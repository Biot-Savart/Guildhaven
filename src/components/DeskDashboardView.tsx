import React, { useEffect, useMemo, useState } from 'react';
import {
  AtSign,
  Building2,
  Calendar,
  Command,
  ExternalLink,
  FileText,
  Folder,
  LayoutGrid,
  Mail,
  Map as MapIcon,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  X,
} from 'lucide-react';
import {
  formatPacketTtlLabel,
  formatSourceTriggerLabel,
  isDecisionPacketExpired,
} from '../data/automationDefaults';
import { VILLAGE_BUILDINGS } from '../data/villageWorld';
import { SpeakButton } from './SpeakButton';
import type {
  Agent,
  ApprovalItem,
  AutomationRun,
  Building,
  DriveWorkingFolderConfig,
  KnowledgeProposal,
  TownAutopilotSettings,
  VillageTask,
  WorkspaceBriefing,
} from '../types/village';
import type { WorkspaceTab } from './WorkspaceHubDrawer';

interface DeskDashboardViewProps {
  agents: Agent[];
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  kbProposals?: KnowledgeProposal[];
  automationRuns?: AutomationRun[];
  autopilotSettings?: TownAutopilotSettings;
  workspaceBriefing: WorkspaceBriefing;
  workingFolder: DriveWorkingFolderConfig | null;
  isGoogleConnected: boolean;
  onSwitchToMap: () => void;
  onOpenMorningBriefing: () => void;
  onOpenCommandPalette: () => void;
  onOpenTownHall: () => void;
  onOpenAgentChat: (agent: Agent) => void;
  onAssignToDirector: (director: Agent) => void;
  onEnterBuilding: (building: Building) => void;
  onOpenReport: (task: VillageTask) => void;
  onOpenApprovals: () => void;
  onRejectApproval: (item: ApprovalItem) => void;
  onOpenWorkspaceTab: (tab: WorkspaceTab) => void;
  onSyncWorkspace: () => Promise<void>;
  onGoogleSignIn: () => void;
  onToggleAutopilot?: () => Promise<void> | void;
  onOpenAutopilotSettings?: () => void;
  onOpenDigest?: () => void;
}

function formatShortTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const DeskDashboardView: React.FC<DeskDashboardViewProps> = ({
  agents,
  tasks,
  approvals,
  kbProposals = [],
  automationRuns = [],
  autopilotSettings,
  workspaceBriefing,
  workingFolder,
  isGoogleConnected,
  onSwitchToMap,
  onOpenMorningBriefing,
  onOpenCommandPalette,
  onOpenTownHall,
  onOpenAgentChat,
  onAssignToDirector,
  onEnterBuilding,
  onOpenReport,
  onOpenApprovals,
  onRejectApproval,
  onOpenWorkspaceTab,
  onSyncWorkspace,
  onGoogleSignIn,
  onToggleAutopilot,
  onOpenAutopilotSettings,
  onOpenDigest,
}) => {
  const [taskQuery, setTaskQuery] = useState('');
  const [taskFilter, setTaskFilter] = useState<'all' | 'active' | 'completed'>('all');
  const [isSyncingWs, setIsSyncingWs] = useState(false);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowTickMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const directors = useMemo(() => agents.filter((a) => a.role === 'director'), [agents]);
  const mattAgent = useMemo(() => agents.find((a) => a.id === 'matt'), [agents]);
  const pendingApprovals = useMemo(
    () =>
      approvals.filter(
        (a) => a.status === 'pending' && !isDecisionPacketExpired(a, nowTickMs)
      ),
    [approvals, nowTickMs]
  );
  const pendingKbCount = useMemo(
    () =>
      kbProposals.filter(
        (p) => p.status === 'pending' && !isDecisionPacketExpired(p, nowTickMs)
      ).length,
    [kbProposals, nowTickMs]
  );
  const totalPendingSignOffs = pendingApprovals.length + pendingKbCount;
  const autopilotEnabled = autopilotSettings?.autopilot_enabled !== false;

  const nonArchivedTasks = useMemo(() => tasks.filter((t) => !t.archived), [tasks]);

  const filteredTasks = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return nonArchivedTasks.filter((t) => {
      const isCompleted = t.status === 'completed';
      if (taskFilter === 'active' && isCompleted) return false;
      if (taskFilter === 'completed' && !isCompleted) return false;
      if (!q) return true;
      return (
        t.prompt.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        t.assignedDirectorName.toLowerCase().includes(q)
      );
    });
  }, [nonArchivedTasks, taskFilter, taskQuery]);

  const activeTaskCount = useMemo(
    () => nonArchivedTasks.filter((t) => t.status !== 'completed').length,
    [nonArchivedTasks]
  );

  const handleRefreshWorkspace = async () => {
    setIsSyncingWs(true);
    try {
      await onSyncWorkspace();
    } finally {
      setIsSyncingWs(false);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1440px] px-6 py-5 space-y-5">
        {/* Contextual Workspace Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Segmented Map / Desk Switcher */}
            <div
              role="group"
              aria-label="Workspace view mode"
              className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5"
            >
              <button
                type="button"
                onClick={onSwitchToMap}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                <MapIcon className="h-3.5 w-3.5" />
                <span>2.5D Map</span>
              </button>
              <button
                type="button"
                aria-current="page"
                className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white cursor-default whitespace-nowrap shrink-0"
              >
                <LayoutGrid className="h-3.5 w-3.5 text-amber-400" />
                <span>Desk Board</span>
              </button>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400 tabular-nums">
              <span>{directors.length} Directors</span>
              <span aria-hidden="true">·</span>
              <span>{activeTaskCount} Active</span>
              <span aria-hidden="true">·</span>
              <span className={totalPendingSignOffs > 0 ? 'text-amber-300 font-medium' : ''}>
                {totalPendingSignOffs} Pending Approvals
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onToggleAutopilot && (
              <div className="inline-flex items-center rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                <button
                  type="button"
                  onClick={() => void onToggleAutopilot()}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    autopilotEnabled
                      ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                      : 'bg-slate-800 text-slate-300 hover:text-white'
                  }`}
                >
                  {autopilotEnabled ? (
                    <Pause className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Play className="h-3 w-3 text-amber-400" />
                  )}
                  <span>Autopilot: {autopilotEnabled ? 'Active' : 'Paused'}</span>
                </button>
                {onOpenAutopilotSettings && (
                  <button
                    type="button"
                    onClick={onOpenAutopilotSettings}
                    aria-label="Configure Autopilot rules"
                    title="Configure Autopilot rules"
                    className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={onOpenMorningBriefing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sun className="h-3.5 w-3.5" />
              <span>Morning Briefing</span>
            </button>
            <button
              type="button"
              onClick={onOpenTownHall}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <Building2 className="h-3.5 w-3.5 text-amber-400" />
              <span>Town Hall</span>
            </button>
            {mattAgent && (
              <button
                type="button"
                onClick={() => onOpenAgentChat(mattAgent)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
                <span>Chat with Matt</span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-700 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <Command className="h-3.5 w-3.5 text-slate-400" />
              <span>Quick Jump</span>
              <kbd className="rounded border border-slate-700 bg-slate-950 px-1 py-0.5 font-mono text-[10px] text-slate-400">
                ⌘K
              </kbd>
            </button>
          </div>
        </div>

        {/* Pending Approvals Banner / Queue (Only highlighted when items exist, or compact single-line status when clear) */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-white tabular-nums">
              <ShieldAlert
                className={`h-4 w-4 ${
                  totalPendingSignOffs > 0 ? 'text-amber-400' : 'text-slate-500'
                }`}
              />
              <span>Pending Sign-Offs ({totalPendingSignOffs})</span>
            </div>
            <button
              type="button"
              onClick={onOpenApprovals}
              className="text-xs font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
            >
              Open Approvals Drawer
            </button>
          </div>

          {pendingApprovals.length === 0 && pendingKbCount === 0 ? (
            <div className="px-4 py-3 text-xs text-slate-400">
              No staged Gmail drafts, Calendar events, Chat replies, Drive files, or KB proposals awaiting your confirmation.
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {pendingKbCount > 0 && pendingApprovals.length === 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-900/90">
                  <div className="text-xs text-slate-300 tabular-nums">
                    <span className="font-semibold text-white">
                      {pendingKbCount} Knowledge Base Decision Packet
                      {pendingKbCount === 1 ? '' : 's'}
                    </span>{' '}
                    awaiting CHO sign-off under KB-GOV-01.
                  </div>
                  <button
                    type="button"
                    onClick={onOpenApprovals}
                    className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Review Packets
                  </button>
                </div>
              )}
              {pendingApprovals.slice(0, 4).map((item) => {
                const srcLabel = formatSourceTriggerLabel(item.source_trigger, item.source_label);
                const ttl = formatPacketTtlLabel(item.ttl_expires_at, nowTickMs);
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-900/90"
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                        <span className="font-semibold text-white truncate">{item.title}</span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-400 whitespace-nowrap">
                          {item.directorName}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-mono text-[11px] text-amber-300 whitespace-nowrap">
                          {item.type.replace('_', ' ')}
                        </span>
                        <span className="text-slate-600" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-[11px] text-sky-300 whitespace-nowrap">
                          {srcLabel}
                        </span>
                        {ttl && (
                          <>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={`text-[11px] whitespace-nowrap ${
                                ttl.isUrgent ? 'text-amber-300 font-medium' : 'text-slate-400'
                              }`}
                            >
                              {ttl.text}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-400">{item.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onOpenApprovals}
                        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Edit &amp; Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => onRejectApproval(item)}
                        className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Main 12-Column Executive Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left 7 Columns: Active & Recent Deliverables + 8 Guild Directors */}
          <div className="lg:col-span-7 space-y-5">
            {/* Deliverables Table */}
            <section className="rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300 tabular-nums">
                  Deliverables &amp; Active Tasks ({filteredTasks.length})
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center">
                    <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={taskQuery}
                      onChange={(e) => setTaskQuery(e.target.value)}
                      placeholder="Filter tasks..."
                      className="w-44 rounded-md border border-slate-700 bg-slate-950 pl-8 pr-6 py-1 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                    />
                    {taskQuery && (
                      <button
                        type="button"
                        onClick={() => setTaskQuery('')}
                        aria-label="Clear filter"
                        className="absolute right-2 text-slate-400 hover:text-white cursor-pointer"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="inline-flex rounded-md border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
                    {(
                      [
                        ['all', 'All'],
                        ['active', 'Active'],
                        ['completed', 'Done'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTaskFilter(id)}
                        className={`rounded px-2 py-0.5 font-medium cursor-pointer ${
                          taskFilter === id
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {filteredTasks.length === 0 ? (
                <div className="px-4 py-8 text-center space-y-1.5">
                  <p className="text-xs font-medium text-slate-300">
                    {nonArchivedTasks.length === 0
                      ? 'No tasks dispatched yet'
                      : 'No deliverables match your current filter'}
                  </p>
                  <p className="text-xs text-slate-500">
                    Assign a task in the bottom bar (or type @Director to route directly).
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-800 max-h-[340px] overflow-y-auto">
                  {filteredTasks.slice(0, 12).map((task) => {
                    const isDone = task.status === 'completed';
                    const needsAppr = task.status === 'needs_approval';
                    const dirAgent = agents.find((a) => a.id === task.assignedDirectorId);

                    return (
                      <div
                        key={task.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-900/90"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-2 text-[11px] text-slate-400 tabular-nums">
                            <span className="font-semibold text-amber-300">
                              {task.assignedDirectorName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span
                              className={
                                isDone
                                  ? 'text-emerald-400'
                                  : needsAppr
                                    ? 'text-amber-300'
                                    : 'text-sky-300'
                              }
                            >
                              {isDone
                                ? 'Completed'
                                : needsAppr
                                  ? 'Needs Approval'
                                  : `${Math.round(task.progressPercent ?? 25)}%`}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-500">
                              {formatShortTime(task.completedAt || task.createdAt)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => onOpenReport(task)}
                            className="block max-w-full truncate text-left text-xs font-semibold text-white hover:text-amber-300 cursor-pointer"
                          >
                            {task.prompt}
                          </button>
                          <p className="truncate text-[11px] text-slate-400">{task.summary}</p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isDone && task.summary && (
                            <SpeakButton
                              variant="inline"
                              itemId={`desk_task_${task.id}`}
                              label="Listen"
                              turn={{
                                agentId: task.assignedDirectorId,
                                speakerName: task.assignedDirectorName,
                                voiceName: dirAgent?.voiceName,
                                text: task.summary,
                              }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenReport(task)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap"
                          >
                            <FileText className="h-3 w-3 text-slate-400" />
                            <span>Open</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* 8 Guild Houses & Directors Roster */}
            <section className="rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Guild Houses &amp; Department Directors
                </h2>
                <span className="text-[11px] text-slate-500">
                  Click @Assign for direct task routing
                </span>
              </div>
              <div className="divide-y divide-slate-800">
                {directors.map((dir) => {
                  const building = VILLAGE_BUILDINGS.find((b) => b.id === dir.buildingId);
                  const specialist = agents.find(
                    (a) => a.role === 'worker' && a.buildingId === dir.buildingId
                  );
                  return (
                    <div
                      key={dir.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-900/90"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-white">{dir.name}</span>
                          <span className="text-slate-600" aria-hidden="true">
                            ·
                          </span>
                          <span className="text-slate-300 truncate">{dir.department}</span>
                          {specialist && (
                            <>
                              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                                ·
                              </span>
                              <span className="hidden sm:inline text-[11px] text-slate-500">
                                w/ {specialist.name}
                              </span>
                            </>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-slate-400 mt-0.5">
                          {dir.currentActivity || `${dir.title}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onAssignToDirector(dir)}
                          title={`Assign directly to @${dir.name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] font-semibold text-amber-300 hover:border-amber-500/50 hover:text-amber-200 cursor-pointer whitespace-nowrap"
                        >
                          <AtSign className="h-3 w-3" />
                          <span>Assign</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenAgentChat(dir)}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap"
                        >
                          Chat
                        </button>
                        {building && (
                          <button
                            type="button"
                            onClick={() => onEnterBuilding(building)}
                            className="hidden sm:inline-flex rounded-md border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] font-medium text-slate-400 hover:text-white cursor-pointer whitespace-nowrap"
                          >
                            House
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Right 5 Columns: Google Workspace Live Snapshot */}
          <div className="lg:col-span-5 space-y-5">
            <section className="rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Google Workspace Snapshot
                  </h2>
                  {workspaceBriefing.email && (
                    <p className="truncate text-[11px] text-slate-500 mt-0.5">
                      {workspaceBriefing.email}
                    </p>
                  )}
                </div>
                {isGoogleConnected ? (
                  <button
                    type="button"
                    onClick={() => void handleRefreshWorkspace()}
                    disabled={isSyncingWs}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className={`h-3 w-3 ${isSyncingWs ? 'animate-spin' : ''}`} />
                    <span>Sync</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Connect Google
                  </button>
                )}
              </div>

              {/* 4 Metric Cells */}
              <div className="grid grid-cols-2 border-b border-slate-800 divide-x divide-y divide-slate-800">
                <button
                  type="button"
                  onClick={() => onOpenWorkspaceTab('overview')}
                  className="p-3.5 text-left hover:bg-slate-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Unread Gmail</span>
                    <Mail className="h-3.5 w-3.5 text-emerald-400" />
                  </div>
                  <p className="mt-1 text-lg font-bold text-white tabular-nums">
                    {workspaceBriefing.unreadCount}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWorkspaceTab('calendar')}
                  className="p-3.5 text-left hover:bg-slate-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Upcoming Events</span>
                    <Calendar className="h-3.5 w-3.5 text-sky-400" />
                  </div>
                  <p className="mt-1 text-lg font-bold text-white tabular-nums">
                    {workspaceBriefing.upcomingEvents.length}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWorkspaceTab('chat')}
                  className="p-3.5 text-left hover:bg-slate-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Chat Spaces</span>
                    <MessageSquare className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <p className="mt-1 text-lg font-bold text-white tabular-nums">
                    {workspaceBriefing.chatSpaces?.length ?? 0}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWorkspaceTab('drive')}
                  className="p-3.5 text-left hover:bg-slate-900 cursor-pointer"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>Working Folder</span>
                    <Folder className="h-3.5 w-3.5 text-orange-400" />
                  </div>
                  <p className="mt-1 truncate text-xs font-semibold text-white">
                    {workingFolder ? workingFolder.name : 'Set up folder'}
                  </p>
                </button>
              </div>

              {/* Upcoming Schedule Rows */}
              <div className="border-b border-slate-800 p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-white">Upcoming Calendar</h3>
                  <button
                    type="button"
                    onClick={() => onOpenWorkspaceTab('calendar')}
                    className="text-[11px] text-sky-400 hover:underline cursor-pointer"
                  >
                    Manage Calendar
                  </button>
                </div>
                {workspaceBriefing.upcomingEvents.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {isGoogleConnected
                      ? 'No upcoming events scheduled.'
                      : 'Sign in with Google to view your live schedule.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {workspaceBriefing.upcomingEvents.slice(0, 4).map((ev) => (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="truncate font-medium text-slate-200">{ev.summary}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            {formatShortTime(ev.start)}
                          </span>
                          {ev.htmlLink && (
                            <a
                              href={ev.htmlLink}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open in Google Calendar"
                              className="text-slate-500 hover:text-sky-400"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Gmail Rows */}
              <div className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-white truncate tabular-nums">
                    Recent Gmail
                    {(workspaceBriefing.activeGmailSources?.length ?? 0) > 1
                      ? ` · ${workspaceBriefing.activeGmailSources!.length} sources`
                      : workspaceBriefing.activeGmailSources?.length === 1 &&
                          workspaceBriefing.activeGmailSources[0].id !== 'INBOX'
                        ? ` · ${workspaceBriefing.activeGmailSources[0].name}`
                        : ''}
                  </h3>
                  <button
                    type="button"
                    onClick={() => onOpenWorkspaceTab('overview')}
                    className="text-[11px] text-emerald-400 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                  >
                    Labels &amp; Inbox
                  </button>
                </div>
                {workspaceBriefing.recentEmails.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    {isGoogleConnected
                      ? 'No recent messages in your monitored Gmail sources.'
                      : 'Sign in with Google to read inbox and label summaries.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {workspaceBriefing.recentEmails.slice(0, 4).map((em) => {
                      const lbls =
                        em.labelNames && em.labelNames.length > 0
                          ? em.labelNames.join(', ')
                          : '';
                      return (
                        <div key={em.id} className="space-y-0.5 text-xs">
                          <p
                            className={`truncate ${
                              em.isUnread
                                ? 'font-semibold text-white'
                                : 'font-medium text-slate-200'
                            }`}
                          >
                            {em.subject}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {em.from}
                            {lbls ? ` · ${lbls}` : ''}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* Town Digest: Supervised Autonomy Activity Stream */}
            <section className="rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
                <div className="flex items-center gap-2 text-xs">
                  <h2 className="font-semibold text-white tabular-nums">
                    Town Digest ({automationRuns.length})
                  </h2>
                  <span className="text-slate-600" aria-hidden="true">
                    ·
                  </span>
                  <span
                    className={`text-[11px] font-medium ${
                      autopilotEnabled ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {autopilotEnabled ? 'Autopilot Active' : 'Autopilot Paused'}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {onOpenAutopilotSettings && (
                    <button
                      type="button"
                      onClick={onOpenAutopilotSettings}
                      className="text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Rules
                    </button>
                  )}
                  {onOpenDigest && (
                    <button
                      type="button"
                      onClick={onOpenDigest}
                      className="text-[11px] font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Full Digest
                    </button>
                  )}
                </div>
              </div>

              {automationRuns.length === 0 ? (
                <div className="px-4 py-4 text-xs text-slate-400 space-y-2">
                  <p>
                    No background triage or webhook runs recorded yet. Scheduled heartbeats (07:30 &amp; 12:30 SAST) and monitored Gmail label webhooks post quiet digests here.
                  </p>
                  {onOpenAutopilotSettings && (
                    <button
                      type="button"
                      onClick={onOpenAutopilotSettings}
                      className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:border-amber-500/50 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Open Autopilot Controls
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-800 max-h-60 overflow-y-auto">
                  {automationRuns.slice(0, 5).map((run) => {
                    const statusText =
                      run.status === 'staged_packet'
                        ? 'Staged Packet'
                        : run.status === 'completed'
                          ? 'Quiet'
                          : run.status === 'skipped_paused'
                            ? 'Paused'
                            : 'Fail-Closed';
                    const statusColor =
                      run.status === 'staged_packet'
                        ? 'text-amber-300'
                        : run.status === 'completed'
                          ? 'text-emerald-400'
                          : run.status === 'skipped_paused'
                            ? 'text-slate-400'
                            : 'text-rose-400';
                    return (
                      <div key={run.id} className="px-4 py-2.5 space-y-0.5">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-semibold text-slate-200 truncate">
                              {run.rule_name || run.rule_id}
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className={`font-medium whitespace-nowrap ${statusColor}`}>
                              {statusText}
                            </span>
                          </div>
                          <span className="shrink-0 text-slate-500">
                            {formatShortTime(run.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2">{run.summary}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
