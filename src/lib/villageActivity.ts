import { VILLAGE_BUILDINGS, worldToTile } from '../data/villageWorld.ts';
import type {
  Agent,
  ApprovalItem,
  ChatMessage,
  GroundedWorkAnchor,
  KnowledgeEntry,
  KnowledgeProposal,
  VillageActivityEvent,
  VillageTask,
  WorkspaceBriefing,
} from '../types/village.ts';

/**
 * Maps world pixel coordinates to a human-readable village landmark or pathway.
 */
export function describeVillageLocation(px: number, py: number): string {
  const tile = worldToTile(px, py);

  // Check proximity to any building gate / courtyard
  for (const b of VILLAGE_BUILDINGS) {
    const nearDoor = Math.abs(tile.x - b.doorTileX) <= 2 && Math.abs(tile.y - b.doorTileY) <= 2;
    const nearYard = Math.abs(tile.x - b.yardTileX) <= 2 && Math.abs(tile.y - b.yardTileY) <= 2;
    const insideBounds =
      tile.x >= b.tileX - 1 &&
      tile.x <= b.tileX + b.widthTiles &&
      tile.y >= b.tileY - 1 &&
      tile.y <= b.tileY + b.heightTiles;
    if (nearDoor || nearYard || insideBounds) {
      return `${b.name} Courtyard`;
    }
  }

  // Bridges over the eastern brook
  if (tile.x >= 39 && tile.y >= 9 && tile.y <= 12) {
    return 'Upper Brook Bridge';
  }
  if (tile.x >= 39 && tile.y >= 18 && tile.y <= 21) {
    return 'Lower Brook Bridge';
  }

  // Central Cobblestone Fountain Plaza
  const distPlaza = Math.hypot(tile.x - 22.5, tile.y - 14.8);
  if (distPlaza <= 6.2) {
    return 'Town Square Plaza';
  }

  if (tile.y >= 26) {
    return 'Southern Promenade';
  }
  if (tile.x <= 16) {
    return 'Western Avenue';
  }
  if (tile.x >= 28) {
    return 'Eastern Avenue';
  }
  return 'Village Crossroads';
}

/**
 * Formats a concise human-readable state label for an agent.
 */
export function formatLiveStateLabel(agent: Agent): {
  category: 'working' | 'talking' | 'moving' | 'standby';
  label: string;
} {
  if (agent.state === 'phone_call') {
    return { category: 'talking', label: 'On Dispatch Call' };
  }
  if (agent.state === 'chatting' || (agent.speechBubble && agent.speechTimer > 0)) {
    return { category: 'talking', label: 'In Conversation' };
  }
  if (agent.state === 'working_inside' || Boolean(agent.busyUntil && agent.busyUntil > Date.now())) {
    return { category: 'working', label: 'Working Inside' };
  }
  if (agent.state === 'summoned') {
    return { category: 'moving', label: 'Walking to You' };
  }
  if (agent.state === 'town_hall_seated') {
    return { category: 'talking', label: 'In Town Hall' };
  }
  if (agent.isMoving || agent.path.length > 0) {
    return {
      category: 'moving',
      label: agent.id === 'matt' ? 'Following You' : 'Strolling Standby',
    };
  }
  if (agent.id === 'matt') {
    return { category: 'standby', label: 'At Your Side' };
  }
  return {
    category: 'standby',
    label: agent.role === 'worker' ? 'Quiet Standby' : 'Courtyard Standby',
  };
}

export type AgentAvailabilityLevel = 'available' | 'working' | 'busy';

export interface AgentAvailabilityInfo {
  level: AgentAvailabilityLevel;
  label: 'Available' | 'Working' | 'Busy';
  detail: string;
}

const IN_FLIGHT_TASK_STATUSES = new Set<VillageTask['status']>([
  'queued',
  'matt_routing',
  'worker_executing',
  'director_review',
  'advisor_escalated',
]);

/**
 * Resolves an agent's at-a-glance availability badge state ('available' | 'working' | 'busy').
 */
export function resolveAgentAvailability(
  agent: Agent,
  options: {
    tasks?: VillageTask[];
    approvals?: ApprovalItem[];
    busyChatAgentId?: string | null;
  } = {}
): AgentAvailabilityInfo {
  const { tasks = [], approvals = [], busyChatAgentId = null } = options;

  const inFlightTasks = tasks.filter((t) => {
    if (!IN_FLIGHT_TASK_STATUSES.has(t.status)) return false;
    if (t.id === agent.activeTaskId) return true;
    if (t.assignedDirectorId === agent.id || t.assignedWorkerId === agent.id) return true;
    if (t.collaboratorIds?.includes(agent.id)) return true;
    if (agent.id === 'matt' && t.status === 'matt_routing') return true;
    if (
      t.handoffTrace?.status === 'running' &&
      t.handoffTrace.packets.some(
        (p) =>
          (p.status === 'running' || p.status === 'queued') &&
          (p.from_agent === agent.id || p.to_agent === agent.id)
      )
    ) {
      return true;
    }
    return false;
  });

  const pendingApprovalsCount = approvals.filter(
    (a) => a.status === 'pending' && a.directorId === agent.id
  ).length;

  if (busyChatAgentId && busyChatAgentId === agent.id) {
    return { level: 'busy', label: 'Busy', detail: 'Responding in live chat' };
  }
  if (agent.state === 'phone_call') {
    return { level: 'busy', label: 'Busy', detail: 'On dispatch call' };
  }
  if (agent.state === 'chatting' || Boolean(agent.speechBubble && agent.speechTimer > 0)) {
    return { level: 'busy', label: 'Busy', detail: 'In active conversation' };
  }
  if (agent.state === 'town_hall_seated') {
    return { level: 'busy', label: 'Busy', detail: 'In Town Hall session' };
  }
  if (inFlightTasks.length >= 2) {
    return {
      level: 'busy',
      label: 'Busy',
      detail: `${inFlightTasks.length} active assignments`,
    };
  }
  if (inFlightTasks.some((t) => t.status === 'advisor_escalated')) {
    return { level: 'busy', label: 'Busy', detail: 'Advisor escalation in progress' };
  }
  if (inFlightTasks.length >= 1 && pendingApprovalsCount >= 1) {
    return { level: 'busy', label: 'Busy', detail: 'Active task + pending CHO approval' };
  }

  if (inFlightTasks.length === 1) {
    const prompt = inFlightTasks[0].prompt.trim();
    const shortPrompt = prompt.length > 42 ? `${prompt.slice(0, 39)}...` : prompt;
    return {
      level: 'working',
      label: 'Working',
      detail: shortPrompt ? `Working on "${shortPrompt}"` : 'Executing assigned task',
    };
  }
  if (
    agent.state === 'working_inside' ||
    Boolean(agent.busyUntil && agent.busyUntil > Date.now())
  ) {
    return { level: 'working', label: 'Working', detail: 'Working inside Guild House' };
  }
  if (agent.state === 'summoned') {
    return { level: 'working', label: 'Working', detail: 'Walking to meet you' };
  }
  if (
    pendingApprovalsCount >= 1 ||
    tasks.some(
      (t) =>
        t.status === 'needs_approval' &&
        (t.assignedDirectorId === agent.id || t.assignedWorkerId === agent.id)
    )
  ) {
    return { level: 'working', label: 'Working', detail: 'Awaiting your approval' };
  }

  return { level: 'available', label: 'Available', detail: 'Ready for assignment' };
}

/**
 * Honest quiet-standby activity label when an agent has no active user work.
 */
export function defaultStandbyActivity(
  agent: Pick<Agent, 'id' | 'role' | 'department'>
): string {
  if (agent.id === 'cho') return 'Touring Guildhaven';
  if (agent.id === 'matt') return 'Following you · Ready to dispatch';
  return `Standing by for your direction · ${agent.department || 'Guildhaven'}`;
}

/**
 * Derives an agent's true baseline activity from the user's real tasks/approvals,
 * falling back to honest quiet standby if no user work has been assigned to them.
 */
export function deriveAgentGroundedActivity(
  agent: Pick<Agent, 'id' | 'role' | 'department'>,
  tasks: Array<{
    id?: string;
    prompt?: string;
    status?: string;
    assignedDirectorId?: string;
    assignedDirectorName?: string;
    assignedWorkerId?: string | null;
  }> = [],
  approvals: Array<{
    directorId?: string;
    title?: string;
    status?: string;
  }> = []
): string {
  if (agent.id === 'cho') return 'Touring Guildhaven';
  if (agent.id === 'matt') {
    const latest = tasks[0];
    if (latest && latest.prompt) {
      const short = latest.prompt.length > 44 ? `${latest.prompt.slice(0, 41)}...` : latest.prompt;
      return `Following you · Last routed "${short}"`;
    }
    return 'Following you · Ready to dispatch';
  }

  const pendingApproval = approvals.find(
    (a) => a && a.directorId === agent.id && a.status === 'pending' && a.title
  );
  if (pendingApproval && pendingApproval.title) {
    const shortTitle =
      pendingApproval.title.length > 48
        ? `${pendingApproval.title.slice(0, 45)}...`
        : pendingApproval.title;
    return `Awaiting your approval: ${shortTitle}`;
  }

  const myTask = tasks.find(
    (t) =>
      t &&
      t.prompt &&
      (t.assignedDirectorId === agent.id || t.assignedWorkerId === agent.id)
  );
  if (myTask && myTask.prompt) {
    const shortPrompt =
      myTask.prompt.length > 46 ? `${myTask.prompt.slice(0, 43)}...` : myTask.prompt;
    if (myTask.status === 'needs_approval') {
      return `Awaiting approval · "${shortPrompt}"`;
    }
    if (
      myTask.status === 'queued' ||
      myTask.status === 'matt_routing' ||
      myTask.status === 'worker_executing' ||
      myTask.status === 'director_review'
    ) {
      return `Working on "${shortPrompt}"`;
    }
    return `Completed for you · "${shortPrompt}"`;
  }

  return defaultStandbyActivity(agent);
}

const LEGACY_FICTIONAL_NOTE_SNIPPETS = [
  'connected to gmail & google calendar workspace tools',
  'strict draft-only policy enforced on every reply',
  'studio roof ring-light calibrated',
  'coordinating with layla on episode launch copy',
  'monitoring monthly tool spend and cost savings',
  'all purchase recommendations routed to pending approvals',
  'co-leading centralized village knowledge base',
  'google search grounding enabled for live citation verification',
  'enforcing canonical kb-sop-* handoff templates',
  'tracking cross-department handoffs with zero duplicate wiki drift',
  'staging launch drafts for cho review',
  'collaborating with elena on creator copy',
  'prepared balanced weekly meal prep template',
  'ready to plan personal logistics and workouts',
  'specializes in api integrations, webhooks, etl pipelines',
  'coordinates with devon on operational sops',
  'making the morning mail and schedule rounds',
  'drafting hook variations for next upload',
  'auditing recurring saas subscriptions',
  'retired decentralized wiki proposal in favor of',
  'indexing verified benchmarks and citations with aria',
  'co-maintaining canonical kb-sop-* handoff templates',
  'auditing task queues against the village single source',
  'polishing draft newsletter intro',
  'updating weekly grocery checklist',
  'validating webhook signatures and integration retry policies',
  'via centralized knowledge base.',
  'opening 30-second retention hooks',
  'q4 budget variance checkpoints',
  'weekly meal prep & grocery logistics',
  'focus-block recovery and workout schedule',
  'guild specialist queue load balancing',
  'thumbnail framing and episode outline',
];

/**
 * Identifies legacy canned cross-talk notes or fictional starter notes so they can be scrubbed
 * while preserving genuine notes created from the user's real tasks, chats, and hires.
 */
export function isLegacyFictionalNote(note: string): boolean {
  const trimmed = note.trim();
  if (!trimmed) return true;
  const lower = trimmed.toLowerCase();

  // Grounded notes created under the new architecture include an explicit [Ref: ...] anchor
  if (trimmed.includes('[Ref:')) return false;

  if (
    lower.startsWith('synced with ') ||
    lower.startsWith('aligned on ') ||
    lower.startsWith('checked in with ') ||
    lower.startsWith('coordinated on ')
  ) {
    return true;
  }

  return LEGACY_FICTIONAL_NOTE_SNIPPETS.some((snippet) => lower.includes(snippet));
}

const LEGACY_FICTIONAL_ACTIVITIES = [
  'monitoring inbox & calendar courtyard',
  'prepping youtube studio creator hooks',
  'reviewing budgets at finance & money',
  'standing by at research & intel',
  'coordinating workflows at operations house',
  'staging launch copy at creative & comms',
  'planning weekly routines at health & home',
  'mapping api & webhook topologies at systems & dev',
  'carrying dispatches · inbox triage standby',
  'scouting angles in plaza · drafting video hooks',
  'balancing ledgers · auditing subscriptions',
  'indexing verified briefs into knowledge base',
  'maintaining kb-sop-* handoff templates',
  'strolling town square · polishing draft copy',
  'tending greenhouse path · updating errand lists',
  'testing telegraph & api payloads on avenues',
];

/**
 * Identifies legacy fictional starter activities or stale ungrounded patrol/chat labels.
 */
export function isLegacyFictionalActivity(activity?: string | null): boolean {
  if (!activity) return true;
  const lower = activity.trim().toLowerCase();
  if (!lower) return true;
  if (
    lower.startsWith('patrolling avenues ·') ||
    lower.startsWith('on duty at ') ||
    (lower.startsWith('talking with ') && !activity.includes('·'))
  ) {
    return true;
  }
  return LEGACY_FICTIONAL_ACTIVITIES.includes(lower);
}

/**
 * Identifies legacy random cross_talk events that were generated from static templates
 * rather than grounded user context. Preserves all real dispatches, task completions,
 * user chats, Town Hall sessions, KB syncs, and grounded cross_talk events with contextRef.
 */
export function isLegacyRandomActivityEvent(ev: {
  kind?: string;
  contextRef?: unknown;
  lines?: Array<{ text?: string }>;
}): boolean {
  if (!ev || ev.kind !== 'cross_talk') return false;
  if (typeof ev.contextRef !== 'string' || !ev.contextRef.trim()) {
    return true;
  }
  const combined = (ev.lines ?? [])
    .map((l) => (l?.text ?? '').toLowerCase())
    .join(' ');
  if (
    combined.includes('logged our latest update on') ||
    combined.includes('pulling that ground truth into') ||
    combined.includes('checking kb handoffs from')
  ) {
    return true;
  }
  return false;
}

const DEFAULT_SEED_KB_IDS = new Set([
  'kb_gov_01',
  'kb_gov_02',
  'kb_sop_01',
  'kb_sop_02',
  'kb_sop_03',
  'kb_sop_04',
  'kb_res_01',
  'kb_res_02',
]);

const SEED_KB_TIMESTAMP = '2026-11-13T09:00:00.000Z';

/**
 * Collects all verified user-grounded work anchors from the 4 confirmed user sources:
 * 1. User-dispatched Tasks (active & completed)
 * 2. User Approvals (pending & approved)
 * 3. Direct 1-on-1 Chats & Town Hall interactions with the CHO
 * 4. Auto-synced Google Workspace Gmail & Calendar items
 * 5. User-created or task-indexed Knowledge Base entries
 */
export function collectGroundedWorkAnchors(params: {
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  kbProposals?: KnowledgeProposal[];
  chatHistory: Record<string, ChatMessage[]>;
  workspaceBriefing?: WorkspaceBriefing;
  knowledgeBase: KnowledgeEntry[];
  agents: Agent[];
}): GroundedWorkAnchor[] {
  const {
    tasks,
    approvals,
    kbProposals = [],
    chatHistory,
    workspaceBriefing,
    knowledgeBase,
    agents,
  } = params;
  const anchors: GroundedWorkAnchor[] = [];

  const findDeptByAgentId = (id?: string | null): string => {
    if (!id) return 'Village';
    return agents.find((a) => a.id === id)?.department ?? 'Village';
  };

  const guildMembersForAgent = (agentId?: string | null): string[] => {
    if (!agentId) return [];
    const target = agents.find((a) => a.id === agentId);
    if (!target) return [agentId];
    return agents
      .filter((a) => a.id !== 'cho' && a.buildingId === target.buildingId)
      .map((a) => a.id);
  };

  // 1. User-dispatched tasks (most recent 10), including cross-house collaborators & handoff participants
  for (const task of tasks.slice(0, 10)) {
    if (!task || !task.prompt) continue;
    const shortPrompt =
      task.prompt.length > 52 ? `${task.prompt.slice(0, 49)}...` : task.prompt;
    const dept = findDeptByAgentId(task.assignedDirectorId);
    const ids = new Set<string>([
      'matt',
      task.assignedDirectorId,
      ...guildMembersForAgent(task.assignedDirectorId),
    ]);
    if (task.assignedWorkerId) ids.add(task.assignedWorkerId);
    for (const collabId of task.collaboratorIds ?? []) {
      ids.add(collabId);
      for (const gm of guildMembersForAgent(collabId)) ids.add(gm);
    }
    for (const pkt of task.handoffTrace?.packets ?? []) {
      if (pkt.from_agent) ids.add(pkt.from_agent);
      if (pkt.to_agent) ids.add(pkt.to_agent);
    }

    anchors.push({
      sourceType: 'task',
      refLabel: `Task · "${shortPrompt}"`,
      detail: `CHO Task (${task.status}) assigned to ${task.assignedDirectorName} (${dept}): "${task.prompt}". Summary: ${task.summary || 'In progress'}`,
      department: dept,
      agentIds: Array.from(ids),
    });
  }

  // 1b. Pending / Approved KB Proposals
  for (const prop of kbProposals.slice(0, 5)) {
    if (!prop || prop.status === 'rejected') continue;
    const shortTitle =
      prop.title.length > 44 ? `${prop.title.slice(0, 41)}...` : prop.title;
    anchors.push({
      sourceType: 'knowledge',
      refLabel: `${prop.id} (${prop.status}) · "${shortTitle}"`,
      detail: `Knowledge Base proposal [${prop.id}] "${prop.title}" (${prop.scope}, status: ${prop.status}) proposed by ${prop.proposed_by_name}: ${prop.summary}`,
      department: prop.scope,
      agentIds: Array.from(
        new Set([
          prop.proposed_by,
          ...guildMembersForAgent(prop.proposed_by),
          'aria',
          'worker_aria',
          'devon',
          'worker_devon',
          'matt',
        ])
      ),
    });
  }

  // 2. Pending / Approved CHO approvals
  for (const appr of approvals.slice(0, 6)) {
    if (!appr || appr.status === 'rejected') continue;
    const dept = findDeptByAgentId(appr.directorId);
    const shortTitle =
      appr.title.length > 48 ? `${appr.title.slice(0, 45)}...` : appr.title;
    anchors.push({
      sourceType: 'approval',
      refLabel: `Approval (${appr.status}) · "${shortTitle}"`,
      detail: `${appr.type} approval (${appr.status}) prepared by ${appr.directorName} (${dept}): "${appr.title}" — ${appr.description}`,
      department: dept,
      agentIds: Array.from(
        new Set(['matt', appr.directorId, ...guildMembersForAgent(appr.directorId)])
      ),
    });
  }

  // 3. Direct 1-on-1 Chats with the CHO
  for (const [agentId, msgs] of Object.entries(chatHistory)) {
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    const choMsgs = msgs.filter((m) => m && m.sender === 'cho' && m.text.trim());
    if (choMsgs.length === 0) continue;
    const lastCho = choMsgs[choMsgs.length - 1];
    const lastAgentReply = [...msgs]
      .reverse()
      .find((m) => m && m.sender === 'agent' && m.text.trim());
    const agentObj = agents.find((a) => a.id === agentId);
    const dept = agentObj?.department ?? 'Village';
    const shortMsg =
      lastCho.text.length > 46 ? `${lastCho.text.slice(0, 43)}...` : lastCho.text;

    anchors.push({
      sourceType: 'chat',
      refLabel: `Chat with ${agentObj?.name ?? agentId} · "${shortMsg}"`,
      detail: `CHO asked ${agentObj?.name ?? agentId} (${dept}): "${lastCho.text}"${
        lastAgentReply ? ` | Reply: "${lastAgentReply.text.slice(0, 140)}"` : ''
      }`,
      department: dept,
      agentIds: Array.from(new Set([agentId, ...guildMembersForAgent(agentId)])),
    });
  }

  // 4. Live synced Google Workspace (Gmail & Google Calendar)
  if (workspaceBriefing?.connected) {
    const hasEmails = workspaceBriefing.recentEmails.length > 0 || workspaceBriefing.unreadCount > 0;
    const hasEvents = workspaceBriefing.upcomingEvents.length > 0;
    if (hasEmails) {
      const topSubjects = workspaceBriefing.recentEmails
        .slice(0, 3)
        .map((e) => `"${e.subject}" from ${e.from}`)
        .join('; ');
      anchors.push({
        sourceType: 'workspace',
        refLabel: `Gmail · ${workspaceBriefing.unreadCount} unread`,
        detail: `Synced CHO Gmail Inbox (${workspaceBriefing.unreadCount} unread). Recent threads: ${
          topSubjects || 'Inbox checked'
        }. Remember: draft-only policy.`,
        department: 'Inbox & Calendar',
        agentIds: ['daniel', 'worker_daniel', 'matt'],
      });
    }
    if (hasEvents) {
      const topEvents = workspaceBriefing.upcomingEvents
        .slice(0, 3)
        .map((ev) => `"${ev.summary}" (${ev.start})`)
        .join('; ');
      anchors.push({
        sourceType: 'workspace',
        refLabel: `Calendar · ${workspaceBriefing.upcomingEvents[0].summary.slice(0, 36)}`,
        detail: `Synced CHO Google Calendar upcoming events: ${topEvents}.`,
        department: 'Inbox & Calendar',
        agentIds: ['daniel', 'worker_daniel', 'matt'],
      });
    }
    const chatSpaces = workspaceBriefing.chatSpaces ?? [];
    if (chatSpaces.length > 0) {
      const spaceDigest = chatSpaces
        .slice(0, 3)
        .map((sp) => {
          const latest = sp.recentMessages[0];
          return latest
            ? `${sp.displayName} (latest from ${latest.senderName}: "${latest.text.slice(0, 60)}")`
            : sp.displayName;
        })
        .join('; ');
      anchors.push({
        sourceType: 'workspace',
        refLabel: `Google Chat · ${chatSpaces.length} space${chatSpaces.length === 1 ? '' : 's'}`,
        detail: `Synced CHO Google Chat spaces: ${spaceDigest}. Outgoing chat messages require explicit CHO approval.`,
        department: 'Inbox & Calendar',
        agentIds: ['daniel', 'worker_daniel', 'matt', 'devon', 'worker_devon'],
      });
    }
  }

  const linkedDocs = workspaceBriefing?.linkedDocs ?? [];
  for (const doc of linkedDocs.slice(0, 4)) {
    const shortTitle = doc.title.length > 40 ? `${doc.title.slice(0, 37)}...` : doc.title;
    anchors.push({
      sourceType: 'workspace',
      refLabel: `Google Doc · "${shortTitle}"`,
      detail: `CHO Google Doc "${doc.title}": ${doc.excerpt.slice(0, 160)}`,
      department: 'Research & Intel',
      agentIds: ['daniel', 'worker_daniel', 'aria', 'worker_aria', 'layla', 'worker_layla', 'matt'],
    });
  }

  const pinnedDriveFiles = workspaceBriefing?.pinnedDriveFiles ?? [];
  for (const df of pinnedDriveFiles.slice(0, 4)) {
    const shortName = df.name.length > 40 ? `${df.name.slice(0, 37)}...` : df.name;
    anchors.push({
      sourceType: 'workspace',
      refLabel: `Google Drive · "${shortName}"`,
      detail: `Pinned CHO Google Drive file "${df.name}" (${df.mimeType}): ${(df.excerpt || 'Pinned for village reference').slice(0, 160)}`,
      department: 'Operations House',
      agentIds: ['daniel', 'worker_daniel', 'devon', 'worker_devon', 'aria', 'worker_aria', 'matt'],
    });
  }

  const recentDriveFiles = workspaceBriefing?.driveFiles ?? [];
  if (workspaceBriefing?.connected && recentDriveFiles.length > 0 && pinnedDriveFiles.length === 0) {
    const topNames = recentDriveFiles
      .slice(0, 4)
      .map((f) => `"${f.name}"`)
      .join(', ');
    anchors.push({
      sourceType: 'workspace',
      refLabel: `Google Drive · ${recentDriveFiles.length} recent files`,
      detail: `Synced CHO Google Drive recent files: ${topNames}.`,
      department: 'Inbox & Calendar',
      agentIds: ['daniel', 'worker_daniel', 'devon', 'worker_devon', 'matt'],
    });
  }

  const pinnedChats = workspaceBriefing?.pinnedChats ?? [];
  for (const pc of pinnedChats.slice(0, 3)) {
    const label = pc.label || pc.spaceDisplayName;
    const shortLabel = label.length > 40 ? `${label.slice(0, 37)}...` : label;
    const snippet = pc.messages
      .slice(-2)
      .map((m) => `${m.senderName}: "${m.text.slice(0, 60)}"`)
      .join('; ');
    anchors.push({
      sourceType: 'workspace',
      refLabel: `Pinned Chat · "${shortLabel}"`,
      detail: `Pinned CHO Google Chat context "${label}" (${pc.messages.length} messages): ${snippet || 'Pinned conversation'}`,
      department: 'Inbox & Calendar',
      agentIds: ['daniel', 'worker_daniel', 'matt', 'devon', 'worker_devon', 'aria', 'worker_aria'],
    });
  }

  // 5. User-created or task-indexed Knowledge Base entries
  for (const entry of knowledgeBase) {
    if (!entry || entry.category === 'house_memory') continue;
    const isUntouchedSeed =
      DEFAULT_SEED_KB_IDS.has(entry.id) &&
      !entry.sourceTaskId &&
      entry.updatedAt === SEED_KB_TIMESTAMP;
    if (isUntouchedSeed) continue;

    const matchingAgents = agents
      .filter(
        (a) =>
          a.id !== 'cho' &&
          (a.department.toLowerCase() === entry.department.toLowerCase() ||
            entry.department === 'All Houses')
      )
      .map((a) => a.id);

    const shortTitle =
      entry.title.length > 44 ? `${entry.title.slice(0, 41)}...` : entry.title;

    anchors.push({
      sourceType: 'knowledge',
      refLabel: `${entry.code} · "${shortTitle}"`,
      detail: `CHO/Task Knowledge Base entry [${entry.code}] "${entry.title}" (${entry.department}): ${entry.summary}`,
      department: entry.department,
      agentIds: Array.from(
        new Set([...matchingAgents, 'aria', 'worker_aria', 'devon', 'worker_devon'])
      ),
    });
  }

  // 6. Fallback to live Village Constitution & SOP entries (KB-GOV-* / KB-SOP-*) when no user tasks/chats exist yet
  if (anchors.length === 0) {
    const allVillagerIds = agents.filter((a) => a.id !== 'cho').map((a) => a.id);
    for (const entry of knowledgeBase) {
      if (
        !entry ||
        (entry.category !== 'constitution' && entry.category !== 'handoff_template')
      ) {
        continue;
      }
      const shortTitle =
        entry.title.length > 42 ? `${entry.title.slice(0, 39)}...` : entry.title;
      anchors.push({
        sourceType: 'knowledge',
        refLabel: `${entry.code} · "${shortTitle}"`,
        detail: `Live Village Governance/SOP [${entry.code}] "${entry.title}" (${entry.department}): ${entry.summary}`,
        department: entry.department,
        agentIds: allVillagerIds,
      });
    }
  }

  return anchors;
}

/**
 * Selects grounded user work anchors relevant to a pair of proximate agents.
 */
export function selectAnchorsForPair(
  a: Agent,
  b: Agent,
  allAnchors: GroundedWorkAnchor[]
): GroundedWorkAnchor[] {
  if (allAnchors.length === 0) return [];

  const anchorsA = allAnchors.filter(
    (x) =>
      x.agentIds.includes(a.id) ||
      x.department.toLowerCase() === a.department.toLowerCase() ||
      x.department === 'All Houses'
  );
  const anchorsB = allAnchors.filter(
    (x) =>
      x.agentIds.includes(b.id) ||
      x.department.toLowerCase() === b.department.toLowerCase() ||
      x.department === 'All Houses'
  );

  // Neither agent holds grounded work -> stay quiet
  if (anchorsA.length === 0 && anchorsB.length === 0) {
    return [];
  }

  // Same guild house or cross-house peers sharing active village work/SOP context
  const merged: GroundedWorkAnchor[] = [];
  const seen = new Set<string>();
  const prioritized =
    a.buildingId === b.buildingId
      ? [...anchorsA, ...anchorsB]
      : [...anchorsA.slice(0, 2), ...anchorsB.slice(0, 2), ...anchorsA.slice(2), ...anchorsB.slice(2)];

  for (const item of prioritized) {
    if (!seen.has(item.refLabel)) {
      seen.add(item.refLabel);
      merged.push(item);
      if (merged.length >= 4) break;
    }
  }
  return merged;
}
