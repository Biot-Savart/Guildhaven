import { VILLAGE_BUILDINGS } from '../data/villageWorld.ts';
import type { ApprovalItem, TaskSource, VillageTask } from '../types/village.ts';

export type TrendWindow = '24h' | '7d' | '14d';

export interface EnrichedTaskMetric {
  task: VillageTask;
  department: string;
  source: TaskSource;
  isCompleted: boolean;
  fulfillmentSeconds: number;
  timestampMs: number;
}

export interface TrendBucketPoint {
  label: string;
  completed: number;
  pendingApproval: number;
  total: number;
}

export interface DepartmentFulfillmentPoint {
  department: string;
  shortDepartment: string;
  avgSeconds: number;
  taskCount: number;
  completedCount: number;
}

export interface SourceDistributionPoint {
  source: TaskSource;
  label: 'Gmail' | 'Calendar' | 'Google Chat' | 'Google Docs' | 'Google Drive' | 'Manual';
  count: number;
  percentage: number;
  avgSeconds: number;
  color: string;
}

const DIRECTOR_DEPARTMENT_MAP: Record<string, string> = {
  daniel: 'Inbox & Calendar',
  elena: 'YouTube Studio',
  marcus: 'Finance & Money',
  aria: 'Research & Intel',
  devon: 'Operations House',
  layla: 'Creative & Comms',
  noah: 'Health & Home',
  kieran: 'Systems & Dev',
};

const SHORT_DEPARTMENT_LABELS: Record<string, string> = {
  'Inbox & Calendar': 'Inbox & Cal',
  'YouTube Studio': 'YouTube',
  'Finance & Money': 'Finance',
  'Research & Intel': 'Research',
  'Operations House': 'Operations',
  'Creative & Comms': 'Creative',
  'Health & Home': 'Health & Home',
  'Systems & Dev': 'Systems & Dev',
};

export function resolveTaskDepartment(task: Pick<VillageTask, 'assignedDirectorId' | 'assignedDirectorName'>): string {
  if (task.assignedDirectorId && DIRECTOR_DEPARTMENT_MAP[task.assignedDirectorId]) {
    return DIRECTOR_DEPARTMENT_MAP[task.assignedDirectorId];
  }
  const byBuilding = VILLAGE_BUILDINGS.find((b) => b.directorId === task.assignedDirectorId);
  if (byBuilding) return byBuilding.name;
  return task.assignedDirectorName || 'Village';
}

const GMAIL_REGEX = /\b(gmail|email|emails|inbox|unread|draft reply|reply draft|mail thread|follow-up email|send draft)\b/i;
const CALENDAR_REGEX = /\b(google calendar|calendar|schedule|meeting|meetings|appointment|appointments|agenda|reschedule|time block|calendar invite)\b/i;
const CHAT_REGEX = /\b(google chat|chat space|chat spaces|spaces\/|chat thread|chat room|message space)\b/i;
const DOCS_REGEX = /\b(google doc|google docs|docs\.google\.com\/document|document draft|save to docs|export to docs)\b/i;
const DRIVE_REGEX = /\b(google drive|drive\.google\.com|drive folder|drive file|drive files|shared drive|my drive|save to drive|upload to drive)\b/i;

/**
 * Classifies how a task originated: Gmail, Calendar, Google Chat, Google Docs, Google Drive, or Manual prompt.
 * Uses explicit taskSource when recorded, or deterministically inspects prompt & approval metadata
 * for tasks persisted prior to telemetry capture.
 */
export function classifyTaskSource(
  textOrTask: string | Pick<VillageTask, 'prompt' | 'taskSource' | 'approvalId' | 'id'>,
  approvals: ApprovalItem[] = []
): TaskSource {
  if (typeof textOrTask !== 'string' && textOrTask.taskSource) {
    return textOrTask.taskSource;
  }

  const prompt = typeof textOrTask === 'string' ? textOrTask : textOrTask.prompt || '';

  if (typeof textOrTask !== 'string') {
    const linkedApproval = approvals.find(
      (a) => a.taskId === textOrTask.id || (textOrTask.approvalId && a.id === textOrTask.approvalId)
    );
    if (linkedApproval?.type === 'email_draft') {
      return 'gmail';
    }
    if (linkedApproval?.type === 'chat_message') {
      return 'chat';
    }
    if (linkedApproval?.type === 'google_doc') {
      return 'docs';
    }
    if (linkedApproval?.type === 'drive_file') {
      return 'drive';
    }
  }

  const candidates: Array<{ source: TaskSource; index: number }> = [];
  const gmailMatch = prompt.match(GMAIL_REGEX);
  const calendarMatch = prompt.match(CALENDAR_REGEX);
  const chatMatch = prompt.match(CHAT_REGEX);
  const docsMatch = prompt.match(DOCS_REGEX);
  const driveMatch = prompt.match(DRIVE_REGEX);

  if (gmailMatch) candidates.push({ source: 'gmail', index: gmailMatch.index ?? 0 });
  if (calendarMatch) candidates.push({ source: 'calendar', index: calendarMatch.index ?? 0 });
  if (chatMatch) candidates.push({ source: 'chat', index: chatMatch.index ?? 0 });
  if (docsMatch) candidates.push({ source: 'docs', index: docsMatch.index ?? 0 });
  if (driveMatch) candidates.push({ source: 'drive', index: driveMatch.index ?? 0 });

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.index - b.index);
    return candidates[0].source;
  }
  return 'manual';
}

/**
 * Resolves task fulfillment duration in seconds.
 * Prioritizes measured execution latency (`fulfillmentMs`), then (`completedAt - createdAt`),
 * and falls back to a deterministic complexity estimate for legacy tasks lacking duration metadata.
 */
export function resolveTaskFulfillmentSeconds(task: VillageTask): number {
  if (typeof task.fulfillmentMs === 'number' && Number.isFinite(task.fulfillmentMs) && task.fulfillmentMs > 0) {
    return Number((task.fulfillmentMs / 1000).toFixed(1));
  }

  const startMs = Date.parse(task.createdAt);
  const endMs = task.completedAt ? Date.parse(task.completedAt) : NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const deltaSec = (endMs - startMs) / 1000;
    // Cap at 120s in case a pending approval sat waiting for human sign-off for hours
    if (deltaSec <= 120) {
      return Number(deltaSec.toFixed(1));
    }
  }

  // Deterministic model-based estimate for older persisted tasks without recorded fulfillmentMs
  const markdownChars = (task.reportMarkdown || '').length;
  const charContribution = Math.min(8.5, markdownChars / 420);
  const groundingContribution = (task.groundingSources?.length ?? 0) > 0 ? 3.4 : 0;
  const advisorContribution = task.escalatedToAdvisor ? 4.2 : 0;
  const baseSeconds = 5.2 + charContribution + groundingContribution + advisorContribution;
  return Number(baseSeconds.toFixed(1));
}

export function buildEnrichedTaskMetrics(
  tasks: VillageTask[],
  approvals: ApprovalItem[]
): EnrichedTaskMetric[] {
  const approvedIds = new Set(
    approvals.filter((a) => a.status === 'approved').map((a) => a.id)
  );
  const approvedTaskIds = new Set(
    approvals.filter((a) => a.status === 'approved').map((a) => a.taskId)
  );

  return tasks.map((task) => {
    const isCompleted =
      task.status === 'completed' ||
      approvedTaskIds.has(task.id) ||
      (task.approvalId != null && approvedIds.has(task.approvalId));
    const ts = Date.parse(task.completedAt || task.createdAt);
    return {
      task,
      department: resolveTaskDepartment(task),
      source: classifyTaskSource(task, approvals),
      isCompleted,
      fulfillmentSeconds: resolveTaskFulfillmentSeconds(task),
      timestampMs: Number.isFinite(ts) ? ts : Date.now(),
    };
  });
}

export function buildCompletionTrendSeries(
  metrics: EnrichedTaskMetric[],
  windowMode: TrendWindow,
  nowMs = Date.now()
): TrendBucketPoint[] {
  if (windowMode === '24h') {
    // 6 four-hour buckets across the last 24 hours
    const bucketMs = 4 * 60 * 60 * 1000;
    const buckets: TrendBucketPoint[] = [];
    for (let i = 5; i >= 0; i--) {
      const end = nowMs - i * bucketMs;
      const start = end - bucketMs;
      const d = new Date(end);
      const label = d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      let completed = 0;
      let pendingApproval = 0;
      for (const m of metrics) {
        if (m.timestampMs > start && m.timestampMs <= end) {
          if (m.isCompleted) completed += 1;
          else pendingApproval += 1;
        }
      }
      buckets.push({
        label,
        completed,
        pendingApproval,
        total: completed + pendingApproval,
      });
    }
    return buckets;
  }

  const days = windowMode === '7d' ? 7 : 14;
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  const buckets: TrendBucketPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart.getTime() - i * dayMs;
    const end = start + dayMs;
    const label = new Date(start).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
    let completed = 0;
    let pendingApproval = 0;
    for (const m of metrics) {
      if (m.timestampMs >= start && m.timestampMs < end) {
        if (m.isCompleted) completed += 1;
        else pendingApproval += 1;
      }
    }
    buckets.push({
      label,
      completed,
      pendingApproval,
      total: completed + pendingApproval,
    });
  }
  return buckets;
}

export function buildDepartmentFulfillmentSeries(
  metrics: EnrichedTaskMetric[]
): DepartmentFulfillmentPoint[] {
  const byDept = new Map<
    string,
    { totalSec: number; count: number; completedCount: number }
  >();

  for (const m of metrics) {
    const cur = byDept.get(m.department) ?? {
      totalSec: 0,
      count: 0,
      completedCount: 0,
    };
    cur.totalSec += m.fulfillmentSeconds;
    cur.count += 1;
    if (m.isCompleted) cur.completedCount += 1;
    byDept.set(m.department, cur);
  }

  return Array.from(byDept.entries())
    .map(([department, agg]) => ({
      department,
      shortDepartment: SHORT_DEPARTMENT_LABELS[department] ?? department,
      avgSeconds: Number((agg.totalSec / Math.max(1, agg.count)).toFixed(1)),
      taskCount: agg.count,
      completedCount: agg.completedCount,
    }))
    .sort((a, b) => b.avgSeconds - a.avgSeconds);
}

export const SOURCE_COLORS: Record<TaskSource, string> = {
  gmail: '#38bdf8', // sky-400
  calendar: '#10b981', // emerald-500
  chat: '#a78bfa', // violet-400
  docs: '#60a5fa', // blue-400
  drive: '#fb923c', // orange-400
  manual: '#f59e0b', // amber-500
};

export const SOURCE_LABELS: Record<
  TaskSource,
  'Gmail' | 'Calendar' | 'Google Chat' | 'Google Docs' | 'Google Drive' | 'Manual'
> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  chat: 'Google Chat',
  docs: 'Google Docs',
  drive: 'Google Drive',
  manual: 'Manual',
};

export function buildSourceDistributionSeries(
  metrics: EnrichedTaskMetric[]
): SourceDistributionPoint[] {
  const total = metrics.length;
  const order: TaskSource[] = ['manual', 'gmail', 'calendar', 'chat', 'docs', 'drive'];

  return order.map((source) => {
    const matching = metrics.filter((m) => m.source === source);
    const count = matching.length;
    const sumSec = matching.reduce((acc, m) => acc + m.fulfillmentSeconds, 0);
    return {
      source,
      label: SOURCE_LABELS[source],
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      avgSeconds: count > 0 ? Number((sumSec / count).toFixed(1)) : 0,
      color: SOURCE_COLORS[source],
    };
  });
}
