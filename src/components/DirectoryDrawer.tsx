import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  DoorOpen,
  Footprints,
  Landmark,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { formatSourceTriggerLabel } from '../data/automationDefaults';
import { VILLAGE_BUILDINGS } from '../data/villageWorld';
import { resolveAgentVoiceProfile } from '../lib/agentVoices';
import {
  defaultStandbyActivity,
  describeVillageLocation,
  formatLiveStateLabel,
  resolveAgentAvailability,
  type AgentAvailabilityLevel,
} from '../lib/villageActivity';
import {
  CollaborationNetworkGraph,
  buildCollaborationNetwork,
  type NetworkFilter,
} from './CollaborationNetworkGraph';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';
import { SpeakButton } from './SpeakButton';
import type {
  Agent,
  ApprovalItem,
  AutomationRun,
  Building,
  ChatMessage,
  HandoffTrace,
  TownAutopilotSettings,
  VillageActivityEvent,
  VillageTask,
} from '../types/village';

export type DirectoryTab = 'team' | 'network' | 'buildings' | 'feed' | 'digest';

interface DirectoryDrawerProps {
  initialTab?: DirectoryTab;
  agentsRef: React.MutableRefObject<Agent[]>;
  tasks: VillageTask[];
  chatHistory?: Record<string, ChatMessage[]>;
  approvals?: ApprovalItem[];
  busyChatAgentId?: string | null;
  activityFeed: VillageActivityEvent[];
  automationRuns?: AutomationRun[];
  autopilotSettings?: TownAutopilotSettings;
  onClose: () => void;
  onOpenAgentChat: (agent: Agent) => void;
  onWalkToAgent: (agent: Agent) => void;
  onEnterBuilding: (building: Building) => void;
  onWalkToBuilding: (building: Building) => void;
  onOpenTownHall: () => void;
  onOpenWorkspace: () => void;
  onOpenApprovals?: () => void;
  onOpenAutopilotSettings?: () => void;
  onRefreshAutomation?: () => Promise<void>;
  onClearSyncFeed?: () => void;
  onOpenTaskReport?: (taskId: string) => void;
  onVisualizeTraceInTown?: (trace: HandoffTrace) => void;
  onPrefillTask?: (prompt: string) => void;
}

type RosterFilter = 'all' | 'available' | 'working' | 'busy' | 'directors' | 'workers';
type FeedFilter = 'all' | 'cross_talk' | 'dispatch' | 'cho';
type DigestFilter = 'all' | 'staged_packet' | 'completed' | 'failed_closed';

const AVAILABILITY_DOT_STYLES: Record<
  AgentAvailabilityLevel,
  { dot: string; text: string; pulse: boolean }
> = {
  available: {
    dot: 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.55)]',
    text: 'text-emerald-400',
    pulse: false,
  },
  working: {
    dot: 'bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.55)]',
    text: 'text-orange-400',
    pulse: true,
  },
  busy: {
    dot: 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.65)]',
    text: 'text-rose-400',
    pulse: true,
  },
};

function formatFeedTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatEventKindLabel(kind: VillageActivityEvent['kind']): string {
  switch (kind) {
    case 'cross_talk':
      return 'Village Sync';
    case 'dispatch_call':
      return 'Dispatch Call';
    case 'task_complete':
      return 'Task Handoff';
    case 'cho_chat':
      return 'Direct Chat';
    case 'town_hall':
      return 'Town Hall';
    case 'knowledge_sync':
      return 'KB Ground Truth';
  }
}

export const DirectoryDrawer: React.FC<DirectoryDrawerProps> = ({
  initialTab = 'team',
  agentsRef,
  tasks,
  chatHistory,
  approvals = [],
  busyChatAgentId = null,
  activityFeed,
  automationRuns = [],
  autopilotSettings,
  onClose,
  onOpenAgentChat,
  onWalkToAgent,
  onEnterBuilding,
  onWalkToBuilding,
  onOpenTownHall,
  onOpenWorkspace,
  onOpenApprovals,
  onOpenAutopilotSettings,
  onRefreshAutomation,
  onClearSyncFeed,
  onOpenTaskReport,
  onVisualizeTraceInTown,
  onPrefillTask,
}) => {
  const [view, setView] = useState<DirectoryTab>(initialTab);
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>('all');
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>('all');
  const [focusedNetworkAgentId, setFocusedNetworkAgentId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [digestFilter, setDigestFilter] = useState<DigestFilter>('all');
  const [isRefreshingDigest, setIsRefreshingDigest] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setView(initialTab);
  }, [initialTab]);

  const [liveAgents, setLiveAgents] = useState<Agent[]>(() =>
    agentsRef.current.filter((a) => a.id !== 'cho').map((a) => ({ ...a }))
  );

  useEffect(() => {
    const sync = () => {
      setLiveAgents(agentsRef.current.filter((a) => a.id !== 'cho').map((a) => ({ ...a })));
    };
    sync();
    const timer = setInterval(sync, 400);
    return () => clearInterval(timer);
  }, [agentsRef]);

  const taskById = useMemo(() => {
    const m = new Map<string, VillageTask>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const collaborationNetwork = useMemo(
    () => buildCollaborationNetwork(liveAgents, tasks, chatHistory),
    [liveAgents, tasks, chatHistory]
  );

  const enrichedRoster = useMemo(() => {
    return liveAgents.map((agent) => {
      const location = describeVillageLocation(agent.x, agent.y);
      const status = formatLiveStateLabel(agent);
      const availability = resolveAgentAvailability(agent, {
        tasks,
        approvals,
        busyChatAgentId,
      });
      const liveSpeech =
        agent.speechBubble && agent.speechTimer > 0 ? agent.speechBubble : null;
      const activeTask = agent.activeTaskId ? taskById.get(agent.activeTaskId) ?? null : null;
      return {
        agent,
        location,
        status,
        availability,
        liveSpeech,
        activeTask,
      };
    });
  }, [liveAgents, tasks, approvals, busyChatAgentId, taskById]);

  const counts = useMemo(() => {
    let available = 0;
    let working = 0;
    let busy = 0;
    for (const item of enrichedRoster) {
      if (item.availability.level === 'busy') busy++;
      else if (item.availability.level === 'working') working++;
      else available++;
    }
    return { available, working, busy };
  }, [enrichedRoster]);

  const filteredRoster = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = enrichedRoster.filter(
      ({ agent, location, status, availability, liveSpeech }) => {
        if (rosterFilter === 'available' && availability.level !== 'available') return false;
        if (rosterFilter === 'working' && availability.level !== 'working') return false;
        if (rosterFilter === 'busy' && availability.level !== 'busy') return false;
        if (
          rosterFilter === 'directors' &&
          agent.role !== 'director' &&
          agent.role !== 'chief_of_staff'
        ) {
          return false;
        }
        if (rosterFilter === 'workers' && agent.role !== 'worker') return false;

        if (!q) return true;
        return (
          agent.name.toLowerCase().includes(q) ||
          agent.title.toLowerCase().includes(q) ||
          agent.department.toLowerCase().includes(q) ||
          location.toLowerCase().includes(q) ||
          status.label.toLowerCase().includes(q) ||
          availability.label.toLowerCase().includes(q) ||
          availability.detail.toLowerCase().includes(q) ||
          (agent.currentActivity ?? '').toLowerCase().includes(q) ||
          (liveSpeech ?? '').toLowerCase().includes(q)
        );
      }
    );

    const availabilityRank: Record<AgentAvailabilityLevel, number> = {
      busy: 0,
      working: 1,
      available: 2,
    };
    const priorityRank = { talking: 0, working: 1, moving: 2, standby: 3 };
    return [...filtered].sort((a, b) => {
      const availDiff =
        availabilityRank[a.availability.level] - availabilityRank[b.availability.level];
      if (availDiff !== 0) return availDiff;
      const diff = priorityRank[a.status.category] - priorityRank[b.status.category];
      if (diff !== 0) return diff;
      if (a.agent.id === 'matt') return -1;
      if (b.agent.id === 'matt') return 1;
      return a.agent.name.localeCompare(b.agent.name);
    });
  }, [enrichedRoster, rosterFilter, searchQuery]);

  const filteredBuildings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return VILLAGE_BUILDINGS.filter((b) => {
      if (!q) return true;
      const director = b.directorId
        ? liveAgents.find((a) => a.id === b.directorId)
        : undefined;
      return (
        b.name.toLowerCase().includes(q) ||
        b.subtitle.toLowerCase().includes(q) ||
        b.interiorSubtitle.toLowerCase().includes(q) ||
        (director?.name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [liveAgents, searchQuery]);

  const filteredFeed = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activityFeed.filter((ev) => {
      if (
        feedFilter === 'cross_talk' &&
        ev.kind !== 'cross_talk' &&
        ev.kind !== 'knowledge_sync'
      ) {
        return false;
      }
      if (
        feedFilter === 'dispatch' &&
        ev.kind !== 'dispatch_call' &&
        ev.kind !== 'task_complete'
      ) {
        return false;
      }
      if (feedFilter === 'cho' && ev.kind !== 'cho_chat' && ev.kind !== 'town_hall') {
        return false;
      }
      if (!q) return true;
      return (
        ev.headline.toLowerCase().includes(q) ||
        ev.location.toLowerCase().includes(q) ||
        (ev.contextRef ?? '').toLowerCase().includes(q) ||
        ev.participants.some(
          (p) =>
            p.name.toLowerCase().includes(q) || p.department.toLowerCase().includes(q)
        ) ||
        ev.lines.some(
          (l) =>
            l.speakerName.toLowerCase().includes(q) || l.text.toLowerCase().includes(q)
        )
      );
    });
  }, [activityFeed, feedFilter, searchQuery]);

  const hasSyncEvents = useMemo(
    () => activityFeed.some((ev) => ev.kind === 'cross_talk'),
    [activityFeed]
  );

  const filteredDigest = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return automationRuns.filter((run) => {
      if (digestFilter === 'staged_packet' && run.status !== 'staged_packet') return false;
      if (digestFilter === 'completed' && run.status !== 'completed') return false;
      if (digestFilter === 'failed_closed' && run.status !== 'failed_closed') return false;
      if (!q) return true;
      return (
        (run.rule_name || run.rule_id).toLowerCase().includes(q) ||
        run.summary.toLowerCase().includes(q) ||
        run.status.toLowerCase().includes(q) ||
        run.agent_trace.some((ag) => ag.toLowerCase().includes(q))
      );
    });
  }, [automationRuns, digestFilter, searchQuery]);

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-30 w-[560px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Header & View Switcher */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setView('team')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              view === 'team'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Team ({enrichedRoster.length})
          </button>
          <button
            type="button"
            onClick={() => setView('network')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              view === 'network'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Network ({collaborationNetwork.edges.length})
          </button>
          <button
            type="button"
            onClick={() => setView('buildings')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              view === 'buildings'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Houses ({VILLAGE_BUILDINGS.length})
          </button>
          <button
            type="button"
            onClick={() => setView('feed')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              view === 'feed'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Feed ({activityFeed.length})
          </button>
          <button
            type="button"
            onClick={() => setView('digest')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              view === 'digest'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            Digest ({automationRuns.length})
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Directory"
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Prominent Town Hall & Workspace Quick-Launch Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/70 px-4 py-2">
        <div className="flex items-center gap-x-2.5 text-[11px] text-slate-300 tabular-nums">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
            <span>
              Available: <strong className="font-semibold text-emerald-300">{counts.available}</strong>
            </span>
          </span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-orange-400 shrink-0" aria-hidden="true" />
            <span>
              Working: <strong className="font-semibold text-orange-300">{counts.working}</strong>
            </span>
          </span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
            <span>
              Busy: <strong className="font-semibold text-rose-300">{counts.busy}</strong>
            </span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onOpenWorkspace}
            className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            Workspace Hub
          </button>
          <button
            type="button"
            onClick={onOpenTownHall}
            className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/40 px-2.5 py-1 text-[11px] font-semibold text-amber-300 hover:bg-amber-500/30 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Landmark className="h-3 w-3" />
            <span>Town Hall &amp; Hiring</span>
          </button>
        </div>
      </div>

      {/* Search & Segmented Filters */}
      <div className="border-b border-slate-800 bg-slate-950/40 p-3.5 space-y-2.5">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              view === 'team'
                ? 'Find any villager, Director, role, or current activity...'
                : view === 'network'
                  ? 'Filter collaboration graph by villager, House, or task...'
                  : view === 'buildings'
                    ? 'Search Town Hall or Guild Houses...'
                    : view === 'digest'
                      ? 'Search Town Digest runs, rules, or agents...'
                      : 'Search conversations, speakers, or topics...'
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-8 pr-8 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
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

        {view === 'team' ? (
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ['all', 'All'],
                ['available', `Available (${counts.available})`],
                ['working', `Working (${counts.working})`],
                ['busy', `Busy (${counts.busy})`],
                ['directors', 'Matt & Directors'],
                ['workers', 'Guild Staff'],
              ] as Array<[RosterFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setRosterFilter(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  rosterFilter === key
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : view === 'network' ? (
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ['all', `All Links (${collaborationNetwork.edges.length})`],
                ['frequent', `Frequent 2+ (${collaborationNetwork.frequentEdgeCount})`],
                ['cross_house', `Cross-House (${collaborationNetwork.crossHouseEdgeCount})`],
                ['intra_house', `Intra-House (${collaborationNetwork.intraHouseEdgeCount})`],
              ] as Array<[NetworkFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setNetworkFilter(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  networkFilter === key
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : view === 'feed' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['all', 'All Activity'],
                  ['cross_talk', 'Agent Syncs'],
                  ['dispatch', 'Dispatches & Tasks'],
                  ['cho', 'Your Chats & Town Hall'],
                ] as Array<[FeedFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFeedFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    feedFilter === key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {hasSyncEvents && onClearSyncFeed && (
              <button
                type="button"
                onClick={onClearSyncFeed}
                className="text-[11px] text-slate-400 hover:text-amber-300 underline decoration-slate-700 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                Clear Syncs
              </button>
            )}
          </div>
        ) : view === 'digest' ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  ['all', `All Runs (${automationRuns.length})`],
                  [
                    'staged_packet',
                    `Staged Packet (${automationRuns.filter((r) => r.status === 'staged_packet').length})`,
                  ],
                  [
                    'completed',
                    `Quiet (${automationRuns.filter((r) => r.status === 'completed').length})`,
                  ],
                  [
                    'failed_closed',
                    `Fail-Closed (${automationRuns.filter((r) => r.status === 'failed_closed').length})`,
                  ],
                ] as Array<[DigestFilter, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDigestFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    digestFilter === key
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onRefreshAutomation && (
                <button
                  type="button"
                  disabled={isRefreshingDigest}
                  onClick={async () => {
                    setIsRefreshingDigest(true);
                    try {
                      await onRefreshAutomation();
                    } finally {
                      setIsRefreshingDigest(false);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshingDigest ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              )}
              {onOpenAutopilotSettings && (
                <button
                  type="button"
                  onClick={onOpenAutopilotSettings}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Settings className="h-3 w-3" />
                  <span>Autopilot: {autopilotSettings?.autopilot_enabled === false ? 'Paused' : 'Active'}</span>
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>

      {/* Main Content */}
      {view === 'team' ? (
        filteredRoster.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
            <p className="text-xs text-slate-400">No villagers match your current filter right now.</p>
            <button
              type="button"
              onClick={() => {
                setRosterFilter('all');
                setSearchQuery('');
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
            >
              Show everyone
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
            {filteredRoster.map(
              ({ agent, location, status, availability, liveSpeech, activeTask }) => {
                const statusTone =
                  status.category === 'talking'
                    ? 'text-sky-300'
                    : status.category === 'working'
                      ? 'text-amber-300'
                      : status.category === 'moving'
                        ? 'text-emerald-300'
                        : 'text-slate-400';
                const badgeStyle = AVAILABILITY_DOT_STYLES[availability.level];

                return (
                  <div
                    key={agent.id}
                    className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-slate-950/40 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className="relative shrink-0 mt-0.5"
                        title={`${availability.label} — ${availability.detail}`}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/80 overflow-hidden">
                          <CharacterSpriteBadge agent={agent} size={40} />
                        </div>
                        <span
                          role="status"
                          aria-label={`${agent.name} status: ${availability.label} (${availability.detail})`}
                          className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center"
                        >
                          {badgeStyle.pulse && (
                            <span
                              aria-hidden="true"
                              className={`absolute inline-flex h-full w-full rounded-full opacity-45 animate-ping ${
                                availability.level === 'busy'
                                  ? 'bg-rose-400'
                                  : 'bg-orange-400'
                              }`}
                            />
                          )}
                          <span
                            aria-hidden="true"
                            className={`relative inline-flex h-3 w-3 rounded-full ring-2 ring-slate-900 ${badgeStyle.dot}`}
                          />
                        </span>
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
                          <span className="font-semibold text-white">{agent.name}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-slate-400">{agent.department}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-slate-500">
                            {resolveAgentVoiceProfile(agent).voiceName} voice
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                          <span className={`font-semibold ${badgeStyle.text}`}>
                            {availability.label}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className={`font-medium ${statusTone}`}>{status.label}</span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-slate-400">{location}</span>
                          {(collaborationNetwork.statsByAgentId.get(agent.id)?.totalWeight ?? 0) >
                            0 && (
                            <>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setFocusedNetworkAgentId(agent.id);
                                  setView('network');
                                }}
                                className="text-amber-300 hover:text-amber-200 underline decoration-amber-500/40 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                              >
                                {collaborationNetwork.statsByAgentId.get(agent.id)?.totalWeight}{' '}
                                {(collaborationNetwork.statsByAgentId.get(agent.id)?.totalWeight ??
                                  0) === 1
                                  ? 'collab'
                                  : 'collabs'}
                              </button>
                            </>
                          )}
                        </div>

                      <p className="text-xs text-slate-200 leading-snug">
                        <span className="text-slate-400">Busy with: </span>
                        {agent.currentActivity || defaultStandbyActivity(agent)}
                      </p>

                      {activeTask && status.category === 'working' && (
                        <p className="text-[11px] text-amber-300/90 truncate">
                          Task: {activeTask.prompt}
                        </p>
                      )}

                      {liveSpeech && (
                        <p className="text-xs text-sky-200 italic leading-snug">
                          “{liveSpeech}”
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                    <SpeakButton
                      variant="subtle"
                      itemId={`live_roster_${agent.id}`}
                      label="Listen"
                      turn={{
                        agentId: agent.id,
                        speakerName: agent.name,
                        title: agent.title,
                        department: agent.department,
                        voiceName: agent.voiceName,
                        text:
                          liveSpeech ||
                          `${agent.name} here at ${location}. ${
                            agent.currentActivity || defaultStandbyActivity(agent)
                          }.`,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => onWalkToAgent(agent)}
                      title={`Walk your character to ${agent.name}`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Footprints className="h-3 w-3 text-slate-400" />
                      <span>Go To</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAgentChat(agent)}
                      className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>Chat</span>
                    </button>
                  </div>
                  </div>
                );
              }
            )}
          </div>
        )
      ) : view === 'network' ? (
        <CollaborationNetworkGraph
          agents={liveAgents}
          network={collaborationNetwork}
          tasks={tasks}
          approvals={approvals}
          busyChatAgentId={busyChatAgentId}
          filter={networkFilter}
          searchQuery={searchQuery}
          focusedAgentId={focusedNetworkAgentId}
          onSelectAgentId={setFocusedNetworkAgentId}
          onOpenAgentChat={onOpenAgentChat}
          onWalkToAgent={onWalkToAgent}
          onOpenTaskReport={onOpenTaskReport}
          onVisualizeTraceInTown={onVisualizeTraceInTown}
          onPrefillTask={onPrefillTask}
        />
      ) : view === 'buildings' ? (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {filteredBuildings.map((b) => {
            const lead = b.directorId
              ? liveAgents.find((a) => a.id === b.directorId)
              : undefined;
            const staffCount = liveAgents.filter((a) => a.buildingId === b.id).length;
            const isInboxHub = b.id === 'inbox';
            const isTownHall = b.id === 'town_hall';
            return (
              <div
                key={b.id}
                className="flex items-start justify-between gap-3 px-4 py-3.5 hover:bg-slate-950/40 transition-colors"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {isTownHall ? (
                      <Landmark className="h-4 w-4 text-amber-400 shrink-0" />
                    ) : (
                      <Building2 className="h-4 w-4 text-sky-400 shrink-0" />
                    )}
                    <span className="text-xs font-semibold text-white">{b.name}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="text-[11px] text-amber-300">{b.subtitle}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-snug">{b.interiorSubtitle}</p>
                  <p className="text-[11px] text-slate-400 tabular-nums">
                    {isTownHall
                      ? 'All 8 Directors · Morning Briefing, Debrief & Guild Hiring'
                      : isInboxHub
                        ? `Led by ${lead?.name ?? 'Daniel'} · Opens Unified Workspace Hub`
                        : `${lead ? `Led by ${lead.name}` : 'Village Guild'} · ${staffCount} ${
                            staffCount === 1 ? 'villager' : 'villagers'
                          }`}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <button
                    type="button"
                    onClick={() => onWalkToBuilding(b)}
                    title={`Walk to ${b.name} door`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Footprints className="h-3 w-3 text-slate-400" />
                    <span>Walk To</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onEnterBuilding(b)}
                    className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <DoorOpen className="h-3 w-3" />
                    <span>{isInboxHub ? 'Open Hub' : 'Enter'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : view === 'digest' ? (
        filteredDigest.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2.5">
            <p className="text-xs font-medium text-slate-300">
              {automationRuns.length === 0
                ? 'No background automation runs logged yet'
                : 'No Town Digest runs match your filter'}
            </p>
            <p className="max-w-xs text-xs text-slate-500 leading-relaxed">
              Scheduled heartbeats (07:30 SAST Morning Triage, 12:30 SAST Midday Replan, Mon 08:00 KB Sync) and monitored Workspace webhooks log concise summaries here without interrupting you.
            </p>
            {onOpenAutopilotSettings && (
              <button
                type="button"
                onClick={onOpenAutopilotSettings}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Settings className="h-3.5 w-3.5" />
                <span>Configure Autopilot &amp; Run Test</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
            {filteredDigest.map((run) => {
              const timeLabel = formatFeedTime(run.created_at);
              const statusLabel =
                run.status === 'staged_packet'
                  ? 'Staged Decision Packet'
                  : run.status === 'completed'
                    ? 'Quiet Completed'
                    : run.status === 'skipped_paused'
                      ? 'Skipped (Paused)'
                      : 'Failed Closed';
              const statusTone =
                run.status === 'staged_packet'
                  ? 'text-amber-300'
                  : run.status === 'completed'
                    ? 'text-emerald-400'
                    : run.status === 'skipped_paused'
                      ? 'text-slate-400'
                      : 'text-rose-400';
              const sourceLabel = formatSourceTriggerLabel(
                run.trigger_type ?? (run.rule_id.startsWith('webhook_') ? 'webhook' : 'cron')
              );
              const traceLabel =
                run.agent_trace.length > 0 ? run.agent_trace.join(' → ') : 'headless runner';

              return (
                <div key={run.id} className="p-4 hover:bg-slate-950/40 transition-colors space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className={`font-semibold ${statusTone}`}>{statusLabel}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="text-sky-300">{sourceLabel}</span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span className="font-mono text-slate-400">{run.duration_ms}ms</span>
                    </div>
                    {timeLabel && <span className="shrink-0 text-slate-500">{timeLabel}</span>}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white truncate">
                      {run.rule_name || run.rule_id}
                    </p>
                    {run.staged_packet_ids.length > 0 && onOpenApprovals && (
                      <button
                        type="button"
                        onClick={onOpenApprovals}
                        className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                      >
                        Review Packet ({run.staged_packet_ids.length})
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">{run.summary}</p>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 font-mono tabular-nums">
                    <span>Trace: {traceLabel}</span>
                    {run.error_detail && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-rose-300/90 font-sans">{run.error_detail}</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : filteredFeed.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-2">
          <p className="text-xs font-medium text-slate-300">No conversations logged yet</p>
          <p className="max-w-xs text-xs text-slate-500 leading-relaxed">
            Villagers stroll quietly on standby until they have real context from you. Assign a task, chat with an agent, sync Google Workspace, or add a Knowledge Base entry to start grounded collaboration.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {filteredFeed.map((ev) => {
            const timeLabel = formatFeedTime(ev.timestamp);
            const kindLabel = formatEventKindLabel(ev.kind);

            return (
              <div key={ev.id} className="p-4 hover:bg-slate-950/40 transition-colors space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 tabular-nums">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="font-medium text-amber-400">{kindLabel}</span>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span>{ev.location}</span>
                    {ev.contextRef && (
                      <>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-emerald-300/90">Ref: {ev.contextRef}</span>
                      </>
                    )}
                  </div>
                  {timeLabel && <span className="shrink-0 text-slate-500">{timeLabel}</span>}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white truncate">{ev.headline}</p>
                  {ev.lines.some((l) => l.speakerName !== 'You (CHO)') && (
                    <SpeakButton
                      variant="subtle"
                      itemId={`feed_ev_${ev.id}`}
                      label="Listen"
                      dialogueTurns={ev.lines
                        .filter((l) => l.speakerName !== 'You (CHO)')
                        .map((line, idx) => {
                          const matched = agentsRef.current.find(
                            (a) =>
                              a.name === line.speakerName ||
                              line.speakerName.startsWith(a.name)
                          );
                          return {
                            itemId: `feed_ev_${ev.id}_${idx}`,
                            agentId: matched?.id,
                            speakerName: matched?.name ?? line.speakerName,
                            title: matched?.title,
                            department: matched?.department,
                            voiceName: matched?.voiceName,
                            text: line.text,
                          };
                        })}
                    />
                  )}
                </div>

                <div className="space-y-1.5 pt-0.5">
                  {ev.lines.map((line, idx) => (
                    <p key={idx} className="text-xs text-slate-300 leading-relaxed">
                      <span className="font-semibold text-sky-300">{line.speakerName}: </span>
                      <span>“{line.text}”</span>
                    </p>
                  ))}
                </div>

                {ev.participants.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="text-slate-500">Jump to:</span>
                    {ev.participants
                      .filter((p) => p.id !== 'cho')
                      .map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            const found = agentsRef.current.find((a) => a.id === p.id);
                            if (found) onOpenAgentChat(found);
                          }}
                          className="text-slate-300 hover:text-amber-300 underline decoration-slate-700 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          {p.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
};
