import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  MapPin,
  ShieldAlert,
  X,
} from 'lucide-react';
import { SpeakButton } from './SpeakButton';
import type { Agent, ApprovalItem, KnowledgeProposal, VillageTask } from '../types/village';

interface LiveTaskTrackerBarProps {
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  kbProposals?: KnowledgeProposal[];
  agents: Agent[];
  dismissedTaskIds: string[];
  onDismissTask: (taskId: string) => void;
  onDismissCompletedTasks?: (taskIds: string[]) => void;
  onOpenReport: (task: VillageTask) => void;
  onOpenApprovals: () => void;
  onLocateTaskOnMap?: (task: VillageTask) => void;
}

function getStageLabel(task: VillageTask): {
  label: string;
  percent: number;
  isRunning: boolean;
  isFailed?: boolean;
} {
  if (task.status === 'failed') {
    return {
      label: task.progressLabel || 'Aborted (fail-closed)',
      percent: 100,
      isRunning: false,
      isFailed: true,
    };
  }
  if (task.status === 'queued') {
    return { label: 'Queued', percent: task.progressPercent ?? 10, isRunning: true };
  }
  if (task.status === 'matt_routing') {
    return {
      label: task.progressLabel || 'Routing to Director',
      percent: task.progressPercent ?? 22,
      isRunning: true,
    };
  }
  if (task.status === 'worker_executing') {
    return {
      label: task.progressLabel || 'Specialist drafting deliverable',
      percent: task.progressPercent ?? 58,
      isRunning: true,
    };
  }
  if (task.status === 'director_review' || task.status === 'advisor_escalated') {
    return {
      label:
        task.progressLabel ||
        (task.status === 'advisor_escalated'
          ? 'Senior Advisor reviewing'
          : 'Director reviewing draft'),
      percent: task.progressPercent ?? 86,
      isRunning: true,
    };
  }
  if (task.status === 'needs_approval') {
    return { label: 'Awaiting your approval', percent: 94, isRunning: false };
  }
  return { label: 'Deliverable ready', percent: 100, isRunning: false };
}

function isTaskRunning(task: VillageTask): boolean {
  return (
    task.status === 'queued' ||
    task.status === 'matt_routing' ||
    task.status === 'worker_executing' ||
    task.status === 'director_review' ||
    task.status === 'advisor_escalated'
  );
}

export const LiveTaskTrackerBar: React.FC<LiveTaskTrackerBarProps> = ({
  tasks,
  approvals,
  kbProposals = [],
  agents,
  dismissedTaskIds,
  onDismissTask,
  onDismissCompletedTasks,
  onOpenReport,
  onOpenApprovals,
  onLocateTaskOnMap,
}) => {
  const [expanded, setExpanded] = useState(false);
  const dismissedSet = new Set(dismissedTaskIds);

  // Active running tasks always show; newly completed / needs_approval / failed tasks show if created within the last 10 minutes and not dismissed
  const now = Date.now();
  const allVisibleTasks = tasks.filter((t) => {
    if (t.archived) return false;
    if (isTaskRunning(t)) return true;
    if (dismissedSet.has(t.id)) return false;
    const refTime = Date.parse(t.completedAt || t.createdAt) || 0;
    return now - refTime < 10 * 60 * 1000;
  });

  if (allVisibleTasks.length === 0) return null;

  const runningCount = allVisibleTasks.filter((t) => isTaskRunning(t)).length;
  const dismissibleIds = allVisibleTasks
    .filter((t) => !isTaskRunning(t))
    .map((t) => t.id);

  const displayedTasks = expanded ? allVisibleTasks.slice(0, 6) : allVisibleTasks.slice(0, 2);
  const hiddenCount = Math.max(0, allVisibleTasks.length - displayedTasks.length);

  return (
    <div className="z-20 shrink-0 border-t border-slate-800 bg-slate-900/95 px-5 py-2">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-1.5">
        {(allVisibleTasks.length > 2 || dismissibleIds.length >= 2) && (
          <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-1 text-[11px] text-slate-400 tabular-nums">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-300">
                Live Queue ({allVisibleTasks.length})
              </span>
              {runningCount > 0 && (
                <>
                  <span className="text-slate-700" aria-hidden="true">·</span>
                  <span className="text-sky-300">{runningCount} running</span>
                </>
              )}
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {dismissibleIds.length >= 2 && (
                <button
                  type="button"
                  onClick={() => {
                    if (onDismissCompletedTasks) {
                      onDismissCompletedTasks(dismissibleIds);
                    } else {
                      dismissibleIds.forEach((id) => onDismissTask(id));
                    }
                  }}
                  className="text-slate-400 hover:text-white underline decoration-slate-700 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Clear finished ({dismissibleIds.length})
                </button>
              )}

              {allVisibleTasks.length > 2 && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="inline-flex items-center gap-1 font-medium text-amber-300 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {expanded ? (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      <span>Show fewer</span>
                    </>
                  ) : (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      <span>Show all ({allVisibleTasks.length})</span>
                      {hiddenCount > 0 ? <span className="sr-only">{hiddenCount} more</span> : null}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {displayedTasks.map((task) => {
          const stage = getStageLabel(task);
          const linkedApproval = approvals.find(
            (a) =>
              (a.id === task.approvalId || a.taskId === task.id) && a.status === 'pending'
          );
          const hasPendingKbProposal = kbProposals.some(
            (p) =>
              p.status === 'pending' &&
              (p.task_id === task.id ||
                (task.kbProposalIds ?? []).includes(p.proposal_id))
          );
          const needsSignOff =
            (task.status === 'needs_approval' && Boolean(linkedApproval)) ||
            hasPendingKbProposal;
          const directorAgent = agents.find((a) => a.id === task.assignedDirectorId);

          return (
            <div
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {stage.isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />
                ) : stage.isFailed ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                ) : needsSignOff ? (
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                )}

                <span className="font-semibold text-white whitespace-nowrap shrink-0">
                  {task.assignedDirectorName || 'Matt'}
                </span>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span
                  className={`whitespace-nowrap shrink-0 ${
                    stage.isRunning
                      ? 'text-sky-300'
                      : stage.isFailed
                        ? 'text-rose-300'
                        : needsSignOff
                          ? 'text-amber-300'
                          : 'text-emerald-300'
                  }`}
                >
                  {hasPendingKbProposal && !stage.isRunning && !stage.isFailed
                    ? 'KB Decision Packet staged'
                    : stage.label}
                </span>

                {stage.isRunning && (
                  <>
                    <div className="hidden sm:block h-1.5 w-24 overflow-hidden rounded-full bg-slate-800 shrink-0">
                      <div
                        className="h-full bg-sky-400 transition-all duration-300"
                        style={{ width: `${Math.max(6, Math.min(100, stage.percent))}%` }}
                      />
                    </div>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                      {Math.round(stage.percent)}%
                    </span>
                  </>
                )}

                <span className="text-slate-600 hidden md:inline" aria-hidden="true">
                  ·
                </span>
                <span className="hidden md:inline min-w-0 truncate text-slate-400">
                  {task.prompt}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {!stage.isRunning && !stage.isFailed && task.summary && (
                  <SpeakButton
                    variant="inline"
                    itemId={`tracker_audio_${task.id}`}
                    label="Listen"
                    turn={{
                      agentId: task.assignedDirectorId,
                      speakerName: task.assignedDirectorName,
                      voiceName: directorAgent?.voiceName,
                      text: `${task.assignedDirectorName} reporting. ${task.summary}`,
                    }}
                  />
                )}

                {onLocateTaskOnMap && (
                  <button
                    type="button"
                    onClick={() => onLocateTaskOnMap(task)}
                    title={`Center map on ${task.assignedDirectorName || 'Matt'}`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-medium text-slate-300 hover:border-amber-500/60 hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <MapPin className="h-3 w-3 text-amber-400" />
                    <span>Locate</span>
                  </button>
                )}

                {stage.isFailed ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDismissTask(task.id);
                      onOpenReport(task);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-950/60 px-2.5 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-900 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <AlertTriangle className="h-3 w-3" />
                    <span>Inspect Trace</span>
                  </button>
                ) : needsSignOff ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDismissTask(task.id);
                      onOpenApprovals();
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ShieldAlert className="h-3 w-3" />
                    <span>Review Approval</span>
                  </button>
                ) : !stage.isRunning ? (
                  <button
                    type="button"
                    onClick={() => {
                      onDismissTask(task.id);
                      onOpenReport(task);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <FileText className="h-3 w-3" />
                    <span>View Report</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenReport(task)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span>Watch Live</span>
                  </button>
                )}

                {!stage.isRunning && (
                  <button
                    type="button"
                    onClick={() => onDismissTask(task.id)}
                    aria-label="Dismiss notification"
                    className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
