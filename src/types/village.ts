export type BuildingStyle =
  | 'town_hall'
  | 'inbox'
  | 'youtube'
  | 'finance'
  | 'research'
  | 'operations'
  | 'creative'
  | 'health'
  | 'engineering';

export interface Building {
  id: string;
  name: string;
  subtitle: string;
  directorId: string | null;
  tileX: number;
  tileY: number;
  widthTiles: number;
  heightTiles: number;
  doorTileX: number;
  doorTileY: number;
  yardTileX: number;
  yardTileY: number;
  roofColor: string;
  roofAccent: string;
  wallColor: string;
  style: BuildingStyle;
  interiorSubtitle: string;
}

export type AgentRole = 'cho' | 'chief_of_staff' | 'director' | 'worker';

export type Direction = 'down' | 'up' | 'left' | 'right';

export type AgentBehaviorState =
  | 'idle_yard'
  | 'walking'
  | 'working_inside'
  | 'following_cho'
  | 'phone_call'
  | 'summoned'
  | 'town_hall_seated'
  | 'chatting';

export interface GridPoint {
  x: number;
  y: number;
}

export type AgentVoiceName = 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  title: string;
  department: string;
  buildingId: string;
  modelName: string;
  voiceName?: AgentVoiceName;
  advisorEnabled: boolean;
  instructions: string;
  notes: string[];
  shirtColor: string;
  pantsColor: string;
  hairColor: string;
  skinColor: string;
  hasYellowVest: boolean;
  hasGlasses?: boolean;
  x: number; // pixel coordinates in world
  y: number;
  direction: Direction;
  walkFrame: number;
  isMoving: boolean;
  state: AgentBehaviorState;
  speechBubble: string | null;
  speechTimer: number;
  path: GridPoint[];
  talkedTodayWith: string[];
  activeTaskId: string | null;
  patrolTimer: number;
  currentActivity?: string;
  busyUntil?: number | null;
}

export type TaskStatus =
  | 'queued'
  | 'matt_routing'
  | 'worker_executing'
  | 'director_review'
  | 'advisor_escalated'
  | 'completed'
  | 'needs_approval'
  | 'failed';

export interface GroundSource {
  title: string;
  uri: string;
}

export type ApprovalType =
  | 'email_draft'
  | 'calendar_event'
  | 'chat_message'
  | 'google_doc'
  | 'drive_file'
  | 'spend'
  | 'publish'
  | 'hire';

export type DecisionPacketSourceTrigger = 'chat' | 'cron' | 'webhook';

export interface ApprovalItem {
  id: string;
  taskId: string;
  directorId: string;
  directorName: string;
  type: ApprovalType;
  title: string;
  description: string;
  payload: {
    to?: string;
    subject?: string;
    body?: string;
    eventId?: string;
    eventSummary?: string;
    eventStart?: string;
    eventEnd?: string;
    eventLocation?: string;
    eventDescription?: string;
    eventHtmlLink?: string;
    chatSpaceName?: string;
    chatSpaceDisplayName?: string;
    chatThreadName?: string;
    chatMessageId?: string;
    docTitle?: string;
    documentId?: string;
    documentUrl?: string;
    driveFileName?: string;
    driveFolderId?: string;
    driveFileId?: string;
    driveFileUrl?: string;
    amount?: string;
    vendor?: string;
    postPlatform?: string;
    postContent?: string;
    candidateName?: string;
    candidateSpecialty?: string;
    buildingId?: string;
    gmailDraftId?: string;
  };
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: string;
  source_trigger?: DecisionPacketSourceTrigger;
  source_label?: string;
  automation_run_id?: string;
  ttl_expires_at?: string;
}

export interface TownAutomationRuleConfig {
  monitored_gmail_labels?: string[];
  ignore_unread_bulk?: boolean;
  watched_chat_spaces?: string[];
  packet_ttl_hours: number;
}

export interface TownAutomationRule {
  id: string;
  name: string;
  description?: string;
  type: 'cron' | 'webhook';
  enabled: boolean;
  schedule_cron?: string;
  timezone: string;
  target_house: string;
  config: TownAutomationRuleConfig;
  last_run_at?: string;
  updated_at: string;
}

export interface TownAutopilotSettings {
  autopilot_enabled: boolean;
  max_runs_per_hour: number;
  max_job_duration_ms: number;
  max_agent_hops: number;
}

export type AutomationRunStatus =
  | 'completed'
  | 'staged_packet'
  | 'skipped_paused'
  | 'failed_closed';

export interface AutomationRun {
  id: string;
  rule_id: string;
  rule_name?: string;
  trigger_type?: 'cron' | 'webhook';
  idempotency_key: string;
  status: AutomationRunStatus;
  summary: string;
  staged_packet_ids: string[];
  agent_trace: string[];
  duration_ms: number;
  error_detail?: string;
  created_at: string;
}

export type TaskSource = 'gmail' | 'calendar' | 'chat' | 'docs' | 'drive' | 'manual';

export type TaskPriority = 'low' | 'medium' | 'high';

export type HandoffPacketStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted_cap_reached';

export interface HandoffExpectedOutputSchema {
  format: 'structured_json' | 'executive_markdown';
  required_fields: string[];
  notes?: string;
}

export interface HandoffArtifact {
  agent_id: string;
  agent_name: string;
  house: string;
  summary: string;
  deliverable_markdown: string;
  verified_claims: string[];
  citations: GroundSource[];
  risks?: string[];
}

export interface HandoffPacket {
  handoff_id: string;
  task_id: string;
  depth: number;
  sequence: number;
  from_agent: string;
  from_agent_name: string;
  from_house: string;
  to_agent: string;
  to_agent_name: string;
  to_house: string;
  objective: string;
  kb_refs: string[];
  verified_facts: string[];
  constraints: string[];
  expected_output_schema: HandoffExpectedOutputSchema;
  status: HandoffPacketStatus;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  output_artifact?: HandoffArtifact;
  error_detail?: string;
}

export interface HandoffTrace {
  task_id: string;
  root_agent: string;
  coordinating_director: string;
  coordinating_director_name: string;
  status: 'running' | 'completed' | 'failed' | 'aborted_cap_reached';
  total_hops: number;
  max_hops: number;
  max_depth: number;
  started_at: string;
  completed_at?: string;
  error_banner?: string;
  packets: HandoffPacket[];
  staged_kb_proposal_ids: string[];
}

export interface VillageTask {
  id: string;
  prompt: string;
  createdAt: string;
  completedAt?: string;
  fulfillmentMs?: number;
  taskSource?: TaskSource;
  priority?: TaskPriority;
  status: TaskStatus;
  assignedDirectorId: string;
  assignedDirectorName: string;
  assignedWorkerId: string | null;
  workerModel: string;
  directorModel: string;
  escalatedToAdvisor: boolean;
  routingNote: string;
  summary: string;
  reportMarkdown: string;
  groundingSources: GroundSource[];
  approvalId?: string | null;
  progressPercent?: number;
  progressLabel?: string;
  archived?: boolean;
  archivedAt?: string;
  exportedDocUrl?: string;
  exportedDocTitle?: string;
  exportedDriveUrl?: string;
  exportedDriveName?: string;
  handoffTrace?: HandoffTrace;
  kbProposalIds?: string[];
  collaboratorIds?: string[];
  orchestrationError?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'cho' | 'agent' | 'system';
  agentId?: string;
  agentName?: string;
  agentTitle?: string;
  text: string;
  timestamp: string;
  sources?: GroundSource[];
  taskId?: string;
  handoffTrace?: HandoffTrace;
  kbProposalIds?: string[];
  approvalId?: string;
  orchestrationError?: string;
}

export interface GmailLabelConfig {
  id: string;
  name: string;
  type?: 'system' | 'user';
}

export interface GmailLabelSummary {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
}

export interface GmailSummary {
  id: string;
  threadId?: string;
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  bodyExcerpt?: string;
  date: string;
  internalDate?: string;
  isUnread?: boolean;
  labelIds?: string[];
  labelNames?: string[];
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  htmlLink?: string;
}

export interface GoogleChatMessageSummary {
  name: string;
  spaceName?: string;
  threadName?: string;
  senderName: string;
  senderId?: string;
  senderType?: string;
  text: string;
  createTime: string;
  lastUpdateTime?: string;
  attachmentNames?: string[];
  reactionSummary?: string[];
}

export interface GoogleChatThreadSummary {
  threadName: string;
  spaceName: string;
  rootSenderName: string;
  rootText: string;
  replyCount: number;
  messageCount: number;
  participants: string[];
  firstMessageTime: string;
  lastUpdateTime: string;
  messages: GoogleChatMessageSummary[];
}

export interface PinnedChatContext {
  id: string;
  spaceName: string;
  spaceDisplayName: string;
  spaceType?: string;
  threadName?: string;
  label: string;
  pinnedAt: string;
  messages: GoogleChatMessageSummary[];
}

export interface ChatSpaceSummary {
  name: string;
  displayName: string;
  spaceType?: string;
  spaceThreadingState?: string;
  lastActiveTime?: string;
  singleUserBotDm?: boolean;
  recentMessages: GoogleChatMessageSummary[];
}

export interface GoogleDocSummary {
  documentId: string;
  title: string;
  url: string;
  excerpt: string;
  content?: string;
  updatedAt: string;
  sourceTaskId?: string;
}

export interface GoogleDriveFileSummary {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  webViewLink?: string;
  size?: string;
  isFolder?: boolean;
  parents?: string[];
  excerpt?: string;
  content?: string;
}

export interface DriveWorkingFolderConfig {
  id: string;
  name: string;
  webViewLink: string;
  configuredAt: string;
}

export type DriveWorkingFolderWriteMode = 'direct_in_folder' | 'confirm_each_write';

export interface VillageSettings {
  driveWorkingFolder: DriveWorkingFolderConfig | null;
  driveWorkingFolderWriteMode: DriveWorkingFolderWriteMode;
  autoSyncWorkingFolderContext: boolean;
  calendarWriteAccess: boolean;
  gmailIncludeInbox: boolean;
  gmailSelectedLabels: GmailLabelConfig[];
  hasDismissedQuickGuide?: boolean;
  workspaceViewMode?: 'map' | 'desk';
}

export interface MorningBriefingPriorityItem {
  title: string;
  detail: string;
  ownerName: string;
  ownerDirectorId: string;
  category: 'inbox' | 'calendar' | 'approvals' | 'tasks' | 'operations';
  suggestedPrompt?: string;
}

export interface ExecutiveMorningBriefing {
  generatedAt: string;
  headline: string;
  spokenSummary: string;
  priorities: MorningBriefingPriorityItem[];
  scheduleHighlights: string[];
  inboxHighlights: string[];
}

export interface WorkspaceBriefing {
  connected: boolean;
  email?: string;
  unreadCount: number;
  recentEmails: GmailSummary[];
  gmailLabels?: GmailLabelSummary[];
  activeGmailSources?: GmailLabelSummary[];
  upcomingEvents: CalendarEventSummary[];
  calendarStatus?: 'connected_read' | 'connected_write' | 'needs_consent' | 'unavailable';
  chatSpaces?: ChatSpaceSummary[];
  pinnedChats?: PinnedChatContext[];
  chatStatus?: 'connected' | 'app_not_configured' | 'needs_consent' | 'unavailable';
  chatStatusMessage?: string;
  chatConsoleUrl?: string;
  linkedDocs?: GoogleDocSummary[];
  docsStatus?: 'connected' | 'needs_consent';
  driveFiles?: GoogleDriveFileSummary[];
  pinnedDriveFiles?: GoogleDriveFileSummary[];
  workingFolder?: DriveWorkingFolderConfig | null;
  workingFolderFiles?: GoogleDriveFileSummary[];
  driveStatus?: 'connected' | 'needs_consent' | 'unavailable';
  error?: string;
}

export interface HiringCandidate {
  id: string;
  directorId: string;
  directorName: string;
  buildingId: string;
  name: string;
  specialty: string;
  bio: string;
  rationale: string;
  hairColor: string;
  shirtColor: string;
}

export type TownHallMode =
  | 'general'
  | 'morning_briefing'
  | 'daily_debrief'
  | 'quarterly_review'
  | 'hiring_interview';

export type KnowledgeCategory =
  | 'constitution'
  | 'handoff_template'
  | 'research_brief'
  | 'house_memory';

export interface KnowledgeVersionSnapshot {
  version: number;
  updatedAt: string;
  title: string;
  scope: string;
  owners: string;
  summary: string;
  details: string;
  proposedBy?: string;
  approvedBy?: string;
  changeNote?: string;
}

export interface KnowledgeEntry {
  id: string;
  code: string;
  title: string;
  category: KnowledgeCategory;
  department: string;
  maintainedBy: string;
  summary: string;
  contentMarkdown: string;
  sources?: GroundSource[];
  updatedAt: string;
  locked?: boolean;
  sourceTaskId?: string;
  version?: number;
  approvedByCho?: boolean;
  approvedBy?: string;
  versionHistory?: KnowledgeVersionSnapshot[];
}

export type KnowledgeProposalActionType = 'create' | 'update';

export type KnowledgeProposalStatus =
  | 'pending'
  | 'approved'
  | 'revision_requested'
  | 'rejected'
  | 'expired';

export interface KnowledgeProposal {
  proposal_id: string;
  task_id: string;
  id: string; // Strictly matches ^KB-(GOV|SOP|RES)-\d{2,}$
  title: string;
  scope: string;
  owners: string;
  summary: string;
  details: string;
  action_type: KnowledgeProposalActionType;
  proposed_by: string;
  proposed_by_name: string;
  rationale?: string;
  sources?: GroundSource[];
  status: KnowledgeProposalStatus;
  base_version?: number;
  previous_snapshot?: {
    id: string;
    title: string;
    scope: string;
    owners: string;
    summary: string;
    details: string;
    version: number;
    updatedAt: string;
  };
  cho_edits?: {
    title?: string;
    scope?: string;
    owners?: string;
    summary?: string;
    details?: string;
  };
  revision_feedback?: string;
  revised_by_proposal_id?: string;
  rejection_reason?: string;
  approved_by?: string;
  committed_version?: number;
  created_at: string;
  resolved_at?: string;
  source_trigger?: DecisionPacketSourceTrigger;
  source_label?: string;
  automation_run_id?: string;
  ttl_expires_at?: string;
}

export type ActivityEventKind =
  | 'cross_talk'
  | 'dispatch_call'
  | 'task_complete'
  | 'cho_chat'
  | 'town_hall'
  | 'knowledge_sync';

export interface GroundedWorkAnchor {
  sourceType: 'task' | 'approval' | 'chat' | 'workspace' | 'knowledge';
  refLabel: string;
  detail: string;
  department: string;
  agentIds: string[];
}

export interface VillageActivityEvent {
  id: string;
  kind: ActivityEventKind;
  timestamp: string;
  location: string;
  headline: string;
  contextRef?: string;
  participants: Array<{
    id: string;
    name: string;
    department: string;
  }>;
  lines: Array<{
    speakerName: string;
    text: string;
  }>;
}

export interface PersistedVillageState {
  version: number;
  updatedAt: string;
  choSessionToken?: string;
  activeScreen?: 'TITLE_MENU' | 'PLAYING';
  activeBuildingId?: string | null;
  selectedAgentId?: string | null;
  rightDrawerMode?:
    | 'none'
    | 'agent'
    | 'directory'
    | 'workspace'
    | 'activity'
    | 'knowledge'
    | 'reports'
    | 'approvals'
    | 'history'
    | 'analytics'
    | 'settings';
  agents: Agent[];
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  kbProposals?: KnowledgeProposal[];
  townAutomationRules?: TownAutomationRule[];
  townAutopilotSettings?: TownAutopilotSettings;
  automationRuns?: AutomationRun[];
  chatHistory: Record<string, ChatMessage[]>;
  activityFeed?: VillageActivityEvent[];
  knowledgeBase?: KnowledgeEntry[];
  workspaceSnapshot?: WorkspaceBriefing;
  settings?: VillageSettings;
  instructions: Record<string, string>;
  notes: Record<string, string[]>;
}


