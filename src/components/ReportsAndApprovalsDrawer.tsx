import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  BarChart3,
  BookOpen,
  Calendar,
  Check,
  Download,
  ExternalLink,
  FileText,
  HardDrive,
  PencilLine,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  formatPacketTtlLabel,
  formatSourceTriggerLabel,
  isDecisionPacketExpired,
} from '../data/automationDefaults';
import { exportTaskReportAsPdf } from '../lib/pdfExport';
import { FormattedMarkdown } from './FormattedMarkdown';
import { HandoffTracePanel } from './HandoffTracePanel';
import { KbDecisionPacketCard, type KbProposalEdits } from './KbDecisionPacketCard';
import { SpeakButton } from './SpeakButton';
import { TaskAnalyticsView } from './TaskAnalyticsView';
import type {
  Agent,
  ApprovalItem,
  DriveWorkingFolderConfig,
  DriveWorkingFolderWriteMode,
  HandoffTrace,
  KnowledgeEntry,
  KnowledgeProposal,
  TaskPriority,
  VillageTask,
} from '../types/village';

export type DrawerTab = 'reports' | 'approvals' | 'history' | 'analytics';
type HistoryScopeFilter = 'all' | 'archived' | 'grounded' | 'advisor';

interface ReportsAndApprovalsDrawerProps {
  initialTab: DrawerTab;
  focusedTaskId?: string | null;
  activeTownTraceTaskId?: string | null;
  agents?: Agent[];
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  kbProposals?: KnowledgeProposal[];
  kbBusyMap?: Record<string, 'approving' | 'revising' | 'rejecting'>;
  knowledgeBase: KnowledgeEntry[];
  workingFolder?: DriveWorkingFolderConfig | null;
  workingFolderWriteMode?: DriveWorkingFolderWriteMode;
  calendarWriteAccess?: boolean;
  isGoogleConnected: boolean;
  isDispatching: boolean;
  onTabChange?: (tab: DrawerTab) => void;
  onVisualizeTraceInTown?: (trace: HandoffTrace) => void;
  onOpenSettings?: (tab?: 'guardrails' | 'autopilot' | 'audio' | 'village') => void;
  onOpenWorkspace?: (tab?: 'overview' | 'calendar' | 'chat' | 'docs' | 'drive') => void;
  onClose: () => void;
  onApproveItem: (item: ApprovalItem) => Promise<void>;
  onUpdateApprovalItem?: (item: ApprovalItem) => void;
  onRejectItem: (item: ApprovalItem) => void;
  onDismissExpiredPackets?: (
    mode: 'expired_only' | 'clear_all_resolved'
  ) => Promise<number | void> | void;
  onApproveKbProposal?: (proposal: KnowledgeProposal, edits?: KbProposalEdits) => Promise<void>;
  onRequestKbRevision?: (proposal: KnowledgeProposal, feedback: string) => Promise<void>;
  onRejectKbProposal?: (proposal: KnowledgeProposal, reason?: string) => Promise<void>;
  onRedispatchTask: (prompt: string, priority?: TaskPriority) => Promise<void>;
  onPrefillTask: (prompt: string, priority?: TaskPriority) => void;
  onIndexTaskToKnowledge: (task: VillageTask) => Promise<void>;
  onArchiveTask?: (taskId: string) => void;
  onRestoreTask?: (taskId: string) => void;
  onExportTaskToGoogleDoc?: (task: VillageTask) => Promise<{ url: string; title: string }>;
  onExportTaskToDrive?: (task: VillageTask) => Promise<{ url: string; name: string }>;
}

function formatShortTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const CALENDAR_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function formatCalendarTimestamp(iso?: string): string {
  if (!iso) return '';
  const trimmed = iso.trim();
  if (!trimmed) return '';
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnlyMatch) {
    const [, y, m, d] = dateOnlyMatch;
    const monthName = CALENDAR_MONTHS[Number(m) - 1] ?? m;
    return `${monthName} ${Number(d)}, ${y} (All day)`;
  }
  const explicitMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
      trimmed
    );
  if (explicitMatch) {
    const [, , m, d, hm, tz] = explicitMatch;
    const monthName = CALENDAR_MONTHS[Number(m) - 1] ?? m;
    const tzLabel = tz.toUpperCase() === 'Z' ? 'UTC' : tz;
    return `${monthName} ${Number(d)}, ${hm} (${tzLabel})`;
  }
  return formatShortTimestamp(trimmed) || trimmed;
}

function isoToDateTimeLocalValue(iso?: string): string {
  if (!iso) return '';
  const trimmed = iso.trim();
  const explicitMatch =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/i.exec(
      trimmed
    );
  if (explicitMatch) {
    return `${explicitMatch[1]}T${explicitMatch[2]}`;
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return `${dateOnly[1]}T09:00`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(
    parsed.getHours()
  )}:${pad(parsed.getMinutes())}`;
}

function dateTimeLocalToIsoPreservingOffset(localValue: string, originalIso?: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(localValue.trim());
  if (!match) return localValue.trim();
  const [, ymd, hm, sec = '00'] = match;
  const origOffsetMatch = /(Z|[+-]\d{2}:\d{2})$/i.exec((originalIso || '').trim());
  if (origOffsetMatch) {
    return `${ymd}T${hm}:${sec}${origOffsetMatch[1]}`;
  }
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hm.split(':').map(Number);
  const dt = new Date(y, mo - 1, d, h, mi, Number(sec));
  const offsetMins = -dt.getTimezoneOffset();
  const sign = offsetMins >= 0 ? '+' : '-';
  const absMins = Math.abs(offsetMins);
  const hh = String(Math.floor(absMins / 60)).padStart(2, '0');
  const mm = String(absMins % 60).padStart(2, '0');
  return `${ymd}T${hm}:${sec}${sign}${hh}:${mm}`;
}

function getPriorityMeta(priority?: TaskPriority): { label: string; textClass: string } {
  if (priority === 'high') {
    return { label: 'High', textClass: 'text-rose-400' };
  }
  if (priority === 'low') {
    return { label: 'Low', textClass: 'text-slate-400' };
  }
  return { label: 'Med', textClass: 'text-sky-300' };
}

interface TaskProgressMeta {
  percent: number;
  workerLabel: string;
  stageLabel: string;
  barColorClass: string;
  textColorClass: string;
  isExecuting: boolean;
}

function getTaskProgressMeta(
  task: VillageTask,
  agents: Agent[],
  approvals: ApprovalItem[]
): TaskProgressMeta | null {
  if (task.status === 'completed' || task.status === 'failed') return null;

  const assignedWorker = task.assignedWorkerId
    ? agents.find((a) => a.id === task.assignedWorkerId)
    : undefined;

  if (task.status === 'needs_approval') {
    const linkedApproval = approvals.find(
      (a) => a.id === task.approvalId || a.taskId === task.id
    );
    if (linkedApproval && (linkedApproval.status === 'approved' || linkedApproval.status === 'rejected')) {
      return null;
    }
    const percent = Math.max(0, Math.min(100, Math.round(task.progressPercent ?? 92)));
    const workerLabel =
      assignedWorker?.name ??
      (task.assignedDirectorName && task.assignedDirectorName !== 'Matt'
        ? `${task.assignedDirectorName}'s Specialist`
        : 'Guild Specialist');
    return {
      percent,
      workerLabel,
      stageLabel: task.progressLabel || 'Awaiting CHO approval',
      barColorClass: 'bg-amber-400',
      textColorClass: 'text-amber-300',
      isExecuting: false,
    };
  }

  const defaultPercents: Record<
    Exclude<VillageTask['status'], 'completed' | 'needs_approval' | 'failed'>,
    number
  > = {
    queued: 8,
    matt_routing: 22,
    worker_executing: 58,
    director_review: 86,
    advisor_escalated: 91,
  };
  const defaultStages: Record<
    Exclude<VillageTask['status'], 'completed' | 'needs_approval' | 'failed'>,
    string
  > = {
    queued: 'Queued for routing',
    matt_routing: 'Routing to department',
    worker_executing: 'Executing assignment',
    director_review: 'Director reviewing draft',
    advisor_escalated: 'Senior Advisor review',
  };

  const statusKey = task.status;
  const rawPercent = task.progressPercent ?? defaultPercents[statusKey];
  const percent = Math.max(4, Math.min(99, Math.round(rawPercent)));
  const workerLabel =
    statusKey === 'queued' || statusKey === 'matt_routing'
      ? 'Matt'
      : assignedWorker?.name ??
        (statusKey === 'director_review' && task.assignedDirectorName && task.assignedDirectorName !== 'Matt'
          ? task.assignedDirectorName
          : task.assignedDirectorName && task.assignedDirectorName !== 'Matt'
            ? `${task.assignedDirectorName}'s Specialist`
            : 'Guild Specialist');

  const isAdvisor = statusKey === 'advisor_escalated';
  return {
    percent,
    workerLabel,
    stageLabel: task.progressLabel || defaultStages[statusKey],
    barColorClass: isAdvisor ? 'bg-amber-400' : 'bg-sky-400',
    textColorClass: isAdvisor ? 'text-amber-300' : 'text-sky-300',
    isExecuting: true,
  };
}

export const ReportsAndApprovalsDrawer: React.FC<ReportsAndApprovalsDrawerProps> = ({
  initialTab,
  focusedTaskId = null,
  activeTownTraceTaskId = null,
  agents = [],
  tasks,
  approvals,
  kbProposals = [],
  kbBusyMap = {},
  knowledgeBase,
  workingFolder = null,
  workingFolderWriteMode = 'direct_in_folder',
  calendarWriteAccess = false,
  isGoogleConnected,
  isDispatching,
  onTabChange,
  onVisualizeTraceInTown,
  onOpenSettings,
  onOpenWorkspace,
  onClose,
  onApproveItem,
  onUpdateApprovalItem,
  onRejectItem,
  onDismissExpiredPackets,
  onApproveKbProposal,
  onRequestKbRevision,
  onRejectKbProposal,
  onRedispatchTask,
  onPrefillTask,
  onIndexTaskToKnowledge,
  onArchiveTask,
  onRestoreTask,
  onExportTaskToGoogleDoc,
  onExportTaskToDrive,
}) => {
  const activeReportTasks = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'resolved'>('pending');
  const [reportsSearchQuery, setReportsSearchQuery] = useState('');
  const filteredReportTasks = useMemo(() => {
    const q = reportsSearchQuery.trim().toLowerCase();
    if (!q) return activeReportTasks;
    return activeReportTasks.filter(
      (t) => t.prompt.toLowerCase().includes(q) || t.summary.toLowerCase().includes(q)
    );
  }, [activeReportTasks, reportsSearchQuery]);
  const [selectedTask, setSelectedTask] = useState<VillageTask | null>(
    () =>
      (focusedTaskId ? tasks.find((t) => t.id === focusedTaskId) : null) ??
      tasks.find((t) => !t.archived) ??
      null
  );
  const activeTask = useMemo(
    () =>
      selectedTask
        ? filteredReportTasks.find((t) => t.id === selectedTask.id) ?? filteredReportTasks[0]
        : filteredReportTasks[0],
    [filteredReportTasks, selectedTask]
  );
  const activeTaskProgress = activeTask ? getTaskProgressMeta(activeTask, agents, approvals) : null;
  const [confirmItem, setConfirmItem] = useState<ApprovalItem | null>(null);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, ApprovalItem['payload']>>({});
  const [confirmExportTask, setConfirmExportTask] = useState<VillageTask | null>(null);
  const [exportingTaskId, setExportingTaskId] = useState<string | null>(null);
  const [confirmDriveExportTask, setConfirmDriveExportTask] = useState<VillageTask | null>(null);
  const [exportingDriveTaskId, setExportingDriveTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isDismissingPackets, setIsDismissingPackets] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTickMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  // History search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [directorFilter, setDirectorFilter] = useState<string>('all');
  const [scopeFilter, setScopeFilter] = useState<HistoryScopeFilter>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest'>('newest');
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [redispatchingId, setRedispatchingId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusedTaskId) return;
    const target = tasks.find((t) => t.id === focusedTaskId);
    if (target) {
      setReportsSearchQuery('');
      setSelectedTask(target);
    }
  }, [focusedTaskId, tasks]);

  const topTask = activeReportTasks[0];
  useEffect(() => {
    if (focusedTaskId) return;
    if (
      topTask &&
      topTask.status !== 'completed' &&
      topTask.status !== 'needs_approval' &&
      topTask.status !== 'failed'
    ) {
      setSelectedTask(topTask);
    }
  }, [topTask?.id, focusedTaskId]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const switchTab = (next: DrawerTab) => {
    setTab(next);
    onTabChange?.(next);
  };

  const startEditingApproval = (item: ApprovalItem) => {
    setApprovalDrafts((prev) => ({
      ...prev,
      [item.id]: prev[item.id] ? { ...prev[item.id] } : { ...item.payload },
    }));
    setEditingApprovalId(item.id);
  };

  const updateApprovalDraftField = (
    itemId: string,
    basePayload: ApprovalItem['payload'],
    patch: Partial<ApprovalItem['payload']>
  ) => {
    setApprovalDrafts((prev) => ({
      ...prev,
      [itemId]: {
        ...(prev[itemId] ?? basePayload),
        ...patch,
      },
    }));
  };

  const resolveEditedApprovalItem = (item: ApprovalItem): ApprovalItem => {
    const draft = approvalDrafts[item.id];
    if (!draft) return item;
    return {
      ...item,
      payload: {
        ...item.payload,
        ...draft,
      },
    };
  };

  const saveApprovalEditsInline = (item: ApprovalItem) => {
    const merged = resolveEditedApprovalItem(item);
    onUpdateApprovalItem?.(merged);
    setEditingApprovalId(null);
    setActionMsg(`Saved inline edits for "${merged.title}".`);
  };

  const pendingApprovals = useMemo(
    () =>
      approvals.filter(
        (a) => a.status === 'pending' && !isDecisionPacketExpired(a, nowTickMs)
      ),
    [approvals, nowTickMs]
  );
  const resolvedApprovals = useMemo(
    () =>
      approvals.filter(
        (a) => a.status !== 'pending' || isDecisionPacketExpired(a, nowTickMs)
      ),
    [approvals, nowTickMs]
  );
  const pendingKbProposals = useMemo(
    () =>
      kbProposals.filter(
        (p) => p.status === 'pending' && !isDecisionPacketExpired(p, nowTickMs)
      ),
    [kbProposals, nowTickMs]
  );
  const resolvedKbProposals = useMemo(
    () =>
      kbProposals.filter(
        (p) => p.status !== 'pending' || isDecisionPacketExpired(p, nowTickMs)
      ),
    [kbProposals, nowTickMs]
  );
  const expiredPacketsCount = useMemo(() => {
    const expAppr = approvals.filter((a) => isDecisionPacketExpired(a, nowTickMs)).length;
    const expKb = kbProposals.filter((p) => isDecisionPacketExpired(p, nowTickMs)).length;
    return expAppr + expKb;
  }, [approvals, kbProposals, nowTickMs]);
  const totalPendingCount = pendingApprovals.length + pendingKbProposals.length;
  const totalResolvedCount = resolvedApprovals.length + resolvedKbProposals.length;
  const visibleApprovals = approvalFilter === 'pending' ? pendingApprovals : resolvedApprovals;
  const visibleKbProposals =
    approvalFilter === 'pending' ? pendingKbProposals : resolvedKbProposals;

  const completedTaskIds = useMemo(() => {
    const approvedIds = new Set(
      approvals.filter((a) => a.status === 'approved').map((a) => a.id)
    );
    const approvedTaskIds = new Set(
      approvals.filter((a) => a.status === 'approved').map((a) => a.taskId)
    );
    const ids = new Set<string>();
    for (const t of tasks) {
      if (
        t.status === 'completed' ||
        approvedTaskIds.has(t.id) ||
        (t.approvalId != null && approvedIds.has(t.approvalId))
      ) {
        ids.add(t.id);
      }
    }
    return ids;
  }, [tasks, approvals]);

  const completedTasks = useMemo(
    () => tasks.filter((t) => completedTaskIds.has(t.id)),
    [tasks, completedTaskIds]
  );

  const archivedCount = useMemo(
    () => completedTasks.filter((t) => Boolean(t.archived)).length,
    [completedTasks]
  );

  const directorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of completedTasks) {
      if (t.assignedDirectorId && t.assignedDirectorName) {
        map.set(t.assignedDirectorId, t.assignedDirectorName);
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [completedTasks]);

  const filteredHistory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = completedTasks.filter((t) => {
      if (directorFilter !== 'all' && t.assignedDirectorId !== directorFilter) {
        return false;
      }
      if (scopeFilter === 'archived' && !t.archived) {
        return false;
      }
      if (scopeFilter === 'grounded' && t.groundingSources.length === 0) {
        return false;
      }
      if (scopeFilter === 'advisor' && !t.escalatedToAdvisor) {
        return false;
      }
      if (!q) return true;
      return (
        t.prompt.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.reportMarkdown.toLowerCase().includes(q) ||
        t.assignedDirectorName.toLowerCase().includes(q) ||
        t.routingNote.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      const ta = Date.parse(a.createdAt) || 0;
      const tb = Date.parse(b.createdAt) || 0;
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });
  }, [completedTasks, directorFilter, scopeFilter, searchQuery, sortOrder]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 || directorFilter !== 'all' || scopeFilter !== 'all';

  const resetHistoryFilters = () => {
    setSearchQuery('');
    setDirectorFilter('all');
    setScopeFilter('all');
  };

  const handleConfirmApproval = async () => {
    if (!confirmItem) return;
    setBusyId(confirmItem.id);
    setActionMsg(null);
    try {
      await onApproveItem(confirmItem);
      setActionMsg(
        confirmItem.type === 'email_draft'
          ? isGoogleConnected
            ? 'Saved safely to your Gmail Drafts (not sent).'
            : 'Email draft approved locally. Sign in with Google to push drafts directly to Gmail.'
          : confirmItem.type === 'chat_message'
            ? 'Message sent to your Google Chat space.'
            : confirmItem.type === 'google_doc'
              ? `Created Google Doc "${confirmItem.payload.docTitle || confirmItem.title}".`
              : confirmItem.type === 'drive_file'
                ? `Saved "${confirmItem.payload.driveFileName || confirmItem.title}" to your Google Drive.`
                : confirmItem.type === 'calendar_event'
                  ? `Added "${confirmItem.payload.eventSummary || confirmItem.title}" to your primary Google Calendar.`
                  : `Approved "${confirmItem.title}".`
      );
      setConfirmItem(null);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Approval action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmExportDoc = async () => {
    if (!confirmExportTask || !onExportTaskToGoogleDoc) return;
    setExportingTaskId(confirmExportTask.id);
    setActionMsg(null);
    try {
      const created = await onExportTaskToGoogleDoc(confirmExportTask);
      setActionMsg(`Created Google Doc "${created.title}" in your Google Docs account.`);
      setConfirmExportTask(null);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Failed to create Google Doc.');
    } finally {
      setExportingTaskId(null);
    }
  };

  const canAutoSaveToWorkingFolder =
    Boolean(workingFolder?.id) && workingFolderWriteMode === 'direct_in_folder';

  const handleSaveTaskToDriveClick = async (task: VillageTask) => {
    if (!onExportTaskToDrive) return;
    if (!canAutoSaveToWorkingFolder) {
      setConfirmDriveExportTask(task);
      return;
    }
    setExportingDriveTaskId(task.id);
    setActionMsg(null);
    try {
      const saved = await onExportTaskToDrive(task);
      setActionMsg(
        `Saved "${saved.name}" to Working Folder "${workingFolder?.name}".`
      );
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Failed to save to Google Drive.');
    } finally {
      setExportingDriveTaskId(null);
    }
  };

  const handleConfirmExportDrive = async () => {
    if (!confirmDriveExportTask || !onExportTaskToDrive) return;
    setExportingDriveTaskId(confirmDriveExportTask.id);
    setActionMsg(null);
    try {
      const saved = await onExportTaskToDrive(confirmDriveExportTask);
      setActionMsg(
        workingFolder
          ? `Saved "${saved.name}" to "${workingFolder.name}".`
          : `Saved "${saved.name}" to your Google Drive.`
      );
      setConfirmDriveExportTask(null);
    } catch (err) {
      setActionMsg(err instanceof Error ? err.message : 'Failed to save to Google Drive.');
    } finally {
      setExportingDriveTaskId(null);
    }
  };

  const handleRedispatch = async (task: VillageTask) => {
    if (isDispatching) return;
    setRedispatchingId(task.id);
    setActionMsg(null);
    try {
      await onRedispatchTask(task.prompt, task.priority);
    } finally {
      setRedispatchingId(null);
    }
  };

  const handleArchiveTask = (task: VillageTask) => {
    if (!onArchiveTask) return;
    onArchiveTask(task.id);
    if (selectedTask?.id === task.id) {
      const next = activeReportTasks.find((t) => t.id !== task.id) ?? null;
      setSelectedTask(next);
    }
    setActionMsg('Moved completed report to the History log.');
  };

  const handleRestoreTask = (task: VillageTask, openInReports = false) => {
    if (!onRestoreTask) return;
    onRestoreTask(task.id);
    setSelectedTask(task);
    if (openInReports) {
      switchTab('reports');
    }
    setActionMsg('Restored report to the active Reports dashboard.');
  };

  return (
    <aside
      className={`absolute right-3 top-3 bottom-3 z-30 ${
        tab === 'analytics' ? 'w-[620px]' : 'w-[560px]'
      } max-w-[calc(100vw-1.5rem)] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            onClick={() => switchTab('reports')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'reports' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Reports ({activeReportTasks.length})
          </button>
          <button
            onClick={() => switchTab('approvals')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'approvals' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Approvals ({totalPendingCount})
          </button>
          <button
            onClick={() => switchTab('history')}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'history' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            History ({completedTasks.length})
          </button>
          <button
            onClick={() => switchTab('analytics')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'analytics' ? 'bg-amber-500 text-slate-950' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Analytics</span>
          </button>
        </div>
        <button
          onClick={onClose}
          aria-label="Close drawer"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {actionMsg && (
        <div className="border-b border-slate-800 bg-emerald-950/60 px-4 py-2 text-xs text-emerald-200">
          {actionMsg}
        </div>
      )}

      {tab === 'reports' ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {tasks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-slate-400 leading-relaxed">
              Assign a task in the bottom command bar. Matt will call the right Director, their guild specialist will execute it, and the finished report will appear here ready for PDF export.
            </div>
          ) : activeReportTasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <p className="text-xs font-semibold text-slate-200">
                Active Reports dashboard is clear
              </p>
              <p className="max-w-xs text-xs text-slate-400 leading-relaxed">
                All completed deliverables have been archived to the History log. Assign a new task below or browse archived reports in History.
              </p>
              <button
                type="button"
                onClick={() => {
                  setScopeFilter('archived');
                  switchTab('history');
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
              >
                <Archive className="h-3.5 w-3.5 text-amber-400" />
                <span>View History ({completedTasks.length})</span>
              </button>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-800 bg-slate-950/50 px-4 py-3 space-y-1.5">
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={reportsSearchQuery}
                    onChange={(e) => setReportsSearchQuery(e.target.value)}
                    placeholder="Filter tasks by prompt or summary..."
                    aria-label="Filter tasks by prompt or summary"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                  />
                  {reportsSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setReportsSearchQuery('')}
                      aria-label="Clear report search"
                      className="absolute right-2.5 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {reportsSearchQuery.trim() && (
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    Showing {filteredReportTasks.length} of {activeReportTasks.length}{' '}
                    {activeReportTasks.length === 1 ? 'report' : 'reports'}
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {filteredReportTasks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center space-y-2.5">
                    <p className="text-xs font-medium text-slate-300">
                      No active reports match &ldquo;{reportsSearchQuery.trim()}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={() => setReportsSearchQuery('')}
                      className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {filteredReportTasks.map((t) => {
                      const meta = getTaskProgressMeta(t, agents, approvals);
                      const isCompleted = completedTaskIds.has(t.id);
                      return (
                        <div
                          key={t.id}
                          className={`rounded-lg border p-3 transition-colors ${
                            activeTask?.id === t.id
                              ? 'border-amber-500/70 bg-slate-800/80'
                              : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2.5">
                            <button
                              type="button"
                              onClick={() => setSelectedTask(t)}
                              className="min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-white truncate">
                                  {t.prompt}
                                </span>
                                <span className="text-[11px] whitespace-nowrap shrink-0">
                                  {t.status === 'failed' && (
                                    <>
                                      <span className="font-semibold text-rose-400">
                                        Fail-Closed
                                      </span>
                                      <span className="text-slate-600" aria-hidden="true"> · </span>
                                    </>
                                  )}
                                  {t.handoffTrace && t.handoffTrace.packets.length > 0 && (
                                    <>
                                      <span className="font-mono text-sky-300 tabular-nums">
                                        {t.handoffTrace.packets.length}{' '}
                                        {t.handoffTrace.packets.length === 1 ? 'hop' : 'hops'}
                                      </span>
                                      <span className="text-slate-600" aria-hidden="true"> · </span>
                                    </>
                                  )}
                                  <span className={getPriorityMeta(t.priority).textClass}>
                                    {getPriorityMeta(t.priority).label}
                                  </span>
                                  <span className="text-slate-600" aria-hidden="true"> · </span>
                                  <span className="text-amber-400">{t.assignedDirectorName}</span>
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] text-slate-400 line-clamp-2">{t.summary}</p>
                            </button>
                            {isCompleted && onArchiveTask && (
                              <button
                                type="button"
                                onClick={() => handleArchiveTask(t)}
                                title="Move completed task to History log"
                                aria-label={`Archive "${t.prompt}" to History`}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Archive className="h-3 w-3 text-slate-400" />
                                <span>Archive</span>
                              </button>
                            )}
                          </div>
                          {meta && (
                            <div className="mt-2.5 border-t border-slate-800/80 pt-2">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate font-medium text-slate-300">
                                  {meta.workerLabel} ·{' '}
                                  <span className={meta.textColorClass}>{meta.stageLabel}</span>
                                </span>
                                <span
                                  className={`font-mono font-semibold tabular-nums shrink-0 ${meta.textColorClass}`}
                                >
                                  {meta.percent}%
                                </span>
                              </div>
                              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                                <div
                                  role="progressbar"
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={meta.percent}
                                  aria-label={`${meta.workerLabel}: ${meta.stageLabel} (${meta.percent}%)`}
                                  style={{ width: `${meta.percent}%` }}
                                  className={`h-full rounded-full transition-all duration-300 ease-out motion-reduce:transition-none ${meta.barColorClass}`}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

              {activeTask && (
                <div className="border-t border-slate-800 pt-4 space-y-3">
                  {activeTaskProgress?.isExecuting && !activeTask.reportMarkdown ? (
                    <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Assignment In Progress</h3>
                          <p className="text-[11px] text-slate-400">
                            {activeTaskProgress.workerLabel} · {activeTaskProgress.stageLabel}
                          </p>
                        </div>
                        <span
                          className={`font-mono text-sm font-semibold tabular-nums ${activeTaskProgress.textColorClass}`}
                        >
                          {activeTaskProgress.percent}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={activeTaskProgress.percent}
                          aria-label={`${activeTaskProgress.workerLabel}: ${activeTaskProgress.stageLabel} (${activeTaskProgress.percent}%)`}
                          style={{ width: `${activeTaskProgress.percent}%` }}
                          className={`h-full rounded-full transition-all duration-300 ease-out motion-reduce:transition-none ${activeTaskProgress.barColorClass}`}
                        />
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed">
                        {activeTask.summary}
                      </p>
                      {activeTask.handoffTrace && (
                        <HandoffTracePanel
                          isActive
                          trace={activeTask.handoffTrace}
                          agents={agents}
                        />
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Executive Deliverable</h3>
                          <p className="text-[11px] text-slate-400">
                            <span className={getPriorityMeta(activeTask.priority).textClass}>
                              {getPriorityMeta(activeTask.priority).label} priority
                            </span>
                            <span aria-hidden="true"> · </span>
                            <span>{activeTask.assignedDirectorName}&apos;s Team</span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            onClick={() => void handleRedispatch(activeTask)}
                            disabled={isDispatching}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>{redispatchingId === activeTask.id ? 'Routing...' : 'Re-dispatch'}</span>
                          </button>
                          {completedTaskIds.has(activeTask.id) && onArchiveTask && (
                            <button
                              type="button"
                              onClick={() => handleArchiveTask(activeTask)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-500 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Archive className="h-3.5 w-3.5 text-slate-400" />
                              <span>Archive</span>
                            </button>
                          )}
                          <button
                            onClick={() => exportTaskReportAsPdf(activeTask)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Download PDF</span>
                          </button>
                        </div>
                      </div>

                      {activeTask.status === 'failed' && (
                        <div className="flex items-start justify-between gap-3 rounded-lg border border-rose-500/40 bg-rose-950/35 px-3 py-2.5 text-xs text-rose-200">
                          <div className="flex items-start gap-2 min-w-0">
                            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                            <div className="space-y-0.5 min-w-0">
                              <p className="font-semibold text-rose-300">
                                Fail-Closed Orchestration Abort
                              </p>
                              <p className="text-rose-200/90 leading-relaxed">
                                {activeTask.orchestrationError ||
                                  'Execution halted safely at loop/timeout cap. No external actions or KB mutations were committed.'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeTaskProgress && (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-950/30 px-3 py-2">
                          <span className="text-xs text-amber-200">
                            {activeTaskProgress.workerLabel} · {activeTaskProgress.stageLabel} (
                            <span className="font-mono font-semibold tabular-nums">
                              {activeTaskProgress.percent}%
                            </span>
                            )
                          </span>
                          <button
                            type="button"
                            onClick={() => switchTab('approvals')}
                            className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Review Approval
                          </button>
                        </div>
                      )}

                      {activeTask.handoffTrace && (
                        <HandoffTracePanel
                          trace={activeTask.handoffTrace}
                          agents={agents}
                          isVisualizedInTown={
                            activeTownTraceTaskId === activeTask.handoffTrace.task_id
                          }
                          onVisualizeInTown={onVisualizeTraceInTown}
                          onOpenKbProposals={() => switchTab('approvals')}
                        />
                      )}

                      {/* Tidy Audio & Workspace Export Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <SpeakButton
                            variant="subtle"
                            itemId={`rep_sum_${activeTask.id}`}
                            label="Listen Summary"
                            turn={{
                              agentId: activeTask.assignedDirectorId,
                              speakerName: activeTask.assignedDirectorName,
                              voiceName: agents.find((a) => a.id === activeTask.assignedDirectorId)?.voiceName,
                              text: activeTask.summary,
                            }}
                          />
                          <SpeakButton
                            variant="subtle"
                            itemId={`rep_full_${activeTask.id}`}
                            label="Read Full Report"
                            turn={{
                              agentId: activeTask.assignedDirectorId,
                              speakerName: activeTask.assignedDirectorName,
                              voiceName: agents.find((a) => a.id === activeTask.assignedDirectorId)?.voiceName,
                              text: `${activeTask.summary}. ${activeTask.reportMarkdown}`,
                              maxChars: 2400,
                            }}
                          />
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              await onIndexTaskToKnowledge(activeTask);
                              setActionMsg('Indexed deliverable into the Village Knowledge Base.');
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <BookOpen className="h-3 w-3 text-amber-400" />
                            <span>
                              {knowledgeBase.some((k) => k.sourceTaskId === activeTask.id)
                                ? 'Indexed in KB'
                                : 'Index in KB'}
                            </span>
                          </button>
                          {activeTask.exportedDocUrl ? (
                            <a
                              href={activeTask.exportedDocUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-sky-500/50 bg-sky-950/60 px-2.5 py-1 text-[11px] font-medium text-sky-200 hover:bg-sky-950 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <ExternalLink className="h-3 w-3 text-sky-400" />
                              <span>Open Google Doc</span>
                            </a>
                          ) : (
                            onExportTaskToGoogleDoc && (
                              <button
                                type="button"
                                onClick={() => setConfirmExportTask(activeTask)}
                                disabled={exportingTaskId === activeTask.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500/60 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <FileText className="h-3 w-3 text-sky-400" />
                                <span>
                                  {exportingTaskId === activeTask.id ? 'Saving...' : 'Save to Docs'}
                                </span>
                              </button>
                            )
                          )}
                          {activeTask.exportedDriveUrl ? (
                            <a
                              href={activeTask.exportedDriveUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-orange-500/50 bg-orange-950/60 px-2.5 py-1 text-[11px] font-medium text-orange-200 hover:bg-orange-950 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <ExternalLink className="h-3 w-3 text-orange-400" />
                              <span>Open in Drive</span>
                            </a>
                          ) : (
                            onExportTaskToDrive && (
                              <button
                                type="button"
                                onClick={() => void handleSaveTaskToDriveClick(activeTask)}
                                disabled={exportingDriveTaskId === activeTask.id}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-orange-500/60 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <HardDrive className="h-3 w-3 text-orange-400" />
                                <span>
                                  {exportingDriveTaskId === activeTask.id ? 'Saving...' : 'Save to Drive'}
                                </span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                        <FormattedMarkdown content={activeTask.reportMarkdown} />
                      </div>

                      {activeTask.groundingSources.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-slate-300">Google Search Sources</p>
                          {activeTask.groundingSources.map((src) => (
                            <a
                              key={src.uri}
                              href={src.uri}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline truncate"
                            >
                              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{src.title}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            </>
          )}
        </div>
      ) : tab === 'approvals' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-300 leading-relaxed flex flex-wrap items-center justify-between gap-2">
            <span>
              <span className="font-semibold text-amber-400">Village Constitution:</span> Emails stay drafts, Google Chat, Docs &amp; Calendar writes require confirmation, and Drive saves target{' '}
              <strong className="font-semibold text-white">
                {workingFolder ? workingFolder.name : 'My Drive'}
              </strong>
              .
            </span>
            <div className="flex items-center gap-3 shrink-0">
              {onOpenWorkspace && (
                <button
                  type="button"
                  onClick={() => onOpenWorkspace('overview')}
                  className="text-[11px] font-medium text-sky-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Open Workspace Hub
                </button>
              )}
              {onOpenSettings && (
                <>
                  <button
                    type="button"
                    onClick={() => onOpenSettings('guardrails')}
                    className="text-[11px] font-medium text-emerald-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Calendar: {calendarWriteAccess ? 'Write On' : 'Read-Only'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenSettings('guardrails')}
                    className="text-[11px] font-medium text-orange-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {workingFolder ? 'Manage Guardrails' : 'Set Working Folder'}
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
              <button
                type="button"
                onClick={() => setApprovalFilter('pending')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  approvalFilter === 'pending'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pending ({totalPendingCount})
              </button>
              <button
                type="button"
                onClick={() => setApprovalFilter('resolved')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  approvalFilter === 'resolved'
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Resolved ({totalResolvedCount})
              </button>
            </div>

            {onDismissExpiredPackets && (
              <div className="flex items-center gap-2 shrink-0">
                {expiredPacketsCount > 0 && (
                  <button
                    type="button"
                    disabled={isDismissingPackets}
                    onClick={async () => {
                      setIsDismissingPackets(true);
                      setActionMsg(null);
                      try {
                        const count = await onDismissExpiredPackets('expired_only');
                        setActionMsg(
                          typeof count === 'number' && count > 0
                            ? `Dismissed ${count} expired decision packet${count === 1 ? '' : 's'}.`
                            : 'Cleared expired decision packets.'
                        );
                      } catch (err) {
                        setActionMsg(
                          err instanceof Error ? err.message : 'Failed to dismiss expired packets.'
                        );
                      } finally {
                        setIsDismissingPackets(false);
                      }
                    }}
                    className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                  >
                    Dismiss Expired ({expiredPacketsCount})
                  </button>
                )}
                {approvalFilter === 'resolved' && totalResolvedCount > 0 && (
                  <button
                    type="button"
                    disabled={isDismissingPackets}
                    onClick={async () => {
                      setIsDismissingPackets(true);
                      setActionMsg(null);
                      try {
                        const count = await onDismissExpiredPackets('clear_all_resolved');
                        setActionMsg(
                          typeof count === 'number' && count > 0
                            ? `Cleared ${count} resolved decision packet${count === 1 ? '' : 's'}.`
                            : 'Cleared resolved decision history.'
                        );
                      } catch (err) {
                        setActionMsg(
                          err instanceof Error ? err.message : 'Failed to clear resolved packets.'
                        );
                      } finally {
                        setIsDismissingPackets(false);
                      }
                    }}
                    className="rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-400 hover:border-slate-700 hover:text-slate-200 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                  >
                    Clear All Resolved
                  </button>
                )}
              </div>
            )}
          </div>

          {visibleKbProposals.length > 0 && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span className="font-semibold text-white tabular-nums">
                  Knowledge Base Decision Packets ({visibleKbProposals.length})
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  KB-GOV-01 · CHO-gated commit
                </span>
              </div>
              {visibleKbProposals.map((proposal) => {
                const liveEntry = knowledgeBase.find(
                  (e) => e.code.toUpperCase() === proposal.id.toUpperCase()
                );
                return (
                  <KbDecisionPacketCard
                    key={proposal.proposal_id}
                    proposal={proposal}
                    liveEntry={liveEntry}
                    busyState={kbBusyMap[proposal.proposal_id] ?? null}
                    nowTickMs={nowTickMs}
                    onApprove={async (p, edits) => {
                      if (!onApproveKbProposal) return;
                      setActionMsg(null);
                      try {
                        await onApproveKbProposal(p, edits);
                        setActionMsg(
                          `Committed [${p.id}] to the Single Source of Truth and refreshed shared agent context.`
                        );
                      } catch (err) {
                        setActionMsg(
                          err instanceof Error ? err.message : 'KB approval failed.'
                        );
                      }
                    }}
                    onRequestRevision={async (p, feedback) => {
                      if (!onRequestKbRevision) return;
                      setActionMsg(null);
                      try {
                        await onRequestKbRevision(p, feedback);
                        setActionMsg(
                          `Routed revision feedback for [${p.id}] back to ${p.proposed_by_name}.`
                        );
                      } catch (err) {
                        setActionMsg(
                          err instanceof Error ? err.message : 'Revision request failed.'
                        );
                      }
                    }}
                    onReject={async (p, reason) => {
                      if (!onRejectKbProposal) return;
                      setActionMsg(null);
                      try {
                        await onRejectKbProposal(p, reason);
                        setActionMsg(`Rejected KB proposal [${p.id}].`);
                      } catch (err) {
                        setActionMsg(
                          err instanceof Error ? err.message : 'Failed to reject proposal.'
                        );
                      }
                    }}
                  />
                );
              })}
            </div>
          )}

          {visibleApprovals.length === 0 && visibleKbProposals.length === 0 ? (
            <div className="py-8 text-center space-y-2">
              <p className="text-xs text-slate-400">
                {approvalFilter === 'pending'
                  ? 'No pending actions or KB proposals awaiting your sign-off.'
                  : 'No resolved approvals yet.'}
              </p>
              {approvalFilter === 'pending' && totalResolvedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setApprovalFilter('resolved')}
                  className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                >
                  View Resolved History ({totalResolvedCount})
                </button>
              )}
            </div>
          ) : (
            visibleApprovals.map((rawItem) => {
              const item = resolveEditedApprovalItem(rawItem);
              const isItemExpired = isDecisionPacketExpired(item, nowTickMs);
              const isEffectivePending = item.status === 'pending' && !isItemExpired;
              const isEditing = editingApprovalId === item.id && isEffectivePending;
              const hasUnsavedDraft = Boolean(approvalDrafts[item.id]);
              const sourceLabel = formatSourceTriggerLabel(
                item.source_trigger,
                item.source_label
              );
              const ttlMeta = formatPacketTtlLabel(item.ttl_expires_at, nowTickMs);
              const statusDisplay = isItemExpired ? 'expired' : item.status;

              return (
                <div
                  key={item.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/70 p-3.5 space-y-2.5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-0.5 min-w-0">
                      <span className="text-xs font-semibold text-white block">{item.title}</span>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 tabular-nums">
                        <span className="text-slate-300">{item.directorName}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-sky-300">{sourceLabel}</span>
                        {ttlMeta && (isEffectivePending || isItemExpired) && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span
                              className={
                                ttlMeta.isExpired
                                  ? 'text-rose-400 font-semibold'
                                  : ttlMeta.isUrgent
                                    ? 'text-amber-300 font-semibold'
                                    : 'text-slate-300'
                              }
                            >
                              {ttlMeta.text}
                            </span>
                          </>
                        )}
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span
                          className={
                            statusDisplay === 'approved'
                              ? 'text-emerald-400 font-medium'
                              : statusDisplay === 'expired'
                                ? 'text-slate-400 font-medium'
                                : statusDisplay === 'rejected'
                                  ? 'text-rose-400 font-medium'
                                  : 'text-slate-400'
                          }
                        >
                          {statusDisplay}
                          {hasUnsavedDraft && isEffectivePending ? ' · edited' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <SpeakButton
                        variant="inline"
                        itemId={`appr_audio_${item.id}`}
                        label="Listen"
                        turn={{
                          agentId: item.directorId,
                          speakerName: item.directorName,
                          voiceName: agents.find((a) => a.id === item.directorId)?.voiceName,
                          text: [
                            `${item.title}. ${item.description}`,
                            item.payload.subject ? `Subject: ${item.payload.subject}.` : '',
                            item.payload.docTitle ? `Document Title: ${item.payload.docTitle}.` : '',
                            item.payload.driveFileName
                              ? `Google Drive File: ${item.payload.driveFileName}.`
                              : '',
                            item.payload.eventSummary
                              ? `Calendar Event: ${item.payload.eventSummary}.`
                              : '',
                            item.payload.eventStart
                              ? `Starts: ${formatCalendarTimestamp(item.payload.eventStart)}.`
                              : '',
                            item.payload.eventEnd
                              ? `Ends: ${formatCalendarTimestamp(item.payload.eventEnd)}.`
                              : '',
                            item.payload.eventLocation
                              ? `Location: ${item.payload.eventLocation}.`
                              : '',
                            item.payload.body ||
                              item.payload.eventDescription ||
                              item.payload.postContent ||
                              '',
                          ]
                            .filter(Boolean)
                            .join(' '),
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-300">{item.description}</p>

                  {/* Inline Editor Mode for Pending Approvals */}
                  {isEditing ? (
                    <div className="rounded-lg border border-amber-500/40 bg-slate-900 p-3 space-y-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-amber-300">
                          Edit Details Before Approving
                        </span>
                        <button
                          type="button"
                          onClick={() => setEditingApprovalId(null)}
                          className="text-[11px] text-slate-400 hover:text-white cursor-pointer"
                        >
                          Done editing
                        </button>
                      </div>

                      {item.type === 'email_draft' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Recipient (To)
                            </label>
                            <input
                              type="text"
                              value={item.payload.to ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  to: e.target.value,
                                })
                              }
                              placeholder="recipient@example.com"
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Subject
                            </label>
                            <input
                              type="text"
                              value={item.payload.subject ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  subject: e.target.value,
                                })
                              }
                              placeholder="Email subject"
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Draft Body
                            </label>
                            <textarea
                              rows={5}
                              value={item.payload.body ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  body: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'calendar_event' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Event Title
                            </label>
                            <input
                              type="text"
                              value={item.payload.eventSummary ?? item.title}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  eventSummary: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                Start Time
                              </label>
                              <input
                                type="datetime-local"
                                value={isoToDateTimeLocalValue(item.payload.eventStart)}
                                onChange={(e) =>
                                  updateApprovalDraftField(item.id, rawItem.payload, {
                                    eventStart: dateTimeLocalToIsoPreservingOffset(
                                      e.target.value,
                                      rawItem.payload.eventStart
                                    ),
                                  })
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums focus:border-amber-500 focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-400 mb-1">
                                End Time
                              </label>
                              <input
                                type="datetime-local"
                                value={isoToDateTimeLocalValue(item.payload.eventEnd)}
                                onChange={(e) =>
                                  updateApprovalDraftField(item.id, rawItem.payload, {
                                    eventEnd: dateTimeLocalToIsoPreservingOffset(
                                      e.target.value,
                                      rawItem.payload.eventEnd || rawItem.payload.eventStart
                                    ),
                                  })
                                }
                                className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums focus:border-amber-500 focus:outline-none"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Location / Meeting Link
                            </label>
                            <input
                              type="text"
                              value={item.payload.eventLocation ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  eventLocation: e.target.value,
                                })
                              }
                              placeholder="Optional location or video link"
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Agenda / Description
                            </label>
                            <textarea
                              rows={3}
                              value={item.payload.eventDescription ?? item.payload.body ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  eventDescription: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'chat_message' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Google Chat Space Resource Name
                            </label>
                            <input
                              type="text"
                              value={item.payload.chatSpaceName ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  chatSpaceName: e.target.value,
                                })
                              }
                              placeholder="spaces/AAAA..."
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Thread Resource Name (Optional — leave blank for new space message)
                            </label>
                            <input
                              type="text"
                              value={item.payload.chatThreadName ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  chatThreadName: e.target.value,
                                })
                              }
                              placeholder="spaces/AAAA.../threads/BBBB..."
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white font-mono focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Message Text
                            </label>
                            <textarea
                              rows={4}
                              value={item.payload.body ?? item.payload.postContent ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  body: e.target.value,
                                  postContent: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'google_doc' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Google Doc Title
                            </label>
                            <input
                              type="text"
                              value={item.payload.docTitle ?? item.title}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  docTitle: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Document Content
                            </label>
                            <textarea
                              rows={6}
                              value={item.payload.body ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  body: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'drive_file' && (
                        <div className="space-y-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Google Drive File Name
                            </label>
                            <input
                              type="text"
                              value={item.payload.driveFileName ?? item.title}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  driveFileName: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              File Content
                            </label>
                            <textarea
                              rows={6}
                              value={item.payload.body ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  body: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'spend' && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Amount
                            </label>
                            <input
                              type="text"
                              value={item.payload.amount ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  amount: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white tabular-nums focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Vendor
                            </label>
                            <input
                              type="text"
                              value={item.payload.vendor ?? ''}
                              onChange={(e) =>
                                updateApprovalDraftField(item.id, rawItem.payload, {
                                  vendor: e.target.value,
                                })
                              }
                              className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}

                      {item.type === 'publish' && (
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Post Content
                          </label>
                          <textarea
                            rows={4}
                            value={item.payload.postContent ?? item.payload.body ?? ''}
                            onChange={(e) =>
                              updateApprovalDraftField(item.id, rawItem.payload, {
                                postContent: e.target.value,
                              })
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setApprovalDrafts((prev) => {
                              const next = { ...prev };
                              delete next[item.id];
                              return next;
                            });
                            setEditingApprovalId(null);
                          }}
                          className="rounded border border-slate-700 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => saveApprovalEditsInline(rawItem)}
                          className="rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer"
                        >
                          Save Edits
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {item.type === 'email_draft' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 space-y-1">
                          {item.payload.to && (
                            <p>
                              <span className="text-slate-400">To:</span> {item.payload.to}
                            </p>
                          )}
                          {item.payload.subject && (
                            <p>
                              <span className="text-slate-400">Subject:</span> {item.payload.subject}
                            </p>
                          )}
                          {item.payload.body && (
                            <p className="whitespace-pre-wrap pt-1 border-t border-slate-800">
                              {item.payload.body}
                            </p>
                          )}
                        </div>
                      )}

                      {item.type === 'chat_message' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 space-y-1">
                          <p>
                            <span className="text-slate-400">Google Chat Space:</span>{' '}
                            <span className="font-medium text-white">
                              {item.payload.chatSpaceDisplayName ||
                                item.payload.chatSpaceName ||
                                'Primary synced Google Chat space'}
                            </span>
                          </p>
                          {item.payload.chatThreadName && (
                            <p className="font-mono tabular-nums text-[10px] text-violet-300 truncate">
                              <span className="font-sans text-slate-400">Replying in Thread:</span>{' '}
                              {item.payload.chatThreadName}
                            </p>
                          )}
                          {(item.payload.body || item.payload.postContent) && (
                            <p className="whitespace-pre-wrap pt-1 border-t border-slate-800">
                              {item.payload.body || item.payload.postContent}
                            </p>
                          )}
                        </div>
                      )}

                      {item.type === 'google_doc' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate">
                              <span className="text-slate-400">Google Doc Title:</span>{' '}
                              <span className="font-medium text-white">
                                {item.payload.docTitle || item.title}
                              </span>
                            </p>
                            {item.payload.documentUrl && (
                              <a
                                href={item.payload.documentUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-sky-400 hover:underline whitespace-nowrap shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Open Doc</span>
                              </a>
                            )}
                          </div>
                          {item.payload.body && (
                            <p className="whitespace-pre-wrap pt-1 border-t border-slate-800 line-clamp-5">
                              {item.payload.body}
                            </p>
                          )}
                        </div>
                      )}

                      {item.type === 'drive_file' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate">
                              <span className="text-slate-400">Google Drive File:</span>{' '}
                              <span className="font-medium text-white">
                                {item.payload.driveFileName || item.title}
                              </span>
                            </p>
                            {item.payload.driveFileUrl && (
                              <a
                                href={item.payload.driveFileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-orange-400 hover:underline whitespace-nowrap shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Open in Drive</span>
                              </a>
                            )}
                          </div>
                          {item.payload.body && (
                            <p className="whitespace-pre-wrap pt-1 border-t border-slate-800 line-clamp-5">
                              {item.payload.body}
                            </p>
                          )}
                        </div>
                      )}

                      {item.type === 'calendar_event' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="inline-flex items-center gap-1.5 min-w-0 truncate">
                              <Calendar className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="font-medium text-white truncate">
                                {item.payload.eventSummary || item.title}
                              </span>
                            </p>
                            {item.payload.eventHtmlLink && (
                              <a
                                href={item.payload.eventHtmlLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-emerald-400 hover:underline whitespace-nowrap shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Open in Calendar</span>
                              </a>
                            )}
                          </div>
                          {(item.payload.eventStart || item.payload.eventEnd) && (
                            <p className="text-slate-300 tabular-nums">
                              <span className="text-slate-400">When:</span>{' '}
                              {item.payload.eventStart
                                ? formatCalendarTimestamp(item.payload.eventStart)
                                : 'TBD'}
                              {item.payload.eventEnd
                                ? ` – ${formatCalendarTimestamp(item.payload.eventEnd)}`
                                : ''}
                            </p>
                          )}
                          {item.payload.eventLocation && (
                            <p>
                              <span className="text-slate-400">Location:</span>{' '}
                              {item.payload.eventLocation}
                            </p>
                          )}
                          {(item.payload.eventDescription || item.payload.body) && (
                            <p className="whitespace-pre-wrap pt-1 border-t border-slate-800 line-clamp-4">
                              {item.payload.eventDescription || item.payload.body}
                            </p>
                          )}
                          {item.status === 'pending' && !calendarWriteAccess && (
                            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-950/40 px-2.5 py-2 text-[11px] text-amber-200">
                              <span>
                                Calendar write access is Read-Only. Enable Write Access in Guardrails to add this event.
                              </span>
                              {onOpenSettings && (
                                <button
                                  type="button"
                                  onClick={() => onOpenSettings('guardrails')}
                                  className="font-semibold text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  Enable in Guardrails
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {item.type === 'spend' && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300">
                          Amount: {item.payload.amount || 'See report'} · Vendor:{' '}
                          {item.payload.vendor || 'TBD'}
                        </div>
                      )}

                      {item.type === 'publish' && item.payload.postContent && (
                        <div className="rounded border border-slate-800 bg-slate-900 p-2.5 text-[11px] text-slate-300 whitespace-pre-wrap">
                          {item.payload.postContent}
                        </div>
                      )}
                    </>
                  )}

                  {isItemExpired && (
                    <p className="text-[11px] text-slate-400 border-t border-slate-800/80 pt-2 tabular-nums">
                      Packet TTL expired without CHO sign-off. No external Workspace action was executed.
                    </p>
                  )}

                  {isEffectivePending && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (approvalDrafts[rawItem.id]) {
                            onUpdateApprovalItem?.(item);
                          }
                          setEditingApprovalId(null);
                          setConfirmItem(item);
                        }}
                        disabled={
                          busyId === item.id ||
                          (item.type === 'calendar_event' && !calendarWriteAccess)
                        }
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>
                          {item.type === 'email_draft'
                            ? 'Approve & Save Draft'
                            : item.type === 'chat_message'
                              ? 'Approve & Send Chat'
                              : item.type === 'google_doc'
                                ? 'Approve & Create Doc'
                                : item.type === 'drive_file'
                                  ? 'Approve & Save to Drive'
                                  : item.type === 'calendar_event'
                                    ? 'Approve & Add to Calendar'
                                    : 'Approve'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          isEditing ? saveApprovalEditsInline(rawItem) : startEditingApproval(rawItem)
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <PencilLine className="h-3 w-3 text-amber-400" />
                        <span>{isEditing ? 'Save Edits' : 'Edit Details'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onRejectItem(rawItem)}
                        className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : tab === 'analytics' ? (
        <TaskAnalyticsView
          tasks={tasks}
          approvals={approvals}
          onOpenTaskReport={(t) => {
            setSelectedTask(t);
            switchTab('reports');
          }}
          onPrefillTask={(prompt) => {
            onPrefillTask(prompt);
            setActionMsg('Loaded prompt into the bottom command bar.');
          }}
        />
      ) : (
        /* Searchable, Filterable Completed Tasks History Tab */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search & Filter Toolbar */}
          <div className="border-b border-slate-800 bg-slate-950/50 p-4 space-y-2.5">
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search completed prompts, deliverables, or directors..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-8 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={directorFilter}
                  onChange={(e) => setDirectorFilter(e.target.value)}
                  aria-label="Filter by Director"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none cursor-pointer"
                >
                  <option value="all">All Directors</option>
                  {directorOptions.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 p-0.5">
                  {(
                    [
                      ['all', 'All'],
                      ['archived', `Archived (${archivedCount})`],
                      ['grounded', 'With Sources'],
                      ['advisor', 'Advisor'],
                    ] as Array<[HistoryScopeFilter, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setScopeFilter(key)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                        scopeFilter === key
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSortOrder((s) => (s === 'newest' ? 'oldest' : 'newest'))}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowUpDown className="h-3 w-3 text-slate-400" />
                <span>{sortOrder === 'newest' ? 'Newest first' : 'Oldest first'}</span>
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
              <span>
                Showing {filteredHistory.length} of {completedTasks.length} completed{' '}
                {completedTasks.length === 1 ? 'task' : 'tasks'}
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetHistoryFilters}
                  className="text-amber-400 hover:text-amber-300 underline underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Reset filters
                </button>
              )}
            </div>
          </div>

          {/* Completed Tasks List */}
          {completedTasks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
              <p className="text-xs font-medium text-slate-300">No completed tasks in history yet</p>
              <p className="max-w-xs text-xs text-slate-500 leading-relaxed">
                Once Directors finish deliverables (or pending items receive your approval), they appear here for instant search, reference, and one-click re-dispatching.
              </p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <p className="text-xs text-slate-400">
                No completed tasks match your current search or filter criteria.
              </p>
              <button
                type="button"
                onClick={resetHistoryFilters}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                Clear search & filters
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
              {filteredHistory.map((t) => {
                const isExpanded = expandedHistoryId === t.id;
                const isRowBusy = redispatchingId === t.id;
                const timeStr = formatShortTimestamp(t.createdAt);

                return (
                  <div key={t.id} className="p-4 hover:bg-slate-950/40 transition-colors space-y-2.5">
                    {/* Unboxed clean metadata row */}
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="font-medium text-amber-400">{t.assignedDirectorName}</span>
                        <span aria-hidden="true">·</span>
                        <span className={getPriorityMeta(t.priority).textClass}>
                          {getPriorityMeta(t.priority).label} priority
                        </span>
                        {t.archived && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-300">Archived</span>
                          </>
                        )}
                        {t.escalatedToAdvisor && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-sky-300">Advisor XHIGH</span>
                          </>
                        )}
                        {t.groundingSources.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{t.groundingSources.length} web sources</span>
                          </>
                        )}
                      </div>
                      {timeStr && <span className="shrink-0 text-slate-500">{timeStr}</span>}
                    </div>

                    {/* Prompt & Executive Summary */}
                    <div>
                      <button
                        type="button"
                        onClick={() => setExpandedHistoryId(isExpanded ? null : t.id)}
                        className="text-left text-xs font-semibold text-white hover:text-amber-300 transition-colors cursor-pointer"
                      >
                        {t.prompt}
                      </button>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed">{t.summary}</p>
                    </div>

                    {/* Quick Reference Expandable Deliverable */}
                    {isExpanded && (
                      <div className="pt-2 pb-1 space-y-2.5 border-t border-slate-800/70">
                        {t.handoffTrace && (
                          <HandoffTracePanel
                            compact
                            trace={t.handoffTrace}
                            agents={agents}
                            isVisualizedInTown={
                              activeTownTraceTaskId === t.handoffTrace.task_id
                            }
                            onVisualizeInTown={onVisualizeTraceInTown}
                            onOpenKbProposals={() => switchTab('approvals')}
                          />
                        )}
                        <FormattedMarkdown compact content={t.reportMarkdown} />
                        {t.groundingSources.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/60 space-y-1">
                            {t.groundingSources.map((src) => (
                              <a
                                key={src.uri}
                                href={src.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-[11px] text-sky-400 hover:underline truncate"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{src.title}</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Controls: Reference, Edit in Bar, PDF, Re-dispatch */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedHistoryId(isExpanded ? null : t.id)}
                          className="text-xs font-medium text-slate-300 hover:text-white underline decoration-slate-700 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {isExpanded ? 'Hide preview' : 'Quick preview'}
                        </button>
                        <span className="text-slate-700" aria-hidden="true">·</span>
                        {t.archived ? (
                          onRestoreTask && (
                            <button
                              type="button"
                              onClick={() => handleRestoreTask(t, true)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300 hover:text-emerald-200 cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <ArchiveRestore className="h-3 w-3" />
                              <span>Restore to Reports</span>
                            </button>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTask(t);
                              switchTab('reports');
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <FileText className="h-3 w-3 text-slate-400" />
                            <span>Full report</span>
                          </button>
                        )}
                        <span className="text-slate-700" aria-hidden="true">·</span>
                        <SpeakButton
                          variant="inline"
                          itemId={`hist_audio_${t.id}`}
                          label="Listen"
                          turn={{
                            agentId: t.assignedDirectorId,
                            speakerName: t.assignedDirectorName,
                            voiceName: agents.find((a) => a.id === t.assignedDirectorId)?.voiceName,
                            text: isExpanded ? `${t.summary}. ${t.reportMarkdown}` : t.summary,
                          }}
                        />
                        <span className="text-slate-700" aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => exportTaskReportAsPdf(t)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <Download className="h-3 w-3 text-slate-400" />
                          <span>PDF</span>
                        </button>
                        {(t.exportedDocUrl || onExportTaskToGoogleDoc) && (
                          <>
                            <span className="text-slate-700" aria-hidden="true">·</span>
                            {t.exportedDocUrl ? (
                              <a
                                href={t.exportedDocUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Google Doc</span>
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmExportTask(t)}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <FileText className="h-3 w-3 text-sky-400" />
                                <span>Save to Docs</span>
                              </button>
                            )}
                          </>
                        )}
                        {(t.exportedDriveUrl || onExportTaskToDrive) && (
                          <>
                            <span className="text-slate-700" aria-hidden="true">·</span>
                            {t.exportedDriveUrl ? (
                              <a
                                href={t.exportedDriveUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-orange-300 hover:text-orange-200 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <ExternalLink className="h-3 w-3" />
                                <span>Drive</span>
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleSaveTaskToDriveClick(t)}
                                disabled={exportingDriveTaskId === t.id}
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <HardDrive className="h-3 w-3 text-orange-400" />
                                <span>{exportingDriveTaskId === t.id ? 'Saving...' : 'Save to Drive'}</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onPrefillTask(t.prompt, t.priority);
                            setActionMsg('Loaded task prompt into the command bar below for editing.');
                          }}
                          className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <PencilLine className="h-3 w-3" />
                          <span>Edit Prompt</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRedispatch(t)}
                          disabled={isDispatching}
                          className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>{isRowBusy ? 'Routing...' : 'Re-dispatch'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Explicit Confirmation Modal for Mutating Workspace Actions (Gmail Drafts, Google Chat, Google Docs) */}
      {confirmItem && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-400">
                <ShieldAlert className="h-5 w-5" />
                <h3 className="text-sm font-bold text-white">Confirm Approval</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  const itemToEdit = confirmItem;
                  setConfirmItem(null);
                  startEditingApproval(itemToEdit);
                }}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:underline cursor-pointer"
              >
                <PencilLine className="h-3 w-3" />
                <span>Edit first</span>
              </button>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmItem.type === 'email_draft'
                ? isGoogleConnected
                  ? `Save this message as a Draft in your Gmail account for "${confirmItem.payload.subject || confirmItem.title}"${confirmItem.payload.to ? ` (To: ${confirmItem.payload.to})` : ''}? Nothing will be sent.`
                  : `Approve email draft "${confirmItem.title}" locally?`
                : confirmItem.type === 'chat_message'
                  ? `Send this message to "${confirmItem.payload.chatSpaceDisplayName || confirmItem.payload.chatSpaceName || 'your Google Chat space'}" in Google Chat on your behalf?`
                  : confirmItem.type === 'google_doc'
                    ? `Create a new Google Doc titled "${confirmItem.payload.docTitle || confirmItem.title}" in your Google Docs account?`
                    : confirmItem.type === 'drive_file'
                      ? `Save file "${confirmItem.payload.driveFileName || confirmItem.title}" to ${workingFolder ? `"${workingFolder.name}"` : 'your Google Drive'}?`
                      : confirmItem.type === 'calendar_event'
                        ? `Create Google Calendar event "${confirmItem.payload.eventSummary || confirmItem.title}"${
                            confirmItem.payload.eventStart
                              ? ` (${formatCalendarTimestamp(confirmItem.payload.eventStart)}${
                                  confirmItem.payload.eventEnd
                                    ? ` – ${formatCalendarTimestamp(confirmItem.payload.eventEnd)}`
                                    : ''
                                })`
                              : ''
                          } on your primary Google Calendar?`
                        : `Approve "${confirmItem.title}" from ${confirmItem.directorName}?`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmItem(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={busyId === confirmItem.id}
                className="rounded-md bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                {busyId === confirmItem.id ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Modal for Exporting a Deliverable to Google Docs */}
      {confirmExportTask && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-sky-400">
              <FileText className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">Create Google Doc?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Create a new Google Doc titled{' '}
              <strong className="font-semibold text-white">
                &ldquo;
                {confirmExportTask.prompt.length > 70
                  ? `${confirmExportTask.prompt.slice(0, 67)}...`
                  : confirmExportTask.prompt}
                &rdquo;
              </strong>{' '}
              in your Google Docs account with {confirmExportTask.assignedDirectorName}&apos;s executive deliverable?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmExportTask(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExportDoc()}
                disabled={exportingTaskId === confirmExportTask.id}
                className="rounded-md bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {exportingTaskId === confirmExportTask.id ? 'Creating...' : 'Confirm & Create Doc'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Confirmation Modal for Saving a Deliverable to Google Drive */}
      {confirmDriveExportTask && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-5">
          <div className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-orange-400">
              <HardDrive className="h-5 w-5" />
              <h3 className="text-sm font-bold text-white">Save Deliverable to Google Drive?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Save a Markdown file for{' '}
              <strong className="font-semibold text-white">
                &ldquo;
                {confirmDriveExportTask.prompt.length > 70
                  ? `${confirmDriveExportTask.prompt.slice(0, 67)}...`
                  : confirmDriveExportTask.prompt}
                &rdquo;
              </strong>{' '}
              to{' '}
              <strong className="font-semibold text-white">
                {workingFolder ? workingFolder.name : 'your Google Drive'}
              </strong>{' '}
              with {confirmDriveExportTask.assignedDirectorName}&apos;s executive deliverable?
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDriveExportTask(null)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExportDrive()}
                disabled={exportingDriveTaskId === confirmDriveExportTask.id}
                className="rounded-md bg-orange-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-orange-400 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {exportingDriveTaskId === confirmDriveExportTask.id
                  ? 'Saving...'
                  : 'Confirm & Save to Drive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
