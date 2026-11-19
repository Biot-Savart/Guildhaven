import type { Agent, ApprovalItem, VillageTask } from '../types/village';

export type AgentMoodKey = 'thriving' | 'focused' | 'stretched' | 'strained' | 'rested';

export interface AgentMoodSummary {
  key: AgentMoodKey;
  label: string;
  reason: string;
  sparksLit: 1 | 2 | 3;
  colorClass: string;
  sparkColorClass: string;
}

const ACTIVE_TASK_STATUSES = new Set<VillageTask['status']>([
  'queued',
  'matt_routing',
  'worker_executing',
  'director_review',
  'advisor_escalated',
]);

export function computeAgentMood(
  agent: Agent,
  tasks: VillageTask[],
  approvals: ApprovalItem[]
): AgentMoodSummary {
  const relevantTasks =
    agent.role === 'chief_of_staff'
      ? tasks.slice(0, 12)
      : agent.role === 'director'
        ? tasks.filter((t) => t.assignedDirectorId === agent.id).slice(0, 12)
        : tasks.filter((t) => t.assignedWorkerId === agent.id).slice(0, 12);

  const relevantTaskIds = new Set(relevantTasks.map((t) => t.id));
  const relevantApprovals =
    agent.role === 'chief_of_staff'
      ? approvals.slice(0, 12)
      : agent.role === 'director'
        ? approvals.filter((a) => a.directorId === agent.id).slice(0, 12)
        : approvals.filter((a) => relevantTaskIds.has(a.taskId)).slice(0, 12);

  const approvalById = new Map(approvals.map((a) => [a.id, a]));
  const approvalByTaskId = new Map(approvals.map((a) => [a.taskId, a]));

  let activeCount = relevantTasks.filter((t) => ACTIVE_TASK_STATUSES.has(t.status)).length;
  if (
    activeCount === 0 &&
    (agent.activeTaskId !== null ||
      agent.state === 'working_inside' ||
      agent.state === 'phone_call')
  ) {
    activeCount = 1;
  }

  const pendingApprovalCount = relevantApprovals.filter((a) => a.status === 'pending').length;

  let completedCount = 0;
  let rejectedCount = 0;
  let escalatedCount = 0;

  for (const task of relevantTasks) {
    if (task.escalatedToAdvisor) escalatedCount += 1;
    const linkedApproval =
      (task.approvalId ? approvalById.get(task.approvalId) : undefined) ??
      approvalByTaskId.get(task.id);

    if (linkedApproval?.status === 'rejected') {
      rejectedCount += 1;
    } else if (task.status === 'completed' || linkedApproval?.status === 'approved') {
      completedCount += 1;
    }
  }

  // Account for any standalone rejected approvals not already counted via recent tasks
  for (const appr of relevantApprovals) {
    if (appr.status === 'rejected' && !relevantTaskIds.has(appr.taskId)) {
      rejectedCount += 1;
    }
  }

  const recentWindow = relevantTasks.slice(0, 5);
  let recentRejected = 0;
  let recentCompleted = 0;
  for (const task of recentWindow) {
    const linkedApproval =
      (task.approvalId ? approvalById.get(task.approvalId) : undefined) ??
      approvalByTaskId.get(task.id);
    if (linkedApproval?.status === 'rejected') recentRejected += 1;
    else if (task.status === 'completed' || linkedApproval?.status === 'approved') recentCompleted += 1;
  }

  const resolvedTotal = completedCount + rejectedCount;
  const successRate = resolvedTotal > 0 ? completedCount / resolvedTotal : 1;
  const successPct = Math.round(successRate * 100);

  if (recentRejected >= 2 || (recentRejected === 1 && recentCompleted <= 1)) {
    return {
      key: 'strained',
      label: 'Strained',
      reason: `${rejectedCount} declined · ${completedCount} completed`,
      sparksLit: 1,
      colorClass: 'text-rose-400',
      sparkColorClass: 'text-rose-400',
    };
  }

  if (
    activeCount >= 2 ||
    activeCount + pendingApprovalCount >= 3 ||
    (relevantTasks.length >= 6 && escalatedCount >= 3 && activeCount >= 1)
  ) {
    const parts: string[] = [];
    if (activeCount > 0) parts.push(`${activeCount} active`);
    if (pendingApprovalCount > 0) parts.push(`${pendingApprovalCount} awaiting approval`);
    if (escalatedCount > 0) parts.push(`${escalatedCount} escalated`);
    return {
      key: 'stretched',
      label: 'Stretched',
      reason: parts.join(' · ') || 'Heavy recent queue',
      sparksLit: 2,
      colorClass: 'text-amber-400',
      sparkColorClass: 'text-amber-400',
    };
  }

  if (completedCount >= 2 && successRate >= 0.8) {
    return {
      key: 'thriving',
      label: 'Thriving',
      reason: `${completedCount} completed · ${successPct}% success`,
      sparksLit: 3,
      colorClass: 'text-emerald-400',
      sparkColorClass: 'text-emerald-400',
    };
  }

  if (
    activeCount > 0 ||
    pendingApprovalCount > 0 ||
    completedCount >= 1 ||
    agent.state === 'chatting' ||
    agent.state === 'summoned'
  ) {
    const detail =
      activeCount > 0
        ? `${activeCount} active assignment`
        : pendingApprovalCount > 0
          ? `${pendingApprovalCount} awaiting approval`
          : completedCount > 0
            ? `${completedCount} completed recently`
            : 'Engaged with the CHO';
    return {
      key: 'focused',
      label: 'Focused',
      reason: detail,
      sparksLit: 2,
      colorClass: 'text-sky-400',
      sparkColorClass: 'text-sky-400',
    };
  }

  return {
    key: 'rested',
    label: 'Rested',
    reason: 'Light queue · Ready for new assignments',
    sparksLit: 1,
    colorClass: 'text-slate-300',
    sparkColorClass: 'text-slate-400',
  };
}
