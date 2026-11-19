import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Command,
  Compass,
  DoorOpen,
  GitBranch,
  HelpCircle,
  LayoutGrid,
  Loader2,
  LogOut,
  Map as MapIcon,
  MessageSquare,
  Pause,
  Play,
  RotateCcw,
  Send,
  Settings,
  SkipForward,
  Square,
  Sun,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import guildhavenAvatarImg from './assets/images/guildhaven_chat_avatar_1794833257258.jpg';
import { AgentDrawer } from './components/AgentDrawer';
import { BuildingInteriorModal } from './components/BuildingInteriorModal';
import { CommandPaletteModal } from './components/CommandPaletteModal';
import { DeskDashboardView } from './components/DeskDashboardView';
import { DirectoryDrawer, type DirectoryTab } from './components/DirectoryDrawer';
import { isCrossHousePacket } from './components/HandoffTracePanel';
import { KnowledgeBaseDrawer } from './components/KnowledgeBaseDrawer';
import type { KbProposalEdits } from './components/KbDecisionPacketCard';
import { LiveTaskTrackerBar } from './components/LiveTaskTrackerBar';
import { MorningBriefingModal } from './components/MorningBriefingModal';
import { ReportsAndApprovalsDrawer } from './components/ReportsAndApprovalsDrawer';
import {
  SettingsDrawer,
  type ReadOnlyExternalError,
  type SettingsTab,
} from './components/SettingsDrawer';
import { TitleMenuOverlay } from './components/TitleMenuOverlay';
import { VillageCanvas } from './components/VillageCanvas';
import { WorkspaceHubDrawer, type WorkspaceTab } from './components/WorkspaceHubDrawer';
import {
  DEFAULT_TOWN_AUTOPILOT_SETTINGS,
  createDefaultTownAutomationRules,
  isDecisionPacketExpired,
  mergeTownAutomationRules,
  normalizeTownAutopilotSettings,
} from './data/automationDefaults';
import { mergeKnowledgeBase } from './data/knowledgeBase';
import {
  VILLAGE_BUILDINGS,
  VILLAGE_MAP,
  findGridPath,
  tileToWorldCenter,
  worldToTile,
} from './data/villageWorld';
import {
  clearExpiredWorkspaceToken,
  ensureWorkspaceToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logoutGoogle,
  onWorkspaceTokenUpdate,
  refreshWorkspaceAccess,
  requestWorkspaceConsent,
  setCalendarWriteAccessScopeEnabled,
} from './lib/googleAuth';
import { pickVoiceForCustomAgent } from './lib/agentVoices';
import { soundFx } from './lib/soundFx';
import { classifyTaskSource } from './lib/taskAnalytics';
import {
  collectGroundedWorkAnchors,
  deriveAgentGroundedActivity,
  describeVillageLocation,
  resolveAgentAvailability,
  selectAnchorsForPair,
} from './lib/villageActivity';
import {
  hasMeaningfulState,
  mergePersistedAgents,
  normalizeVillageSettings,
  readLocalVillageState,
  sanitizeActivityFeed,
  sanitizeAgentNotes,
  writeLocalVillageState,
} from './lib/villagePersistence';
import { useVoicePlayer, voicePlayer } from './lib/voicePlayer';
import type {
  Agent,
  AgentVoiceName,
  ApprovalItem,
  AutomationRun,
  Building,
  CalendarEventSummary,
  ChatMessage,
  ChatSpaceSummary,
  DriveWorkingFolderConfig,
  ExecutiveMorningBriefing,
  GmailLabelConfig,
  GmailLabelSummary,
  GmailSummary,
  GoogleChatMessageSummary,
  GoogleChatThreadSummary,
  GoogleDocSummary,
  GoogleDriveFileSummary,
  HandoffPacket,
  HandoffTrace,
  HiringCandidate,
  KnowledgeEntry,
  KnowledgeProposal,
  PersistedVillageState,
  PinnedChatContext,
  TaskPriority,
  TownAutomationRule,
  TownAutopilotSettings,
  TownHallMode,
  VillageActivityEvent,
  VillageSettings,
  VillageTask,
  WorkspaceBriefing,
} from './types/village';

async function computeDeterministicIdempotencyKey(
  proposalId: string,
  baseVersion: number | null,
  edits?: KbProposalEdits
): Promise<string> {
  const canonicalPayload = JSON.stringify({
    proposal_id: proposalId,
    base_version: baseVersion ?? 0,
    edits: edits ?? null,
  });
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const encoded = new TextEncoder().encode(canonicalPayload);
    const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
    const hex = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `kb_commit_${proposalId}_${hex.slice(0, 24)}`;
  }
  let h = 5381;
  for (let i = 0; i < canonicalPayload.length; i++) {
    h = ((h << 5) + h) ^ canonicalPayload.charCodeAt(i);
  }
  return `kb_commit_${proposalId}_${(h >>> 0).toString(16)}`;
}

type GameScreen = 'TITLE_MENU' | 'PLAYING';

const EMPTY_BRIEFING: WorkspaceBriefing = {
  connected: false,
  unreadCount: 0,
  recentEmails: [],
  upcomingEvents: [],
};

function getClientTimeContext(): { timeZone: string; offset: string; localIso: string } {
  const now = new Date();
  const offsetMins = -now.getTimezoneOffset();
  const sign = offsetMins >= 0 ? '+' : '-';
  const absMins = Math.abs(offsetMins);
  const hh = String(Math.floor(absMins / 60)).padStart(2, '0');
  const mm = String(absMins % 60).padStart(2, '0');
  const offset = `${sign}${hh}:${mm}`;
  const pad = (n: number) => String(n).padStart(2, '0');
  const localIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${offset}`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return { timeZone, offset, localIso };
}

type DrawerMode =
  | 'none'
  | 'agent'
  | 'directory'
  | 'workspace'
  | 'knowledge'
  | 'reports'
  | 'approvals'
  | 'history'
  | 'analytics'
  | 'settings';

function normalizeRightDrawerMode(mode?: PersistedVillageState['rightDrawerMode']): DrawerMode {
  if (!mode) return 'none';
  if (mode === 'activity') return 'directory';
  return mode;
}

export default function App() {
  const initialLocalRef = useRef<PersistedVillageState | null>(readLocalVillageState());
  const hasHydratedRef = useRef(false);

  const [screen, setScreen] = useState<GameScreen>(
    initialLocalRef.current?.activeScreen === 'PLAYING' ? 'PLAYING' : 'TITLE_MENU'
  );
  const agentsRef = useRef<Agent[]>(
    mergePersistedAgents(
      initialLocalRef.current?.agents,
      initialLocalRef.current?.instructions,
      initialLocalRef.current?.notes,
      initialLocalRef.current?.tasks ?? [],
      initialLocalRef.current?.approvals ?? []
    )
  );
  const [agentsVersion, setAgentsVersion] = useState(0);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    initialLocalRef.current?.selectedAgentId ?? null
  );
  const [activeBuilding, setActiveBuilding] = useState<Building | null>(() => {
    const bId = initialLocalRef.current?.activeBuildingId;
    return bId ? VILLAGE_BUILDINGS.find((b) => b.id === bId) ?? null : null;
  });
  const [rightDrawerMode, setRightDrawerMode] = useState<DrawerMode>(() =>
    normalizeRightDrawerMode(initialLocalRef.current?.rightDrawerMode)
  );
  const [directoryInitialTab, setDirectoryInitialTab] = useState<DirectoryTab>('team');
  const [workspaceInitialTab, setWorkspaceInitialTab] = useState<WorkspaceTab>('overview');
  const [kbInitialDepartment, setKbInitialDepartment] = useState<string>('all');
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('guardrails');
  const [showShortcutsPopover, setShowShortcutsPopover] = useState(false);
  const [settings, setSettings] = useState<VillageSettings>(() =>
    normalizeVillageSettings(initialLocalRef.current?.settings)
  );
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    setCalendarWriteAccessScopeEnabled(settings.calendarWriteAccess);
  }, [settings]);

  const updateVillageSettings = useCallback(
    (updater: (prev: VillageSettings) => VillageSettings) => {
      const next = normalizeVillageSettings(updater(settingsRef.current));
      settingsRef.current = next;
      setCalendarWriteAccessScopeEnabled(next.calendarWriteAccess);
      setSettings(next);
      if (hasHydratedRef.current) {
        void fetch('/api/village/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: next }),
        }).catch(() => {});
      }
    },
    []
  );

  const [nearDoor, setNearDoor] = useState<Building | null>(null);
  const [nearAgent, setNearAgent] = useState<Agent | null>(null);
  const [showWalkability, setShowWalkability] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [commandBarCollapsed, setCommandBarCollapsed] = useState(false);

  const [taskInput, setTaskInput] = useState('');
  const [mentionSelectionIdx, setMentionSelectionIdx] = useState(0);
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium');
  const [isDispatching, setIsDispatching] = useState(false);
  const [liveStatusText, setLiveStatusText] = useState<string | null>(null);
  const [map4kUrl, setMap4kUrl] = useState<string | null>(null);
  const [isRendering4k, setIsRendering4k] = useState(false);

  // Quick Jump Command Palette, Morning Briefing & Live Tracker State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isMorningBriefingOpen, setIsMorningBriefingOpen] = useState(false);
  const [morningBriefing, setMorningBriefing] = useState<ExecutiveMorningBriefing | null>(null);
  const [isLoadingMorningBriefing, setIsLoadingMorningBriefing] = useState(false);
  const [morningBriefingError, setMorningBriefingError] = useState<string | null>(null);
  const [focusedReportTaskId, setFocusedReportTaskId] = useState<string | null>(null);
  const [agentDrawerInitialTab, setAgentDrawerInitialTab] = useState<'chat' | 'trace' | 'dossier'>(
    'chat'
  );
  const [focusedTraceTaskId, setFocusedTraceTaskId] = useState<string | null>(null);
  const [focusedTraceNonce, setFocusedTraceNonce] = useState<number>(0);
  const [agentPrefillDraft, setAgentPrefillDraft] = useState<string | null>(null);
  const [agentPrefillNonce, setAgentPrefillNonce] = useState<number>(0);
  const [townTraceTaskId, setTownTraceTaskId] = useState<string | null>(null);
  const [adhocTownTrace, setAdhocTownTrace] = useState<HandoffTrace | null>(null);
  const [townTraceHidden, setTownTraceHidden] = useState<boolean>(false);
  const [handoffReplayNonce, setHandoffReplayNonce] = useState<number>(0);
  const [cameraSpotlight, setCameraSpotlight] = useState<{
    x: number;
    y: number;
    nonce: number;
  } | null>(null);
  const [dismissedTrackerTaskIds, setDismissedTrackerTaskIds] = useState<string[]>([]);

  const [tasks, setTasks] = useState<VillageTask[]>(initialLocalRef.current?.tasks ?? []);
  const [approvals, setApprovals] = useState<ApprovalItem[]>(initialLocalRef.current?.approvals ?? []);
  const [chatHistory, setChatHistory] = useState<Record<string, ChatMessage[]>>(
    initialLocalRef.current?.chatHistory ?? {}
  );
  const [activityFeed, setActivityFeed] = useState<VillageActivityEvent[]>(() =>
    sanitizeActivityFeed(initialLocalRef.current?.activityFeed)
  );
  const choSessionTokenRef = useRef<string>('');
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeEntry[]>(() =>
    mergeKnowledgeBase(initialLocalRef.current?.knowledgeBase)
  );
  const [kbProposals, setKbProposals] = useState<KnowledgeProposal[]>(
    () => initialLocalRef.current?.kbProposals ?? []
  );
  const [kbBusyMap, setKbBusyMap] = useState<
    Record<string, 'approving' | 'revising' | 'rejecting'>
  >({});
  const [isConsolidatingKb, setIsConsolidatingKb] = useState(false);
  const [isChatSending, setIsChatSending] = useState(false);
  const [townAutopilotSettings, setTownAutopilotSettings] = useState<TownAutopilotSettings>(() =>
    normalizeTownAutopilotSettings(
      initialLocalRef.current?.townAutopilotSettings ?? DEFAULT_TOWN_AUTOPILOT_SETTINGS
    )
  );
  const [townAutomationRules, setTownAutomationRules] = useState<TownAutomationRule[]>(() =>
    mergeTownAutomationRules(
      initialLocalRef.current?.townAutomationRules ?? createDefaultTownAutomationRules()
    )
  );
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>(
    () => initialLocalRef.current?.automationRuns ?? []
  );
  const [runningAutomationRuleId, setRunningAutomationRuleId] = useState<string | null>(null);

  const allTownTraces = useMemo(() => {
    const byId = new Map<
      string,
      {
        taskId: string;
        title: string;
        timestampMs: number;
        crossHouseCount: number;
        trace: HandoffTrace;
      }
    >();

    for (const t of tasks) {
      if (
        !t.handoffTrace ||
        t.handoffTrace.status === 'running' ||
        t.handoffTrace.packets.length === 0
      ) {
        continue;
      }
      const tr = t.handoffTrace;
      byId.set(tr.task_id, {
        taskId: tr.task_id,
        title: t.prompt,
        timestampMs: Date.parse(tr.started_at || t.createdAt) || 0,
        crossHouseCount: tr.packets.filter(isCrossHousePacket).length,
        trace: tr,
      });
    }

    for (const msgs of Object.values(chatHistory)) {
      if (!Array.isArray(msgs)) continue;
      for (let i = 0; i < msgs.length; i += 1) {
        const m = msgs[i];
        if (!m.handoffTrace || m.handoffTrace.packets.length === 0) continue;
        const tr = m.handoffTrace;
        if (byId.has(tr.task_id)) continue;
        let promptTitle = 'Cross-agent collaboration';
        for (let j = i - 1; j >= 0; j -= 1) {
          if (msgs[j].sender === 'cho' && msgs[j].text.trim()) {
            promptTitle = msgs[j].text.trim();
            break;
          }
        }
        byId.set(tr.task_id, {
          taskId: tr.task_id,
          title: promptTitle,
          timestampMs: Date.parse(tr.started_at || m.timestamp) || 0,
          crossHouseCount: tr.packets.filter(isCrossHousePacket).length,
          trace: tr,
        });
      }
    }

    if (adhocTownTrace && adhocTownTrace.packets.length > 0 && !byId.has(adhocTownTrace.task_id)) {
      byId.set(adhocTownTrace.task_id, {
        taskId: adhocTownTrace.task_id,
        title: `${adhocTownTrace.coordinating_director_name} handoff thread`,
        timestampMs: Date.parse(adhocTownTrace.started_at) || Date.now(),
        crossHouseCount: adhocTownTrace.packets.filter(isCrossHousePacket).length,
        trace: adhocTownTrace,
      });
    }

    return Array.from(byId.values()).sort((a, b) => b.timestampMs - a.timestampMs);
  }, [adhocTownTrace, chatHistory, tasks]);

  const activeTownTraceEntry = useMemo(() => {
    if (townTraceHidden || allTownTraces.length === 0) return null;
    if (townTraceTaskId) {
      const matched = allTownTraces.find((item) => item.taskId === townTraceTaskId);
      if (matched) return matched;
    }
    return allTownTraces[0];
  }, [allTownTraces, townTraceHidden, townTraceTaskId]);

  // Google Workspace Auth State
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [hasWorkspaceToken, setHasWorkspaceToken] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [workspaceBriefing, setWorkspaceBriefing] = useState<WorkspaceBriefing>(
    initialLocalRef.current?.workspaceSnapshot ?? EMPTY_BRIEFING
  );

  const lastMKeyRef = useRef<number>(0);
  const taskInputElRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!liveStatusText || liveStatusText.endsWith('...')) return;
    const t = setTimeout(() => setLiveStatusText(null), 4500);
    return () => clearTimeout(t);
  }, [liveStatusText]);

  const voiceState = useVoicePlayer();

  const bumpAgents = useCallback(() => {
    setAgentsVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    return voicePlayer.onAgentSpeaking((agentId, snippet) => {
      if (!agentId || !snippet) return;
      const speakingAgent = agentsRef.current.find((a) => a.id === agentId);
      if (speakingAgent) {
        speakingAgent.speechBubble = snippet;
        speakingAgent.speechTimer = 220;
        bumpAgents();
      }
    });
  }, [bumpAgents]);

  const pushActivityEvent = useCallback((event: VillageActivityEvent) => {
    setActivityFeed((prev) => [event, ...prev].slice(0, 60));
  }, []);

  const buildStateSnapshot = useCallback((): PersistedVillageState => {
    const instructions: Record<string, string> = {};
    const notes: Record<string, string[]> = {};
    for (const a of agentsRef.current) {
      instructions[a.id] = a.instructions;
      notes[a.id] = a.notes;
    }
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      activeScreen: screen,
      activeBuildingId: activeBuilding?.id ?? null,
      selectedAgentId,
      rightDrawerMode,
      agents: agentsRef.current.map((a) => ({ ...a })),
      tasks: tasks.filter(
        (t) =>
          t.status !== 'queued' &&
          t.status !== 'matt_routing' &&
          t.status !== 'worker_executing' &&
          t.status !== 'director_review' &&
          t.status !== 'advisor_escalated'
      ),
      approvals,
      chatHistory,
      activityFeed,
      knowledgeBase,
      kbProposals,
      workspaceSnapshot: workspaceBriefing.connected ? workspaceBriefing : undefined,
      settings,
      instructions,
      notes,
    };
  }, [
    screen,
    activeBuilding,
    selectedAgentId,
    rightDrawerMode,
    tasks,
    approvals,
    chatHistory,
    activityFeed,
    knowledgeBase,
    kbProposals,
    workspaceBriefing,
    settings,
  ]);

  const persistStateNow = useCallback(
    (useBeacon = false) => {
      if (!hasHydratedRef.current) return;
      const snapshot = buildStateSnapshot();
      writeLocalVillageState(snapshot);
      const json = JSON.stringify(snapshot);
      if (useBeacon && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([json], { type: 'application/json' });
        navigator.sendBeacon('/api/village/state', blob);
        return;
      }
      void fetch('/api/village/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
      }).catch(() => {
        // Local storage already persisted; ignore transient offline write failure
      });
    },
    [buildStateSnapshot]
  );

  const persistRef = useRef(persistStateNow);
  useEffect(() => {
    persistRef.current = persistStateNow;
  }, [persistStateNow]);

  const refreshWorkspaceBriefing = useCallback(
    async (
      token?: string | null,
      gmailOverride?: { includeInbox: boolean; selectedLabels: GmailLabelConfig[] }
    ) => {
      const activeToken = token ?? getAccessToken();
      let url = '/api/workspace/briefing';
      if (gmailOverride || hasHydratedRef.current) {
        const includeInbox = gmailOverride
          ? gmailOverride.includeInbox
          : settingsRef.current.gmailIncludeInbox;
        const selectedLabels = gmailOverride
          ? gmailOverride.selectedLabels
          : settingsRef.current.gmailSelectedLabels;
        const qs = new URLSearchParams({
          includeInbox: includeInbox ? '1' : '0',
          selectedLabels: JSON.stringify(selectedLabels),
        });
        url = `/api/workspace/briefing?${qs.toString()}`;
      }
      try {
        const res = await fetch(url, {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : undefined,
        });
        if (res.ok) {
          const data = (await res.json()) as WorkspaceBriefing;
          if (activeToken && !data.connected && data.error) {
            clearExpiredWorkspaceToken();
          }
          if (
            data.connected ||
            (data.linkedDocs && data.linkedDocs.length > 0) ||
            (data.pinnedDriveFiles && data.pinnedDriveFiles.length > 0) ||
            (data.pinnedChats && data.pinnedChats.length > 0)
          ) {
            setWorkspaceBriefing(data);
          }
        }
      } catch {
        // Ignore transient briefing fetch errors
      }
    },
    []
  );

  // Hydrate persisted village & agent state + init persistent Firebase Auth
  useEffect(() => {
    document.title = 'Guildhaven';
    void (async () => {
      try {
        const res = await fetch('/api/village/state');
        if (res.ok) {
          const serverState = (await res.json()) as PersistedVillageState;
          if (serverState.choSessionToken) {
            choSessionTokenRef.current = serverState.choSessionToken;
          }
          // Server is always authoritative for live Knowledge Base & KB Proposal ledger
          if (Array.isArray(serverState.knowledgeBase)) {
            setKnowledgeBase(mergeKnowledgeBase(serverState.knowledgeBase));
          }
          if (Array.isArray(serverState.kbProposals)) {
            setKbProposals(serverState.kbProposals);
          }
          if (serverState.townAutopilotSettings) {
            setTownAutopilotSettings(
              normalizeTownAutopilotSettings(serverState.townAutopilotSettings)
            );
          }
          if (Array.isArray(serverState.townAutomationRules)) {
            setTownAutomationRules(mergeTownAutomationRules(serverState.townAutomationRules));
          }
          if (Array.isArray(serverState.automationRuns)) {
            setAutomationRuns(serverState.automationRuns);
          }

          const localState = initialLocalRef.current;
          const serverTime = Date.parse(serverState.updatedAt || '') || 0;
          const localTime = Date.parse(localState?.updatedAt || '') || 0;

          if (hasMeaningfulState(serverState) && (serverTime >= localTime || !hasMeaningfulState(localState))) {
            agentsRef.current = mergePersistedAgents(
              serverState.agents,
              serverState.instructions,
              serverState.notes,
              serverState.tasks ?? [],
              serverState.approvals ?? []
            );
            if (Array.isArray(serverState.tasks)) setTasks(serverState.tasks);
            if (Array.isArray(serverState.approvals)) setApprovals(serverState.approvals);
            if (serverState.chatHistory) setChatHistory(serverState.chatHistory);
            if (Array.isArray(serverState.activityFeed)) {
              setActivityFeed(sanitizeActivityFeed(serverState.activityFeed));
            }
            if (serverState.activeScreen) setScreen(serverState.activeScreen);
            if (serverState.activeBuildingId) {
              const found = VILLAGE_BUILDINGS.find((b) => b.id === serverState.activeBuildingId) ?? null;
              setActiveBuilding(found);
            }
            if (serverState.selectedAgentId !== undefined) {
              setSelectedAgentId(serverState.selectedAgentId ?? null);
            }
            if (serverState.rightDrawerMode) {
              setRightDrawerMode(normalizeRightDrawerMode(serverState.rightDrawerMode));
            }
            if (
              serverState.workspaceSnapshot?.connected ||
              (serverState.workspaceSnapshot?.pinnedChats &&
                serverState.workspaceSnapshot.pinnedChats.length > 0)
            ) {
              setWorkspaceBriefing(serverState.workspaceSnapshot);
            }
            if (serverState.settings) {
              const normSettings = normalizeVillageSettings(serverState.settings);
              settingsRef.current = normSettings;
              setSettings(normSettings);
            }
            bumpAgents();
          } else {
            // Merge any newer/additional dossier notes from server if local wasn't hydrated from server
            if (serverState.instructions || serverState.notes) {
              for (const a of agentsRef.current) {
                if (serverState.instructions?.[a.id] && !localState?.instructions?.[a.id]) {
                  a.instructions = serverState.instructions[a.id];
                }
                if (serverState.notes?.[a.id] && (!localState?.notes?.[a.id] || localState.notes[a.id].length === 0)) {
                  a.notes = sanitizeAgentNotes(serverState.notes[a.id]);
                }
              }
              bumpAgents();
            }
            if (hasMeaningfulState(localState)) {
              hasHydratedRef.current = true;
              persistRef.current(false);
              return;
            }
          }
        }
      } catch {
        // LocalStorage fallback already loaded synchronously
      } finally {
        hasHydratedRef.current = true;
      }
    })();

    const trigger4kRender = async (force = false) => {
      setIsRendering4k(true);
      if (force) {
        setLiveStatusText('Rendering 4K Guildhaven diorama...');
      }
      try {
        const res = await fetch('/api/village/render-4k-map', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        });
        const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
        if (res.ok && data.url) {
          setMap4kUrl(data.url);
          if (force) {
            setLiveStatusText('4K Guildhaven diorama map rendered and active.');
          }
        } else if (force && data.error) {
          setLiveStatusText(data.error);
        }
      } catch {
        // Keep bundled map active on transient error
      } finally {
        setIsRendering4k(false);
      }
    };

    void (async () => {
      try {
        const statusRes = await fetch('/api/village/map-4k/status');
        if (statusRes.ok) {
          const st = (await statusRes.json()) as { ready?: boolean; url?: string | null };
          if (st.ready && st.url) {
            setMap4kUrl(st.url);
            return;
          }
        }
      } catch {
        // Ignore status check errors
      }
      void trigger4kRender(false);
    })();

    const unsub = initAuth(
      (user, token) => {
        setIsGoogleConnected(true);
        setHasWorkspaceToken(true);
        setUserEmail(user.email);
        void refreshWorkspaceBriefing(token);
      },
      () => {
        setIsGoogleConnected(false);
        setHasWorkspaceToken(false);
        setUserEmail(null);
        setWorkspaceBriefing(EMPTY_BRIEFING);
      },
      (user) => {
        // Firebase persisted user session across page refresh; hydrate latest synced Workspace snapshot immediately
        setIsGoogleConnected(true);
        setHasWorkspaceToken(Boolean(getAccessToken()));
        setUserEmail(user.email);
        void refreshWorkspaceBriefing();
      }
    );
    const unsubToken = onWorkspaceTokenUpdate((nextToken) => {
      setHasWorkspaceToken(Boolean(nextToken));
      if (nextToken) {
        void refreshWorkspaceBriefing(nextToken);
      }
    });
    return () => {
      unsub();
      unsubToken();
    };
  }, [bumpAgents, refreshWorkspaceBriefing]);

  // Continuous background auto-sync for Gmail & Google Calendar every 60s and on tab focus
  useEffect(() => {
    if (!isGoogleConnected) return;
    void refreshWorkspaceBriefing();

    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refreshWorkspaceBriefing();
      }
    }, 60_000);

    const onVisibilitySync = () => {
      if (document.visibilityState === 'visible') {
        void refreshWorkspaceBriefing();
      }
    };
    document.addEventListener('visibilitychange', onVisibilitySync);

    return () => {
      window.clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', onVisibilitySync);
    };
  }, [isGoogleConnected, hasWorkspaceToken, refreshWorkspaceBriefing]);

  // Reactive save whenever UI / tasks / approvals / chats / agents state updates
  useEffect(() => {
    if (!hasHydratedRef.current) return;
    const t = setTimeout(() => {
      persistRef.current(false);
    }, 250);
    return () => clearTimeout(t);
  }, [
    screen,
    activeBuilding,
    selectedAgentId,
    rightDrawerMode,
    tasks,
    approvals,
    chatHistory,
    activityFeed,
    knowledgeBase,
    agentsVersion,
    workspaceBriefing,
    settings,
  ]);

  // Continuous live coordinate/state/busy snapshot every 2s + immediate flush on refresh/tab hide
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasHydratedRef.current) {
        persistRef.current(false);
      }
    }, 2000);

    const handleBeforeUnload = () => {
      persistRef.current(true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistRef.current(true);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const handleRender4kMap = async () => {
    if (isRendering4k) return;
    setIsRendering4k(true);
    setLiveStatusText('Rendering 4K Guildhaven diorama...');
    try {
      const res = await fetch('/api/village/render-4k-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: Boolean(map4kUrl) }),
      });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Failed to render 4K Guildhaven map.');
      }
      setMap4kUrl(data.url);
      setLiveStatusText('4K Guildhaven diorama map active.');
    } catch (err) {
      setLiveStatusText(err instanceof Error ? err.message : '4K render failed.');
    } finally {
      setIsRendering4k(false);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      const res = await googleSignIn();
      if (res) {
        setIsGoogleConnected(true);
        setHasWorkspaceToken(true);
        setUserEmail(res.user.email);
        await refreshWorkspaceBriefing(res.accessToken);
      }
    } catch (err) {
      setLiveStatusText(err instanceof Error ? err.message : 'Google sign-in cancelled.');
    }
  };

  const handleSyncWorkspace = async () => {
    try {
      const token = await ensureWorkspaceToken();
      if (token) {
        setHasWorkspaceToken(true);
        await refreshWorkspaceBriefing(token);
        setLiveStatusText('Google Workspace (Gmail, Calendar, Chat, Docs & Drive) synced.');
        return;
      }
      const res = await refreshWorkspaceAccess();
      if (res) {
        setIsGoogleConnected(true);
        setHasWorkspaceToken(true);
        setUserEmail(res.user.email);
        await refreshWorkspaceBriefing(res.accessToken);
        setLiveStatusText('Google Workspace (Gmail, Calendar, Chat, Docs & Drive) synced.');
      }
    } catch (err) {
      setLiveStatusText(err instanceof Error ? err.message : 'Workspace sync cancelled.');
    }
  };

  const resolveFreshWorkspaceToken = useCallback(async (): Promise<string> => {
    const existing = getAccessToken() ?? (isGoogleConnected ? await ensureWorkspaceToken() : null);
    if (existing) {
      setHasWorkspaceToken(true);
      return existing;
    }
    const signed = await googleSignIn();
    if (!signed?.accessToken) {
      throw new Error('Please Sign in with Google first.');
    }
    setIsGoogleConnected(true);
    setHasWorkspaceToken(true);
    setUserEmail(signed.user.email);
    return signed.accessToken;
  }, [isGoogleConnected]);

  const handleUpdateGmailSources = useCallback(
    (next: { includeInbox: boolean; selectedLabels: GmailLabelConfig[] }) => {
      const normalized = normalizeVillageSettings({
        ...settingsRef.current,
        gmailIncludeInbox: next.includeInbox,
        gmailSelectedLabels: next.selectedLabels,
      });
      updateVillageSettings((prev) => ({
        ...prev,
        gmailIncludeInbox: normalized.gmailIncludeInbox,
        gmailSelectedLabels: normalized.gmailSelectedLabels,
      }));
      const sourceNames = [
        ...(normalized.gmailIncludeInbox ? ['Primary Inbox'] : []),
        ...normalized.gmailSelectedLabels.map((l) => l.name),
      ];
      setLiveStatusText(
        sourceNames.length > 0
          ? `Gmail sources updated: ${sourceNames.slice(0, 3).join(', ')}${
              sourceNames.length > 3 ? ` +${sourceNames.length - 3} more` : ''
            }.`
          : 'No Gmail sources selected — enable Primary Inbox or choose a label.'
      );
      if (isGoogleConnected) {
        void refreshWorkspaceBriefing(undefined, {
          includeInbox: normalized.gmailIncludeInbox,
          selectedLabels: normalized.gmailSelectedLabels,
        });
      }
    },
    [isGoogleConnected, refreshWorkspaceBriefing, updateVillageSettings]
  );

  const handleListGmailLabels = useCallback(async (): Promise<GmailLabelSummary[]> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/gmail/labels', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/gmail/labels', {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      labels?: GmailLabelSummary[];
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to load Gmail labels.');
    }
    const labels = data.labels ?? [];
    setWorkspaceBriefing((prev) => ({
      ...prev,
      gmailLabels: labels,
    }));
    return labels;
  }, [resolveFreshWorkspaceToken]);

  const handleReadGmailMessages = useCallback(
    async (params: {
      labelIds?: string[];
      includeInbox?: boolean;
      query?: string;
      unreadOnly?: boolean;
      maxResults?: number;
      includeBody?: boolean;
    }): Promise<{ messages: GmailSummary[]; matchedLabels: GmailLabelSummary[] }> => {
      let token = await resolveFreshWorkspaceToken();
      let res = await fetch('/api/workspace/gmail/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(params),
      });
      if (res.status === 401 || res.status === 403) {
        const consent = await requestWorkspaceConsent();
        if (consent?.accessToken) {
          token = consent.accessToken;
          res = await fetch('/api/workspace/gmail/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(params),
          });
        }
      }
      const data = (await res.json()) as {
        ok?: boolean;
        messages?: GmailSummary[];
        matchedLabels?: GmailLabelSummary[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to read Gmail messages.');
      }
      return {
        messages: data.messages ?? [],
        matchedLabels: data.matchedLabels ?? [],
      };
    },
    [resolveFreshWorkspaceToken]
  );

  const handleGrantWorkspaceConsent = async () => {
    try {
      const res = await requestWorkspaceConsent();
      if (res) {
        setIsGoogleConnected(true);
        setHasWorkspaceToken(true);
        setUserEmail(res.user.email);
        await refreshWorkspaceBriefing(res.accessToken);
        setLiveStatusText('Google Workspace (Chat, Docs & Drive) permissions enabled.');
      }
    } catch (err) {
      setLiveStatusText(err instanceof Error ? err.message : 'Permission prompt cancelled.');
    }
  };

  const handleGrantCalendarWriteConsent = async () => {
    try {
      setCalendarWriteAccessScopeEnabled(true);
      const res = await requestWorkspaceConsent({ includeCalendarWrite: true });
      if (!res?.accessToken) {
        throw new Error('Google Calendar authorization was cancelled.');
      }
      setIsGoogleConnected(true);
      setHasWorkspaceToken(true);
      setUserEmail(res.user.email);
      await refreshWorkspaceBriefing(res.accessToken);
      setLiveStatusText('Google Calendar write permissions authorized.');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Google Calendar authorization cancelled.';
      setLiveStatusText(msg);
      throw err instanceof Error ? err : new Error(msg);
    }
  };

  const handleCreateCalendarEvent = async (params: {
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
  }): Promise<CalendarEventSummary> => {
    if (!settingsRef.current.calendarWriteAccess) {
      throw new Error('Calendar write access is currently set to Read-Only in Settings.');
    }
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/calendar/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    let data = (await res.json()) as {
      ok?: boolean;
      event?: CalendarEventSummary;
      error?: string;
      calendarSettingDisabled?: boolean;
    };
    if (res.status === 403 && !data.calendarSettingDisabled) {
      setCalendarWriteAccessScopeEnabled(true);
      const consent = await requestWorkspaceConsent({ includeCalendarWrite: true });
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/calendar/events', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });
        data = (await res.json()) as {
          ok?: boolean;
          event?: CalendarEventSummary;
          error?: string;
          calendarSettingDisabled?: boolean;
        };
      }
    }
    if (!res.ok || !data.event) {
      throw new Error(data.error || 'Failed to create Google Calendar event.');
    }
    const createdEvent = data.event;
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      calendarStatus: 'connected_write',
      upcomingEvents: [
        createdEvent,
        ...prev.upcomingEvents.filter((ev) => ev.id !== createdEvent.id),
      ].sort((a, b) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0)),
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Scheduled Calendar event: "${createdEvent.summary}"`;
      bumpAgents();
    }
    setLiveStatusText(`Added "${createdEvent.summary}" to your Google Calendar.`);
    void refreshWorkspaceBriefing(token);
    soundFx.taskDone();
    return createdEvent;
  };

  const handleUpdateCalendarEvent = async (
    eventId: string,
    params: {
      summary?: string;
      start?: string;
      end?: string;
      location?: string;
      description?: string;
    }
  ): Promise<CalendarEventSummary> => {
    if (!settingsRef.current.calendarWriteAccess) {
      throw new Error('Calendar write access is currently set to Read-Only in Settings.');
    }
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch(`/api/workspace/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    let data = (await res.json()) as {
      ok?: boolean;
      event?: CalendarEventSummary;
      error?: string;
      calendarSettingDisabled?: boolean;
    };
    if (res.status === 403 && !data.calendarSettingDisabled) {
      setCalendarWriteAccessScopeEnabled(true);
      const consent = await requestWorkspaceConsent({ includeCalendarWrite: true });
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch(`/api/workspace/calendar/events/${encodeURIComponent(eventId)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });
        data = (await res.json()) as {
          ok?: boolean;
          event?: CalendarEventSummary;
          error?: string;
          calendarSettingDisabled?: boolean;
        };
      }
    }
    if (!res.ok || !data.event) {
      throw new Error(data.error || 'Failed to update Google Calendar event.');
    }
    const updatedEvent = data.event;
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      calendarStatus: 'connected_write',
      upcomingEvents: prev.upcomingEvents
        .map((ev) => (ev.id === updatedEvent.id ? updatedEvent : ev))
        .sort((a, b) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0)),
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Updated Calendar event: "${updatedEvent.summary}"`;
      bumpAgents();
    }
    setLiveStatusText(`Updated "${updatedEvent.summary}" on Google Calendar.`);
    void refreshWorkspaceBriefing(token);
    soundFx.taskDone();
    return updatedEvent;
  };

  const handleDeleteCalendarEvent = async (eventId: string): Promise<void> => {
    if (!settingsRef.current.calendarWriteAccess) {
      throw new Error('Calendar write access is currently set to Read-Only in Settings.');
    }
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch(`/api/workspace/calendar/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    let data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      calendarSettingDisabled?: boolean;
    };
    if (res.status === 403 && !data.calendarSettingDisabled) {
      setCalendarWriteAccessScopeEnabled(true);
      const consent = await requestWorkspaceConsent({ includeCalendarWrite: true });
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch(`/api/workspace/calendar/events/${encodeURIComponent(eventId)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          calendarSettingDisabled?: boolean;
        };
      }
    }
    if (!res.ok) {
      throw new Error(data.error || 'Failed to remove Google Calendar event.');
    }
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      calendarStatus: 'connected_write',
      upcomingEvents: prev.upcomingEvents.filter((ev) => ev.id !== eventId),
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = 'Removed event from Google Calendar';
      bumpAgents();
    }
    setLiveStatusText('Removed event from Google Calendar.');
    void refreshWorkspaceBriefing(token);
  };

  const handleSendGoogleChatMessage = async (
    spaceName: string,
    text: string,
    threadName?: string
  ) => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/chat/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ spaceName, text, threadName }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/chat/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ spaceName, text, threadName }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      messageName?: string;
      threadName?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to send Google Chat message.');
    }
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = threadName
        ? `Replied in Google Chat thread (${spaceName})`
        : `Sent Google Chat update to ${spaceName}`;
      bumpAgents();
    }
    await refreshWorkspaceBriefing(token);
    soundFx.taskDone();
  };

  const handleListGoogleChatSpaces = async (params?: {
    pageToken?: string;
    filterType?: 'ALL' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  }): Promise<{ spaces: ChatSpaceSummary[]; nextPageToken?: string }> => {
    let token = await resolveFreshWorkspaceToken();
    const qs = new URLSearchParams();
    if (params?.pageToken) qs.set('pageToken', params.pageToken);
    if (params?.filterType) qs.set('filterType', params.filterType);
    const url = `/api/workspace/chat/spaces${qs.toString() ? `?${qs.toString()}` : ''}`;

    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      spaces?: ChatSpaceSummary[];
      nextPageToken?: string;
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to list Google Chat spaces.');
    }
    return {
      spaces: data.spaces ?? [],
      nextPageToken: data.nextPageToken,
    };
  };

  const handleReadGoogleChatConversation = async (params: {
    target: string;
    threadName?: string;
    pageSize?: number;
    pageToken?: string;
    searchQuery?: string;
  }): Promise<{
    space: ChatSpaceSummary;
    messages: GoogleChatMessageSummary[];
    threads: GoogleChatThreadSummary[];
    focusedThreadName?: string;
    nextPageToken?: string;
  }> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/chat/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(params),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/chat/read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      space?: ChatSpaceSummary;
      messages?: GoogleChatMessageSummary[];
      threads?: GoogleChatThreadSummary[];
      focusedThreadName?: string;
      nextPageToken?: string;
      error?: string;
    };
    if (!res.ok || !data.space) {
      throw new Error(data.error || 'Failed to read Google Chat conversation.');
    }
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Reading Google Chat: ${data.space.displayName}${
        data.focusedThreadName ? ' (thread)' : ''
      }`;
      bumpAgents();
    }
    return {
      space: data.space,
      messages: data.messages ?? [],
      threads: data.threads ?? [],
      focusedThreadName: data.focusedThreadName,
      nextPageToken: data.nextPageToken,
    };
  };

  const handlePinGoogleChatContext = async (params: {
    target?: string;
    spaceName: string;
    spaceDisplayName: string;
    spaceType?: string;
    threadName?: string;
    label?: string;
    messages: GoogleChatMessageSummary[];
  }): Promise<PinnedChatContext[]> => {
    let token = getAccessToken();
    if (!token && isGoogleConnected) {
      token = await ensureWorkspaceToken();
    }
    let res = await fetch('/api/workspace/chat/pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/chat/pin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(params),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      pinned?: PinnedChatContext;
      pinnedChats?: PinnedChatContext[];
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to pin Google Chat conversation.');
    }
    const nextPinned =
      data.pinnedChats ??
      (data.pinned ? [data.pinned, ...(workspaceBriefing.pinnedChats ?? [])] : []);
    setWorkspaceBriefing((prev) => ({
      ...prev,
      pinnedChats: nextPinned,
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel && data.pinned) {
      daniel.currentActivity = `Pinned Google Chat context: "${data.pinned.label}"`;
      bumpAgents();
    }
    if (data.pinned) {
      setLiveStatusText(`Pinned "${data.pinned.label}" to Daniel & Village context.`);
    }
    soundFx.taskDone();
    return nextPinned;
  };

  const handleUnpinGoogleChatContext = async (id: string): Promise<PinnedChatContext[]> => {
    const res = await fetch('/api/workspace/chat/unpin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      pinnedChats?: PinnedChatContext[];
      error?: string;
    };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to unpin Google Chat context.');
    }
    const nextPinned =
      data.pinnedChats ?? (workspaceBriefing.pinnedChats ?? []).filter((c) => c.id !== id);
    setWorkspaceBriefing((prev) => ({
      ...prev,
      pinnedChats: nextPinned,
    }));
    return nextPinned;
  };

  const handleImportGoogleDoc = async (docIdOrUrl: string) => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/docs/import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ docIdOrUrl }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/docs/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ docIdOrUrl }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      doc?: GoogleDocSummary;
      linkedDocs?: GoogleDocSummary[];
      error?: string;
    };
    if (!res.ok || !data.doc) {
      throw new Error(data.error || 'Failed to read Google Doc.');
    }
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      docsStatus: 'connected',
      linkedDocs: data.linkedDocs ?? [data.doc!, ...(prev.linkedDocs ?? [])],
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Linked Google Doc: "${data.doc.title}"`;
      bumpAgents();
    }
    setLiveStatusText(`Linked Google Doc "${data.doc.title}".`);
    soundFx.taskDone();
  };

  const handleCreateGoogleDoc = async (
    title: string,
    content: string,
    sourceTaskId?: string
  ): Promise<{ url: string; title: string }> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/docs/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title, content, sourceTaskId }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/docs/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ title, content, sourceTaskId }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      doc?: GoogleDocSummary;
      linkedDocs?: GoogleDocSummary[];
      error?: string;
    };
    if (!res.ok || !data.doc) {
      throw new Error(data.error || 'Failed to create Google Doc.');
    }
    const createdDoc = data.doc;
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      docsStatus: 'connected',
      linkedDocs: data.linkedDocs ?? [createdDoc, ...(prev.linkedDocs ?? [])],
    }));
    if (sourceTaskId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === sourceTaskId
            ? { ...t, exportedDocUrl: createdDoc.url, exportedDocTitle: createdDoc.title }
            : t
        )
      );
    }
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Created Google Doc: "${createdDoc.title}"`;
      bumpAgents();
    }
    setLiveStatusText(`Created Google Doc "${createdDoc.title}".`);
    soundFx.taskDone();
    return { url: createdDoc.url, title: createdDoc.title };
  };

  const handleExportTaskToGoogleDoc = async (
    task: VillageTask
  ): Promise<{ url: string; title: string }> => {
    const cleanTitle =
      task.prompt.length > 72 ? `${task.prompt.slice(0, 69)}...` : task.prompt;
    const body = `${task.summary}\n\nPrepared by ${task.assignedDirectorName} (Guildhaven)\n\n${task.reportMarkdown}`;
    return handleCreateGoogleDoc(cleanTitle, body, task.id);
  };

  const handleUnlinkGoogleDoc = async (documentId: string) => {
    const res = await fetch(`/api/workspace/docs/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    });
    const data = (await res.json()) as { ok?: boolean; linkedDocs?: GoogleDocSummary[] };
    if (res.ok && Array.isArray(data.linkedDocs)) {
      setWorkspaceBriefing((prev) => ({
        ...prev,
        linkedDocs: data.linkedDocs,
      }));
    }
  };

  const handleSearchDriveFiles = async (
    query?: string,
    folderId?: string
  ): Promise<GoogleDriveFileSummary[]> => {
    let token = await resolveFreshWorkspaceToken();
    const params = new URLSearchParams();
    if (query?.trim()) params.set('q', query.trim());
    if (folderId?.trim()) params.set('folderId', folderId.trim());
    const qs = params.toString();
    const url = `/api/workspace/drive/files${qs ? `?${qs}` : ''}`;

    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      files?: GoogleDriveFileSummary[];
      error?: string;
    };
    if (!res.ok || !Array.isArray(data.files)) {
      throw new Error(data.error || 'Failed to search Google Drive.');
    }
    return data.files;
  };

  const handlePinDriveFile = async (fileIdOrUrl: string): Promise<void> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/drive/pin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileIdOrUrl }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/drive/pin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ fileIdOrUrl }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      pinnedDriveFiles?: GoogleDriveFileSummary[];
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(data.error || 'Failed to pin Google Drive item.');
    }
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      driveStatus: 'connected',
      pinnedDriveFiles: data.pinnedDriveFiles ?? [data.file!, ...(prev.pinnedDriveFiles ?? [])],
    }));
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = `Pinned Drive item: "${data.file.name}"`;
      bumpAgents();
    }
    setLiveStatusText(`Pinned "${data.file.name}" from Google Drive into village context.`);
    soundFx.taskDone();
  };

  const handleUnpinDriveFile = async (fileId: string): Promise<void> => {
    const res = await fetch(`/api/workspace/drive/pin/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
    });
    const data = (await res.json()) as {
      ok?: boolean;
      pinnedDriveFiles?: GoogleDriveFileSummary[];
    };
    if (res.ok && Array.isArray(data.pinnedDriveFiles)) {
      setWorkspaceBriefing((prev) => ({
        ...prev,
        pinnedDriveFiles: data.pinnedDriveFiles,
      }));
    }
  };

  const handleSaveDriveFile = async (params: {
    name: string;
    content?: string;
    isFolder?: boolean;
    parentFolderId?: string;
    sourceTaskId?: string;
  }): Promise<{ url: string; name: string }> => {
    const resolvedParentFolderId =
      params.parentFolderId ?? settingsRef.current.driveWorkingFolder?.id;
    const payload = {
      ...params,
      ...(resolvedParentFolderId ? { parentFolderId: resolvedParentFolderId } : {}),
    };
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/drive/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/drive/save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      pinnedDriveFiles?: GoogleDriveFileSummary[];
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(data.error || 'Failed to save to Google Drive.');
    }
    const savedFile = data.file;
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      driveStatus: 'connected',
      driveFiles: [savedFile, ...(prev.driveFiles ?? []).filter((f) => f.id !== savedFile.id)],
      pinnedDriveFiles: data.pinnedDriveFiles ?? [savedFile, ...(prev.pinnedDriveFiles ?? [])],
    }));
    if (params.sourceTaskId) {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === params.sourceTaskId
            ? { ...t, exportedDriveUrl: savedFile.webViewLink, exportedDriveName: savedFile.name }
            : t
        )
      );
    }
    const daniel = agentsRef.current.find((a) => a.id === 'daniel');
    if (daniel) {
      daniel.currentActivity = params.isFolder
        ? `Created Drive folder: "${savedFile.name}"`
        : `Saved to Google Drive: "${savedFile.name}"`;
      bumpAgents();
    }
    setLiveStatusText(
      params.isFolder
        ? `Created Google Drive folder "${savedFile.name}".`
        : `Saved "${savedFile.name}" to Google Drive.`
    );
    soundFx.taskDone();
    return {
      url: savedFile.webViewLink || `https://drive.google.com/file/d/${savedFile.id}/view`,
      name: savedFile.name,
    };
  };

  const handleExportTaskToDrive = async (
    task: VillageTask
  ): Promise<{ url: string; name: string }> => {
    const cleanStem = (task.prompt.length > 60 ? task.prompt.slice(0, 60) : task.prompt)
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim();
    const fileName = `${cleanStem || 'Executive-Deliverable'}.md`;
    const content = `# ${task.prompt}\n\n**Executive Summary:** ${task.summary}\n\n*Prepared by ${task.assignedDirectorName} · Guildhaven*\n\n---\n\n${task.reportMarkdown}`;
    return handleSaveDriveFile({
      name: fileName,
      content,
      parentFolderId: settingsRef.current.driveWorkingFolder?.id,
      sourceTaskId: task.id,
    });
  };

  const handleListDriveFolders = async (query?: string): Promise<GoogleDriveFileSummary[]> => {
    let token = await resolveFreshWorkspaceToken();
    const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    let res = await fetch(`/api/workspace/drive/folders${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch(`/api/workspace/drive/folders${qs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      folders?: GoogleDriveFileSummary[];
      error?: string;
    };
    if (!res.ok || !Array.isArray(data.folders)) {
      throw new Error(data.error || 'Failed to list Google Drive folders.');
    }
    return data.folders;
  };

  const handleCreateWorkingFolder = async (name: string): Promise<DriveWorkingFolderConfig> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/drive/working-folder/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ createRootFolder: true, name }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/drive/working-folder/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ createRootFolder: true, name }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      workingFolder?: DriveWorkingFolderConfig;
      error?: string;
    };
    if (!res.ok || !data.workingFolder) {
      throw new Error(data.error || 'Failed to create Google Drive Working Folder.');
    }
    setSettings((prev) => ({
      ...prev,
      driveWorkingFolder: data.workingFolder!,
    }));
    setWorkspaceBriefing((prev) => ({
      ...prev,
      connected: true,
      driveStatus: 'connected',
      workingFolder: data.workingFolder!,
      workingFolderFiles: [],
    }));
    soundFx.taskDone();
    return data.workingFolder;
  };

  const handleSelectWorkingFolderByUrl = async (
    folderUrlOrId: string
  ): Promise<DriveWorkingFolderConfig> => {
    let token = await resolveFreshWorkspaceToken();
    let res = await fetch('/api/workspace/drive/working-folder/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileId: folderUrlOrId }),
    });
    if (res.status === 403) {
      const consent = await requestWorkspaceConsent();
      if (consent?.accessToken) {
        token = consent.accessToken;
        res = await fetch('/api/workspace/drive/working-folder/read', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ fileId: folderUrlOrId }),
        });
      }
    }
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(data.error || 'Could not find that Google Drive folder.');
    }
    if (!data.file.isFolder) {
      throw new Error('The linked Google Drive URL/ID is a file, not a folder. Please paste a Drive Folder link.');
    }
    const config: DriveWorkingFolderConfig = {
      id: data.file.id,
      name: data.file.name,
      webViewLink:
        data.file.webViewLink || `https://drive.google.com/drive/folders/${data.file.id}`,
      configuredAt: new Date().toISOString(),
    };
    setSettings((prev) => ({
      ...prev,
      driveWorkingFolder: config,
    }));
    setWorkspaceBriefing((prev) => ({
      ...prev,
      workingFolder: config,
    }));
    soundFx.taskDone();
    return config;
  };

  const handleListWorkingFolderFiles = async (
    folderId?: string,
    query?: string
  ): Promise<GoogleDriveFileSummary[]> => {
    const workingFolderId = settingsRef.current.driveWorkingFolder?.id;
    if (!workingFolderId) return [];
    const token = await resolveFreshWorkspaceToken();
    const params = new URLSearchParams({ workingFolderId });
    if (folderId?.trim()) params.set('folderId', folderId.trim());
    if (query?.trim()) params.set('q', query.trim());
    const res = await fetch(`/api/workspace/drive/working-folder/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as {
      ok?: boolean;
      files?: GoogleDriveFileSummary[];
      error?: string;
    };
    if (!res.ok || !Array.isArray(data.files)) {
      throw new Error(data.error || 'Failed to list Working Folder contents.');
    }
    if (!folderId || folderId === workingFolderId) {
      setWorkspaceBriefing((prev) => ({
        ...prev,
        workingFolderFiles: data.files,
      }));
    }
    return data.files;
  };

  const handleReadWorkingFolderFile = async (fileId: string): Promise<GoogleDriveFileSummary> => {
    const workingFolderId = settingsRef.current.driveWorkingFolder?.id;
    const token = await resolveFreshWorkspaceToken();
    const res = await fetch('/api/workspace/drive/working-folder/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileId, workingFolderId }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(data.error || 'Failed to read Working Folder file.');
    }
    return data.file;
  };

  const handleCreateWorkingFolderItem = async (params: {
    name: string;
    content?: string;
    isFolder?: boolean;
    parentFolderId?: string;
  }): Promise<GoogleDriveFileSummary> => {
    const workingFolderId = settingsRef.current.driveWorkingFolder?.id;
    if (!workingFolderId) {
      throw new Error('No Google Drive Working Folder configured yet.');
    }
    const token = await resolveFreshWorkspaceToken();
    const res = await fetch('/api/workspace/drive/working-folder/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        workingFolderId,
        parentFolderId: params.parentFolderId ?? workingFolderId,
        name: params.name,
        content: params.content,
        isFolder: params.isFolder,
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      error?: string;
    };
    if (!res.ok || !data.file) {
      throw new Error(data.error || 'Failed to create item in Working Folder.');
    }
    soundFx.taskDone();
    return data.file;
  };

  const handleUpdateWorkingFolderFile = async (params: {
    fileId: string;
    name?: string;
    content?: string;
  }): Promise<GoogleDriveFileSummary> => {
    const workingFolderId = settingsRef.current.driveWorkingFolder?.id;
    if (!workingFolderId) {
      throw new Error('No Google Drive Working Folder configured yet.');
    }
    const token = await resolveFreshWorkspaceToken();
    const res = await fetch(
      `/api/workspace/drive/working-folder/files/${encodeURIComponent(params.fileId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          workingFolderId,
          name: params.name,
          content: params.content,
        }),
      }
    );
    const data = (await res.json()) as {
      ok?: boolean;
      file?: GoogleDriveFileSummary;
      error?: string;
      readOnlyExternal?: boolean;
    };
    if (!res.ok || !data.file) {
      const err: ReadOnlyExternalError = new Error(data.error || 'Failed to update file.');
      if (data.readOnlyExternal) err.readOnlyExternal = true;
      throw err;
    }
    soundFx.taskDone();
    return data.file;
  };

  const handleTrashWorkingFolderFile = async (fileId: string): Promise<void> => {
    const workingFolderId = settingsRef.current.driveWorkingFolder?.id;
    if (!workingFolderId) {
      throw new Error('No Google Drive Working Folder configured yet.');
    }
    const token = await resolveFreshWorkspaceToken();
    const res = await fetch(
      `/api/workspace/drive/working-folder/files/${encodeURIComponent(
        fileId
      )}?workingFolderId=${encodeURIComponent(workingFolderId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }
    );
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Failed to move item to Trash.');
    }
  };

  const handleGoogleSignOut = async () => {
    await logoutGoogle();
    setIsGoogleConnected(false);
    setHasWorkspaceToken(false);
    setUserEmail(null);
    setWorkspaceBriefing((prev) => ({
      ...EMPTY_BRIEFING,
      linkedDocs: prev.linkedDocs,
      pinnedDriveFiles: prev.pinnedDriveFiles,
      pinnedChats: prev.pinnedChats,
    }));
    void fetch('/api/village/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceSnapshot: null }),
    }).catch(() => {});
  };

  const openAgentChat = useCallback(
    (agent: Agent) => {
      soundFx.chatPop();
      setAgentDrawerInitialTab('chat');
      setSelectedAgentId(agent.id);
      setRightDrawerMode('agent');
      if (agent.id === 'daniel' && isGoogleConnected && !getAccessToken()) {
        void ensureWorkspaceToken();
      }
    },
    [isGoogleConnected]
  );

  const handleAskDanielWithPrompt = useCallback(
    (prompt: string) => {
      const daniel = agentsRef.current.find((a) => a.id === 'daniel');
      if (!daniel) return;
      soundFx.chatPop();
      setAgentDrawerInitialTab('chat');
      setSelectedAgentId('daniel');
      setAgentPrefillDraft(prompt);
      setAgentPrefillNonce((n) => n + 1);
      setRightDrawerMode('agent');
      if (isGoogleConnected && !getAccessToken()) {
        void ensureWorkspaceToken();
      }
    },
    [isGoogleConnected]
  );

  const openAgentTraceInDrawer = useCallback(
    (trace: HandoffTrace, preferredAgentId?: string) => {
      soundFx.chatPop();
      const targetId = preferredAgentId || trace.coordinating_director;
      const target =
        agentsRef.current.find((a) => a.id === targetId) ??
        agentsRef.current.find((a) => a.id === trace.coordinating_director) ??
        agentsRef.current.find((a) => a.id === 'matt');
      if (!target) return;
      setAgentDrawerInitialTab('trace');
      setFocusedTraceTaskId(trace.task_id);
      setFocusedTraceNonce((n) => n + 1);
      setSelectedAgentId(target.id);
      setRightDrawerMode('agent');
    },
    []
  );

  const visualizeTraceInTown = useCallback(
    (trace: HandoffTrace, focusMapCamera = true) => {
      if (!trace || trace.packets.length === 0) return;
      setAdhocTownTrace(trace);
      setTownTraceTaskId(trace.task_id);
      setTownTraceHidden(false);
      setHandoffReplayNonce((n) => n + 1);

      const involvedIds = new Set<string>([trace.coordinating_director]);
      if (trace.root_agent && trace.root_agent !== 'cho') {
        involvedIds.add(trace.root_agent);
      }
      for (const pkt of trace.packets) {
        involvedIds.add(pkt.from_agent);
        involvedIds.add(pkt.to_agent);
      }

      let sumX = 0;
      let sumY = 0;
      let countPts = 0;
      const nowMs = Date.now();

      // Step participating villagers out into their House courtyards so town arcs connect live characters
      for (const agId of involvedIds) {
        const ag = agentsRef.current.find((a) => a.id === agId);
        if (!ag || ag.id === 'cho') continue;
        const bld = VILLAGE_BUILDINGS.find((b) => b.id === ag.buildingId);
        if (bld && ag.id !== 'matt') {
          const yardGoal = { x: bld.yardTileX, y: bld.yardTileY };
          const yardWorld = tileToWorldCenter(yardGoal.x, yardGoal.y);
          sumX += yardWorld.x;
          sumY += yardWorld.y;
          countPts += 1;
          if (ag.state === 'working_inside') {
            ag.state = ag.role === 'worker' ? 'walking' : 'idle_yard';
          }
          ag.path = findGridPath(
            worldToTile(ag.x, ag.y),
            yardGoal,
            VILLAGE_MAP.walkable
          );
        } else {
          sumX += ag.x;
          sumY += ag.y;
          countPts += 1;
        }
      }

      // Surface concise hop callouts over participating villagers
      trace.packets.forEach((pkt, idx) => {
        const receiver = agentsRef.current.find((a) => a.id === pkt.to_agent);
        if (receiver) {
          const statusPrefix =
            pkt.status === 'completed'
              ? '✓'
              : pkt.status === 'failed' || pkt.status === 'aborted_cap_reached'
                ? '!'
                : '…';
          receiver.speechBubble = `#${pkt.sequence} ${statusPrefix} ${
            pkt.output_artifact?.summary
              ? pkt.output_artifact.summary.slice(0, 62)
              : pkt.objective.slice(0, 62)
          }`;
          receiver.speechTimer = 190 + idx * 45;
          receiver.busyUntil = nowMs + 4500;
        }
      });

      const coord = agentsRef.current.find((a) => a.id === trace.coordinating_director);
      if (coord && trace.packets.length > 0) {
        coord.speechBubble =
          trace.status === 'completed'
            ? `Synthesized ${trace.packets.length} verified hop${
                trace.packets.length === 1 ? '' : 's'
              } for CHO`
            : `Fail-closed halt on ${trace.task_id}`;
        coord.speechTimer = 240;
      }

      bumpAgents();

      if (focusMapCamera) {
        setActiveBuilding(null);
        setSettings((prev) =>
          prev.workspaceViewMode === 'desk'
            ? { ...prev, workspaceViewMode: 'map' }
            : prev
        );
        if (countPts > 0) {
          setCameraSpotlight({
            x: sumX / countPts,
            y: sumY / countPts,
            nonce: Date.now(),
          });
        }
      }
    },
    [bumpAgents]
  );

  const enterBuilding = useCallback(
    (building: Building) => {
      soundFx.doorEnter();
      if ((building.id === 'inbox' || building.id === 'town_hall') && isGoogleConnected && !getAccessToken()) {
        void ensureWorkspaceToken();
      }
      const cho = agentsRef.current.find((a) => a.id === 'cho');
      if (building.id === 'inbox') {
        if (cho) cho.currentActivity = `Reviewing ${building.name} in Workspace Hub`;
        setActiveBuilding(null);
        setWorkspaceInitialTab('overview');
        setRightDrawerMode('workspace');
        bumpAgents();
        return;
      }
      if (building.id === 'town_hall') {
        soundFx.townHallBell();
        if (cho) cho.currentActivity = 'Hosting Town Hall roundtable';
        for (const a of agentsRef.current) {
          if (a.role === 'director' || a.id === 'matt') {
            a.state = 'town_hall_seated';
            a.currentActivity =
              a.id === 'matt' ? 'Co-hosting Town Hall roundtable' : 'Seated in Town Hall meeting';
          }
        }
      } else if (cho) {
        cho.currentActivity = `Visiting ${building.name}`;
      }
      setActiveBuilding(building);
      bumpAgents();
    },
    [bumpAgents, isGoogleConnected]
  );

  const getBaselineActivity = useCallback(
    (agent: Agent) => deriveAgentGroundedActivity(agent, tasks, approvals),
    [tasks, approvals]
  );

  const exitBuilding = useCallback(() => {
    const cho = agentsRef.current.find((a) => a.id === 'cho');
    if (cho) cho.currentActivity = 'Touring Guildhaven';
    if (activeBuilding?.id === 'town_hall') {
      for (const a of agentsRef.current) {
        if (a.role === 'director') {
          a.state = 'idle_yard';
          if (a.currentActivity === 'Seated in Town Hall meeting') {
            a.currentActivity = deriveAgentGroundedActivity(a, tasks, approvals);
          }
        }
        if (a.id === 'matt') {
          a.state = 'following_cho';
          a.currentActivity = deriveAgentGroundedActivity(a, tasks, approvals);
        }
      }
      bumpAgents();
    }
    setActiveBuilding(null);
  }, [activeBuilding, approvals, bumpAgents, tasks]);

  const openSettingsTab = useCallback(
    (tab: SettingsTab = 'guardrails') => {
      if (activeBuilding) exitBuilding();
      setSettingsInitialTab(tab);
      setRightDrawerMode('settings');
    },
    [activeBuilding, exitBuilding]
  );

  const openWorkspaceTab = useCallback(
    (tab: WorkspaceTab = 'overview') => {
      if (activeBuilding) exitBuilding();
      if (isGoogleConnected && !getAccessToken()) {
        void ensureWorkspaceToken();
      }
      setWorkspaceInitialTab(tab);
      setRightDrawerMode('workspace');
    },
    [activeBuilding, exitBuilding, isGoogleConnected]
  );

  // Keyboard shortcuts: Cmd/Ctrl+K (Quick Jump), T (Talk nearby), MM (Call Matt), E/Enter (Enter door), G (Walkability map), L (Directory Live Feed), K (Knowledge), ? (Help), Escape (Close)
  useEffect(() => {
    if (screen !== 'PLAYING') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((v) => !v);
        return;
      }

      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      const key = e.key.toLowerCase();
      if (key === 'escape') {
        if (isCommandPaletteOpen) setIsCommandPaletteOpen(false);
        else if (isMorningBriefingOpen) setIsMorningBriefingOpen(false);
        else if (showShortcutsPopover) setShowShortcutsPopover(false);
        else if (activeBuilding) exitBuilding();
        else setRightDrawerMode('none');
        return;
      }

      if (activeBuilding || isCommandPaletteOpen || isMorningBriefingOpen) return;

      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutsPopover((v) => !v);
      } else if (key === 't' && nearAgent) {
        e.preventDefault();
        openAgentChat(nearAgent);
      } else if (key === '/') {
        e.preventDefault();
        setCommandBarCollapsed(false);
        requestAnimationFrame(() => {
          taskInputElRef.current?.focus();
        });
      } else if (key === 'l') {
        e.preventDefault();
        setDirectoryInitialTab('feed');
        setRightDrawerMode((m) => (m === 'directory' ? 'none' : 'directory'));
      } else if (key === 'k') {
        e.preventDefault();
        setKbInitialDepartment('all');
        setRightDrawerMode((m) => (m === 'knowledge' ? 'none' : 'knowledge'));
      } else if (key === 'e' || key === 'enter') {
        if (nearDoor) {
          e.preventDefault();
          enterBuilding(nearDoor);
        }
      } else if (key === 'g') {
        setShowWalkability((s) => !s);
      } else if (key === 'm') {
        const now = Date.now();
        if (now - lastMKeyRef.current < 480) {
          const matt = agentsRef.current.find((a) => a.id === 'matt');
          if (matt) {
            soundFx.phoneRing();
            matt.speechBubble = 'Right here—what do you need?';
            matt.speechTimer = 140;
            openAgentChat(matt);
          }
          lastMKeyRef.current = 0;
        } else {
          lastMKeyRef.current = now;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    screen,
    activeBuilding,
    isCommandPaletteOpen,
    isMorningBriefingOpen,
    nearAgent,
    nearDoor,
    showShortcutsPopover,
    enterBuilding,
    exitBuilding,
    openAgentChat,
  ]);

  const handleWalkToAgent = useCallback(
    (targetAgent: Agent) => {
      if (activeBuilding) {
        exitBuilding();
      }
      const cho = agentsRef.current.find((a) => a.id === 'cho');
      if (!cho) return;
      const startTile = worldToTile(cho.x, cho.y);
      const goalTile = worldToTile(targetAgent.x, targetAgent.y);
      const path = findGridPath(startTile, goalTile, VILLAGE_MAP.walkable);
      cho.path = path;
      cho.currentActivity = `Walking over to ${targetAgent.name}`;
      setLiveStatusText(`Walking over to ${targetAgent.name} at ${describeVillageLocation(targetAgent.x, targetAgent.y)}...`);
      bumpAgents();
    },
    [activeBuilding, exitBuilding, bumpAgents]
  );

  const handleWalkToBuilding = useCallback(
    (targetBuilding: Building) => {
      if (activeBuilding) {
        exitBuilding();
      }
      const cho = agentsRef.current.find((a) => a.id === 'cho');
      if (!cho) return;
      const startTile = worldToTile(cho.x, cho.y);
      const goalTile = { x: targetBuilding.doorTileX, y: targetBuilding.doorTileY };
      const path = findGridPath(startTile, goalTile, VILLAGE_MAP.walkable);
      cho.path = path;
      cho.currentActivity = `Walking to ${targetBuilding.name}`;
      setLiveStatusText(`Walking to ${targetBuilding.name}...`);
      bumpAgents();
    },
    [activeBuilding, exitBuilding, bumpAgents]
  );

  const summonDirectorToCho = useCallback(
    (directorId: string) => {
      const matt = agentsRef.current.find((a) => a.id === 'matt');
      const dir = agentsRef.current.find((a) => a.id === directorId);
      if (!dir) return;

      soundFx.phoneRing();
      if (matt) {
        matt.state = 'phone_call';
        matt.busyUntil = Date.now() + 2400;
        matt.currentActivity = `Calling ${dir.name} over to meet you`;
        matt.speechBubble = `Calling ${dir.name} over now!`;
        matt.speechTimer = 150;
      }

      dir.state = 'summoned';
      dir.currentActivity = 'Walking over to meet you';
      dir.speechBubble = 'On my way!';
      dir.speechTimer = 140;
      pushActivityEvent({
        id: `ev_summon_${Date.now()}`,
        kind: 'dispatch_call',
        timestamp: new Date().toISOString(),
        location: matt ? describeVillageLocation(matt.x, matt.y) : 'Town Square Plaza',
        headline: `Matt summoned ${dir.name} (${dir.department})`,
        participants: [
          ...(matt ? [{ id: matt.id, name: matt.name, department: matt.department }] : []),
          { id: dir.id, name: dir.name, department: dir.department },
        ],
        lines: [
          { speakerName: 'Matt', text: `Calling ${dir.name} over to meet the CHO right now.` },
          { speakerName: dir.name, text: 'On my way across the square!' },
        ],
      });
      setLiveStatusText(`${dir.name} is running over to meet you.`);
      bumpAgents();
    },
    [bumpAgents, pushActivityEvent]
  );

  const dispatchTaskPrompt = async (
    rawPrompt: string,
    explicitPriority?: TaskPriority,
    explicitDirectorId?: string | null
  ) => {
    const trimmedRaw = rawPrompt.trim();
    if (!trimmedRaw || isDispatching) return;

    // Parse leading @Director mention if present (e.g. "@Daniel draft a reply...")
    let prompt = trimmedRaw;
    let resolvedTargetDirectorId = explicitDirectorId?.trim().toLowerCase() || null;
    const mentionMatch = /^@([a-zA-Z]+)\s+([\s\S]+)$/.exec(trimmedRaw);
    if (mentionMatch) {
      const candidateName = mentionMatch[1].toLowerCase();
      const matchedDir = agentsRef.current.find(
        (a) =>
          a.role === 'director' &&
          (a.id.toLowerCase() === candidateName || a.name.toLowerCase() === candidateName)
      );
      if (matchedDir) {
        resolvedTargetDirectorId = matchedDir.id;
        prompt = mentionMatch[2].trim();
      }
    }

    if (!prompt) return;

    const directDirector = resolvedTargetDirectorId
      ? agentsRef.current.find((a) => a.id === resolvedTargetDirectorId && a.role === 'director')
      : undefined;

    const priority: TaskPriority = explicitPriority ?? taskPriority;

    setIsDispatching(true);
    soundFx.phoneRing();

    const shortPrompt = prompt.length > 48 ? `${prompt.slice(0, 45)}...` : prompt;
    const dispatchStartedMs = Date.now();
    const taskId = `task_${dispatchStartedMs}`;
    const isComplexHint =
      priority === 'high' ||
      prompt.length > 180 ||
      /\b(strategy|audit|roadmap|architecture|legal|contract|forecast|budget)\b/i.test(prompt);

    const startedIso = new Date(dispatchStartedMs).toISOString();
    const mentionedAgents = agentsRef.current.filter((candidate) => {
      if (
        candidate.id === 'cho' ||
        candidate.id === 'matt' ||
        candidate.id === directDirector?.id
      ) {
        return false;
      }
      const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapedName}\\b`, 'i').test(prompt);
    });

    const coordDirector = directDirector ?? mentionedAgents.find((a) => a.role === 'director');
    const coordId = coordDirector?.id ?? 'matt';
    const coordName = coordDirector?.name ?? 'Matt';
    const coordHouse = coordDirector?.department ?? 'Town Hall Triage';
    const defaultWorker = coordDirector
      ? agentsRef.current.find(
          (a) => a.role === 'worker' && a.buildingId === coordDirector.buildingId
        )
      : undefined;

    const liveCollaborators =
      mentionedAgents.filter((a) => a.id !== coordId).length > 0
        ? mentionedAgents.filter((a) => a.id !== coordId).slice(0, 4)
        : defaultWorker
          ? [defaultWorker]
          : [];

    const stubPackets: HandoffPacket[] = liveCollaborators.map((collab, idx) => ({
      handoff_id: `${taskId}_live_${idx + 1}`,
      task_id: taskId,
      depth: 1,
      sequence: idx + 1,
      from_agent: coordId,
      from_agent_name: coordName,
      from_house: coordHouse,
      to_agent: collab.id,
      to_agent_name: collab.name,
      to_house: collab.department || 'Guild House',
      objective: prompt,
      kb_refs: ['KB-SOP-01', 'KB-SOP-02'],
      verified_facts: [],
      constraints: ['Internal collaboration · CHO-gated external actions (KB-GOV-01)'],
      expected_output_schema: {
        format: 'structured_json',
        required_fields: ['summary', 'verified_claims', 'deliverable_markdown'],
      },
      status: idx === 0 ? 'running' : 'queued',
      started_at: startedIso,
    }));

    const stubHandoffTrace: HandoffTrace = {
      task_id: taskId,
      root_agent: directDirector ? directDirector.id : 'matt',
      coordinating_director: coordId,
      coordinating_director_name: coordName,
      status: 'running',
      total_hops: stubPackets.length,
      max_hops: 6,
      max_depth: 2,
      started_at: startedIso,
      packets: stubPackets,
      staged_kb_proposal_ids: [],
    };

    const activeStubTask: VillageTask = {
      id: taskId,
      prompt,
      createdAt: startedIso,
      taskSource: classifyTaskSource(prompt),
      priority,
      status: directDirector ? 'worker_executing' : 'matt_routing',
      progressPercent: directDirector ? 30 : 14,
      progressLabel: directDirector
        ? `Direct to ${directDirector.name} · Specialist drafting`
        : priority === 'high'
          ? 'Matt routing high-priority assignment'
          : 'Matt routing assignment to department Director',
      assignedDirectorId: coordId,
      assignedDirectorName: coordName,
      assignedWorkerId: defaultWorker?.id ?? null,
      workerModel: 'gemini-3.1-flash-lite',
      directorModel: 'gemini-4-hydrogen',
      escalatedToAdvisor: false,
      routingNote: directDirector
        ? `Assigned directly to ${directDirector.name} (${directDirector.department}).`
        : 'Matt is selecting the best Director and guild worker for this task.',
      summary: directDirector
        ? `${directDirector.name}'s guild specialist is researching and drafting your deliverable...`
        : 'Matt is routing your assignment and briefing the assigned guild team...',
      reportMarkdown: '',
      groundingSources: [],
      approvalId: null,
      handoffTrace: stubHandoffTrace,
      collaboratorIds: liveCollaborators.map((c) => c.id),
    };
    setTasks((prev) => [activeStubTask, ...prev]);

    const matt = agentsRef.current.find((a) => a.id === 'matt');
    if (directDirector) {
      directDirector.state = 'working_inside';
      directDirector.activeTaskId = taskId;
      directDirector.currentActivity = `Direct assignment: "${shortPrompt}"`;
      directDirector.speechBubble = 'On it directly!';
      directDirector.speechTimer = 200;
      bumpAgents();
    } else if (matt) {
      matt.state = 'phone_call';
      matt.activeTaskId = taskId;
      matt.currentActivity = `On phone · Routing "${shortPrompt}"`;
      matt.speechBubble = 'On the phone—routing your task...';
      matt.speechTimer = 240;
      bumpAgents();
    }

    const progressIntervalId = window.setInterval(() => {
      const elapsed = Date.now() - dispatchStartedMs;
      let nextStatus: VillageTask['status'] = directDirector ? 'worker_executing' : 'matt_routing';
      let nextPercent = directDirector ? 30 : 14;
      let nextLabel = directDirector
        ? `Direct to ${directDirector.name} · Specialist drafting`
        : 'Matt routing assignment to department Director';
      let nextSummary = directDirector
        ? `${directDirector.name}'s guild specialist is researching and drafting your deliverable...`
        : 'Matt is routing your assignment and briefing the assigned guild team...';

      if (!directDirector && elapsed < 1100) {
        nextStatus = 'matt_routing';
        nextPercent = Math.min(30, Math.round(14 + (elapsed / 1100) * 16));
        nextLabel = 'Matt routing assignment to department Director';
      } else if (elapsed < 4800) {
        nextStatus = 'worker_executing';
        nextPercent = Math.min(78, Math.round(32 + ((Math.max(0, elapsed - 800)) / 4000) * 46));
        nextLabel = directDirector
          ? `${directDirector.name}'s specialist drafting deliverable`
          : 'Guild worker executing assignment';
        nextSummary = 'Assigned guild specialist is researching and drafting the deliverable...';
      } else {
        nextStatus = isComplexHint ? 'advisor_escalated' : 'director_review';
        nextPercent = Math.min(
          95,
          Math.round(80 + 15 * (1 - Math.exp(-(elapsed - 4800) / 4500)))
        );
        nextLabel = isComplexHint
          ? 'Senior Advisor reviewing complex deliverable'
          : directDirector
            ? `${directDirector.name} reviewing draft & citations`
            : 'Director reviewing worker draft & citations';
        nextSummary = isComplexHint
          ? 'Senior Advisor and Director are validating final recommendations...'
          : 'Department Director is reviewing the draft for quality and citations...';
      }

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId &&
          (t.status === 'queued' ||
            t.status === 'matt_routing' ||
            t.status === 'worker_executing' ||
            t.status === 'director_review' ||
            t.status === 'advisor_escalated')
            ? {
                ...t,
                status: nextStatus,
                progressPercent: Math.max(t.progressPercent ?? 0, nextPercent),
                progressLabel: nextLabel,
                summary: nextSummary,
              }
            : t
        )
      );
    }, 250);

    try {
      const directors = agentsRef.current.filter((a) => a.role === 'director');
      const workers = agentsRef.current.filter((a) => a.role === 'worker');
      let token = getAccessToken();
      if (
        !token &&
        isGoogleConnected &&
        (resolvedTargetDirectorId === 'daniel' ||
          /\b(email|emails|gmail|inbox|unread|calendar|schedule|meeting|meetings|event|events|draft|reply|follow-up|chat|chats|space|spaces|thread|threads|doc|docs|document|documents|drive|folder|folders|file|files)\b|spaces\/|chat\.google\.com/i.test(
            prompt
          ))
      ) {
        token = await ensureWorkspaceToken();
      }

      const res = await fetch('/api/village/task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          prompt,
          priority,
          directors,
          workers,
          allAgents: agentsRef.current.filter((a) => a.role !== 'cho'),
          clientTaskId: taskId,
          clientTime: getClientTimeContext(),
          targetDirectorId: resolvedTargetDirectorId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Task dispatch failed');
      }

      window.clearInterval(progressIntervalId);

      const isFailedClosed = Boolean(data.failedClosed);
      const assignedDirector = agentsRef.current.find((a) => a.id === data.directorId);
      const assignedWorker = agentsRef.current.find((a) => a.id === data.workerId);
      const collaboratorIds: string[] = Array.isArray(data.collaboratorIds)
        ? data.collaboratorIds
        : [];
      const stagedKbProposals: KnowledgeProposal[] = Array.isArray(data.stagedKbProposals)
        ? data.stagedKbProposals
        : [];
      const stagedKbIds = stagedKbProposals.map((p) => p.proposal_id);
      if (Array.isArray(data.kbProposals)) {
        setKbProposals(data.kbProposals);
      }

      const approvalId: string | null =
        !isFailedClosed && (data.approvalId || data.approvalProposal?.needed)
          ? data.approvalId ?? `appr_${Date.now()}`
          : null;
      const finishTime = Date.now() + 4500;

      const resolvedTaskId = data.taskId ?? taskId;
      let autoSavedDriveResult: { url: string; name: string } | null = null;
      const workingFolder = settingsRef.current.driveWorkingFolder;
      const canDirectWriteWorkingFolder =
        !isFailedClosed &&
        Boolean(workingFolder?.id) &&
        settingsRef.current.driveWorkingFolderWriteMode === 'direct_in_folder' &&
        data.approvalProposal?.needed &&
        data.approvalProposal.type === 'drive_file';

      if (canDirectWriteWorkingFolder && (token || getAccessToken())) {
        try {
          const driveFileName =
            data.approvalProposal.driveFileName || data.approvalProposal.title || 'Deliverable.md';
          const driveFileBody =
            data.approvalProposal.body || data.reportMarkdown || data.summary || '';
          autoSavedDriveResult = await handleSaveDriveFile({
            name: driveFileName,
            content: driveFileBody,
            parentFolderId: workingFolder!.id,
            sourceTaskId: resolvedTaskId,
          });
        } catch {
          autoSavedDriveResult = null;
        }
      }

      const finalApprovalId = autoSavedDriveResult ? null : approvalId;

      if (matt) {
        matt.activeTaskId = null;
        matt.busyUntil = Date.now() + 1600;
        matt.currentActivity = isFailedClosed
          ? `Aborted "${shortPrompt}" safely (fail-closed)`
          : `Routed "${shortPrompt}" to ${data.directorName}`;
        matt.speechBubble = isFailedClosed
          ? 'Task halted safely—check the handoff trace.'
          : data.routing?.routingNote || `Handed to ${data.directorName}!`;
        matt.speechTimer = 180;
      }

      if (assignedDirector) {
        assignedDirector.state = 'working_inside';
        assignedDirector.activeTaskId = taskId;
        assignedDirector.busyUntil = finishTime;
        assignedDirector.currentActivity = isFailedClosed
          ? `Aborted safely: ${shortPrompt}`
          : autoSavedDriveResult
            ? `Saved "${autoSavedDriveResult.name}" to ${workingFolder?.name ?? 'Working Folder'}`
            : finalApprovalId
              ? `Awaiting approval: ${data.approvalProposal.title}`
              : stagedKbIds.length > 0
                ? `Staged ${stagedKbIds.length} KB proposal(s) for CHO review`
                : `Delivering: ${shortPrompt}`;
        assignedDirector.speechBubble = isFailedClosed
          ? 'Halted at orchestration guardrail.'
          : stagedKbIds.length > 0
            ? 'Synthesized deliverable & staged KB proposal!'
            : 'Heading inside to review!';
        assignedDirector.speechTimer = 150;
        if (Array.isArray(data.updatedDirectorNotes)) {
          assignedDirector.notes = data.updatedDirectorNotes;
        }
      }

      if (assignedWorker) {
        assignedWorker.state = 'working_inside';
        assignedWorker.activeTaskId = taskId;
        assignedWorker.busyUntil = finishTime;
        assignedWorker.currentActivity = `Completed for ${data.directorName}: ${shortPrompt}`;
      }

      for (const collabId of collaboratorIds) {
        if (collabId === data.directorId || collabId === data.workerId || collabId === 'matt') {
          continue;
        }
        const collabAgent = agentsRef.current.find((a) => a.id === collabId);
        if (collabAgent) {
          collabAgent.state = 'working_inside';
          collabAgent.busyUntil = finishTime;
          collabAgent.currentActivity = `Collaborated with ${data.directorName} on "${shortPrompt}"`;
          collabAgent.speechBubble = `Sent verified handoff packet to ${data.directorName}!`;
          collabAgent.speechTimer = 150;
        }
      }

      if (!isFailedClosed && data.approvalProposal?.needed && finalApprovalId) {
        const newApproval: ApprovalItem = {
          id: finalApprovalId,
          taskId: resolvedTaskId,
          directorId: data.directorId,
          directorName: data.directorName,
          type: data.approvalProposal.type,
          title: data.approvalProposal.title,
          description: data.approvalProposal.description,
          payload: {
            to: data.approvalProposal.to,
            subject: data.approvalProposal.subject,
            body: data.approvalProposal.body,
            chatSpaceName: data.approvalProposal.chatSpaceName,
            chatSpaceDisplayName: data.approvalProposal.chatSpaceDisplayName,
            chatThreadName: data.approvalProposal.chatThreadName,
            docTitle: data.approvalProposal.docTitle,
            driveFileName: data.approvalProposal.driveFileName,
            driveFolderId:
              data.approvalProposal.type === 'drive_file' ? workingFolder?.id : undefined,
            eventSummary: data.approvalProposal.eventSummary,
            eventStart: data.approvalProposal.eventStart,
            eventEnd: data.approvalProposal.eventEnd,
            eventLocation: data.approvalProposal.eventLocation,
            eventDescription: data.approvalProposal.eventDescription,
            amount: data.approvalProposal.amount,
            vendor: data.approvalProposal.vendor,
            postPlatform: data.approvalProposal.postPlatform,
            postContent: data.approvalProposal.postContent,
          },
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        setApprovals((prev) => [newApproval, ...prev]);
      }

      const clientElapsedMs = Math.max(400, Date.now() - dispatchStartedMs);
      const resolvedCompletedIso =
        typeof data.completedAt === 'string' ? data.completedAt : new Date().toISOString();
      const resolvedCreatedIso =
        typeof data.createdAt === 'string'
          ? data.createdAt
          : new Date(dispatchStartedMs).toISOString();
      const resolvedSource =
        data.taskSource === 'gmail' ||
        data.taskSource === 'calendar' ||
        data.taskSource === 'chat' ||
        data.taskSource === 'docs' ||
        data.taskSource === 'drive' ||
        data.taskSource === 'manual'
          ? data.taskSource
          : data.approvalProposal?.needed && data.approvalProposal.type === 'email_draft'
            ? 'gmail'
            : data.approvalProposal?.needed && data.approvalProposal.type === 'chat_message'
              ? 'chat'
              : data.approvalProposal?.needed && data.approvalProposal.type === 'google_doc'
                ? 'docs'
                : data.approvalProposal?.needed && data.approvalProposal.type === 'drive_file'
                  ? 'drive'
                  : data.approvalProposal?.needed && data.approvalProposal.type === 'calendar_event'
                    ? 'calendar'
                    : classifyTaskSource(prompt);

      const newTask: VillageTask = {
        id: resolvedTaskId,
        prompt,
        createdAt: resolvedCreatedIso,
        completedAt: resolvedCompletedIso,
        fulfillmentMs:
          typeof data.fulfillmentMs === 'number' && data.fulfillmentMs > 0
            ? data.fulfillmentMs
            : clientElapsedMs,
        taskSource: resolvedSource,
        priority: data.priority ?? priority,
        status: isFailedClosed
          ? 'failed'
          : finalApprovalId
            ? 'needs_approval'
            : 'completed',
        progressPercent: isFailedClosed ? 100 : finalApprovalId ? 92 : 100,
        progressLabel: isFailedClosed
          ? 'Aborted safely (fail-closed)'
          : finalApprovalId
            ? 'Deliverable ready · Awaiting CHO approval'
            : undefined,
        assignedDirectorId: data.directorId,
        assignedDirectorName: data.directorName,
        assignedWorkerId: data.workerId,
        workerModel: data.workerModel,
        directorModel: data.directorModel,
        escalatedToAdvisor: Boolean(data.escalatedToAdvisor),
        routingNote: data.routing?.routingNote ?? '',
        summary: data.summary,
        reportMarkdown: data.reportMarkdown,
        groundingSources: data.groundingSources ?? [],
        approvalId: finalApprovalId,
        handoffTrace: data.handoffTrace ?? undefined,
        kbProposalIds: stagedKbIds.length > 0 ? stagedKbIds : undefined,
        collaboratorIds: collaboratorIds.length > 0 ? collaboratorIds : undefined,
        orchestrationError:
          typeof data.orchestrationError === 'string' ? data.orchestrationError : undefined,
        ...(autoSavedDriveResult
          ? {
              exportedDriveUrl: autoSavedDriveResult.url,
              exportedDriveName: autoSavedDriveResult.name,
            }
          : {}),
      };

      setTasks((prev) => [
        newTask,
        ...prev.filter((t) => t.id !== taskId && t.id !== newTask.id),
      ]);
      if (newTask.handoffTrace && newTask.handoffTrace.packets.length > 0) {
        visualizeTraceInTown(newTask.handoffTrace, false);
      }
      const collabNames = collaboratorIds
        .filter((id) => id !== data.directorId && id !== 'matt')
        .map((id) => agentsRef.current.find((a) => a.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      pushActivityEvent({
        id: `ev_task_${Date.now()}`,
        kind: 'task_complete',
        timestamp: new Date().toISOString(),
        location: assignedDirector
          ? describeVillageLocation(assignedDirector.x, assignedDirector.y)
          : 'Town Square Plaza',
        headline: isFailedClosed
          ? `Fail-Closed Abort · ${data.directorName}`
          : `Matt → ${data.directorName}${
              collabNames.length > 0 ? ` (+ ${collabNames.join(', ')})` : ''
            } · Unified Deliverable`,
        participants: [
          ...(matt ? [{ id: matt.id, name: matt.name, department: matt.department }] : []),
          ...(assignedDirector
            ? [
                {
                  id: assignedDirector.id,
                  name: assignedDirector.name,
                  department: assignedDirector.department,
                },
              ]
            : []),
          ...collaboratorIds
            .filter((id) => id !== data.directorId && id !== 'matt')
            .map((id) => agentsRef.current.find((a) => a.id === id))
            .filter((a): a is Agent => Boolean(a))
            .map((a) => ({ id: a.id, name: a.name, department: a.department })),
        ],
        lines: [
          {
            speakerName: 'Matt',
            text: data.routing?.routingNote || `Routing "${shortPrompt}" to ${data.directorName}.`,
          },
          {
            speakerName: data.directorName,
            text: data.summary || `Completed report for "${shortPrompt}".`,
          },
        ],
      });
      if (!isFailedClosed) {
        soundFx.taskDone();
      }
      if (!isFailedClosed && voicePlayer.getSnapshot().autoSpeakReplies && newTask.summary) {
        void voicePlayer.playSingle({
          itemId: `report_summary_${newTask.id}`,
          agentId: assignedDirector?.id ?? data.directorId,
          speakerName: data.directorName,
          title: assignedDirector?.title,
          department: assignedDirector?.department,
          voiceName: assignedDirector?.voiceName,
          text: `${data.directorName} here. ${newTask.summary}`,
          maxChars: 900,
        });
      }
      if (isFailedClosed) {
        setLiveStatusText(
          data.orchestrationError || 'Task halted safely at orchestration guardrail.'
        );
      } else if (stagedKbIds.length > 0) {
        setLiveStatusText(
          `${data.directorName} delivered unified report & staged ${stagedKbIds.length} KB proposal(s) in Approvals.`
        );
      } else if (autoSavedDriveResult) {
        setLiveStatusText(
          `${data.directorName} saved "${autoSavedDriveResult.name}" to ${workingFolder?.name ?? 'Working Folder'}`
        );
      }
      setFocusedReportTaskId(newTask.id);
      setRightDrawerMode(
        !isFailedClosed && (finalApprovalId || stagedKbIds.length > 0) ? 'approvals' : 'reports'
      );
      bumpAgents();
    } catch (err) {
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (matt) {
        matt.state = 'following_cho';
        matt.activeTaskId = null;
        matt.currentActivity = 'Following you · Ready to dispatch';
      }
      setLiveStatusText(err instanceof Error ? err.message : 'Error running task.');
      bumpAgents();
    } finally {
      window.clearInterval(progressIntervalId);
      setIsDispatching(false);
    }
  };

  const handleDispatchTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = taskInput.trim();
    if (!prompt || isDispatching) return;
    setTaskInput('');
    await dispatchTaskPrompt(prompt, taskPriority);
  };

  const handlePrefillTaskPrompt = useCallback((prompt: string, priority?: TaskPriority) => {
    setCommandBarCollapsed(false);
    setTaskInput(prompt);
    if (priority === 'low' || priority === 'medium' || priority === 'high') {
      setTaskPriority(priority);
    }
    requestAnimationFrame(() => {
      taskInputElRef.current?.focus();
    });
  }, []);

  const handleAssignToDirectorShortcut = useCallback((director: Agent) => {
    setCommandBarCollapsed(false);
    setTaskInput((prev) => {
      const stripped = prev.replace(/^@[a-zA-Z]+\s*/, '').trimStart();
      return `@${director.name} ${stripped}`;
    });
    requestAnimationFrame(() => {
      taskInputElRef.current?.focus();
    });
  }, []);

  const handleOpenMorningBriefing = useCallback(
    async (forceRefresh = false) => {
      setIsMorningBriefingOpen(true);
      if (
        !forceRefresh &&
        morningBriefing &&
        Date.now() - (Date.parse(morningBriefing.generatedAt) || 0) < 2 * 60 * 1000
      ) {
        return;
      }
      setIsLoadingMorningBriefing(true);
      setMorningBriefingError(null);
      try {
        let token = getAccessToken();
        if (!token && isGoogleConnected) {
          token = await ensureWorkspaceToken();
        }
        const recentTasksPayload = tasks
          .filter((t) => !t.archived)
          .slice(0, 8)
          .map((t) => ({
            prompt: t.prompt,
            status: t.status,
            assignedDirectorName: t.assignedDirectorName,
            summary: t.summary,
          }));
        const pendingApprovalsPayload = approvals
          .filter((a) => a.status === 'pending')
          .map((a) => ({
            title: a.title,
            type: a.type,
            directorName: a.directorName,
            description: a.description,
          }));

        const res = await fetch('/api/village/morning-briefing', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            clientTime: getClientTimeContext(),
            recentTasks: recentTasksPayload,
            pendingApprovals: pendingApprovalsPayload,
          }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          briefing?: ExecutiveMorningBriefing;
          error?: string;
        };
        if (!res.ok || !data.briefing) {
          throw new Error(data.error || 'Failed to generate Morning Briefing.');
        }
        setMorningBriefing(data.briefing);
      } catch (err) {
        setMorningBriefingError(
          err instanceof Error ? err.message : 'Unable to generate Morning Briefing right now.'
        );
      } finally {
        setIsLoadingMorningBriefing(false);
      }
    },
    [approvals, isGoogleConnected, morningBriefing, tasks]
  );

  const handleSendAgentMessage = async (agentId: string, text: string) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) return;

    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      sender: 'cho',
      text,
      timestamp: new Date().toISOString(),
    };
    const prevMsgs = chatHistory[agentId] ?? [];
    setChatHistory((prev) => ({ ...prev, [agentId]: [...prevMsgs, userMsg] }));
    setIsChatSending(true);

    try {
      let token = getAccessToken();
      if (
        !token &&
        isGoogleConnected &&
        (agentId === 'daniel' ||
          /\b(email|emails|gmail|inbox|unread|calendar|schedule|meeting|meetings|event|events|draft|reply|chat|chats|space|spaces|thread|threads|doc|docs|document|documents|drive|folder|folders|file|files)\b|spaces\/|chat\.google\.com/i.test(
            text
          ))
      ) {
        token = await ensureWorkspaceToken();
      }
      const directors = agentsRef.current.filter((a) => a.role === 'director');
      const res = await fetch('/api/village/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          agent,
          allDirectors: directors,
          allAgents: agentsRef.current.filter((a) => a.role !== 'cho'),
          message: text,
          history: prevMsgs,
          clientTime: getClientTimeContext(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Chat failed');

      if (data.summonDirectorId) {
        summonDirectorToCho(data.summonDirectorId);
      }
      if (data.newNote) {
        agent.notes = [...agent.notes, data.newNote].slice(-20);
        bumpAgents();
      }

      if (Array.isArray(data.kbProposals)) {
        setKbProposals(data.kbProposals);
      }
      const stagedChatKbIds: string[] = Array.isArray(data.stagedKbProposals)
        ? data.stagedKbProposals.map((p: KnowledgeProposal) => p.proposal_id)
        : [];

      let stagedChatApprovalId: string | null = null;
      if (!data.failedClosed && data.approvalProposal?.needed) {
        const canStageCalendar =
          data.approvalProposal.type !== 'calendar_event' ||
          (Boolean(data.approvalProposal.eventStart?.trim()) &&
            Boolean(data.approvalProposal.eventEnd?.trim()));
        if (canStageCalendar) {
          const chatApproval: ApprovalItem = {
            id: `appr_chat_${Date.now()}`,
            taskId: data.taskId ?? `chat_${Date.now()}`,
            directorId: agent.id,
            directorName: agent.name,
            type: data.approvalProposal.type,
            title:
              data.approvalProposal.title ||
              data.approvalProposal.eventSummary ||
              data.approvalProposal.subject ||
              'Decision Packet',
            description: data.approvalProposal.description || 'Staged from Direct Chat.',
            payload: {
              to: data.approvalProposal.to,
              subject: data.approvalProposal.subject,
              body: data.approvalProposal.body,
              chatSpaceName: data.approvalProposal.chatSpaceName,
              chatSpaceDisplayName: data.approvalProposal.chatSpaceDisplayName,
              chatThreadName: data.approvalProposal.chatThreadName,
              docTitle: data.approvalProposal.docTitle,
              driveFileName: data.approvalProposal.driveFileName,
              driveFolderId:
                data.approvalProposal.type === 'drive_file'
                  ? settingsRef.current.driveWorkingFolder?.id
                  : undefined,
              eventSummary: data.approvalProposal.eventSummary,
              eventStart: data.approvalProposal.eventStart,
              eventEnd: data.approvalProposal.eventEnd,
              eventLocation: data.approvalProposal.eventLocation,
              eventDescription: data.approvalProposal.eventDescription,
              amount: data.approvalProposal.amount,
              vendor: data.approvalProposal.vendor,
              postPlatform: data.approvalProposal.postPlatform,
              postContent: data.approvalProposal.postContent,
            },
            status: 'pending',
            createdAt: new Date().toISOString(),
          };
          stagedChatApprovalId = chatApproval.id;
          setApprovals((prev) => [chatApproval, ...prev]);
          setLiveStatusText(
            `${agent.name} staged "${chatApproval.title}" in Approvals for your confirmation.`
          );
        }
      } else if (stagedChatKbIds.length > 0) {
        setLiveStatusText(
          `${agent.name} staged ${stagedChatKbIds.length} KB proposal(s) in Approvals for CHO sign-off.`
        );
      }

      if (data.handoffTrace?.packets?.length) {
        const finishTime = Date.now() + 4500;
        for (const pkt of data.handoffTrace.packets) {
          const collab = agentsRef.current.find((a) => a.id === pkt.to_agent);
          if (collab && collab.id !== agent.id) {
            collab.busyUntil = finishTime;
            collab.currentActivity = `Collaborated with ${agent.name} on "${text.slice(0, 36)}${
              text.length > 36 ? '...' : ''
            }"`;
          }
        }
        visualizeTraceInTown(data.handoffTrace, false);
      }

      agent.currentActivity = `Discussed: "${text.slice(0, 42)}${text.length > 42 ? '...' : ''}"`;
      agent.speechBubble = data.reply;
      agent.speechTimer = 180;
      bumpAgents();

      const replyMsg: ChatMessage = {
        id: `r_${Date.now()}`,
        sender: 'agent',
        agentId: agent.id,
        agentName: agent.name,
        agentTitle: agent.title,
        text: data.reply,
        timestamp: new Date().toISOString(),
        sources: data.sources ?? [],
        taskId: typeof data.taskId === 'string' ? data.taskId : undefined,
        handoffTrace: data.handoffTrace ?? undefined,
        kbProposalIds: stagedChatKbIds.length > 0 ? stagedChatKbIds : undefined,
        approvalId: stagedChatApprovalId ?? undefined,
        orchestrationError:
          typeof data.orchestrationError === 'string' ? data.orchestrationError : undefined,
      };
      setChatHistory((prev) => ({ ...prev, [agentId]: [...(prev[agentId] ?? []), replyMsg] }));
      pushActivityEvent({
        id: `ev_chat_${Date.now()}`,
        kind: 'cho_chat',
        timestamp: new Date().toISOString(),
        location: describeVillageLocation(agent.x, agent.y),
        headline: `You (CHO) & ${agent.name} · ${agent.department}`,
        participants: [{ id: agent.id, name: agent.name, department: agent.department }],
        lines: [
          { speakerName: 'You (CHO)', text },
          {
            speakerName: agent.name,
            text: data.reply.length > 160 ? `${data.reply.slice(0, 157)}...` : data.reply,
          },
        ],
      });
      soundFx.chatPop();
      if (voicePlayer.getSnapshot().autoSpeakReplies && data.reply) {
        void voicePlayer.playSingle({
          itemId: `chat_msg_${replyMsg.id}`,
          agentId: agent.id,
          speakerName: agent.name,
          title: agent.title,
          department: agent.department,
          voiceName: agent.voiceName,
          text: data.reply,
          maxChars: 1800,
        });
      }
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `e_${Date.now()}`,
        sender: 'agent',
        text: err instanceof Error ? err.message : 'Unable to reply right now.',
        timestamp: new Date().toISOString(),
      };
      setChatHistory((prev) => ({ ...prev, [agentId]: [...(prev[agentId] ?? []), errMsg] }));
    } finally {
      setIsChatSending(false);
    }
  };

  const handleSaveInstructions = async (agentId: string, instructions: string) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) return;
    agent.instructions = instructions;
    bumpAgents();
    await fetch(`/api/village/agents/${agentId}/instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructions }),
    });
  };

  const handleSaveAgentVoice = async (agentId: string, voiceName: AgentVoiceName) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) return;
    agent.voiceName = voiceName;
    bumpAgents();
    await fetch(`/api/village/agents/${agentId}/voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceName }),
    });
  };

  const handleAgentSpeechBubble = useCallback(
    (agentId: string, text: string) => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (!agent || !text.trim()) return;
      agent.speechBubble = text.trim();
      agent.speechTimer = 200;
      bumpAgents();
    },
    [bumpAgents]
  );

  const handleCommitLiveVoiceTurn = useCallback(
    (agentId: string, userTranscript: string, agentTranscript: string) => {
      const agent = agentsRef.current.find((a) => a.id === agentId);
      if (!agent) return;
      const now = Date.now();
      const additions: ChatMessage[] = [];
      if (userTranscript.trim()) {
        additions.push({
          id: `lv_u_${now}`,
          sender: 'cho',
          text: userTranscript.trim(),
          timestamp: new Date(now).toISOString(),
        });
      }
      if (agentTranscript.trim()) {
        additions.push({
          id: `lv_a_${now + 1}`,
          sender: 'agent',
          agentId: agent.id,
          agentName: agent.name,
          agentTitle: agent.title,
          text: agentTranscript.trim(),
          timestamp: new Date(now + 1).toISOString(),
        });
      }
      if (additions.length === 0) return;

      setChatHistory((prev) => ({
        ...prev,
        [agentId]: [...(prev[agentId] ?? []), ...additions],
      }));

      if (userTranscript.trim()) {
        agent.currentActivity = `Voice call: "${userTranscript.trim().slice(0, 40)}${
          userTranscript.trim().length > 40 ? '...' : ''
        }"`;
      }
      if (agentTranscript.trim()) {
        agent.speechBubble = agentTranscript.trim();
        agent.speechTimer = 200;
      }
      bumpAgents();

      pushActivityEvent({
        id: `ev_voice_${now}`,
        kind: 'cho_chat',
        timestamp: new Date(now).toISOString(),
        location: describeVillageLocation(agent.x, agent.y),
        headline: `Live Voice Call · You (CHO) & ${agent.name}`,
        participants: [{ id: agent.id, name: agent.name, department: agent.department }],
        lines: [
          ...(userTranscript.trim()
            ? [{ speakerName: 'You (CHO)', text: userTranscript.trim() }]
            : []),
          ...(agentTranscript.trim()
            ? [
                {
                  speakerName: agent.name,
                  text:
                    agentTranscript.trim().length > 160
                      ? `${agentTranscript.trim().slice(0, 157)}...`
                      : agentTranscript.trim(),
                },
              ]
            : []),
        ],
      });
    },
    [bumpAgents, pushActivityEvent]
  );

  const handleCanAgentsCrossTalk = useCallback(
    (agentA: Agent, agentB: Agent) => {
      const allAnchors = collectGroundedWorkAnchors({
        tasks,
        approvals,
        kbProposals,
        chatHistory,
        workspaceBriefing,
        knowledgeBase,
        agents: agentsRef.current,
      });
      return selectAnchorsForPair(agentA, agentB, allAnchors).length > 0;
    },
    [approvals, chatHistory, kbProposals, knowledgeBase, tasks, workspaceBriefing]
  );

  const handleRequestGroundedCrossTalk = useCallback(
    async (agentA: Agent, agentB: Agent, location: string) => {
      const allAnchors = collectGroundedWorkAnchors({
        tasks,
        approvals,
        kbProposals,
        chatHistory,
        workspaceBriefing,
        knowledgeBase,
        agents: agentsRef.current,
      });
      const pairAnchors = selectAnchorsForPair(agentA, agentB, allAnchors);
      if (pairAnchors.length === 0) {
        return null;
      }

      const res = await fetch('/api/village/crosstalk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentA: {
            id: agentA.id,
            name: agentA.name.replace(' (Worker)', ''),
            role: agentA.role,
            title: agentA.title,
            department: agentA.department,
          },
          agentB: {
            id: agentB.id,
            name: agentB.name.replace(' (Worker)', ''),
            role: agentB.role,
            title: agentB.title,
            department: agentB.department,
          },
          location,
          anchors: pairAnchors,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        shouldSpeak: boolean;
        contextRef: string;
        headline: string;
        lineA: string;
        lineB: string;
        noteA: string;
        noteB: string;
      };
    },
    [approvals, chatHistory, kbProposals, knowledgeBase, tasks, workspaceBriefing]
  );

  const handleClearSyncFeed = useCallback(() => {
    setActivityFeed((prev) => prev.filter((ev) => ev.kind !== 'cross_talk'));
  }, []);

  const handleAgentsCrossTalk = useCallback(
    (
      aId: string,
      bId: string,
      noteA: string,
      noteB: string,
      event: VillageActivityEvent
    ) => {
      const a = agentsRef.current.find((x) => x.id === aId);
      const b = agentsRef.current.find((x) => x.id === bId);
      if (a) {
        a.notes = sanitizeAgentNotes([...a.notes, noteA]);
        void fetch(`/api/village/agents/${a.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: noteA, existingNotes: a.notes }),
        });
      }
      if (b) {
        b.notes = sanitizeAgentNotes([...b.notes, noteB]);
        void fetch(`/api/village/agents/${b.id}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note: noteB, existingNotes: b.notes }),
        });
      }
      pushActivityEvent(event);
      bumpAgents();
    },
    [bumpAgents, pushActivityEvent]
  );

  const handleRunTownHall = async (
    mode: TownHallMode,
    prompt: string,
    targetDirectorId?: string | null
  ) => {
    const directors = agentsRef.current.filter((a) => a.role === 'director');
    let token = getAccessToken();
    if (
      !token &&
      isGoogleConnected &&
      (mode === 'morning_briefing' ||
        /\b(email|emails|gmail|inbox|unread|calendar|schedule|meeting|meetings|chat|space|spaces|doc|docs|document|documents|drive|folder|folders|file|files)\b/i.test(
          prompt
        ))
    ) {
      token = await ensureWorkspaceToken();
    }
    const recentTasksSummary = tasks
      .slice(0, 5)
      .map((t) => `- ${t.assignedDirectorName}: ${t.prompt} (${t.summary})`)
      .join('\n');
    const pendingApprovalsCount = approvals.filter((a) => a.status === 'pending').length;

    const res = await fetch('/api/village/town-hall', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        mode,
        prompt,
        targetDirectorId,
        directors,
        recentTasksSummary,
        pendingApprovalsCount,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Town Hall error');
    const entries: Array<{
      speakerId: string;
      speakerName: string;
      speakerTitle: string;
      message: string;
    }> = data.entries ?? [];
    if (entries.length > 0) {
      pushActivityEvent({
        id: `ev_th_${Date.now()}`,
        kind: 'town_hall',
        timestamp: new Date().toISOString(),
        location: 'Town Hall Council Chambers',
        headline: `Town Hall · ${mode.replace('_', ' ')}`,
        participants: entries
          .map((en) => agentsRef.current.find((a) => a.id === en.speakerId || a.name === en.speakerName))
          .filter((a): a is Agent => Boolean(a))
          .map((a) => ({ id: a.id, name: a.name, department: a.department })),
        lines: entries.slice(0, 4).map((en) => ({
          speakerName: en.speakerName,
          text: en.message.length > 140 ? `${en.message.slice(0, 137)}...` : en.message,
        })),
      });
    }
    return entries;
  };

  const handleProposeHire = async (directorId: string): Promise<HiringCandidate> => {
    const director = agentsRef.current.find((a) => a.id === directorId);
    if (!director) throw new Error('Director not found');
    const res = await fetch('/api/village/hiring/propose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ director }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Proposal failed');

    const guildShirtByBuilding: Record<string, string> = {
      inbox: '#235B78',
      youtube: '#B43434',
      finance: '#FAF4E8',
      research: '#56755D',
      operations: '#CA7D3B',
      creative: '#7A438D',
      health: '#4B721A',
      engineering: '#186B84',
    };
    const hairPalette = ['#3E2723', '#5C3A21', '#7C2D12', '#1C1917', '#713F12', '#44403C'];
    const seed = (data.name as string).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    return {
      id: `cand_${Date.now()}`,
      directorId: director.id,
      directorName: director.name,
      buildingId: director.buildingId,
      name: data.name,
      specialty: data.specialty,
      bio: data.bio,
      rationale: data.rationale,
      hairColor: hairPalette[seed % hairPalette.length],
      shirtColor: guildShirtByBuilding[director.buildingId] ?? '#8B5E3C',
    };
  };

  const handleInterviewCandidate = async (candidate: HiringCandidate, question: string) => {
    const res = await fetch('/api/village/hiring/interview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateName: candidate.name,
        specialty: candidate.specialty,
        bio: candidate.bio,
        directorName: candidate.directorName,
        question,
      }),
    });
    const data = await res.json();
    return data.answer as string;
  };

  const handleApproveHire = (candidate: HiringCandidate) => {
    const building = VILLAGE_BUILDINGS.find((b) => b.id === candidate.buildingId);
    const spawn = building
      ? tileToWorldCenter(building.doorTileX, building.doorTileY)
      : tileToWorldCenter(21, 13);
    const skinPalette = ['#FED7AA', '#FDBA74', '#FFEDD5', '#E6A87C'];
    const pantsPalette = ['#292524', '#3B2F28', '#27201C', '#1E293B'];
    const seed = candidate.name.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

    const directorAgent = agentsRef.current.find((a) => a.id === candidate.directorId);

    const newWorker: Agent = {
      id: `worker_${Date.now()}`,
      name: candidate.name,
      role: 'worker',
      title: candidate.specialty,
      department: building?.name ?? 'Village',
      buildingId: candidate.buildingId,
      modelName: 'gemini-3.1-flash-lite',
      advisorEnabled: false,
      voiceName: pickVoiceForCustomAgent(candidate.name, directorAgent?.voiceName),
      instructions: `You are ${candidate.name}, a Guild Specialist in ${building?.name ?? 'the village'} hired by the CHO to assist ${candidate.directorName}. ${candidate.bio}`,
      notes: [`Welcomed into Town Hall by the CHO under ${candidate.directorName}.`],
      shirtColor: candidate.shirtColor,
      pantsColor: pantsPalette[seed % pantsPalette.length],
      hairColor: candidate.hairColor,
      skinColor: skinPalette[seed % skinPalette.length],
      hasYellowVest: false,
      ...spawn,
      direction: 'down',
      walkFrame: 0,
      isMoving: false,
      state: 'walking',
      speechBubble: `Excited to join ${candidate.directorName}'s guild!`,
      speechTimer: 180,
      path: [],
      talkedTodayWith: [],
      activeTaskId: null,
      patrolTimer: 30,
      currentActivity: `Onboarding at ${building?.name ?? candidate.directorName}`,
    };

    agentsRef.current = [...agentsRef.current, newWorker];
    soundFx.taskDone();
    setLiveStatusText(`${candidate.name} joined ${candidate.directorName}'s guild house!`);
    bumpAgents();
  };

  const handleApproveItem = async (item: ApprovalItem) => {
    let createdDocUrl: string | undefined;
    let savedDriveFile: { url: string; name: string } | undefined;
    let createdCalendarEvent: CalendarEventSummary | undefined;

    if (item.type === 'email_draft') {
      const token = getAccessToken() ?? (isGoogleConnected ? await ensureWorkspaceToken() : null);
      if (token) {
        const res = await fetch('/api/workspace/create-draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            to: item.payload.to ?? '',
            subject: item.payload.subject ?? item.title,
            body: item.payload.body ?? item.description,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save Gmail draft.');
        item.payload.gmailDraftId = data.draftId;
      }
    } else if (item.type === 'chat_message') {
      const targetSpace =
        item.payload.chatSpaceName || workspaceBriefing.chatSpaces?.[0]?.name;
      if (!targetSpace) {
        throw new Error(
          'No Google Chat space available yet. Open Inbox & Calendar to configure Google Chat or select a space.'
        );
      }
      const messageBody =
        item.payload.body || item.payload.postContent || item.description;
      await handleSendGoogleChatMessage(
        targetSpace,
        messageBody,
        item.payload.chatThreadName
      );
    } else if (item.type === 'google_doc') {
      const docTitle = item.payload.docTitle || item.title;
      const docContent = item.payload.body || item.description;
      const created = await handleCreateGoogleDoc(docTitle, docContent, item.taskId);
      createdDocUrl = created.url;
      item.payload.documentUrl = created.url;
    } else if (item.type === 'drive_file') {
      const fileName = item.payload.driveFileName || item.title;
      const fileContent = item.payload.body || item.description;
      savedDriveFile = await handleSaveDriveFile({
        name: fileName,
        content: fileContent,
        parentFolderId:
          item.payload.driveFolderId || settingsRef.current.driveWorkingFolder?.id,
        sourceTaskId: item.taskId,
      });
      item.payload.driveFileUrl = savedDriveFile.url;
      item.payload.driveFileName = savedDriveFile.name;
    } else if (item.type === 'calendar_event') {
      const summary = item.payload.eventSummary || item.title;
      const start = item.payload.eventStart?.trim();
      const end = item.payload.eventEnd?.trim();
      if (!start || !end) {
        throw new Error(
          'This calendar approval is missing a valid start or end timestamp.'
        );
      }
      createdCalendarEvent = await handleCreateCalendarEvent({
        summary,
        start,
        end,
        location: item.payload.eventLocation,
        description: item.payload.eventDescription || item.payload.body || item.description,
      });
      item.payload.eventId = createdCalendarEvent.id;
      item.payload.eventHtmlLink = createdCalendarEvent.htmlLink;
    }

    const dir = agentsRef.current.find((a) => a.id === item.directorId);
    if (dir) {
      dir.currentActivity =
        item.type === 'email_draft'
          ? `Saved Gmail draft: ${item.payload.subject ?? item.title}`
          : item.type === 'chat_message'
            ? `Sent Google Chat message: ${item.title}`
            : item.type === 'google_doc'
              ? `Created Google Doc: ${item.payload.docTitle ?? item.title}`
              : item.type === 'drive_file'
                ? `Saved to Google Drive: ${savedDriveFile?.name ?? item.title}`
                : item.type === 'calendar_event'
                  ? `Scheduled Calendar event: ${createdCalendarEvent?.summary ?? item.title}`
                  : `Approved & finalized: ${item.title}`;
      bumpAgents();
    }

    setApprovals((prev) =>
      prev.map((a) =>
        a.id === item.id
          ? {
              ...a,
              ...item,
              status: 'approved',
              payload: {
                ...a.payload,
                ...item.payload,
                ...(createdDocUrl ? { documentUrl: createdDocUrl } : {}),
                ...(savedDriveFile
                  ? { driveFileUrl: savedDriveFile.url, driveFileName: savedDriveFile.name }
                  : {}),
                ...(createdCalendarEvent
                  ? {
                      eventId: createdCalendarEvent.id,
                      eventHtmlLink: createdCalendarEvent.htmlLink,
                    }
                  : {}),
              },
            }
          : a
      )
    );
    setTasks((prev) =>
      prev.map((t) =>
        t.id === item.taskId || (item.id && t.approvalId === item.id)
          ? {
              ...t,
              status: 'completed',
              progressPercent: 100,
              progressLabel: undefined,
              completedAt: t.completedAt ?? new Date().toISOString(),
              ...(createdDocUrl
                ? {
                    exportedDocUrl: createdDocUrl,
                    exportedDocTitle: item.payload.docTitle || item.title,
                  }
                : {}),
              ...(savedDriveFile
                ? {
                    exportedDriveUrl: savedDriveFile.url,
                    exportedDriveName: savedDriveFile.name,
                  }
                : {}),
            }
          : t
      )
    );
    soundFx.taskDone();
  };

  const handleUpdateApprovalItem = useCallback((updated: ApprovalItem) => {
    setApprovals((prev) =>
      prev.map((a) =>
        a.id === updated.id
          ? {
              ...a,
              ...updated,
              payload: {
                ...a.payload,
                ...updated.payload,
              },
            }
          : a
      )
    );
  }, []);

  const handleRejectItem = (item: ApprovalItem) => {
    const dir = agentsRef.current.find((a) => a.id === item.directorId);
    if (dir) {
      dir.currentActivity = `Approval declined: ${item.title}`;
      bumpAgents();
    }
    setApprovals((prev) =>
      prev.map((a) => (a.id === item.id ? { ...a, status: 'rejected' } : a))
    );
  };

  const handleArchiveTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? { ...t, archived: true, archivedAt: new Date().toISOString() }
          : t
      )
    );
  }, []);

  const handleRestoreTask = useCallback((taskId: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, archived: false, archivedAt: undefined } : t
      )
    );
  }, []);

  const ensureChoSessionToken = useCallback(async (): Promise<string> => {
    if (choSessionTokenRef.current) return choSessionTokenRef.current;
    try {
      const res = await fetch('/api/village/state');
      if (res.ok) {
        const st = (await res.json()) as PersistedVillageState;
        if (st.choSessionToken) {
          choSessionTokenRef.current = st.choSessionToken;
          return st.choSessionToken;
        }
      }
    } catch {
      // Ignore transient error
    }
    return choSessionTokenRef.current;
  }, []);

  const buildChoAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const sessionTok = await ensureChoSessionToken();
    const wsToken = getAccessToken();
    return {
      'Content-Type': 'application/json',
      ...(sessionTok ? { 'X-CHO-Approval-Token': sessionTok } : {}),
      ...(userEmail ? { 'X-CHO-Email': userEmail } : {}),
      ...(wsToken ? { Authorization: `Bearer ${wsToken}` } : {}),
    };
  }, [ensureChoSessionToken, userEmail]);

  const handleSaveKnowledgeEntry = async (entry: Partial<KnowledgeEntry>) => {
    const headers = await buildChoAuthHeaders();
    const res = await fetch('/api/village/knowledge', {
      method: 'POST',
      headers,
      body: JSON.stringify(entry),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      entry?: KnowledgeEntry;
      entries?: KnowledgeEntry[];
      error?: string;
    };
    if (!res.ok || !data.entries) {
      throw new Error(data.error || 'Failed to save Knowledge Base entry.');
    }
    setKnowledgeBase(mergeKnowledgeBase(data.entries));
    if (data.entry) {
      pushActivityEvent({
        id: `ev_kb_${Date.now()}`,
        kind: 'knowledge_sync',
        timestamp: new Date().toISOString(),
        location: 'Research & Intel · Operations House',
        headline: `Indexed [${data.entry.code}] ${data.entry.title}`,
        participants: [
          { id: 'aria', name: 'Aria', department: 'Research & Intel' },
          { id: 'worker_aria', name: 'Zoe', department: 'Research & Intel' },
          { id: 'worker_devon', name: 'Eli', department: 'Operations House' },
        ],
        lines: [
          {
            speakerName: 'Eli',
            text: `Updated [${data.entry.code}] (v${data.entry.version ?? 1}) in the Single Source of Truth for ${data.entry.department}.`,
          },
        ],
      });
    }
    soundFx.taskDone();
  };

  const handleDeleteKnowledgeEntry = async (id: string) => {
    const headers = await buildChoAuthHeaders();
    const res = await fetch(`/api/village/knowledge/${id}`, {
      method: 'DELETE',
      headers,
    });
    const data = (await res.json()) as { ok?: boolean; entries?: KnowledgeEntry[]; error?: string };
    if (!res.ok || !data.entries) {
      setLiveStatusText(data.error || 'Unable to delete entry.');
      return;
    }
    setKnowledgeBase(mergeKnowledgeBase(data.entries));
  };

  const handleConsolidateKnowledge = async (focusTopic?: string): Promise<string> => {
    setIsConsolidatingKb(true);
    try {
      const res = await fetch('/api/village/knowledge/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focusTopic }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        auditSummary?: string;
        stagedProposals?: KnowledgeProposal[];
        kbProposals?: KnowledgeProposal[];
        entries?: KnowledgeEntry[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Consolidation failed.');
      }

      if (Array.isArray(data.entries)) {
        setKnowledgeBase(mergeKnowledgeBase(data.entries));
      }
      if (Array.isArray(data.kbProposals)) {
        setKbProposals(data.kbProposals);
      }

      // Deduplicate in-memory agent notes and trigger live speech bubbles on Co-Leads Aria, Zoe & Eli
      for (const a of agentsRef.current) {
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const n of a.notes) {
          const k = n.trim().toLowerCase();
          if (k && !seen.has(k)) {
            seen.add(k);
            deduped.push(n.trim());
          }
        }
        a.notes = deduped.slice(-15);
      }

      const stagedCount = data.stagedProposals?.length ?? 0;
      const aria = agentsRef.current.find((a) => a.id === 'aria');
      const zoe = agentsRef.current.find((a) => a.id === 'worker_aria');
      const eli = agentsRef.current.find((a) => a.id === 'worker_devon');
      if (aria) {
        aria.speechBubble =
          stagedCount > 0
            ? `Staged ${stagedCount} KB proposal(s) for CHO approval!`
            : 'Knowledge Base audited—zero contradictions!';
        aria.speechTimer = 180;
        aria.currentActivity = 'Audited Village Knowledge Base with Zoe & Eli';
      }
      if (zoe) {
        zoe.speechBubble = 'Verified briefs checked—no split wikis!';
        zoe.speechTimer = 180;
        zoe.currentActivity = 'Staged verified citations for CHO review';
      }
      if (eli) {
        eli.speechBubble = 'Cross-house SOP proposals staged!';
        eli.speechTimer = 180;
        eli.currentActivity = 'Prepared KB-SOP-* Decision Packets';
      }
      bumpAgents();

      const summary =
        data.auditSummary ||
        (stagedCount > 0
          ? `Aria, Zoe & Eli staged ${stagedCount} KB proposal(s) in Approvals for CHO commit.`
          : 'Aria, Zoe & Eli audited all house notes—zero new KB proposals needed.');

      pushActivityEvent({
        id: `ev_kb_sync_${Date.now()}`,
        kind: 'knowledge_sync',
        timestamp: new Date().toISOString(),
        location: 'Research & Intel · Operations House',
        headline: 'Aria, Zoe & Eli audited the Village Knowledge Base',
        participants: [
          { id: 'aria', name: 'Aria', department: 'Research & Intel' },
          { id: 'worker_aria', name: 'Zoe', department: 'Research & Intel' },
          { id: 'worker_devon', name: 'Eli', department: 'Operations House' },
        ],
        lines: [
          { speakerName: 'Aria & Zoe', text: summary },
          {
            speakerName: 'Eli',
            text:
              stagedCount > 0
                ? `Staged ${(data.stagedProposals ?? []).map((p) => p.id).join(', ')} in CHO Decision Packets.`
                : 'Verified all house notes and handoff templates—zero contradictions.',
          },
        ],
      });
      soundFx.taskDone();
      return summary;
    } finally {
      setIsConsolidatingKb(false);
    }
  };

  const handleApproveKbProposal = async (
    proposal: KnowledgeProposal,
    edits?: KbProposalEdits
  ): Promise<void> => {
    setKbBusyMap((prev) => ({ ...prev, [proposal.proposal_id]: 'approving' }));
    try {
      const authHeaders = await buildChoAuthHeaders();
      const idempKey = await computeDeterministicIdempotencyKey(
        proposal.proposal_id,
        proposal.base_version ?? null,
        edits
      );
      const res = await fetch(
        `/api/kb/proposals/${encodeURIComponent(proposal.proposal_id)}/approve`,
        {
          method: 'POST',
          headers: {
            ...authHeaders,
            'Idempotency-Key': idempKey,
          },
          body: JSON.stringify({ edits }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        entry?: KnowledgeEntry;
        entries?: KnowledgeEntry[];
        proposals?: KnowledgeProposal[];
        error?: string;
      };
      if (!res.ok || !data.entries) {
        throw new Error(data.error || 'Failed to approve & commit KB proposal.');
      }

      setKnowledgeBase(mergeKnowledgeBase(data.entries));
      if (Array.isArray(data.proposals)) {
        setKbProposals(data.proposals);
      }

      const proposer = agentsRef.current.find((a) => a.id === proposal.proposed_by);
      if (proposer) {
        proposer.currentActivity = `KB [${proposal.id}] approved & committed by CHO`;
        proposer.speechBubble = `[${proposal.id}] is now live across all Houses!`;
        proposer.speechTimer = 160;
        bumpAgents();
      }

      if (data.entry) {
        pushActivityEvent({
          id: `ev_kb_commit_${Date.now()}`,
          kind: 'knowledge_sync',
          timestamp: new Date().toISOString(),
          location: 'Town Hall · Single Source of Truth',
          headline: `CHO Committed [${data.entry.code}] v${data.entry.version ?? 1} · ${data.entry.title}`,
          participants: [
            ...(proposer
              ? [{ id: proposer.id, name: proposer.name, department: proposer.department }]
              : []),
          ],
          lines: [
            {
              speakerName: 'You (CHO)',
              text: `Approved & committed [${data.entry.code}] (${proposal.action_type}) to the live Knowledge Base.`,
            },
          ],
        });
      }
      setLiveStatusText(
        `Committed [${proposal.id}] (v${data.entry?.version ?? 1}) to the live Knowledge Base.`
      );
      soundFx.taskDone();
    } finally {
      setKbBusyMap((prev) => {
        const next = { ...prev };
        delete next[proposal.proposal_id];
        return next;
      });
    }
  };

  const handleRequestKbRevision = async (
    proposal: KnowledgeProposal,
    feedback: string
  ): Promise<void> => {
    setKbBusyMap((prev) => ({ ...prev, [proposal.proposal_id]: 'revising' }));
    try {
      const authHeaders = await buildChoAuthHeaders();
      const res = await fetch(
        `/api/kb/proposals/${encodeURIComponent(proposal.proposal_id)}/request-revision`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            feedback,
            allAgents: agentsRef.current.filter((a) => a.role !== 'cho'),
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        revisedProposal?: KnowledgeProposal | null;
        proposals?: KnowledgeProposal[];
        revisionError?: string | null;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to route revision request.');
      }
      if (Array.isArray(data.proposals)) {
        setKbProposals(data.proposals);
      }
      const proposer = agentsRef.current.find((a) => a.id === proposal.proposed_by);
      if (proposer) {
        proposer.currentActivity = data.revisedProposal
          ? `Restaged revised [${data.revisedProposal.id}] per CHO feedback`
          : `Reviewing CHO revision notes for [${proposal.id}]`;
        proposer.speechBubble = data.revisedProposal
          ? `Restaged revised [${data.revisedProposal.id}] with your feedback!`
          : 'Reviewing your feedback now.';
        proposer.speechTimer = 170;
        bumpAgents();
      }
      setLiveStatusText(
        data.revisedProposal
          ? `${proposal.proposed_by_name} restaged revised [${data.revisedProposal.id}] for your review.`
          : `Revision requested on [${proposal.id}].`
      );
      soundFx.chatPop();
    } finally {
      setKbBusyMap((prev) => {
        const next = { ...prev };
        delete next[proposal.proposal_id];
        return next;
      });
    }
  };

  const handleRejectKbProposal = async (
    proposal: KnowledgeProposal,
    reason?: string
  ): Promise<void> => {
    setKbBusyMap((prev) => ({ ...prev, [proposal.proposal_id]: 'rejecting' }));
    try {
      const authHeaders = await buildChoAuthHeaders();
      const res = await fetch(
        `/api/kb/proposals/${encodeURIComponent(proposal.proposal_id)}/reject`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ reason }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        proposals?: KnowledgeProposal[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to reject KB proposal.');
      }
      if (Array.isArray(data.proposals)) {
        setKbProposals(data.proposals);
      }
      const proposer = agentsRef.current.find((a) => a.id === proposal.proposed_by);
      if (proposer) {
        proposer.currentActivity = `KB proposal [${proposal.id}] declined by CHO`;
        bumpAgents();
      }
      setLiveStatusText(`Rejected KB proposal [${proposal.id}].`);
    } finally {
      setKbBusyMap((prev) => {
        const next = { ...prev };
        delete next[proposal.proposal_id];
        return next;
      });
    }
  };

  const handleIndexTaskToKnowledge = async (task: VillageTask) => {
    const dir = agentsRef.current.find((a) => a.id === task.assignedDirectorId);
    const isSop =
      task.assignedDirectorId === 'devon' ||
      task.assignedDirectorId === 'kieran' ||
      /\b(sop|checklist|handoff|pipeline|runbook|spec)\b/i.test(task.prompt);
    await handleSaveKnowledgeEntry({
      category: isSop ? 'handoff_template' : 'research_brief',
      department: dir?.department ?? 'All Houses',
      maintainedBy: `${task.assignedDirectorName} · Indexed by Aria, Zoe & Eli`,
      title: task.prompt.length > 72 ? `${task.prompt.slice(0, 69)}...` : task.prompt,
      summary: task.summary,
      contentMarkdown: task.reportMarkdown,
      sources: task.groundingSources,
      sourceTaskId: task.id,
    });
  };

  const handleRefreshAutomationRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/automation/runs');
      if (!res.ok) return;
      const data = (await res.json()) as {
        runs?: AutomationRun[];
        autopilot_settings?: TownAutopilotSettings;
        rules?: TownAutomationRule[];
        approvals?: ApprovalItem[];
        kbProposals?: KnowledgeProposal[];
      };
      if (Array.isArray(data.runs)) {
        setAutomationRuns(data.runs);
      }
      if (data.autopilot_settings) {
        setTownAutopilotSettings(normalizeTownAutopilotSettings(data.autopilot_settings));
      }
      if (Array.isArray(data.rules)) {
        setTownAutomationRules(mergeTownAutomationRules(data.rules));
      }
      if (Array.isArray(data.approvals)) {
        setApprovals(data.approvals);
      }
      if (Array.isArray(data.kbProposals)) {
        setKbProposals(data.kbProposals);
      }
    } catch {
      // Ignore transient background refresh errors
    }
  }, []);

  useEffect(() => {
    if (screen !== 'PLAYING') return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void handleRefreshAutomationRuns();
      }
    }, 25_000);
    return () => window.clearInterval(interval);
  }, [screen, handleRefreshAutomationRuns]);

  const handleUpdateAutopilot = useCallback(
    async (patch: {
      autopilot_settings?: Partial<TownAutopilotSettings>;
      rule_update?: Partial<TownAutomationRule> & { id: string };
    }) => {
      const headers = await buildChoAuthHeaders();
      const res = await fetch('/api/automation/rules', {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        autopilot_settings?: TownAutopilotSettings;
        rules?: TownAutomationRule[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update Autopilot settings.');
      }
      if (data.autopilot_settings) {
        setTownAutopilotSettings(normalizeTownAutopilotSettings(data.autopilot_settings));
      }
      if (Array.isArray(data.rules)) {
        setTownAutomationRules(mergeTownAutomationRules(data.rules));
      }
    },
    [buildChoAuthHeaders]
  );

  const handleToggleAutopilot = useCallback(async () => {
    const nextEnabled = !townAutopilotSettings.autopilot_enabled;
    try {
      await handleUpdateAutopilot({
        autopilot_settings: { autopilot_enabled: nextEnabled },
      });
      setLiveStatusText(
        nextEnabled
          ? 'Town Autopilot resumed — background schedules and monitored webhooks active.'
          : 'Town Autopilot paused — background cron and webhook runs halted.'
      );
    } catch (err) {
      setLiveStatusText(
        err instanceof Error ? err.message : 'Unable to toggle Town Autopilot.'
      );
    }
  }, [handleUpdateAutopilot, townAutopilotSettings.autopilot_enabled]);

  const handleRunAutomationRuleNow = useCallback(
    async (ruleId: string) => {
      setRunningAutomationRuleId(ruleId);
      try {
        const headers = await buildChoAuthHeaders();
        const res = await fetch(
          `/api/automation/rules/${encodeURIComponent(ruleId)}/run`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({}),
          }
        );
        const data = (await res.json()) as {
          ok?: boolean;
          status?: string;
          run?: AutomationRun;
          runs?: AutomationRun[];
          rules?: TownAutomationRule[];
          approvals?: ApprovalItem[];
          kbProposals?: KnowledgeProposal[];
          tasks?: VillageTask[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || 'Failed to run automation rule.');
        }
        if (Array.isArray(data.runs)) {
          setAutomationRuns(data.runs);
        }
        if (Array.isArray(data.rules)) {
          setTownAutomationRules(mergeTownAutomationRules(data.rules));
        }
        if (Array.isArray(data.approvals)) {
          setApprovals(data.approvals);
        }
        if (Array.isArray(data.kbProposals)) {
          setKbProposals(data.kbProposals);
        }
        if (Array.isArray(data.tasks)) {
          setTasks(data.tasks);
        }
        if (data.run) {
          const targetAgent = agentsRef.current.find(
            (a) => a.id === data.run?.agent_trace[data.run.agent_trace.length - 1]
          );
          if (targetAgent) {
            targetAgent.speechBubble =
              data.run.status === 'staged_packet'
                ? 'Staged an autonomous Decision Packet for CHO review!'
                : 'Background check complete — logged to Town Digest.';
            targetAgent.speechTimer = 180;
            bumpAgents();
          }
          setLiveStatusText(data.run.summary);
        }
      } finally {
        setRunningAutomationRuleId(null);
      }
    },
    [buildChoAuthHeaders, bumpAgents]
  );

  const handleDismissExpiredPackets = useCallback(
    async (mode: 'expired_only' | 'clear_all_resolved') => {
      const headers = await buildChoAuthHeaders();
      const res = await fetch('/api/automation/packets/dismiss-expired', {
        method: 'POST',
        headers,
        body: JSON.stringify({ mode }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        dismissed_count?: number;
        approvals?: ApprovalItem[];
        kbProposals?: KnowledgeProposal[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to dismiss expired packets.');
      }
      if (Array.isArray(data.approvals)) {
        setApprovals(data.approvals);
      }
      if (Array.isArray(data.kbProposals)) {
        setKbProposals(data.kbProposals);
      }
      return data.dismissed_count ?? 0;
    },
    [buildChoAuthHeaders]
  );

  if (screen === 'TITLE_MENU') {
    return (
      <TitleMenuOverlay
        onEnterVillage={() => {
          setScreen('PLAYING');
          if (isGoogleConnected && !getAccessToken()) {
            void ensureWorkspaceToken();
          }
        }}
        onOpenSettings={() => {
          setScreen('PLAYING');
          setSettingsInitialTab('guardrails');
          setRightDrawerMode('settings');
          if (isGoogleConnected && !getAccessToken()) {
            void ensureWorkspaceToken();
          }
        }}
        onGoogleSignIn={handleGoogleSignIn}
        isGoogleConnected={isGoogleConnected}
        userEmail={userEmail}
      />
    );
  }

  // Ensure agentsVersion is referenced cleanly so React re-renders updated agent dossiers/counts
  void agentsVersion;
  const currentAgents = agentsRef.current;
  const directors = currentAgents.filter((a) => a.role === 'director');
  const selectedAgent = currentAgents.find((a) => a.id === selectedAgentId) ?? null;
  const busyChatId = isChatSending && selectedAgent ? selectedAgent.id : null;
  const pendingKbCount = kbProposals.filter(
    (p) => p.status === 'pending' && !isDecisionPacketExpired(p)
  ).length;
  const pendingCount =
    approvals.filter((a) => a.status === 'pending' && !isDecisionPacketExpired(a)).length +
    pendingKbCount;
  const activeWorkingCount = currentAgents.filter(
    (a) =>
      a.id !== 'cho' &&
      resolveAgentAvailability(a, {
        tasks,
        approvals,
        busyChatAgentId: busyChatId,
      }).level !== 'available'
  ).length;
  const workspaceViewMode = settings.workspaceViewMode === 'desk' ? 'desk' : 'map';

  // @Director autocomplete state derived from taskInput
  const mentionPrefixMatch = /^@([a-zA-Z]*)$/.exec(taskInput);
  const mentionCandidates = mentionPrefixMatch
    ? directors.filter(
        (d) =>
          d.name.toLowerCase().startsWith(mentionPrefixMatch[1].toLowerCase()) ||
          d.department.toLowerCase().includes(mentionPrefixMatch[1].toLowerCase())
      )
    : [];
  const activeDirectMentionMatch = /^@([a-zA-Z]+)\s+/.exec(taskInput);
  const activeDirectDirector = activeDirectMentionMatch
    ? directors.find(
        (d) =>
          d.name.toLowerCase() === activeDirectMentionMatch[1].toLowerCase() ||
          d.id.toLowerCase() === activeDirectMentionMatch[1].toLowerCase()
      )
    : undefined;

  const predictedRoute = (() => {
    const trimmed = taskInput.trim().toLowerCase();
    if (trimmed.length < 6 || activeDirectDirector || mentionPrefixMatch) return null;
    const rules: Array<{ id: string; terms: string[] }> = [
      {
        id: 'daniel',
        terms: [
          'email',
          'gmail',
          'inbox',
          'calendar',
          'schedule',
          'meeting',
          'chat',
          'space',
          'thread',
          'doc',
          'drive',
          'daniel',
          'sam',
        ],
      },
      {
        id: 'kieran',
        terms: [
          'api',
          'webhook',
          'code',
          'typescript',
          'python',
          'sql',
          'schema',
          'oauth',
          'integration',
          'endpoint',
          'pipeline',
          'postgres',
          'stripe',
          'kieran',
          'toby',
        ],
      },
      {
        id: 'aria',
        terms: [
          'research',
          'compare',
          'market',
          'competitor',
          'benchmark',
          'study',
          'citation',
          'intel',
          'vacation',
          'itinerary',
          'aria',
          'zoe',
        ],
      },
      {
        id: 'marcus',
        terms: [
          'budget',
          'cost',
          'price',
          'pricing',
          'expense',
          'vendor',
          'invoice',
          'roi',
          'finance',
          'treasury',
          'spend',
          'marcus',
          'leo',
        ],
      },
      {
        id: 'elena',
        terms: [
          'youtube',
          'video',
          'thumbnail',
          'script',
          'episode',
          'b-roll',
          'hook',
          'creator',
          'elena',
          'maya',
        ],
      },
      {
        id: 'devon',
        terms: [
          'sop',
          'checklist',
          'workflow',
          'process',
          'operations',
          'handoff',
          'audit',
          'kb-sop',
          'devon',
          'eli',
        ],
      },
      {
        id: 'layla',
        terms: [
          'copy',
          'newsletter',
          'announcement',
          'social',
          'post',
          'brand',
          'campaign',
          'briefing',
          'layla',
          'nora',
        ],
      },
      {
        id: 'noah',
        terms: [
          'meal',
          'workout',
          'fitness',
          'grocery',
          'health',
          'errand',
          'wellness',
          'home',
          'noah',
          'owen',
        ],
      },
    ];

    const scored = rules
      .map((rule) => {
        const hits = rule.terms.reduce(
          (acc, term) => (trimmed.includes(term) ? acc + 1 : acc),
          0
        );
        const dir = directors.find((d) => d.id === rule.id);
        return { dir, hits };
      })
      .filter((x): x is { dir: Agent; hits: number } => Boolean(x.dir) && x.hits > 0)
      .sort((a, b) => b.hits - a.hits);

    if (scored.length === 0) return null;
    return {
      primary: scored[0].dir,
      secondary: scored.length > 1 ? scored[1].dir : null,
    };
  })();

  const contextualStarters = (() => {
    const items: Array<{ label: string; prompt: string }> = [];
    const activeGmailDesc = (() => {
      const parts: string[] = [];
      if (settings.gmailIncludeInbox) parts.push('Inbox');
      for (const lbl of settings.gmailSelectedLabels) {
        parts.push(lbl.name);
      }
      if (parts.length === 0) return 'Gmail';
      if (parts.length === 1 && parts[0] === 'Inbox') return 'Inbox';
      if (parts.length <= 2) return parts.join(' & ');
      return `${parts.slice(0, 2).join(', ')} +${parts.length - 2} labels`;
    })();
    const hasCustomGmailSources =
      settings.gmailSelectedLabels.length > 0 || !settings.gmailIncludeInbox;

    if (isGoogleConnected && workspaceBriefing.unreadCount > 0) {
      items.push({
        label: hasCustomGmailSources
          ? `@Daniel Triage ${workspaceBriefing.unreadCount} unread (${activeGmailDesc})`
          : `@Daniel Triage ${workspaceBriefing.unreadCount} unread email${
              workspaceBriefing.unreadCount === 1 ? '' : 's'
            }`,
        prompt: hasCustomGmailSources
          ? `@Daniel Triage my ${workspaceBriefing.unreadCount} unread Gmail messages across ${activeGmailDesc}, flag urgent threads, and prepare safe reply drafts.`
          : `@Daniel Triage my ${workspaceBriefing.unreadCount} unread Gmail messages, flag urgent threads, and prepare safe reply drafts.`,
      });
    } else {
      items.push({
        label: hasCustomGmailSources
          ? `@Daniel Triage ${activeGmailDesc} & Calendar`
          : '@Daniel Triage Inbox & Calendar',
        prompt: hasCustomGmailSources
          ? `@Daniel Check my Gmail messages in ${activeGmailDesc}, Google Chat spaces, and today’s Calendar, then draft any needed follow-up`
          : '@Daniel Check my unread Gmail, Google Chat spaces, and today’s Calendar, then draft any needed follow-up',
      });
    }

    const topPinnedChat = workspaceBriefing.pinnedChats?.[0];
    if (topPinnedChat) {
      const shortChatName =
        (topPinnedChat.label || topPinnedChat.spaceDisplayName).slice(0, 22);
      items.push({
        label: `@Daniel Follow up on "${shortChatName}"`,
        prompt: `@Daniel Review my pinned Google Chat context (${
          topPinnedChat.label || topPinnedChat.spaceDisplayName
        }) and extract action items and owners.`,
      });
    } else if ((workspaceBriefing.upcomingEvents?.length ?? 0) > 0) {
      const nextEv = workspaceBriefing.upcomingEvents[0];
      const shortEv = (nextEv.summary || 'Next Meeting').slice(0, 22);
      items.push({
        label: `@Daniel Prep "${shortEv}"`,
        prompt: `@Daniel Prepare a concise pre-meeting brief and talking points for "${nextEv.summary}" using my Gmail, Docs, and Knowledge Base.`,
      });
    } else {
      items.push({
        label: 'Aria + Marcus Research & Budget',
        prompt:
          'Have Aria benchmark top options with citations and coordinate with Marcus on a cost and ROI breakdown.',
      });
    }

    items.push({
      label: '@Layla Executive Google Doc Brief',
      prompt:
        '@Layla Draft an executive weekly briefing Google Doc from my linked Google Docs, Calendar, and Knowledge Base',
    });

    items.push({
      label: 'Kieran + Eli Cross-House Spec',
      prompt:
        'Have Kieran and Eli spec an idempotent Stripe-to-Postgres webhook retry SOP and propose a KB-SOP entry',
    });

    return items;
  })();

  const handleLocateTaskOnMap = (task: VillageTask) => {
    if (activeBuilding) {
      exitBuilding();
    }
    setRightDrawerMode('none');
    if (workspaceViewMode === 'desk') {
      updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'map' }));
    }
    if (task.handoffTrace && task.handoffTrace.packets.length > 0) {
      visualizeTraceInTown(task.handoffTrace, true);
      setLiveStatusText(
        `Showing live handoff arcs for ${task.assignedDirectorName || 'Matt'} on the town map.`
      );
      return;
    }

    const targetAgent =
      (task.assignedWorkerId
        ? agentsRef.current.find((a) => a.id === task.assignedWorkerId)
        : undefined) ??
      agentsRef.current.find((a) => a.id === task.assignedDirectorId) ??
      agentsRef.current.find((a) => a.id === 'matt');

    const bld = targetAgent
      ? VILLAGE_BUILDINGS.find((b) => b.id === targetAgent.buildingId)
      : undefined;

    if (targetAgent) {
      const pt =
        targetAgent.state === 'working_inside' && bld
          ? tileToWorldCenter(bld.doorTileX, bld.doorTileY)
          : { x: targetAgent.x, y: targetAgent.y };
      setCameraSpotlight({
        x: pt.x,
        y: pt.y,
        nonce: Date.now(),
      });
      setLiveStatusText(
        `Centered map on ${targetAgent.name}${bld ? ` at ${bld.name}` : ''}.`
      );
    }
  };

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* 3-Zone Top Bar Contract */}
      <header className="z-20 flex items-center justify-between gap-8 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        {/* Zone 1: Single-line Brand Title */}
        <button
          onClick={() => setScreen('TITLE_MENU')}
          className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          <img
            src={guildhavenAvatarImg}
            alt="Guildhaven"
            referrerPolicy="no-referrer"
            className="h-7 w-7 rounded-lg border border-amber-500/40 object-cover shrink-0"
          />
          <span>Guildhaven</span>
        </button>

        {/* Zone 2: Clean Text Navigation Links (5 single-line links) */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-300">
          <button
            onClick={() => {
              if (activeBuilding) exitBuilding();
              if (rightDrawerMode === 'directory') {
                setRightDrawerMode('none');
              } else {
                setDirectoryInitialTab('team');
                setRightDrawerMode('directory');
              }
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              rightDrawerMode === 'directory' || activeBuilding?.id === 'town_hall'
                ? 'text-amber-400'
                : 'hover:text-white'
            }`}
          >
            Directory{activeWorkingCount > 0 ? ` · ${activeWorkingCount}` : ''}
          </button>
          <button
            onClick={() => {
              if (activeBuilding) exitBuilding();
              if (rightDrawerMode === 'workspace') {
                setRightDrawerMode('none');
              } else {
                openWorkspaceTab('overview');
              }
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              rightDrawerMode === 'workspace' ? 'text-amber-400' : 'hover:text-white'
            }`}
          >
            Workspace
            {isGoogleConnected && workspaceBriefing.unreadCount > 0
              ? ` · ${workspaceBriefing.unreadCount}`
              : ''}
          </button>
          <button
            onClick={() => {
              if (activeBuilding) exitBuilding();
              setKbInitialDepartment('all');
              setRightDrawerMode(rightDrawerMode === 'knowledge' ? 'none' : 'knowledge');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              rightDrawerMode === 'knowledge' || pendingKbCount > 0
                ? 'text-amber-400 hover:text-amber-300'
                : 'hover:text-white'
            }`}
          >
            Knowledge{pendingKbCount > 0 ? ` · ${pendingKbCount}` : ''}
          </button>
          <button
            onClick={() => {
              if (activeBuilding) exitBuilding();
              setRightDrawerMode(
                rightDrawerMode === 'reports' ||
                  rightDrawerMode === 'history' ||
                  rightDrawerMode === 'analytics'
                  ? 'none'
                  : 'reports'
              );
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              rightDrawerMode === 'reports' ||
              rightDrawerMode === 'history' ||
              rightDrawerMode === 'analytics'
                ? 'text-amber-400'
                : 'hover:text-white'
            }`}
          >
            Reports{tasks.filter((t) => !t.archived).length > 0 ? ` · ${tasks.filter((t) => !t.archived).length}` : ''}
          </button>
          <button
            onClick={() => {
              if (activeBuilding) exitBuilding();
              setRightDrawerMode(rightDrawerMode === 'approvals' ? 'none' : 'approvals');
            }}
            className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
              rightDrawerMode === 'approvals' || pendingCount > 0
                ? 'text-amber-400 hover:text-amber-300'
                : 'hover:text-white'
            }`}
          >
            Approvals{pendingCount > 0 ? ` · ${pendingCount}` : ''}
          </button>
        </nav>

        {/* Zone 3: Settings & Primary Google Workspace Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              if (activeBuilding) exitBuilding();
              setSettingsInitialTab('guardrails');
              setRightDrawerMode(rightDrawerMode === 'settings' ? 'none' : 'settings');
            }}
            aria-label="Settings"
            title="Settings & Workspace Guardrails"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              rightDrawerMode === 'settings'
                ? 'border-amber-500/60 bg-amber-950/60 text-amber-300'
                : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600 hover:text-white'
            }`}
          >
            <Settings className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          {!isGoogleConnected ? (
            <button onClick={handleGoogleSignIn} className="gsi-material-button">
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" style={{ display: 'block' }}>
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">Sign in with Google</span>
              </div>
            </button>
          ) : (
            <button
              onClick={handleGoogleSignOut}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer whitespace-nowrap shrink-0"
            >
              <span className="max-w-[180px] truncate">{userEmail || 'Google Connected'}</span>
              <LogOut className="h-3.5 w-3.5 text-slate-400" />
            </button>
          )}
        </div>
      </header>

      {/* Main Playable 2.5D Village Viewport or Executive Desk Board */}
      <main className="relative flex-1 overflow-hidden">
        {workspaceViewMode === 'desk' ? (
          <DeskDashboardView
            agents={currentAgents}
            tasks={tasks}
            approvals={approvals}
            kbProposals={kbProposals}
            automationRuns={automationRuns}
            autopilotSettings={townAutopilotSettings}
            workspaceBriefing={workspaceBriefing}
            workingFolder={settings.driveWorkingFolder}
            isGoogleConnected={isGoogleConnected}
            onSwitchToMap={() =>
              updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'map' }))
            }
            onOpenMorningBriefing={() => void handleOpenMorningBriefing(false)}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenTownHall={() => {
              const th = VILLAGE_BUILDINGS.find((b) => b.id === 'town_hall');
              if (th) enterBuilding(th);
            }}
            onOpenAgentChat={openAgentChat}
            onAssignToDirector={handleAssignToDirectorShortcut}
            onEnterBuilding={enterBuilding}
            onOpenReport={(task) => {
              setFocusedReportTaskId(task.id);
              setRightDrawerMode('reports');
            }}
            onOpenApprovals={() => setRightDrawerMode('approvals')}
            onRejectApproval={handleRejectItem}
            onOpenWorkspaceTab={(tab) => openWorkspaceTab(tab)}
            onSyncWorkspace={handleSyncWorkspace}
            onGoogleSignIn={handleGoogleSignIn}
            onToggleAutopilot={handleToggleAutopilot}
            onOpenAutopilotSettings={() => openSettingsTab('autopilot')}
            onOpenDigest={() => {
              setDirectoryInitialTab('digest');
              setRightDrawerMode('directory');
            }}
          />
        ) : (
          <>
            <VillageCanvas
              agentsRef={agentsRef}
              tasks={tasks}
              approvals={approvals}
              busyChatAgentId={busyChatId}
              isRightDrawerOpen={rightDrawerMode !== 'none'}
              isCommandBarCollapsed={commandBarCollapsed}
              selectedAgentId={selectedAgentId}
              showWalkability={showWalkability}
              isModalOpen={Boolean(activeBuilding)}
              mapImageUrl={map4kUrl}
              activeHandoffTrace={activeTownTraceEntry?.trace ?? null}
              handoffReplayNonce={handoffReplayNonce}
              cameraSpotlight={cameraSpotlight}
              onClickHandoffHop={(trace, agId) => openAgentTraceInDrawer(trace, agId)}
              onInspectBuildingTask={(task) => {
                setFocusedReportTaskId(task.id);
                setRightDrawerMode('reports');
              }}
              onOpenApprovals={() => setRightDrawerMode('approvals')}
              onSelectAgent={openAgentChat}
              onEnterBuilding={enterBuilding}
              onNearDoorChange={setNearDoor}
              onNearAgentChange={setNearAgent}
              getBaselineActivity={getBaselineActivity}
              canAgentsCrossTalk={handleCanAgentsCrossTalk}
              onRequestGroundedCrossTalk={handleRequestGroundedCrossTalk}
              onAgentsCrossTalk={handleAgentsCrossTalk}
            />

            {/* Compact Map / Desk Switcher + Morning Briefing + Town Handoff Trace Overlay (top-left of canvas) */}
            {!activeBuilding && (
              <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5 max-w-[calc(100vw-1.5rem)]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div
                    role="group"
                    aria-label="Workspace view mode"
                    className="pointer-events-auto inline-flex items-center rounded-lg border border-slate-700/80 bg-slate-950/90 p-0.5 shadow-lg backdrop-blur-md"
                  >
                    <button
                      type="button"
                      aria-current="page"
                      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white cursor-default whitespace-nowrap shrink-0"
                    >
                      <MapIcon className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Map</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'desk' }))
                      }
                      className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <LayoutGrid className="h-3.5 w-3.5 text-slate-400" />
                      <span>Desk</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleOpenMorningBriefing(false)}
                    className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-xs font-semibold text-amber-300 shadow-lg backdrop-blur-md hover:border-amber-500/60 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Sun className="h-3.5 w-3.5" />
                    <span>Briefing</span>
                  </button>

                  <div className="pointer-events-auto inline-flex items-center rounded-lg border border-slate-700/80 bg-slate-950/90 p-0.5 shadow-lg backdrop-blur-md">
                    <button
                      type="button"
                      onClick={() => void handleToggleAutopilot()}
                      title={
                        townAutopilotSettings.autopilot_enabled
                          ? 'Click to pause Supervised Town Autopilot'
                          : 'Click to resume Supervised Town Autopilot'
                      }
                      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        townAutopilotSettings.autopilot_enabled
                          ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
                          : 'bg-slate-800 text-slate-300 hover:text-white'
                      }`}
                    >
                      {townAutopilotSettings.autopilot_enabled ? (
                        <Pause className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Play className="h-3 w-3 text-amber-400" />
                      )}
                      <span>
                        Autopilot: {townAutopilotSettings.autopilot_enabled ? 'Active' : 'Paused'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openSettingsTab('autopilot')}
                      aria-label="Open Autopilot Rules & Schedules"
                      title="Configure Autopilot rules, cron schedules & Test Run Now"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Settings className="h-3.5 w-3.5 text-amber-400" />
                      <span>Rules</span>
                    </button>
                  </div>

                  {automationRuns.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setDirectoryInitialTab('digest');
                        setRightDrawerMode('directory');
                      }}
                      className="pointer-events-auto inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md hover:border-amber-500/50 hover:text-white cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                    >
                      <span>Digest ({automationRuns.length})</span>
                    </button>
                  )}

                  {allTownTraces.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (townTraceHidden) {
                          setTownTraceHidden(false);
                          const target =
                            (townTraceTaskId
                              ? allTownTraces.find((t) => t.taskId === townTraceTaskId)
                              : null) ?? allTownTraces[0];
                          if (target) {
                            visualizeTraceInTown(target.trace, true);
                          }
                        } else {
                          setTownTraceHidden(true);
                        }
                      }}
                      title="Toggle multi-agent handoff sequence arcs on the town map"
                      className={`pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold shadow-lg backdrop-blur-md transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                        !townTraceHidden
                          ? 'border-amber-500/60 bg-slate-900/95 text-amber-300 hover:border-amber-400'
                          : 'border-slate-700/80 bg-slate-950/90 text-slate-300 hover:border-slate-600 hover:text-white'
                      }`}
                    >
                      <GitBranch className="h-3.5 w-3.5 text-amber-400" />
                      <span>Handoffs ({allTownTraces.length})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setIsCommandPaletteOpen(true)}
                    title="Quick Jump (⌘K / Ctrl+K)"
                    className="pointer-events-auto hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-700/80 bg-slate-950/90 px-2 py-1.5 text-xs font-medium text-slate-300 shadow-lg backdrop-blur-md hover:border-slate-600 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Command className="h-3 w-3 text-slate-400" />
                    <span className="font-mono text-[10px]">⌘K</span>
                  </button>
                </div>

                {/* Active Town Handoff Trace HUD Strip */}
                {activeTownTraceEntry && (
                  <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-lg border border-slate-700/85 bg-slate-950/92 px-3 py-1.5 text-xs shadow-xl backdrop-blur-md max-w-xl">
                    {allTownTraces.length > 1 && (
                      <div className="inline-flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            const curIdx = allTownTraces.findIndex(
                              (x) => x.taskId === activeTownTraceEntry.taskId
                            );
                            const nextIdx =
                              (curIdx - 1 + allTownTraces.length) % allTownTraces.length;
                            visualizeTraceInTown(allTownTraces[nextIdx].trace, true);
                          }}
                          title="Previous handoff thread"
                          aria-label="Previous handoff thread"
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const curIdx = allTownTraces.findIndex(
                              (x) => x.taskId === activeTownTraceEntry.taskId
                            );
                            const nextIdx = (curIdx + 1) % allTownTraces.length;
                            visualizeTraceInTown(allTownTraces[nextIdx].trace, true);
                          }}
                          title="Next handoff thread"
                          aria-label="Next handoff thread"
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {activeTownTraceEntry.trace.status === 'completed' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-100 truncate max-w-[200px] sm:max-w-[240px]">
                          {activeTownTraceEntry.title}
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                          · {activeTownTraceEntry.trace.packets.length} hop
                          {activeTownTraceEntry.trace.packets.length === 1 ? '' : 's'}
                          {activeTownTraceEntry.crossHouseCount > 0 && (
                            <span className="text-amber-300">
                              {' '}
                              · {activeTownTraceEntry.crossHouseCount} X-House
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => visualizeTraceInTown(activeTownTraceEntry.trace, true)}
                        title="Replay packet courier sequence & center camera"
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Replay</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openAgentTraceInDrawer(activeTownTraceEntry.trace)}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:border-amber-500/60 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <span>Trace Panel</span>
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setTownTraceHidden(true)}
                        title="Hide town handoff arcs"
                        aria-label="Hide town handoff arcs"
                        className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contextual Proximity Prompt (pointer-events-none wrapper so surrounding canvas stays clickable) */}
            {(nearDoor || nearAgent) && !activeBuilding && (
              <div className="pointer-events-none absolute left-4 bottom-4 z-10 flex items-center gap-2">
                {nearDoor && (
                  <button
                    onClick={() => enterBuilding(nearDoor)}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-amber-500/60 bg-slate-950/90 px-3.5 py-2 text-xs font-semibold text-amber-300 shadow-lg hover:bg-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <DoorOpen className="h-4 w-4" />
                    <span>Enter {nearDoor.name} (E)</span>
                  </button>
                )}
                {nearAgent && (
                  <button
                    onClick={() => openAgentChat(nearAgent)}
                    className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/90 px-3.5 py-2 text-xs font-semibold text-white shadow-lg hover:border-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <MessageSquare className="h-4 w-4 text-sky-400" />
                    <span>Talk to {nearAgent.name} (T)</span>
                  </button>
                )}
              </div>
            )}

            {/* Dismissible Quick-Start Guide Strip */}
            {!settings.hasDismissedQuickGuide && !activeBuilding && rightDrawerMode === 'none' && (
              <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-10 w-full max-w-3xl px-3">
                <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-700/80 bg-slate-950/90 px-3.5 py-2 shadow-xl backdrop-blur-md">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300 shrink-0">
                    <Compass className="h-3.5 w-3.5" />
                    <span>Quick Start:</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCommandBarCollapsed(false);
                        requestAnimationFrame(() => taskInputElRef.current?.focus());
                      }}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      1. Delegate or type @Director below
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleOpenMorningBriefing(false)}
                      className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      2. Morning Briefing
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'desk' }))
                      }
                      className="rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      3. Try Desk View
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateVillageSettings((prev) => ({ ...prev, hasDismissedQuickGuide: true }))
                    }
                    aria-label="Dismiss quick-start guide"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <span>Dismiss</span>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Restore button when bottom command dock is collapsed */}
        {commandBarCollapsed && !activeBuilding && (
          <div className="pointer-events-none absolute right-4 bottom-4 z-10">
            <button
              type="button"
              onClick={() => {
                setCommandBarCollapsed(false);
                requestAnimationFrame(() => taskInputElRef.current?.focus());
              }}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-amber-300 shadow-lg hover:border-amber-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Assign Task (/)</span>
            </button>
          </div>
        )}

        {/* Live Action Feedback Notice */}
        {liveStatusText && (
          <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-20 rounded-lg border border-slate-700 bg-slate-950/95 px-4 py-2 text-xs font-medium text-slate-200 shadow-lg backdrop-blur">
            {liveStatusText}
          </div>
        )}

        {/* Right Side Drawers */}
        {rightDrawerMode === 'knowledge' && (
          <KnowledgeBaseDrawer
            key={kbInitialDepartment}
            entries={knowledgeBase}
            agents={currentAgents}
            pendingProposalsCount={pendingKbCount}
            initialDepartmentFilter={kbInitialDepartment}
            isConsolidating={isConsolidatingKb}
            onClose={() => setRightDrawerMode('none')}
            onOpenProposals={() => setRightDrawerMode('approvals')}
            onSaveEntry={handleSaveKnowledgeEntry}
            onDeleteEntry={handleDeleteKnowledgeEntry}
            onConsolidate={handleConsolidateKnowledge}
            onPrefillTask={handlePrefillTaskPrompt}
            onOpenAgentChat={openAgentChat}
          />
        )}

        {rightDrawerMode === 'directory' && (
          <DirectoryDrawer
            initialTab={directoryInitialTab}
            agentsRef={agentsRef}
            tasks={tasks}
            chatHistory={chatHistory}
            approvals={approvals}
            busyChatAgentId={isChatSending && selectedAgent ? selectedAgent.id : null}
            activityFeed={activityFeed}
            automationRuns={automationRuns}
            autopilotSettings={townAutopilotSettings}
            onClose={() => setRightDrawerMode('none')}
            onOpenAgentChat={openAgentChat}
            onWalkToAgent={(ag) => {
              if (workspaceViewMode === 'desk') {
                updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'map' }));
              }
              handleWalkToAgent(ag);
            }}
            onEnterBuilding={(b) => {
              setRightDrawerMode('none');
              enterBuilding(b);
            }}
            onWalkToBuilding={(b) => {
              if (workspaceViewMode === 'desk') {
                updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'map' }));
              }
              setRightDrawerMode('none');
              handleWalkToBuilding(b);
            }}
            onOpenTownHall={() => {
              setRightDrawerMode('none');
              const th = VILLAGE_BUILDINGS.find((b) => b.id === 'town_hall');
              if (th) enterBuilding(th);
            }}
            onOpenWorkspace={() => openWorkspaceTab('overview')}
            onOpenApprovals={() => setRightDrawerMode('approvals')}
            onOpenAutopilotSettings={() => openSettingsTab('autopilot')}
            onRefreshAutomation={handleRefreshAutomationRuns}
            onClearSyncFeed={handleClearSyncFeed}
            onOpenTaskReport={(taskId) => {
              setFocusedReportTaskId(taskId);
              setRightDrawerMode('reports');
            }}
            onVisualizeTraceInTown={(trace) => {
              if (workspaceViewMode === 'desk') {
                updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: 'map' }));
              }
              visualizeTraceInTown(trace, true);
            }}
            onPrefillTask={(prompt) => {
              handlePrefillTaskPrompt(prompt);
              setLiveStatusText(
                'Loaded cross-house task into the command bar below—press Assign Task to dispatch.'
              );
            }}
          />
        )}

        {rightDrawerMode === 'workspace' && (
          <WorkspaceHubDrawer
            initialTab={workspaceInitialTab}
            agents={currentAgents}
            workspaceBriefing={workspaceBriefing}
            workingFolder={settings.driveWorkingFolder}
            calendarWriteAccess={settings.calendarWriteAccess}
            gmailIncludeInbox={settings.gmailIncludeInbox}
            gmailSelectedLabels={settings.gmailSelectedLabels}
            isGoogleConnected={isGoogleConnected}
            onSyncWorkspace={handleSyncWorkspace}
            onGoogleSignIn={handleGoogleSignIn}
            onGrantWorkspaceConsent={handleGrantWorkspaceConsent}
            onGrantCalendarWriteConsent={handleGrantCalendarWriteConsent}
            onEnableCalendarWriteAccess={() => {
              updateVillageSettings((prev) => ({ ...prev, calendarWriteAccess: true }));
              if (isGoogleConnected && workspaceBriefing.calendarStatus !== 'connected_write') {
                void handleGrantCalendarWriteConsent().catch(() => {});
              }
            }}
            onUpdateGmailSources={handleUpdateGmailSources}
            onListGmailLabels={handleListGmailLabels}
            onReadGmailMessages={handleReadGmailMessages}
            onCreateCalendarEvent={handleCreateCalendarEvent}
            onUpdateCalendarEvent={handleUpdateCalendarEvent}
            onDeleteCalendarEvent={handleDeleteCalendarEvent}
            onSendChatMessage={handleSendGoogleChatMessage}
            onListChatSpaces={handleListGoogleChatSpaces}
            onReadChatConversation={handleReadGoogleChatConversation}
            onPinChatContext={handlePinGoogleChatContext}
            onUnpinChatContext={handleUnpinGoogleChatContext}
            onImportGoogleDoc={handleImportGoogleDoc}
            onCreateGoogleDoc={(title, content) => handleCreateGoogleDoc(title, content)}
            onUnlinkGoogleDoc={handleUnlinkGoogleDoc}
            onSearchDriveFiles={handleSearchDriveFiles}
            onPinDriveFile={handlePinDriveFile}
            onUnpinDriveFile={handleUnpinDriveFile}
            onSaveDriveFile={(params) => handleSaveDriveFile(params)}
            onListWorkingFolderFiles={handleListWorkingFolderFiles}
            onReadWorkingFolderFile={handleReadWorkingFolderFile}
            onCreateWorkingFolderItem={handleCreateWorkingFolderItem}
            onUpdateWorkingFolderFile={handleUpdateWorkingFolderFile}
            onTrashWorkingFolderFile={handleTrashWorkingFolderFile}
            onOpenSettings={(tab) => openSettingsTab(tab ?? 'guardrails')}
            onOpenAgentChat={openAgentChat}
            onAskDanielWithPrompt={handleAskDanielWithPrompt}
            onOpenMorningBriefing={() => void handleOpenMorningBriefing(false)}
            onPrefillTask={(prompt) => {
              handlePrefillTaskPrompt(prompt);
              setLiveStatusText('Loaded task into command bar below—press Assign Task to dispatch.');
            }}
            onClose={() => setRightDrawerMode('none')}
          />
        )}

        {rightDrawerMode === 'agent' && selectedAgent && (
          <AgentDrawer
            agent={selectedAgent}
            allAgents={currentAgents}
            directors={directors}
            tasks={tasks}
            approvals={approvals}
            messages={chatHistory[selectedAgent.id] ?? []}
            allChatHistory={chatHistory}
            initialTab={agentDrawerInitialTab}
            focusedTraceTaskId={focusedTraceTaskId}
            focusedTraceNonce={focusedTraceNonce}
            prefillDraft={agentPrefillDraft}
            prefillNonce={agentPrefillNonce}
            activeTownTraceTaskId={activeTownTraceEntry?.taskId ?? null}
            isSending={isChatSending}
            workspaceBriefing={workspaceBriefing}
            calendarWriteAccess={settings.calendarWriteAccess}
            isGoogleConnected={isGoogleConnected}
            bearerToken={getAccessToken()}
            onSyncWorkspace={handleSyncWorkspace}
            onGrantWorkspaceConsent={handleGrantWorkspaceConsent}
            onGrantCalendarWriteConsent={handleGrantCalendarWriteConsent}
            onClose={() => setRightDrawerMode('none')}
            onSendMessage={handleSendAgentMessage}
            onSummonDirector={summonDirectorToCho}
            onSaveInstructions={handleSaveInstructions}
            onSaveVoice={handleSaveAgentVoice}
            onCommitLiveVoiceTurn={handleCommitLiveVoiceTurn}
            onAgentSpeechBubble={handleAgentSpeechBubble}
            onPromoteToTask={(prompt) => {
              handlePrefillTaskPrompt(prompt);
              setLiveStatusText('Ready to assign to Matt in the command bar below.');
            }}
            onSelectAgent={openAgentChat}
            onOpenTaskReport={(taskId) => {
              setFocusedReportTaskId(taskId);
              setRightDrawerMode('reports');
            }}
            onVisualizeTraceInTown={(trace) => visualizeTraceInTown(trace, true)}
            onOpenWorkspace={() => openWorkspaceTab('overview')}
            onOpenWorkspaceChat={() => openWorkspaceTab('chat')}
            onOpenApprovals={() => setRightDrawerMode('approvals')}
          />
        )}

        {rightDrawerMode === 'settings' && (
          <SettingsDrawer
            initialTab={settingsInitialTab}
            settings={settings}
            workspaceBriefing={workspaceBriefing}
            isGoogleConnected={isGoogleConnected}
            soundEnabled={soundEnabled}
            showWalkability={showWalkability}
            isRendering4k={isRendering4k}
            map4kActive={Boolean(map4kUrl)}
            agentCount={currentAgents.length}
            taskCount={tasks.length}
            knowledgeCount={knowledgeBase.length}
            onUpdateSettings={updateVillageSettings}
            onUpdateGmailSources={handleUpdateGmailSources}
            onListGmailLabels={handleListGmailLabels}
            onToggleSound={() => {
              const next = !soundEnabled;
              soundFx.enabled = next;
              setSoundEnabled(next);
            }}
            onToggleWalkability={() => setShowWalkability((s) => !s)}
            onRender4kMap={() => void handleRender4kMap()}
            onGoogleSignIn={handleGoogleSignIn}
            onGrantWorkspaceConsent={handleGrantWorkspaceConsent}
            onGrantCalendarWriteConsent={handleGrantCalendarWriteConsent}
            onListDriveFolders={handleListDriveFolders}
            onCreateWorkingFolder={handleCreateWorkingFolder}
            onSelectWorkingFolderByUrl={handleSelectWorkingFolderByUrl}
            onOpenWorkspace={(tab) => openWorkspaceTab(tab ?? 'overview')}
            onShowQuickGuide={() =>
              updateVillageSettings((prev) => ({ ...prev, hasDismissedQuickGuide: false }))
            }
            autopilotSettings={townAutopilotSettings}
            automationRules={townAutomationRules}
            automationRuns={automationRuns}
            runningRuleId={runningAutomationRuleId}
            onUpdateAutopilot={handleUpdateAutopilot}
            onRunRuleNow={handleRunAutomationRuleNow}
            onOpenDigest={() => {
              setDirectoryInitialTab('digest');
              setRightDrawerMode('directory');
            }}
            onOpenApprovals={() => setRightDrawerMode('approvals')}
            onClose={() => setRightDrawerMode('none')}
          />
        )}

        {(rightDrawerMode === 'reports' ||
          rightDrawerMode === 'approvals' ||
          rightDrawerMode === 'history' ||
          rightDrawerMode === 'analytics') && (
          <ReportsAndApprovalsDrawer
            initialTab={rightDrawerMode}
            focusedTaskId={focusedReportTaskId}
            activeTownTraceTaskId={activeTownTraceEntry?.taskId ?? null}
            agents={currentAgents}
            tasks={tasks}
            approvals={approvals}
            kbProposals={kbProposals}
            kbBusyMap={kbBusyMap}
            knowledgeBase={knowledgeBase}
            workingFolder={settings.driveWorkingFolder}
            workingFolderWriteMode={settings.driveWorkingFolderWriteMode}
            calendarWriteAccess={settings.calendarWriteAccess}
            isGoogleConnected={isGoogleConnected}
            isDispatching={isDispatching}
            onTabChange={(nextTab) => setRightDrawerMode(nextTab)}
            onVisualizeTraceInTown={(trace) => visualizeTraceInTown(trace, true)}
            onOpenSettings={(tab) => openSettingsTab(tab ?? 'guardrails')}
            onOpenWorkspace={(tab) => openWorkspaceTab(tab ?? 'overview')}
            onClose={() => setRightDrawerMode('none')}
            onApproveItem={handleApproveItem}
            onUpdateApprovalItem={handleUpdateApprovalItem}
            onRejectItem={handleRejectItem}
            onDismissExpiredPackets={handleDismissExpiredPackets}
            onApproveKbProposal={handleApproveKbProposal}
            onRequestKbRevision={handleRequestKbRevision}
            onRejectKbProposal={handleRejectKbProposal}
            onRedispatchTask={dispatchTaskPrompt}
            onPrefillTask={handlePrefillTaskPrompt}
            onIndexTaskToKnowledge={handleIndexTaskToKnowledge}
            onArchiveTask={handleArchiveTask}
            onRestoreTask={handleRestoreTask}
            onExportTaskToGoogleDoc={handleExportTaskToGoogleDoc}
            onExportTaskToDrive={handleExportTaskToDrive}
          />
        )}

        {/* Building Interior / Town Hall Modal */}
        {activeBuilding && (
          <BuildingInteriorModal
            building={activeBuilding}
            agents={currentAgents}
            knowledgeEntries={knowledgeBase}
            onOpenKnowledgeBase={(dept) => {
              setKbInitialDepartment(dept ?? 'all');
              setRightDrawerMode('knowledge');
            }}
            onOpenWorkspace={() => openWorkspaceTab('overview')}
            onClose={exitBuilding}
            onOpenAgentChat={openAgentChat}
            onRunTownHall={handleRunTownHall}
            onProposeHire={handleProposeHire}
            onInterviewCandidate={handleInterviewCandidate}
            onApproveHire={handleApproveHire}
          />
        )}
      </main>

      {/* Clickable Live Task Tracker & Completion Banner */}
      <LiveTaskTrackerBar
        tasks={tasks}
        approvals={approvals}
        kbProposals={kbProposals}
        agents={currentAgents}
        dismissedTaskIds={dismissedTrackerTaskIds}
        onDismissTask={(id) =>
          setDismissedTrackerTaskIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
        }
        onDismissCompletedTasks={(ids) =>
          setDismissedTrackerTaskIds((prev) => Array.from(new Set([...prev, ...ids])))
        }
        onLocateTaskOnMap={handleLocateTaskOnMap}
        onOpenReport={(task) => {
          setFocusedReportTaskId(task.id);
          setRightDrawerMode('reports');
        }}
        onOpenApprovals={() => setRightDrawerMode('approvals')}
      />

      {/* Global Now Speaking Bar (Docked cleanly above bottom command bar so audio plays uninterrupted while walking) */}
      {(voiceState.status !== 'idle' || voiceState.error) && (
        <div className="z-20 shrink-0 border-t border-slate-800 bg-slate-900/95 px-5 py-2">
          <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3">
            {voiceState.error ? (
              <>
                <div className="min-w-0 flex-1 truncate text-xs text-rose-300">
                  Voice playback notice: {voiceState.error}
                </div>
                <button
                  type="button"
                  onClick={() => voicePlayer.clearError()}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Dismiss</span>
                </button>
              </>
            ) : (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2.5 text-xs">
                  {voiceState.status === 'loading' ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-amber-400" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                  )}
                  <span className="font-semibold text-white whitespace-nowrap shrink-0">
                    {voiceState.speakerName || 'Villager'}
                  </span>
                  {voiceState.timbreLabel && (
                    <span className="hidden sm:inline text-slate-400 whitespace-nowrap shrink-0">
                      · {voiceState.timbreLabel}
                    </span>
                  )}
                  {voiceState.queueTotal > 1 && (
                    <span className="font-mono text-[11px] text-amber-300 tabular-nums whitespace-nowrap shrink-0">
                      ({voiceState.queueIndex}/{voiceState.queueTotal})
                    </span>
                  )}
                  {voiceState.snippet && (
                    <span className="min-w-0 truncate text-slate-300">
                      — &ldquo;{voiceState.snippet}&rdquo;
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {voiceState.queueTotal > 1 && voiceState.queueIndex < voiceState.queueTotal && (
                    <button
                      type="button"
                      onClick={() => voicePlayer.skipNext()}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/50 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <SkipForward className="h-3 w-3" />
                      <span>Next</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => voicePlayer.stop()}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/60 bg-amber-950/60 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-950 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Square className="h-3 w-3 fill-current" />
                    <span>Stop</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Docked Bottom Command Bar (sits cleanly below the map so it never overlaps buildings or blocks clicks) */}
      {!commandBarCollapsed && (
        <div className="relative z-20 shrink-0 border-t border-slate-800 bg-slate-950 px-5 py-2.5">
          {showShortcutsPopover && (
            <div className="absolute right-5 bottom-full mb-2 w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-2xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-white">Navigation &amp; Shortcuts</h3>
                <button
                  type="button"
                  onClick={() => setShowShortcutsPopover(false)}
                  aria-label="Close help"
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1.5 text-[11px]">
                {[
                  ['⌘K / Ctrl+K', 'Quick Jump anywhere'],
                  ['@Director', 'Assign directly to a Director'],
                  ['Arrows / WASD', 'Walk around village'],
                  ['Shift + Move', 'Sprint'],
                  ['E or Enter', 'Enter nearby building'],
                  ['T', 'Talk to nearby villager'],
                  ['M M', 'Call Matt anywhere'],
                  ['/', 'Focus task command bar'],
                  ['N', 'Toggle Village Radar mini-map'],
                  ['L', 'Open Directory · Live Feed'],
                  ['K', 'Open Knowledge Base'],
                  ['G', 'Toggle walkability paths'],
                ].map(([keys, desc]) => (
                  <div
                    key={keys}
                    className="flex items-center justify-between gap-2 border-b border-slate-800/70 pb-1"
                  >
                    <span className="text-slate-300">{desc}</span>
                    <kbd className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 whitespace-nowrap shrink-0">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowShortcutsPopover(false);
                    setDirectoryInitialTab('team');
                    setRightDrawerMode('directory');
                  }}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 hover:text-white cursor-pointer"
                >
                  Open Directory
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowShortcutsPopover(false);
                    openWorkspaceTab('overview');
                  }}
                  className="flex-1 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 hover:text-amber-200 cursor-pointer"
                >
                  Open Workspace
                </button>
              </div>
            </div>
          )}

          {/* Upward @Director Autocomplete Menu */}
          {mentionCandidates.length > 0 && (
            <div className="mx-auto relative w-full max-w-7xl">
              <div className="absolute left-0 bottom-full mb-2 w-80 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
                <div className="border-b border-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-400">
                  Direct @Director Assignment (skips routing)
                </div>
                <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/70">
                  {mentionCandidates.map((dir, idx) => {
                    const isSelected = idx === mentionSelectionIdx % mentionCandidates.length;
                    return (
                      <button
                        key={dir.id}
                        type="button"
                        onMouseEnter={() => setMentionSelectionIdx(idx)}
                        onClick={() => {
                          setTaskInput(`@${dir.name} `);
                          setMentionSelectionIdx(0);
                          requestAnimationFrame(() => taskInputElRef.current?.focus());
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs cursor-pointer ${
                          isSelected ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <AtSign className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                          <span className="font-semibold text-white">{dir.name}</span>
                        </div>
                        <span className="truncate text-[11px] text-slate-400">{dir.department}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mx-auto flex w-full max-w-7xl flex-col gap-1.5">
            {activeDirectDirector ? (
              <div className="flex items-center justify-between gap-2 text-[11px] text-amber-300">
                <span>
                  Direct assignment → <strong>@{activeDirectDirector.name}</strong> (
                  {activeDirectDirector.department}) · Bypasses Matt routing
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setTaskInput((prev) => prev.replace(/^@[a-zA-Z]+\s+/, ''))
                  }
                  className="text-slate-400 hover:text-white underline cursor-pointer whitespace-nowrap shrink-0"
                >
                  Let Matt route instead
                </button>
              </div>
            ) : predictedRoute ? (
              <div className="flex items-center justify-between gap-2 text-[11px] text-slate-300">
                <span className="min-w-0 truncate">
                  {predictedRoute.secondary ? (
                    <>
                      Matt will likely coordinate →{' '}
                      <strong className="text-amber-300">{predictedRoute.primary.name}</strong> (
                      {predictedRoute.primary.department}) ↔{' '}
                      <strong className="text-sky-300">{predictedRoute.secondary.name}</strong> (
                      {predictedRoute.secondary.department})
                    </>
                  ) : (
                    <>
                      Matt will likely route to →{' '}
                      <strong className="text-sky-300">{predictedRoute.primary.name}</strong> (
                      {predictedRoute.primary.department})
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setTaskInput((prev) => `@${predictedRoute.primary.name} ${prev.trimStart()}`);
                    requestAnimationFrame(() => taskInputElRef.current?.focus());
                  }}
                  className="text-amber-300 hover:text-amber-200 underline decoration-amber-500/40 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  Assign @{predictedRoute.primary.name} directly
                </button>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <form
                onSubmit={(e) => void handleDispatchTask(e)}
                className="flex flex-1 items-center gap-2 min-w-0"
              >
                <input
                  ref={taskInputElRef}
                  type="text"
                  value={taskInput}
                  onChange={(e) => {
                    setTaskInput(e.target.value);
                    setMentionSelectionIdx(0);
                  }}
                  onKeyDown={(e) => {
                    if (mentionCandidates.length > 0) {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setMentionSelectionIdx((i) => (i + 1) % mentionCandidates.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setMentionSelectionIdx(
                          (i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length
                        );
                      } else if (e.key === 'Tab' || e.key === 'Enter') {
                        e.preventDefault();
                        const chosen =
                          mentionCandidates[mentionSelectionIdx % mentionCandidates.length];
                        if (chosen) {
                          setTaskInput(`@${chosen.name} `);
                          setMentionSelectionIdx(0);
                        }
                      }
                    }
                  }}
                  placeholder="Assign a task to Matt, or type @Daniel / @Aria to assign directly..."
                  className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <div
                  role="group"
                  aria-label="Task priority"
                  title="Set task urgency for Matt and the assigned team"
                  className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 shrink-0"
                >
                  <span className="hidden sm:inline text-[11px] font-medium text-slate-500 pr-1">
                    Priority
                  </span>
                  {(
                    [
                      ['low', 'Low', 'bg-slate-700 text-slate-100'],
                      ['medium', 'Med', 'bg-sky-500/25 text-sky-200'],
                      ['high', 'High', 'bg-rose-500/30 text-rose-200'],
                    ] as Array<[TaskPriority, string, string]>
                  ).map(([level, label, activeClass]) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setTaskPriority(level)}
                      aria-pressed={taskPriority === level}
                      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        taskPriority === level
                          ? activeClass
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="submit"
                  disabled={isDispatching || !taskInput.trim() || Boolean(mentionPrefixMatch)}
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isDispatching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{activeDirectDirector ? 'Working...' : 'Routing...'}</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      <span>
                        {activeDirectDirector
                          ? `Assign @${activeDirectDirector.name}`
                          : 'Assign Task'}
                      </span>
                    </>
                  )}
                </button>
              </form>

              {/* Quick Jump, Audio, Shortcuts Help & Dock Controls */}
              <div className="hidden md:flex items-center gap-1.5 shrink-0 border-l border-slate-800 pl-3">
                <button
                  type="button"
                  onClick={() => setIsCommandPaletteOpen(true)}
                  title="Quick Jump (⌘K / Ctrl+K)"
                  aria-label="Open Quick Jump command palette"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-2 text-xs font-medium text-slate-300 hover:text-white cursor-pointer shrink-0"
                >
                  <Command className="h-3.5 w-3.5 text-amber-400" />
                  <span className="font-mono text-[10px]">⌘K</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowShortcutsPopover((v) => !v)}
                  title="Keyboard shortcuts & navigation help (?)"
                  aria-label="Keyboard shortcuts and navigation help"
                  className={`inline-flex items-center justify-center rounded-lg border p-2 cursor-pointer shrink-0 ${
                    showShortcutsPopover
                      ? 'border-amber-500/60 bg-amber-950/50 text-amber-300'
                      : 'border-slate-800 bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  <HelpCircle className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !soundEnabled;
                    soundFx.enabled = next;
                    setSoundEnabled(next);
                  }}
                  aria-label={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:text-white cursor-pointer shrink-0"
                >
                  {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setCommandBarCollapsed(true)}
                  title="Minimize command bar"
                  aria-label="Minimize command bar"
                  className="inline-flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-400 hover:text-white cursor-pointer shrink-0"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
              <span>Quick actions:</span>
              <button
                type="button"
                onClick={() => void handleOpenMorningBriefing(false)}
                className="font-medium text-amber-300 hover:text-amber-200 underline decoration-amber-500/40 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
              >
                Morning Briefing (Audio)
              </button>
              {pendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => setRightDrawerMode('approvals')}
                  className="font-medium text-amber-300 hover:text-amber-200 underline decoration-amber-500/40 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0 tabular-nums"
                >
                  Review {pendingCount} Pending Sign-Off{pendingCount === 1 ? '' : 's'}
                </button>
              )}
              {contextualStarters.map((starter) => (
                <button
                  key={starter.label}
                  type="button"
                  onClick={() => {
                    setTaskInput(starter.prompt);
                    requestAnimationFrame(() => taskInputElRef.current?.focus());
                  }}
                  className="hover:text-amber-300 underline decoration-slate-700 underline-offset-2 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {starter.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick Jump Command Palette Modal (⌘K / Ctrl+K) */}
      <CommandPaletteModal
        isOpen={isCommandPaletteOpen}
        workspaceViewMode={workspaceViewMode}
        agents={currentAgents}
        tasks={tasks}
        approvals={approvals}
        knowledgeBase={knowledgeBase}
        onClose={() => setIsCommandPaletteOpen(false)}
        onOpenMorningBriefing={() => void handleOpenMorningBriefing(false)}
        onToggleViewMode={(mode) =>
          updateVillageSettings((prev) => ({ ...prev, workspaceViewMode: mode }))
        }
        onAssignToDirector={handleAssignToDirectorShortcut}
        onOpenAgentChat={openAgentChat}
        onEnterBuilding={enterBuilding}
        onOpenWorkspaceTab={(tab) => openWorkspaceTab(tab)}
        onOpenReports={(task) => {
          if (task) setFocusedReportTaskId(task.id);
          setRightDrawerMode('reports');
        }}
        onOpenApprovals={() => setRightDrawerMode('approvals')}
        onOpenKnowledge={(dept) => {
          setKbInitialDepartment(dept ?? 'all');
          setRightDrawerMode('knowledge');
        }}
        onOpenSettings={() => openSettingsTab('guardrails')}
        onOpenAutopilotSettings={() => openSettingsTab('autopilot')}
      />

      {/* Executive Morning Briefing Modal (Written + Voice) */}
      <MorningBriefingModal
        isOpen={isMorningBriefingOpen}
        isLoading={isLoadingMorningBriefing}
        error={morningBriefingError}
        briefing={morningBriefing}
        isGoogleConnected={isGoogleConnected}
        pendingApprovalsCount={pendingCount}
        agents={currentAgents}
        onClose={() => setIsMorningBriefingOpen(false)}
        onRefresh={() => void handleOpenMorningBriefing(true)}
        onGoogleSignIn={handleGoogleSignIn}
        onOpenApprovals={() => setRightDrawerMode('approvals')}
        onAssignPriorityPrompt={(prompt, targetDirId) => {
          const targetDir = targetDirId
            ? currentAgents.find((a) => a.id === targetDirId && a.role === 'director')
            : undefined;
          const formatted = targetDir ? `@${targetDir.name} ${prompt}` : prompt;
          handlePrefillTaskPrompt(formatted, 'high');
        }}
      />
    </div>
  );
}
