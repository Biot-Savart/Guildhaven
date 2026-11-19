import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  ArrowUpRight,
  CheckCircle2,
  Coffee,
  ExternalLink,
  FileText,
  Flame,
  GitBranch,
  Loader2,
  MessageSquare,
  Mic,
  Pin,
  PhoneCall,
  RefreshCw,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import mattPortraitImg from '../assets/images/chief_of_staff_matt_1794560538124.jpg';
import { computeAgentMood, type AgentMoodKey } from '../lib/agentMood';
import { AGENT_VOICE_OPTIONS, resolveAgentVoiceProfile } from '../lib/agentVoices';
import { useVoicePlayer, voicePlayer } from '../lib/voicePlayer';
import type {
  Agent,
  AgentVoiceName,
  ApprovalItem,
  ChatMessage,
  HandoffPacket,
  HandoffTrace,
  VillageTask,
  WorkspaceBriefing,
} from '../types/village';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';
import { FormattedMarkdown } from './FormattedMarkdown';
import { HandoffTracePanel, isCrossHousePacket } from './HandoffTracePanel';
import { LiveVoiceCallPanel } from './LiveVoiceCallPanel';
import { SpeakButton } from './SpeakButton';

type DrawerTab = 'chat' | 'trace' | 'dossier';

interface AgentThreadItem {
  taskId: string;
  title: string;
  originType: 'direct_chat' | 'cross_chat' | 'formal_task';
  originLabel: string;
  formalTaskId?: string;
  agentRoleLabel: string;
  timestampMs: number;
  crossHouseCount: number;
  outcomeSummary: string;
  trace: HandoffTrace;
}

interface AgentDrawerProps {
  agent: Agent;
  allAgents?: Agent[];
  directors: Agent[];
  tasks?: VillageTask[];
  approvals?: ApprovalItem[];
  messages: ChatMessage[];
  allChatHistory?: Record<string, ChatMessage[]>;
  initialTab?: DrawerTab;
  focusedTraceTaskId?: string | null;
  focusedTraceNonce?: number;
  prefillDraft?: string | null;
  prefillNonce?: number;
  activeTownTraceTaskId?: string | null;
  isSending: boolean;
  workspaceBriefing: WorkspaceBriefing;
  calendarWriteAccess?: boolean;
  isGoogleConnected: boolean;
  bearerToken?: string | null;
  onSyncWorkspace: () => Promise<void>;
  onGrantWorkspaceConsent?: () => Promise<void>;
  onGrantCalendarWriteConsent?: () => Promise<void>;
  onClose: () => void;
  onSendMessage: (agentId: string, text: string) => Promise<void>;
  onSummonDirector: (directorId: string) => void;
  onSaveInstructions: (agentId: string, instructions: string) => Promise<void>;
  onSaveVoice: (agentId: string, voiceName: AgentVoiceName) => Promise<void>;
  onCommitLiveVoiceTurn: (
    agentId: string,
    userTranscript: string,
    agentTranscript: string
  ) => void;
  onAgentSpeechBubble?: (agentId: string, text: string) => void;
  onPromoteToTask?: (prompt: string) => void;
  onSelectAgent?: (agent: Agent) => void;
  onOpenTaskReport?: (taskId: string) => void;
  onVisualizeTraceInTown?: (trace: HandoffTrace) => void;
  onOpenWorkspace?: () => void;
  onOpenWorkspaceChat?: () => void;
  onOpenApprovals?: () => void;
}

function formatFallbackActivity(agent: Agent): string {
  switch (agent.state) {
    case 'working_inside':
      return 'Working inside department office';
    case 'phone_call':
      return 'On a dispatch phone call';
    case 'summoned':
      return 'Walking over to meet you';
    case 'town_hall_seated':
      return 'Seated in Town Hall';
    case 'chatting':
      return 'In conversation with you';
    case 'following_cho':
      return 'Following you across the village';
    case 'walking':
      return `Standing by for your direction · ${agent.department}`;
    default:
      return `Standing by for your direction · ${agent.department}`;
  }
}

function summarizeText(raw: string, maxLen = 150): string {
  const cleaned = raw
    .replace(/[#*_`>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Unified synthesis returned to CHO.';
  return cleaned.length > maxLen ? `${cleaned.slice(0, maxLen - 1)}…` : cleaned;
}

function resolveAgentRoleInTrace(agentId: string, trace: HandoffTrace): string {
  if (trace.coordinating_director === agentId) return 'Coordinator';
  if (trace.root_agent === agentId) {
    return agentId === 'matt' ? 'Triage' : 'Origin';
  }
  const receivedCross = trace.packets.some(
    (p) => p.to_agent === agentId && isCrossHousePacket(p)
  );
  if (receivedCross) return 'Cross-House Specialist';
  const receivedAny = trace.packets.some((p) => p.to_agent === agentId);
  if (receivedAny) return 'Guild Specialist';
  const dispatchedAny = trace.packets.some((p) => p.from_agent === agentId);
  if (dispatchedAny) return 'Delegating Lead';
  return 'Thread Participant';
}

function involvesAgentCheck(agentId: string, trace: HandoffTrace): boolean {
  if (agentId === 'matt') return true;
  if (trace.root_agent === agentId || trace.coordinating_director === agentId) {
    return true;
  }
  return trace.packets.some(
    (p) => p.from_agent === agentId || p.to_agent === agentId
  );
}

const MOOD_ICONS: Record<AgentMoodKey, React.FC<{ className?: string }>> = {
  thriving: Sparkles,
  focused: Zap,
  stretched: Flame,
  strained: AlertTriangle,
  rested: Coffee,
};

export const AgentDrawer: React.FC<AgentDrawerProps> = ({
  agent,
  allAgents = [],
  directors,
  tasks = [],
  approvals = [],
  messages,
  allChatHistory = {},
  initialTab = 'chat',
  focusedTraceTaskId = null,
  focusedTraceNonce = 0,
  prefillDraft = null,
  prefillNonce = 0,
  activeTownTraceTaskId = null,
  isSending,
  workspaceBriefing,
  calendarWriteAccess = false,
  isGoogleConnected,
  bearerToken,
  onSyncWorkspace,
  onGrantWorkspaceConsent,
  onGrantCalendarWriteConsent,
  onClose,
  onSendMessage,
  onSummonDirector,
  onSaveInstructions,
  onSaveVoice,
  onCommitLiveVoiceTurn,
  onAgentSpeechBubble,
  onPromoteToTask,
  onSelectAgent,
  onOpenTaskReport,
  onVisualizeTraceInTown,
  onOpenWorkspace,
  onOpenWorkspaceChat,
  onOpenApprovals,
}) => {
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const [selectedTraceTaskId, setSelectedTraceTaskId] = useState<string | null>(
    focusedTraceTaskId
  );
  const [traceFilter, setTraceFilter] = useState<'all' | 'cross_house'>('all');
  const [input, setInput] = useState('');
  const [editingInstructions, setEditingInstructions] = useState(agent.instructions);
  const [savedNotice, setSavedNotice] = useState(false);
  const [voiceSavedNotice, setVoiceSavedNotice] = useState(false);
  const [isVoiceCallActive, setIsVoiceCallActive] = useState(false);

  const player = useVoicePlayer();
  const voiceProfile = resolveAgentVoiceProfile(agent);
  const mood = computeAgentMood(agent, tasks, approvals);
  const MoodIcon = MOOD_ICONS[mood.key];
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const lastJumpContextRef = useRef<{ agentId: string; tab: DrawerTab } | null>(null);

  const agentRoster = useMemo(
    () => (allAgents.length > 0 ? allAgents : [agent, ...directors]),
    [allAgents, agent, directors]
  );

  const agentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agentRoster) map.set(a.id, a.name);
    map.set('matt', 'Matt');
    return map;
  }, [agentRoster]);

  const inFlightChatTrace = useMemo<HandoffTrace | null>(() => {
    if (!isSending) return null;
    const lastChoMsg = [...messages].reverse().find((m) => m.sender === 'cho');
    const promptText = lastChoMsg?.text?.trim() || 'Active collaboration thread';
    const startedAt = lastChoMsg?.timestamp || new Date().toISOString();
    const taskId = `live_chat_${agent.id}`;
    const mentionedCollabs = agentRoster.filter((candidate) => {
      if (candidate.id === 'cho' || candidate.id === agent.id) return false;
      const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escapedName}\\b`, 'i').test(promptText);
    });

    const packets: HandoffPacket[] = mentionedCollabs.slice(0, 4).map((collab, idx) => ({
      handoff_id: `${taskId}_hop_${idx + 1}`,
      task_id: taskId,
      depth: 1,
      sequence: idx + 1,
      from_agent: agent.id,
      from_agent_name: agent.name,
      from_house: agent.department || 'Coordinating House',
      to_agent: collab.id,
      to_agent_name: collab.name,
      to_house: collab.department || 'Collaborating House',
      objective: promptText,
      kb_refs: ['KB-SOP-01', 'KB-SOP-02'],
      verified_facts: [],
      constraints: ['Internal collaboration · CHO-gated external actions (KB-GOV-01)'],
      expected_output_schema: {
        format: 'structured_json',
        required_fields: ['summary', 'verified_claims', 'deliverable_markdown'],
      },
      status: idx === 0 ? 'running' : 'queued',
      started_at: startedAt,
    }));

    return {
      task_id: taskId,
      root_agent: agent.id,
      coordinating_director: agent.id,
      coordinating_director_name: agent.name,
      status: 'running',
      total_hops: packets.length,
      max_hops: 6,
      max_depth: 2,
      started_at: startedAt,
      packets,
      staged_kb_proposal_ids: [],
    };
  }, [agent.department, agent.id, agent.name, agentRoster, isSending, messages]);

  // Aggregate all task threads (live active chat, direct chat, cross-agent chats, and formal tasks) involving this agent
  const agentThreads = useMemo<AgentThreadItem[]>(() => {
    const byTaskId = new Map<string, AgentThreadItem>();

    if (inFlightChatTrace) {
      const lastChoMsg = [...messages].reverse().find((m) => m.sender === 'cho');
      byTaskId.set(inFlightChatTrace.task_id, {
        taskId: inFlightChatTrace.task_id,
        title: lastChoMsg?.text?.trim() || `Collaborating with ${agent.name}...`,
        originType: 'direct_chat',
        originLabel: 'Live Chat',
        agentRoleLabel: 'Coordinating',
        timestampMs: Date.now() + 1000,
        crossHouseCount: inFlightChatTrace.packets.filter(isCrossHousePacket).length,
        outcomeSummary: `${agent.name} is coordinating internal handoffs and synthesizing verified outputs...`,
        trace: inFlightChatTrace,
      });
    }

    // 1. Direct chat messages in this agent's drawer
    for (let i = 0; i < messages.length; i += 1) {
      const m = messages[i];
      if (!m.handoffTrace) continue;
      let promptTitle = 'Direct collaboration thread';
      for (let j = i - 1; j >= 0; j -= 1) {
        if (messages[j].sender === 'cho' && messages[j].text.trim()) {
          promptTitle = messages[j].text.trim();
          break;
        }
      }
      const trace = m.handoffTrace;
      const crossHouseCount = trace.packets.filter(isCrossHousePacket).length;
      const ts = Date.parse(trace.started_at || m.timestamp) || Date.now();
      byTaskId.set(trace.task_id, {
        taskId: trace.task_id,
        title: promptTitle,
        originType: 'direct_chat',
        originLabel: 'Direct Chat',
        agentRoleLabel: resolveAgentRoleInTrace(agent.id, trace),
        timestampMs: ts,
        crossHouseCount,
        outcomeSummary:
          trace.error_banner || summarizeText(m.text),
        trace,
      });
    }

    // 2. Cross-chat threads initiated in another villager's drawer where this agent participated
    for (const [chatOwnerId, threadMsgs] of Object.entries(allChatHistory)) {
      if (chatOwnerId === agent.id || !Array.isArray(threadMsgs)) continue;
      for (let i = 0; i < threadMsgs.length; i += 1) {
        const m = threadMsgs[i];
        if (!m.handoffTrace) continue;
        const trace = m.handoffTrace;
        if (byTaskId.has(trace.task_id)) continue;
        if (!involvesAgentCheck(agent.id, trace)) continue;

        let promptTitle = 'Cross-house chat collaboration';
        for (let j = i - 1; j >= 0; j -= 1) {
          if (threadMsgs[j].sender === 'cho' && threadMsgs[j].text.trim()) {
            promptTitle = threadMsgs[j].text.trim();
            break;
          }
        }
        const ownerName = agentNameById.get(chatOwnerId) ?? chatOwnerId;
        const crossHouseCount = trace.packets.filter(isCrossHousePacket).length;
        const ts = Date.parse(trace.started_at || m.timestamp) || Date.now();
        byTaskId.set(trace.task_id, {
          taskId: trace.task_id,
          title: promptTitle,
          originType: 'cross_chat',
          originLabel: `Via ${ownerName} Chat`,
          agentRoleLabel: resolveAgentRoleInTrace(agent.id, trace),
          timestampMs: ts,
          crossHouseCount,
          outcomeSummary:
            trace.error_banner || summarizeText(m.text),
          trace,
        });
      }
    }

    // 3. Formal VillageTask threads carrying a handoffTrace
    for (const t of tasks) {
      if (!t.handoffTrace) continue;
      const trace = t.handoffTrace;
      if (byTaskId.has(trace.task_id)) continue;
      const involved =
        agent.id === 'matt' ||
        t.assignedDirectorId === agent.id ||
        t.assignedWorkerId === agent.id ||
        (t.collaboratorIds ?? []).includes(agent.id) ||
        involvesAgentCheck(agent.id, trace);
      if (!involved) continue;

      const crossHouseCount = trace.packets.filter(isCrossHousePacket).length;
      const ts = Date.parse(trace.started_at || t.createdAt) || Date.now();
      byTaskId.set(trace.task_id, {
        taskId: trace.task_id,
        title: t.prompt,
        originType: 'formal_task',
        originLabel: 'Assigned Task',
        formalTaskId: t.id,
        agentRoleLabel: resolveAgentRoleInTrace(agent.id, trace),
        timestampMs: ts,
        crossHouseCount,
        outcomeSummary:
          trace.error_banner ||
          t.orchestrationError ||
          summarizeText(t.summary || t.reportMarkdown),
        trace,
      });
    }

    return Array.from(byTaskId.values()).sort(
      (a, b) => b.timestampMs - a.timestampMs
    );
  }, [agent.id, agent.name, agentNameById, allChatHistory, inFlightChatTrace, messages, tasks]);

  const hasActiveCollaboration = useMemo(
    () =>
      Boolean(inFlightChatTrace) ||
      agentThreads.some(
        (th) =>
          th.trace.status === 'running' ||
          th.trace.packets.some((p) => p.status === 'running' || p.status === 'queued')
      ),
    [agentThreads, inFlightChatTrace]
  );

  const crossHouseThreadsCount = useMemo(
    () => agentThreads.filter((th) => th.crossHouseCount > 0).length,
    [agentThreads]
  );

  const totalCrossHouseHops = useMemo(
    () => agentThreads.reduce((sum, th) => sum + th.crossHouseCount, 0),
    [agentThreads]
  );

  const filteredThreads = useMemo(
    () =>
      traceFilter === 'cross_house'
        ? agentThreads.filter((th) => th.crossHouseCount > 0)
        : agentThreads,
    [agentThreads, traceFilter]
  );

  const activeThread = useMemo(() => {
    if (filteredThreads.length === 0) return null;
    if (selectedTraceTaskId) {
      const found = filteredThreads.find((t) => t.taskId === selectedTraceTaskId);
      if (found) return found;
    }
    return filteredThreads[0];
  }, [filteredThreads, selectedTraceTaskId]);

  const latestThread = agentThreads[0] ?? null;

  // Reset live voice call and sync instructions when switching between villagers
  useEffect(() => {
    setIsVoiceCallActive(false);
    setEditingInstructions(agent.instructions);
    setTraceFilter('all');
  }, [agent.id, agent.instructions]);

  // Honor external requests (e.g. clicking a handoff arc in the town map) to focus the Handoff Trace tab
  useEffect(() => {
    if (focusedTraceNonce > 0) {
      setTab(initialTab);
      setSelectedTraceTaskId(focusedTraceTaskId ?? null);
    }
  }, [focusedTraceNonce, focusedTraceTaskId, initialTab]);

  // Honor external prefill requests (e.g. "Ask Daniel" from a Google Chat space/thread)
  useEffect(() => {
    if (prefillNonce > 0 && prefillDraft) {
      setTab('chat');
      setInput(prefillDraft);
    }
  }, [prefillNonce, prefillDraft]);

  // Open at the bottom (newest message) on mount, agent switch, or tab switch; smooth-scroll on new messages
  useLayoutEffect(() => {
    if (tab !== 'chat') {
      lastJumpContextRef.current = { agentId: agent.id, tab };
      return;
    }
    const el = chatContainerRef.current;
    if (!el) return;

    const prev = lastJumpContextRef.current;
    const isInitialOrContextSwitch =
      !prev || prev.agentId !== agent.id || prev.tab !== 'chat';
    lastJumpContextRef.current = { agentId: agent.id, tab };

    if (isInitialOrContextSwitch) {
      el.scrollTop = el.scrollHeight;
      const rafId = window.requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
      });
      return () => window.cancelAnimationFrame(rafId);
    }

    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [agent.id, tab, messages.length, isSending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    setInput('');
    await onSendMessage(agent.id, trimmed);
  };

  const handleSaveInstructions = async () => {
    await onSaveInstructions(agent.id, editingInstructions);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const handleChangeVoice = async (nextVoice: AgentVoiceName) => {
    await onSaveVoice(agent.id, nextVoice);
    setVoiceSavedNotice(true);
    setTimeout(() => setVoiceSavedNotice(false), 2000);
  };

  const crossHouseStarterPrompt =
    agent.id === 'matt'
      ? 'Have Kieran and Eli spec a cross-house webhook retry SOP and stage a KB-SOP proposal'
      : agent.id === 'aria' || agent.id === 'worker_aria'
        ? 'Collaborate with Zoe and Eli across Houses to draft a KB-RES brief on multi-agent verification'
        : agent.id === 'kieran'
          ? 'Coordinate with Toby (Operations) and Eli (Systems & Dev) to spec an idempotent API handoff checklist'
          : `Coordinate with Kieran and Aria across Houses to align ${agent.department} handoff criteria`;

  const quickPrompts =
    agent.id === 'matt'
      ? [
          'Have Kieran and Eli spec a webhook retry SOP and propose a KB entry',
          'Bring Layla here',
          'What is the village working on?',
        ]
      : agent.id === 'daniel'
        ? [
            (workspaceBriefing.pinnedChats?.length ?? 0) > 0
              ? `Analyze our pinned Google Chat "${workspaceBriefing.pinnedChats![0].label}", summarize key decisions, and extract action items`
              : 'List my Google Chat spaces and read the latest messages & threads in the most active space',
            'Read a specific Google Chat space or thread and coordinate any technical follow-ups with Kieran',
            'Summarize my unread Gmail & Calendar and stage any needed reply drafts',
          ]
        : agent.id === 'aria' || agent.id === 'worker_aria'
          ? [
              'Work with Zoe and Eli to propose a KB-RES brief on AI agent reliability',
              'What verified briefs are in our Knowledge Base?',
              'Audit house notes for duplicate rules',
            ]
          : agent.id === 'worker_devon' || agent.id === 'devon'
            ? [
                'Have Kieran and Eli spec an idempotent API handoff SOP and propose a KB-SOP entry',
                'Which KB-SOP handoff templates govern our houses?',
                'Draft a cross-house handoff checklist',
              ]
            : agent.id === 'kieran'
              ? [
                  'Collaborate with Toby and Eli to spec a resilient webhook pipeline & stage a KB-SOP proposal',
                  'Review API auth, rate limits & schema mapping',
                  'Draft an end-to-end systems integration spec',
                ]
              : ['Give me a status update', 'Which KB ground-truth rules apply to your house?'];

  const renderThreadStatusInline = (status: HandoffTrace['status']) => {
    if (status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300 whitespace-nowrap shrink-0">
          <CheckCircle2 className="w-3 h-3 shrink-0" />
          <span>Verified</span>
        </span>
      );
    }
    if (status === 'running') {
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 whitespace-nowrap shrink-0">
          <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
          <span>Running</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-300 whitespace-nowrap shrink-0">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>{status === 'aborted_cap_reached' ? 'Halted' : 'Failed'}</span>
      </span>
    );
  };

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-30 w-[460px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          {agent.id === 'matt' ? (
            <img
              src={mattPortraitImg}
              alt="Matt"
              referrerPolicy="no-referrer"
              className="h-10 w-10 rounded-lg object-cover border border-amber-500/40 shrink-0"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-950/70 shrink-0 overflow-hidden">
              <CharacterSpriteBadge agent={agent} size={40} />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white truncate">{agent.name}</h2>
            <p className="text-xs text-slate-400 truncate">
              {agent.title} · {voiceProfile.timbreLabel}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => {
              setTab('chat');
              setIsVoiceCallActive((v) => !v);
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isVoiceCallActive
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'border border-slate-700 bg-slate-800 text-slate-100 hover:border-amber-500/60 hover:text-amber-300'
            }`}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>{isVoiceCallActive ? 'Live Call' : 'Voice Call'}</span>
          </button>
          <button
            onClick={onClose}
            aria-label="Close agent panel"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Current Activity / Busy With + Mood Indicator */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60 px-4 py-2 text-xs text-slate-300">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Activity className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="truncate">
            <span className="text-slate-400">Busy with: </span>
            <span className="text-slate-100 font-medium">
              {agent.currentActivity || formatFallbackActivity(agent)}
            </span>
          </span>
        </div>

        <div
          className="flex items-center gap-1.5 shrink-0"
          title={`Mood: ${mood.label} — ${mood.reason}`}
          aria-label={`Mood: ${mood.label}. ${mood.reason}`}
        >
          <MoodIcon className={`h-3.5 w-3.5 shrink-0 ${mood.colorClass}`} aria-hidden="true" />
          <span className={`text-[11px] font-semibold whitespace-nowrap ${mood.colorClass}`}>
            {mood.label}
          </span>
          <span className="inline-flex items-center gap-0.5 shrink-0" aria-hidden="true">
            {[0, 1, 2].map((idx) => (
              <svg
                key={idx}
                viewBox="0 0 12 12"
                className={`h-2.5 w-2.5 ${
                  idx < mood.sparksLit ? mood.sparkColorClass : 'text-slate-700'
                }`}
                fill="currentColor"
              >
                <path d="M6 0.5L7.35 4.65L11.5 6L7.35 7.35L6 11.5L4.65 7.35L0.5 6L4.65 4.65Z" />
              </svg>
            ))}
          </span>
        </div>
      </div>

      {/* Real-Time Gemini Live Voice Call Panel */}
      {isVoiceCallActive && (
        <LiveVoiceCallPanel
          agent={agent}
          bearerToken={bearerToken}
          onEndCall={() => setIsVoiceCallActive(false)}
          onTurnCommitted={(userText, agentText) =>
            onCommitLiveVoiceTurn(agent.id, userText, agentText)
          }
          onAgentSpeechBubble={(text) => onAgentSpeechBubble?.(agent.id, text)}
        />
      )}

      {/* Segmented Tabs + Auto-Speak Toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/50 px-3.5 py-2">
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              tab === 'chat' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Direct Chat
          </button>
          <button
            type="button"
            onClick={() => setTab('trace')}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'trace'
                ? 'bg-slate-800 text-white'
                : hasActiveCollaboration
                  ? 'border border-amber-500/40 bg-amber-950/25 text-amber-200 handoff-node-breathing'
                  : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>Handoff Trace ({agentThreads.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingInstructions(agent.instructions);
              setTab('dossier');
            }}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
              tab === 'dossier' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Folder &amp; Voice ({agent.notes.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => voicePlayer.toggleAutoSpeakReplies()}
          title="Automatically read new agent replies aloud in their own voice"
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            player.autoSpeakReplies
              ? 'border-amber-500/50 bg-amber-950/50 text-amber-300'
              : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-slate-200'
          }`}
        >
          {player.autoSpeakReplies ? (
            <Volume2 className="h-3 w-3 text-amber-400" />
          ) : (
            <VolumeX className="h-3 w-3" />
          )}
          <span>{player.autoSpeakReplies ? 'Auto-Read On' : 'Auto-Read'}</span>
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          {/* Matt Summon Bar */}
          {agent.id === 'matt' && (
            <div className="border-b border-slate-800 bg-slate-950/40 px-4 py-2.5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="flex items-center gap-1.5 font-medium text-slate-300">
                  <PhoneCall className="h-3.5 w-3.5 text-sky-400" />
                  <span>Call a Director over to you</span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {directors.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => onSummonDirector(d.id)}
                    className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Daniel Workspace Indicator */}
          {agent.id === 'daniel' && (
            <div className="border-b border-slate-800 bg-slate-950/40 px-4 py-2 text-xs text-slate-300 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {workspaceBriefing.connected ? (
                  <span className="text-emerald-300 truncate tabular-nums">
                    Synced · {workspaceBriefing.unreadCount} unread ·{' '}
                    {workspaceBriefing.upcomingEvents.length} events (
                    {calendarWriteAccess && workspaceBriefing.calendarStatus === 'connected_write'
                      ? 'Cal Write'
                      : 'Cal Read-Only'}
                    ) · {(workspaceBriefing.chatSpaces ?? []).length} spaces
                    {(workspaceBriefing.pinnedChats?.length ?? 0) > 0
                      ? ` · ${workspaceBriefing.pinnedChats!.length} pinned`
                      : ''}
                  </span>
                ) : isGoogleConnected ? (
                  <span className="text-slate-300 truncate">
                    Auto-syncing Gmail, Calendar, Chat, Docs &amp; Drive...
                  </span>
                ) : (
                  <span className="text-amber-300">
                    Google Workspace not signed in yet. Sign in from the top bar to connect Gmail, Calendar, Chat, Docs &amp; Drive.
                  </span>
                )}
                <div className="flex items-center gap-1.5 shrink-0">
                  {onOpenWorkspaceChat && (
                    <button
                      type="button"
                      onClick={onOpenWorkspaceChat}
                      className="inline-flex items-center gap-1 rounded-md border border-violet-500/40 bg-violet-950/40 px-2 py-1 text-[11px] font-medium text-violet-200 hover:border-violet-400 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <MessageSquare className="h-3 w-3 text-violet-300" />
                      <span>Chat Reader</span>
                    </button>
                  )}
                  {onOpenWorkspace && (
                    <button
                      type="button"
                      onClick={onOpenWorkspace}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Workspace
                    </button>
                  )}
                  {isGoogleConnected &&
                    calendarWriteAccess &&
                    workspaceBriefing.calendarStatus !== 'connected_write' &&
                    onGrantCalendarWriteConsent && (
                      <button
                        type="button"
                        onClick={() => void onGrantCalendarWriteConsent().catch(() => {})}
                        className="rounded-md bg-sky-500 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-sky-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Grant Calendar Write
                      </button>
                    )}
                  {isGoogleConnected &&
                    (workspaceBriefing.chatStatus === 'needs_consent' ||
                      workspaceBriefing.docsStatus === 'needs_consent' ||
                      workspaceBriefing.driveStatus === 'needs_consent') &&
                    onGrantWorkspaceConsent && (
                      <button
                        type="button"
                        onClick={() => void onGrantWorkspaceConsent()}
                        className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Grant Access
                      </button>
                    )}
                  {isGoogleConnected && (
                    <button
                      type="button"
                      onClick={() => void onSyncWorkspace()}
                      title="Refresh Google Workspace now"
                      aria-label="Refresh Google Workspace now"
                      className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {(workspaceBriefing.pinnedChats?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-violet-200">
                  <Pin className="h-3 w-3 text-violet-300 shrink-0" />
                  <span className="text-slate-400">Active Chat Context:</span>
                  {workspaceBriefing.pinnedChats!.slice(0, 3).map((pc) => (
                    <span
                      key={pc.id}
                      className="rounded border border-slate-700/80 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 truncate max-w-[200px]"
                      title={`${pc.label} (${pc.messages.length} msgs)`}
                    >
                      {pc.label} ({pc.messages.length})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Latest Thread Activity Callout in Direct Chat */}
          {latestThread && (
            <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-950/65 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <GitBranch className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="truncate text-slate-300 font-mono tabular-nums text-[11px]">
                  Latest trace:{' '}
                  <span className="text-slate-100 font-semibold">
                    {latestThread.trace.packets.length} hop
                    {latestThread.trace.packets.length === 1 ? '' : 's'}
                  </span>
                  {latestThread.crossHouseCount > 0 && (
                    <span className="text-amber-300">
                      {' '}
                      · {latestThread.crossHouseCount} cross-house
                    </span>
                  )}
                </span>
                {renderThreadStatusInline(latestThread.trace.status)}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSelectedTraceTaskId(latestThread.taskId);
                  setTab('trace');
                }}
                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>Inspect Trace</span>
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Chat Messages */}
          <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400 leading-relaxed space-y-2.5">
                <p>
                  Start a conversation with {agent.name}, ask {agent.name} to collaborate across Houses (recorded in{' '}
                  <strong className="font-semibold text-slate-200">Handoff Trace</strong>), or click{' '}
                  <strong className="font-semibold text-slate-200">Voice Call</strong> above to talk in real time.
                </p>
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-500 truncate">
                    {voiceProfile.timbreLabel}
                  </span>
                  <SpeakButton
                    itemId={`preview_empty_${agent.id}`}
                    label={`Hear ${agent.name}`}
                    turn={{
                      agentId: agent.id,
                      speakerName: agent.name,
                      title: agent.title,
                      department: agent.department,
                      voiceName: agent.voiceName,
                      text: voiceProfile.sampleLine,
                    }}
                  />
                </div>
              </div>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'cho' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                    m.sender === 'cho'
                      ? 'bg-amber-500 text-slate-950 font-medium'
                      : 'bg-slate-800 text-slate-100 border border-slate-700/70'
                  }`}
                >
                  {m.sender === 'cho' ? (
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  ) : (
                    <FormattedMarkdown compact content={m.text} />
                  )}
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-700 space-y-1">
                      {m.sources.map((s) => (
                        <a
                          key={s.uri}
                          href={s.uri}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-[11px] text-sky-300 hover:underline truncate"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" />
                          <span className="truncate">{s.title}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {m.sender === 'agent' && (
                    <div className="mt-2 pt-1.5 border-t border-slate-700/70 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400 truncate">
                        {voiceProfile.voiceName} voice
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {onPromoteToTask && (
                          <button
                            type="button"
                            onClick={() => {
                              const cleaned = m.text.replace(/\s+/g, ' ').trim();
                              const snippet =
                                cleaned.length > 220 ? `${cleaned.slice(0, 217)}...` : cleaned;
                              onPromoteToTask(
                                `Follow up with ${agent.name} (${agent.department}): ${snippet}`
                              );
                            }}
                            title="Load into the Assign Task bar for a full deliverable"
                            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-300 hover:underline cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <span>Assign as Task</span>
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        )}
                        <SpeakButton
                          variant="inline"
                          itemId={`chat_msg_${m.id}`}
                          label="Listen"
                          turn={{
                            agentId: agent.id,
                            speakerName: agent.name,
                            title: agent.title,
                            department: agent.department,
                            voiceName: agent.voiceName,
                            text: m.text,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {m.sender === 'agent' &&
                    onOpenApprovals &&
                    (m.approvalId || (m.kbProposalIds && m.kbProposalIds.length > 0)) && (
                      <div className="mt-2 pt-1.5 border-t border-slate-700/70 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-amber-300 font-medium">
                          {m.kbProposalIds && m.kbProposalIds.length > 0
                            ? `${m.kbProposalIds.length} KB proposal(s) staged for CHO review`
                            : 'Action staged for CHO approval'}
                        </span>
                        <button
                          type="button"
                          onClick={onOpenApprovals}
                          className="rounded bg-amber-500 px-2 py-0.5 font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Open Decision Packet
                        </button>
                      </div>
                    )}
                </div>

                {m.sender === 'agent' && m.handoffTrace && (
                  <div className="mt-2 w-full max-w-[96%]">
                    <HandoffTracePanel
                      compact
                      trace={m.handoffTrace}
                      agents={agentRoster}
                      highlightAgentId={agent.id}
                      isVisualizedInTown={activeTownTraceTaskId === m.handoffTrace.task_id}
                      onVisualizeInTown={onVisualizeTraceInTown}
                      onSelectAgent={onSelectAgent}
                      onOpenKbProposals={onOpenApprovals}
                      onInspectInTraceTab={() => {
                        setSelectedTraceTaskId(m.handoffTrace!.task_id);
                        setTab('trace');
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            {isSending && inFlightChatTrace && (
              <div className="space-y-2 w-full max-w-[96%]">
                <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                  <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
                  <span>
                    {agent.name} is coordinating internal handoffs &amp; synthesizing...
                  </span>
                </div>
                <HandoffTracePanel
                  compact
                  isActive
                  trace={inFlightChatTrace}
                  agents={agentRoster}
                  highlightAgentId={agent.id}
                  onSelectAgent={onSelectAgent}
                  onInspectInTraceTab={() => {
                    setSelectedTraceTaskId(inFlightChatTrace.task_id);
                    setTab('trace');
                  }}
                />
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {quickPrompts.map((qp) => (
              <button
                key={qp}
                onClick={() => setInput(qp)}
                className="text-[11px] text-slate-400 hover:text-amber-300 underline decoration-slate-700 underline-offset-2 cursor-pointer text-left"
              >
                {qp}
              </button>
            ))}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-slate-800 p-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${agent.name}...`}
              className="flex-1 min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
            {onPromoteToTask && input.trim() && (
              <button
                type="button"
                onClick={() => {
                  const draft = input.trim();
                  setInput('');
                  onPromoteToTask(draft);
                }}
                title="Send to Matt's formal Assign Task bar instead of quick chat"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-950/40 px-2.5 py-2 text-[11px] font-medium text-amber-200 hover:bg-amber-950/70 cursor-pointer whitespace-nowrap shrink-0"
              >
                <span>As Task</span>
                <ArrowUpRight className="h-3 w-3" />
              </button>
            )}
            <button
              type="submit"
              disabled={isSending || !input.trim()}
              className="inline-flex items-center justify-center rounded-lg bg-amber-500 p-2 text-slate-950 hover:bg-amber-400 disabled:opacity-40 cursor-pointer shrink-0"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </>
      ) : tab === 'trace' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
          {/* Panel Header & Cross-House Filter */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-slate-100">
                Agent Activity / Handoff Trace
              </h3>
              <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                {agentThreads.length} thread{agentThreads.length === 1 ? '' : 's'} ·{' '}
                <span className={totalCrossHouseHops > 0 ? 'text-amber-300' : 'text-slate-400'}>
                  {totalCrossHouseHops} cross-house handoff
                  {totalCrossHouseHops === 1 ? '' : 's'}
                </span>
              </p>
            </div>

            {agentThreads.length > 0 && (
              <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-950 p-0.5">
                <button
                  type="button"
                  onClick={() => setTraceFilter('all')}
                  className={`rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    traceFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({agentThreads.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTraceFilter('cross_house')}
                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    traceFilter === 'cross_house'
                      ? 'bg-slate-800 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowRightLeft className="w-3 h-3 text-amber-400" />
                  <span>Cross-House ({crossHouseThreadsCount})</span>
                </button>
              </div>
            )}
          </div>

          {isSending && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">
              <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin shrink-0" />
              <span>
                Active handoff thread in progress with {agent.name}...
              </span>
            </div>
          )}

          {agentThreads.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <GitBranch className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-slate-200">
                    No multi-agent handoff traces involving {agent.name} yet
                  </p>
                  <p className="text-slate-400 leading-relaxed">
                    When {agent.name} delegates work to Guild Specialists or collaborates across Houses under{' '}
                    <span className="font-mono text-slate-300">KB-SOP-01</span> &amp;{' '}
                    <span className="font-mono text-slate-300">KB-SOP-02</span>, the full agent sequence, cross-house transitions, and verified hop outcomes appear here.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInput(crossHouseStarterPrompt);
                  setTab('chat');
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Draft Cross-House Collaboration</span>
              </button>
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4 space-y-2 text-xs">
              <p className="font-semibold text-slate-200">
                No cross-house handoffs in {agent.name}&apos;s recorded threads
              </p>
              <p className="text-slate-400">
                Existing traces executed within a single House. Switch to All ({agentThreads.length}) to inspect intra-house specialist handoffs.
              </p>
              <button
                type="button"
                onClick={() => setTraceFilter('all')}
                className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
              >
                Show All Threads
              </button>
            </div>
          ) : (
            <>
              {/* Task Thread Selector */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-300">
                    Select Task Thread
                  </span>
                  <span className="font-mono tabular-nums">
                    {filteredThreads.length} recorded
                  </span>
                </div>

                <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/65 max-h-44 overflow-y-auto">
                  {filteredThreads.map((th) => {
                    const isSelected = activeThread?.taskId === th.taskId;
                    return (
                      <button
                        key={th.taskId}
                        type="button"
                        onClick={() => setSelectedTraceTaskId(th.taskId)}
                        className={`w-full px-3 py-2 text-left transition-colors cursor-pointer flex flex-col gap-1 ${
                          isSelected
                            ? 'bg-slate-800/80 text-white'
                            : 'hover:bg-slate-900/70 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium truncate">
                            {th.title}
                          </span>
                          {renderThreadStatusInline(th.trace.status)}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-400">
                          <span>{th.originLabel}</span>
                          <span>·</span>
                          <span>{th.agentRoleLabel}</span>
                          <span>·</span>
                          <span>
                            {th.trace.packets.length} hop
                            {th.trace.packets.length === 1 ? '' : 's'}
                          </span>
                          {th.crossHouseCount > 0 && (
                            <>
                              <span>·</span>
                              <span className="text-amber-300 font-medium">
                                {th.crossHouseCount} cross-house
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Active Thread Context + Visual Sequence & Hop Outcomes */}
              {activeThread && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[11px] font-mono tabular-nums text-slate-400">
                          {activeThread.originLabel} · {agent.name} ({activeThread.agentRoleLabel})
                        </p>
                        <p className="text-xs font-semibold text-slate-100 leading-snug">
                          {activeThread.title}
                        </p>
                      </div>
                      {activeThread.formalTaskId && onOpenTaskReport && (
                        <button
                          type="button"
                          onClick={() => onOpenTaskReport(activeThread.formalTaskId!)}
                          className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <span>Deliverable</span>
                          <ArrowUpRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div className="border-t border-slate-800/80 pt-2 text-[11px] text-slate-300 leading-relaxed">
                      <span className="font-semibold text-slate-400">
                        Thread Outcome:{' '}
                      </span>
                      {activeThread.outcomeSummary}
                    </div>
                  </div>

                  <HandoffTracePanel
                    key={activeThread.taskId}
                    isActive={activeThread.trace.status === 'running'}
                    trace={activeThread.trace}
                    agents={agentRoster}
                    highlightAgentId={agent.id}
                    isVisualizedInTown={activeTownTraceTaskId === activeThread.taskId}
                    onVisualizeInTown={
                      activeThread.trace.status === 'running'
                        ? undefined
                        : onVisualizeTraceInTown
                    }
                    onSelectAgent={(targetAgent) => {
                      if (targetAgent.id !== agent.id) {
                        onSelectAgent?.(targetAgent);
                      }
                    }}
                    onOpenKbProposals={onOpenApprovals}
                  />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Voice Persona Configuration */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-amber-400" />
                <span>Voice Persona</span>
              </label>
              <div className="flex items-center gap-2">
                {voiceSavedNotice && <span className="text-[11px] text-emerald-400">Saved</span>}
                <SpeakButton
                  itemId={`preview_dossier_${agent.id}_${voiceProfile.voiceName}`}
                  label="Preview Voice"
                  turn={{
                    agentId: agent.id,
                    speakerName: agent.name,
                    title: agent.title,
                    department: agent.department,
                    voiceName: voiceProfile.voiceName,
                    text: voiceProfile.sampleLine,
                  }}
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Used whenever {agent.name} reads reports, chat replies, or speaks with you on a Live Voice Call.
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {AGENT_VOICE_OPTIONS.map((opt) => {
                const isSelected = voiceProfile.voiceName === opt.voiceName;
                return (
                  <button
                    key={opt.voiceName}
                    type="button"
                    onClick={() => void handleChangeVoice(opt.voiceName)}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-amber-500/70 bg-slate-800/90 text-white'
                        : 'border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">
                        {opt.voiceName} · <span className="font-normal text-slate-400">{opt.timbre}</span>
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">{opt.description}</p>
                    </div>
                    {isSelected && (
                      <span className="text-[11px] font-medium text-amber-400 shrink-0">Active</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-amber-400" />
                <span>Agent Instructions (Folder File)</span>
              </label>
              {savedNotice && <span className="text-[11px] text-emerald-400">Saved</span>}
            </div>
            <textarea
              rows={5}
              value={editingInstructions}
              onChange={(e) => setEditingInstructions(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-xs text-slate-200 leading-relaxed focus:border-amber-500 focus:outline-none"
            />
            <button
              onClick={handleSaveInstructions}
              className="mt-2 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 cursor-pointer"
            >
              Save Instructions
            </button>
          </div>

          <div className="border-t border-slate-800 pt-3">
            <h3 className="text-xs font-semibold text-slate-200 mb-2">
              Persistent Memory &amp; Cross-Agent Notes
            </h3>
            {agent.notes.length === 0 ? (
              <p className="text-xs text-slate-500">No notes logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {agent.notes.map((n, idx) => (
                  <li
                    key={`${idx}-${n.slice(0, 12)}`}
                    className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300 leading-relaxed"
                  >
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
