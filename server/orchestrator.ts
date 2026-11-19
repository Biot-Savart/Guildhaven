import {
   ThinkingLevel,
  Type,
  type Content,
  type FunctionDeclaration,
  type Part,
} from '@google/genai';
import {
  KB_CANONICAL_ID_REGEX,
  buildKnowledgeGroundTruthBlock,
  categoryFromKbCode,
  isValidCanonicalKbId,
  mergeKnowledgeBase,
  nextKnowledgeCode,
} from '../src/data/knowledgeBase.ts';
import type {
  ApprovalType,
  HandoffArtifact,
  HandoffPacket,
  HandoffTrace,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeProposalActionType,
  TaskPriority,
} from '../src/types/village.ts';
import {
  VILLAGE_CONSTITUTION,
  extractGroundingSources,
  formatWorkspaceContextForPrompts,
  getAiClient,
  listGmailLabels,
  listGoogleChatSpaces,
  readGmailMessages,
  readGoogleChatConversation,
  readGoogleDriveFileContent,
  routeTaskWithMatt,
  searchGoogleDriveFiles,
  type AgentDossier,
  type ClientTimeContext,
  type GroundSource,
  type WorkspaceBriefingPayload,
} from './villageEngine.ts';

export const MAX_HANDOFF_DEPTH = 3;
export const MAX_AGENT_CALLS_PER_TASK = 6;
export const STEP_TIMEOUT_MS = 35_000;
export const WORKFLOW_TIMEOUT_MS = 110_000;

/**
 * Hard runtime whitelist for headless Safe-Zone Background Runner (KB-SOP-01 & KB-GOV-01).
 * Autonomous runs can NEVER invoke tools outside this set; direct external mutations are blocked.
 */
export const AUTONOMOUS_SAFE_TOOL_WHITELIST = new Set<string>([
  'dispatch_handoff',
  'stage_cho_decision_packet',
  'propose_kb_entry',
  'read_google_chat',
  'read_gmail_messages',
  'read_calendar_events',
  'read_drive_files',
]);

const DEFAULT_ROSTER_FALLBACK: AgentDossier[] = [
  {
    id: 'matt',
    name: 'Matt',
    role: 'chief_of_staff',
    title: 'Chief of Staff',
    department: 'Town Hall Dispatch',
    buildingId: 'town_hall',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Matt, Chief of Staff of Guildhaven. You triage incoming tasks, coordinate cross-House Directors, and never bypass CHO approval rules.',
    notes: [],
  },
  {
    id: 'daniel',
    name: 'Daniel',
    role: 'director',
    title: 'Inbox & Calendar Director',
    department: 'Inbox & Calendar',
    buildingId: 'inbox',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Daniel, Director of Inbox & Calendar. You manage Gmail (Inbox + any configured or requested Gmail labels via read_gmail_messages), Google Calendar, Google Chat spaces & threads (via read_google_chat), Google Docs, and Google Drive. Emails ALWAYS stay a draft and Google Chat replies / Calendar writes ALWAYS require explicit CHO confirmation.',
    notes: [],
  },
  {
    id: 'elena',
    name: 'Elena',
    role: 'director',
    title: 'YouTube & Media Director',
    department: 'YouTube Studio',
    buildingId: 'youtube',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Elena, Director of YouTube Studio. You research hooks, script episodes, and track creator trends. Never publish publicly without CHO approval.',
    notes: [],
  },
  {
    id: 'marcus',
    name: 'Marcus',
    role: 'director',
    title: 'Finance & Money Director',
    department: 'Finance & Money',
    buildingId: 'finance',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Marcus, Director of Finance & Money. You analyze budgets, vendor quotes, and ROI. Never spend money without explicit CHO approval.',
    notes: [],
  },
  {
    id: 'aria',
    name: 'Aria',
    role: 'director',
    title: 'Research & Intel Director',
    department: 'Research & Intel',
    buildingId: 'research',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Aria, Director of Research & Intel and Co-Lead of the Centralized Village Knowledge Base alongside Zoe and Eli.',
    notes: [],
  },
  {
    id: 'devon',
    name: 'Devon',
    role: 'director',
    title: 'Operations & Tasks Director',
    department: 'Operations House',
    buildingId: 'operations',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Devon, Director of Operations. Alongside Eli, Aria, and Zoe, you govern Centralized Knowledge Base SOPs & handoff templates (KB-SOP-*).',
    notes: [],
  },
  {
    id: 'layla',
    name: 'Layla',
    role: 'director',
    title: 'Creative & Comms Director',
    department: 'Creative & Comms',
    buildingId: 'creative',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Layla, Director of Creative & Comms. You craft announcements, social posts, and newsletters. Never publish publicly without CHO approval.',
    notes: [],
  },
  {
    id: 'noah',
    name: 'Noah',
    role: 'director',
    title: 'Health & Home Director',
    department: 'Health & Home',
    buildingId: 'health',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Noah, Director of Health & Home. You handle fitness plans, weekly meal prep, and household logistics.',
    notes: [],
  },
  {
    id: 'kieran',
    name: 'Kieran',
    role: 'director',
    title: 'Systems & Integrations Director',
    department: 'Systems & Dev',
    buildingId: 'engineering',
    modelName: 'gemini-4-hydrogen',
    instructions:
      'You are Kieran, Director of Systems & Dev. You design resilient API integrations, TypeScript/SQL specs, webhooks, idempotency, and security boundaries.',
    notes: [],
  },
  {
    id: 'worker_daniel',
    name: 'Sam',
    role: 'worker',
    title: 'Inbox & Schedule Courier',
    department: 'Inbox & Calendar',
    buildingId: 'inbox',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Sam, Inbox & Schedule Courier reporting to Daniel at Inbox & Calendar.',
    notes: [],
  },
  {
    id: 'worker_elena',
    name: 'Maya',
    role: 'worker',
    title: 'Studio Script & Cut Specialist',
    department: 'YouTube Studio',
    buildingId: 'youtube',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Maya, Studio Script & Cut Specialist reporting to Elena at YouTube Studio.',
    notes: [],
  },
  {
    id: 'worker_marcus',
    name: 'Leo',
    role: 'worker',
    title: 'Treasury & Ledger Clerk',
    department: 'Finance & Money',
    buildingId: 'finance',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Leo, Treasury & Ledger Clerk reporting to Marcus at Finance & Money.',
    notes: [],
  },
  {
    id: 'worker_aria',
    name: 'Zoe',
    role: 'worker',
    title: 'Field Scout & Cartographer',
    department: 'Research & Intel',
    buildingId: 'research',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Zoe, Field Scout & Cartographer at Research & Intel and Co-Steward of the Centralized Knowledge Base (KB-RES-*) with Aria and Eli.',
    notes: [],
  },
  {
    id: 'worker_devon',
    name: 'Eli',
    role: 'worker',
    title: 'Workflow & Checklist Wright',
    department: 'Operations House',
    buildingId: 'operations',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Eli, Workflow & Checklist Wright at Operations House and Co-Steward of the Centralized Knowledge Base (KB-SOP-*) with Aria and Zoe.',
    notes: [],
  },
  {
    id: 'worker_layla',
    name: 'Nora',
    role: 'worker',
    title: 'Atelier Copy & Print Artisan',
    department: 'Creative & Comms',
    buildingId: 'creative',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Nora, Atelier Copy & Print Artisan reporting to Layla at Creative & Comms.',
    notes: [],
  },
  {
    id: 'worker_noah',
    name: 'Owen',
    role: 'worker',
    title: 'Home & Apothecary Steward',
    department: 'Health & Home',
    buildingId: 'health',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Owen, Home & Apothecary Steward reporting to Noah at Health & Home.',
    notes: [],
  },
  {
    id: 'worker_kieran',
    name: 'Toby',
    role: 'worker',
    title: 'API & Pipeline Tinkerer',
    department: 'Systems & Dev',
    buildingId: 'engineering',
    modelName: 'gemini-3.1-flash-lite',
    instructions:
      'You are Toby, API & Pipeline Tinkerer reporting to Kieran at Systems & Dev. You draft OpenAPI schemas, webhook mappers, retry/idempotency logic, and SQL migrations.',
    notes: [],
  },
];

export interface StagedApprovalProposal {
  needed: boolean;
  type: Exclude<ApprovalType, 'hire'>;
  title: string;
  description: string;
  to?: string;
  subject?: string;
  body?: string;
  eventSummary?: string;
  eventStart?: string;
  eventEnd?: string;
  eventLocation?: string;
  eventDescription?: string;
  chatSpaceName?: string;
  chatSpaceDisplayName?: string;
  chatThreadName?: string;
  docTitle?: string;
  driveFileName?: string;
  amount?: string;
  vendor?: string;
  postPlatform?: string;
  postContent?: string;
}

class OrchestrationAbortError extends Error {
  public readonly abortKind: 'failed' | 'aborted_cap_reached';
  constructor(message: string, abortKind: 'failed' | 'aborted_cap_reached' = 'failed') {
    super(message);
    this.name = 'OrchestrationAbortError';
    this.abortKind = abortKind;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new OrchestrationAbortError(
              `${label} timed out after ${Math.round(timeoutMs / 1000)}s (fail-closed limit).`,
              'aborted_cap_reached'
            )
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildFullVillageRoster(
  providedAgents: AgentDossier[],
  mergeFn?: (agent: AgentDossier) => AgentDossier
): AgentDossier[] {
  const byId = new Map<string, AgentDossier>();
  for (const fallback of DEFAULT_ROSTER_FALLBACK) {
    byId.set(fallback.id, mergeFn ? mergeFn(fallback) : fallback);
  }
  for (const agent of providedAgents) {
    if (!agent || !agent.id || agent.role === 'cho') continue;
    byId.set(agent.id, mergeFn ? mergeFn(agent) : agent);
  }
  return Array.from(byId.values());
}

export function resolveRosterAgent(
  query: string | undefined | null,
  roster: AgentDossier[]
): AgentDossier | null {
  const clean = (query || '').trim().toLowerCase().replace(/^@/, '');
  if (!clean) return null;

  const exactId = roster.find((a) => a.id.toLowerCase() === clean);
  if (exactId) return exactId;

  const exactName = roster.find((a) => a.name.toLowerCase() === clean);
  if (exactName) return exactName;

  const firstWord = clean.split(/[\s(·-]+/)[0];
  if (firstWord) {
    const byFirstName = roster.find(
      (a) => a.name.toLowerCase() === firstWord || a.id.toLowerCase() === firstWord
    );
    if (byFirstName) return byFirstName;
  }

  const partial = roster.find(
    (a) =>
      a.name.toLowerCase().includes(clean) ||
      a.department.toLowerCase().includes(clean) ||
      a.title.toLowerCase().includes(clean)
  );
  return partial ?? null;
}

export function canAgentProposeKbEntry(agent: AgentDossier): boolean {
  if (agent.role === 'director') return true;
  const lowerId = agent.id.toLowerCase();
  const lowerName = agent.name.toLowerCase();
  return (
    lowerId === 'aria' ||
    lowerId === 'worker_aria' ||
    lowerId === 'worker_devon' ||
    lowerName === 'aria' ||
    lowerName === 'zoe' ||
    lowerName === 'eli'
  );
}

export interface ValidateKbProposalInputParams {
  taskId: string;
  rawId?: string;
  title?: string;
  scope?: string;
  owners?: string;
  summary?: string;
  details?: string;
  actionType?: string;
  proposedByAgent: AgentDossier;
  rationale?: string;
  sources?: GroundSource[];
  liveKnowledgeBase: KnowledgeEntry[];
}

export function validateKnowledgeProposalInput(
  params: ValidateKbProposalInputParams
): { ok: true; proposal: KnowledgeProposal } | { ok: false; error: string } {
  const {
    taskId,
    rawId,
    title,
    scope,
    owners,
    summary,
    details,
    actionType,
    proposedByAgent,
    rationale,
    sources,
    liveKnowledgeBase,
  } = params;

  if (!canAgentProposeKbEntry(proposedByAgent)) {
    return {
      ok: false,
      error: `${proposedByAgent.name} (${proposedByAgent.role}) is not authorized to stage Knowledge Base proposals. Only House Directors and KB Co-Leads (Aria, Zoe, Eli) may invoke propose_kb_entry.`,
    };
  }

  const normalizedId = (rawId || '').trim().toUpperCase();
  if (!isValidCanonicalKbId(normalizedId)) {
    return {
      ok: false,
      error: `Invalid Knowledge Base ID "${rawId ?? ''}". ID must strictly match ${KB_CANONICAL_ID_REGEX.source} (e.g. KB-SOP-05, KB-RES-03, KB-GOV-03).`,
    };
  }

  if (normalizedId === 'KB-GOV-01') {
    return {
      ok: false,
      error:
        'KB-GOV-01 (Core Human-in-the-Loop Governance Constitution) is immutable and cannot be modified by agents.',
    };
  }

  const normalizedAction: KnowledgeProposalActionType | null =
    actionType === 'create' || actionType === 'update' ? actionType : null;
  if (!normalizedAction) {
    return {
      ok: false,
      error: `Invalid action_type "${actionType ?? ''}". Must be "create" or "update".`,
    };
  }

  const cleanTitle = (title || '').trim();
  const cleanScope = (scope || '').trim();
  const cleanOwners = (owners || '').trim();
  const cleanSummary = (summary || '').trim();
  const cleanDetails = (details || '').trim();

  if (cleanTitle.length < 4) {
    return { ok: false, error: 'Proposal title must be at least 4 characters.' };
  }
  if (cleanScope.length < 2) {
    return { ok: false, error: 'Proposal scope (target House or All Houses) is required.' };
  }
  if (cleanOwners.length < 2) {
    return { ok: false, error: 'Proposal owners field is required.' };
  }
  if (cleanSummary.length < 10) {
    return { ok: false, error: 'Proposal summary must be at least 10 characters.' };
  }
  if (cleanDetails.length < 20) {
    return { ok: false, error: 'Proposal details (Markdown content) must be at least 20 characters.' };
  }

  const safeEntries = mergeKnowledgeBase(liveKnowledgeBase);
  const existing = safeEntries.find((e) => e.code.trim().toUpperCase() === normalizedId);

  if (normalizedAction === 'create' && existing) {
    const nextSuggested = nextKnowledgeCode(safeEntries, categoryFromKbCode(normalizedId));
    return {
      ok: false,
      error: `${normalizedId} already exists in the live Knowledge Base ("${existing.title}", v${existing.version ?? 1}). Use action_type="update" to update ${normalizedId}, or use id="${nextSuggested}" for action_type="create".`,
    };
  }

  if (normalizedAction === 'update' && !existing) {
    return {
      ok: false,
      error: `${normalizedId} does not exist in the live Knowledge Base yet. Use action_type="create" to propose ${normalizedId} as a new entry.`,
    };
  }

  const nowIso = new Date().toISOString();
  const baseVersion = existing ? (existing.version ?? 1) : undefined;

  const proposal: KnowledgeProposal = {
    proposal_id: `kbp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    task_id: taskId,
    id: normalizedId,
    title: cleanTitle,
    scope: cleanScope,
    owners: cleanOwners,
    summary: cleanSummary,
    details: cleanDetails,
    action_type: normalizedAction,
    proposed_by: proposedByAgent.id,
    proposed_by_name: `${proposedByAgent.name} (${proposedByAgent.department})`,
    rationale: rationale?.trim() || undefined,
    sources: sources && sources.length > 0 ? sources : undefined,
    status: 'pending',
    base_version: baseVersion,
    previous_snapshot: existing
      ? {
          id: existing.code,
          title: existing.title,
          scope: existing.department,
          owners: existing.maintainedBy,
          summary: existing.summary,
          details: existing.contentMarkdown,
          version: existing.version ?? 1,
          updatedAt: existing.updatedAt,
        }
      : undefined,
    created_at: nowIso,
  };

  return { ok: true, proposal };
}

function normalizeIsoTimestamp(value: string | undefined, fallbackOffset?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const explicitMatch =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
      trimmed
    );
  if (explicitMatch) {
    const [, datePart, hmPart, secPart, rawTz] = explicitMatch;
    const tzPart = rawTz.toUpperCase() === 'Z' ? 'Z' : rawTz;
    const normalized = `${datePart}T${hmPart}:${secPart ?? '00'}${tzPart}`;
    if (!Number.isNaN(Date.parse(normalized))) return normalized;
  }

  const naiveMatch = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(trimmed);
  if (naiveMatch) {
    const [, datePart, hmPart, secPart] = naiveMatch;
    const safeOffset =
      fallbackOffset && /^[+-]\d{2}:\d{2}$/.test(fallbackOffset.trim())
        ? fallbackOffset.trim()
        : 'Z';
    const normalized = `${datePart}T${hmPart}:${secPart ?? '00'}${safeOffset}`;
    if (!Number.isNaN(Date.parse(normalized))) return normalized;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function addMinutesWithOffset(startIso: string, minutes: number): string {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return new Date(Date.now() + minutes * 60_000).toISOString();
  const endMs = startMs + minutes * 60_000;
  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(startIso);
  if (offsetMatch) {
    const [, sign, oh, om] = offsetMatch;
    const offsetMins = (sign === '+' ? 1 : -1) * (Number(oh) * 60 + Number(om));
    const shifted = new Date(endMs + offsetMins * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate()
    )}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
      shifted.getUTCSeconds()
    )}${sign}${oh}:${om}`;
  }
  return new Date(endMs).toISOString();
}

function buildDispatchHandoffDeclaration(roster: AgentDossier[], excludeId: string): FunctionDeclaration {
  const availableList = roster
    .filter((a) => a.id !== excludeId && a.id !== 'matt' && a.role !== 'cho')
    .map((a) => `${a.id} (${a.name} · ${a.role === 'director' ? 'Director' : 'Specialist'} · ${a.department})`)
    .join(', ');

  return {
    name: 'dispatch_handoff',
    description: `Dispatch a typed KB-SOP-02 JSON handoff packet to another Guildhaven Director or Guild Specialist within this shared task_id thread and receive their verified output artifact. Available agents: ${availableList}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        to_agent: {
          type: Type.STRING,
          description:
            'Target agent id or name (e.g. "kieran", "Eli", "worker_devon", "Zoe", "aria", "Toby", "marcus").',
        },
        objective: {
          type: Type.STRING,
          description:
            'Specific, bounded objective for the target agent to execute and return in this thread.',
        },
        kb_refs: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Array of canonical KB-* IDs governing this handoff (e.g. ["KB-SOP-01", "KB-SOP-02", "KB-GOV-01"]).',
        },
        verified_facts: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Verified facts, CHO requirements, or Workspace context already established in this thread.',
        },
        constraints: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Non-negotiable governance, scope, or technical constraints the target agent must honor.',
        },
        expected_output_fields: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            'Expected sections or structured fields in the returned deliverable (e.g. ["schema_spec", "retry_policy", "risks"]).',
        },
      },
      required: ['to_agent', 'objective', 'kb_refs', 'verified_facts', 'constraints'],
    },
  };
}

function buildProposeKbDeclaration(liveEntries: KnowledgeEntry[]): FunctionDeclaration {
  const safeEntries = mergeKnowledgeBase(liveEntries);
  const existingCodes = safeEntries.map((e) => `${e.code} (v${e.version ?? 1}: ${e.title})`).join('; ');
  const nextSop = nextKnowledgeCode(safeEntries, 'handoff_template');
  const nextRes = nextKnowledgeCode(safeEntries, 'research_brief');
  const nextGov = nextKnowledgeCode(safeEntries, 'constitution');

  return {
    name: 'propose_kb_entry',
    description: `Stage a pending Knowledge Base proposal (CHO Decision Packet) without modifying the live Knowledge Base directly. Existing live codes: [${existingCodes}]. Next available codes for action_type="create": SOP=${nextSop}, RES=${nextRes}, GOV=${nextGov}.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.STRING,
          description: `Canonical KB ID strictly matching ^KB-(GOV|SOP|RES)-\\d{2,}$ (e.g. "${nextSop}" or "${nextRes}" for create, or an existing KB-* ID for update; never KB-GOV-01).`,
        },
        action_type: {
          type: Type.STRING,
          description: '"create" for a brand-new KB-* ID, or "update" to revise an existing live KB-* ID.',
        },
        title: {
          type: Type.STRING,
          description: 'Concise, authoritative title for the Knowledge Base entry.',
        },
        scope: {
          type: Type.STRING,
          description: 'Target House or "All Houses" (e.g. "Systems & Dev", "Operations House", "All Houses").',
        },
        owners: {
          type: Type.STRING,
          description: 'Steward names maintaining this entry (e.g. "Eli, Kieran & Devon").',
        },
        summary: {
          type: Type.STRING,
          description: '1-2 sentence executive summary of the SOP, brief, or governance rule.',
        },
        details: {
          type: Type.STRING,
          description: 'Complete structured Markdown body (headings, checklists, schemas, rules).',
        },
        rationale: {
          type: Type.STRING,
          description: 'Why this KB addition or update improves cross-House consistency for the CHO.',
        },
      },
      required: ['id', 'action_type', 'title', 'scope', 'owners', 'summary', 'details'],
    },
  };
}

function buildStageDecisionPacketDeclaration(
  calendarWriteAccess: boolean,
  mode: 'interactive' | 'autonomous' = 'interactive'
): FunctionDeclaration {
  const allowCalendarStage = calendarWriteAccess || mode === 'autonomous';
  return {
    name: 'stage_cho_decision_packet',
    description: `Stage an external or irreversible action in Pending CHO Approvals (KB-GOV-01). Use ONLY when an outbound Gmail draft, ${
      allowCalendarStage ? 'a Google Calendar event / Focus Buffer write, ' : ''
    }a Google Chat reply (in a space or specific thread), a new Google Doc, a Google Drive file export, a spend/purchase authorization, or a public social/YouTube/newsletter post is warranted. Never execute external writes directly.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        type: {
          type: Type.STRING,
          description:
            'One of: email_draft, calendar_event, chat_message, google_doc, drive_file, spend, publish',
        },
        title: { type: Type.STRING, description: 'Clear title shown in Pending Approvals.' },
        description: { type: Type.STRING, description: '1-sentence summary of what the CHO is approving.' },
        to: { type: Type.STRING, description: 'Recipient email address (for email_draft).' },
        subject: { type: Type.STRING, description: 'Email subject line (for email_draft).' },
        body: {
          type: Type.STRING,
          description: 'Full draft text/markdown body (for email_draft, google_doc, drive_file, or chat_message).',
        },
        eventSummary: { type: Type.STRING, description: 'Calendar event title (for calendar_event).' },
        eventStart: {
          type: Type.STRING,
          description: 'ISO-8601 start dateTime with timezone offset (for calendar_event).',
        },
        eventEnd: {
          type: Type.STRING,
          description: 'ISO-8601 end dateTime with timezone offset (for calendar_event).',
        },
        eventLocation: { type: Type.STRING },
        eventDescription: { type: Type.STRING },
        chatSpaceName: { type: Type.STRING, description: 'Google Chat space resource e.g. spaces/AAAA...' },
        chatSpaceDisplayName: { type: Type.STRING },
        chatThreadName: {
          type: Type.STRING,
          description:
            'Optional Google Chat thread resource name (e.g. spaces/AAAA.../threads/BBBB...) when replying inside an existing thread.',
        },
        docTitle: { type: Type.STRING },
        driveFileName: { type: Type.STRING },
        amount: { type: Type.STRING, description: 'Total spend amount e.g. "$240/yr" (for spend).' },
        vendor: { type: Type.STRING, description: 'Vendor or merchant name (for spend).' },
        postPlatform: { type: Type.STRING, description: 'Target platform e.g. YouTube, LinkedIn, X (for publish).' },
        postContent: { type: Type.STRING, description: 'Staged post or message copy (for publish or chat_message).' },
      },
      required: ['type', 'title', 'description'],
    },
  };
}

function buildReadGoogleChatDeclaration(
  workspaceBriefing: WorkspaceBriefingPayload
): FunctionDeclaration {
  const knownSpaces = (workspaceBriefing.chatSpaces ?? [])
    .slice(0, 15)
    .map((s) => `"${s.displayName}" (${s.name})`)
    .join(', ');
  return {
    name: 'read_google_chat',
    description: `Read-only autonomous Google Workspace tool to list Google Chat spaces OR read full message history and threads from any specified Google Chat space, room name, Google Chat URL, or thread (spaces/.../threads/...). Known spaces: [${
      knownSpaces || 'none pre-listed; call with action="list_spaces" or provide target URL/ID'
    }].`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            '"read_messages" (default) to read messages/threads from a specified space or thread, or "list_spaces" to list up to 50 Google Chat spaces/DMs.',
        },
        target: {
          type: Type.STRING,
          description:
            'Space resource ("spaces/AAAA..."), thread resource ("spaces/AAAA.../threads/BBBB..."), Google Chat URL ("https://chat.google.com/..."), or human space displayName (e.g. "Engineering"). Required when action="read_messages".',
        },
        thread_name: {
          type: Type.STRING,
          description:
            'Optional specific thread resource ("spaces/AAAA.../threads/BBBB...") to read all replies in that thread.',
        },
        search_query: {
          type: Type.STRING,
          description:
            'Optional keyword or sender filter applied to messages in the target space/thread.',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Number of messages to read (10 to 100, default 45).',
        },
      },
    },
  };
}

function buildReadGmailDeclaration(
  workspaceBriefing: WorkspaceBriefingPayload
): FunctionDeclaration {
  const activeSources = (workspaceBriefing.activeGmailSources ?? [])
    .map((s) => `${s.name} (${s.id})`)
    .join(', ');
  const knownLabels = (workspaceBriefing.gmailLabels ?? [])
    .slice(0, 20)
    .map((l) => `${l.name} (${l.id})`)
    .join(', ');
  return {
    name: 'read_gmail_messages',
    description: `Read-only Google Workspace tool to list Gmail labels OR read full email bodies and metadata from Inbox, configured Gmail labels, a specific Gmail label, or a search query. Active monitored sources: [${
      activeSources || 'Inbox'
    }]. Known labels: [${knownLabels || 'call action="list_labels"'}].`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description:
            '"read_messages" (default) to read emails with plain-text body excerpts, or "list_labels" to list all user & system Gmail labels with unread counts.',
        },
        label: {
          type: Type.STRING,
          description:
            'Optional Gmail label name or ID (e.g. "Inbox", "Starred", "Important", "Clients", "Label_12"), or "all_monitored" (default) to read across all monitored Gmail sources.',
        },
        unread_only: {
          type: Type.BOOLEAN,
          description: 'Set true to return only unread messages.',
        },
        search_query: {
          type: Type.STRING,
          description:
            'Optional Gmail search query filter (e.g. "from:alex invoice", "subject:Q4").',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Number of emails to read (1 to 25, default 12).',
        },
      },
    },
  };
}

function buildReadCalendarEventsDeclaration(
  workspaceBriefing: WorkspaceBriefingPayload
): FunctionDeclaration {
  const count = (workspaceBriefing.upcomingEvents ?? []).length;
  return {
    name: 'read_calendar_events',
    description: `Read-only Google Workspace tool to inspect upcoming Google Calendar events (${count} cached/live events) with optional date or keyword filtering (e.g., OOO notices, meetings, schedule gaps).`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        date_prefix: {
          type: Type.STRING,
          description: 'Optional YYYY-MM-DD date prefix filter (e.g. "2026-11-17").',
        },
        search_query: {
          type: Type.STRING,
          description: 'Optional keyword filter across event summary, location, and description (e.g. "OOO", "Standup").',
        },
        limit: {
          type: Type.NUMBER,
          description: 'Maximum number of events to return (default 20).',
        },
      },
    },
  };
}

function buildReadDriveFilesDeclaration(
  workspaceBriefing: WorkspaceBriefingPayload
): FunctionDeclaration {
  const workingName = workspaceBriefing.workingFolder?.name || 'none configured';
  return {
    name: 'read_drive_files',
    description: `Read-only Google Workspace tool to search Google Drive metadata or read text excerpts from a Google Drive / Docs / Sheets file. Working Folder: "${workingName}". Never modifies Drive files.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: {
          type: Type.STRING,
          description: '"search_files" (default) to search/list files, or "read_file" to read text content of a specific file_id_or_url.',
        },
        query: {
          type: Type.STRING,
          description: 'Optional filename search query when action="search_files".',
        },
        file_id_or_url: {
          type: Type.STRING,
          description: 'Google Drive file ID or URL when action="read_file".',
        },
      },
    },
  };
}

function buildSummonDirectorDeclaration(roster: AgentDossier[]): FunctionDeclaration {
  const directors = roster
    .filter((a) => a.role === 'director')
    .map((d) => `${d.id} (${d.name} · ${d.department})`)
    .join(', ');
  return {
    name: 'summon_director',
    description: `Summon a House Director physically to the CHO's location on the Guildhaven map when the CHO asks Matt to bring or call them over. Directors: ${directors}`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        director_id: {
          type: Type.STRING,
          description: 'Director ID (daniel, elena, marcus, aria, devon, layla, noah, kieran).',
        },
      },
      required: ['director_id'],
    },
  };
}

/**
 * Post-turn anti-hallucination gate (KB-GOV-01 Section 4):
 * Ensures no agent text falsely claims an external write or live KB mutation already occurred
 * without actual tool staging + explicit CHO approval.
 */
export function enforceGovernanceTruthfulness(params: {
  text: string;
  approvalProposal: StagedApprovalProposal | null;
  stagedKbProposals: KnowledgeProposal[];
}): string {
  const { approvalProposal, stagedKbProposals } = params;
  let cleaned = params.text.trim();
  if (!cleaned) return cleaned;

  const notices: string[] = [];

  const claimsEmailSent =
    /\b(i(?:'ve| have)?\s+sent\s+(?:the\s+)?email|email\s+has\s+been\s+sent|sent\s+your\s+email\s+to)\b/i.test(
      cleaned
    );
  if (claimsEmailSent) {
    notices.push(
      approvalProposal?.type === 'email_draft'
        ? '**Governance Status (`KB-GOV-01`)**: Outbound email was **not** sent; it is staged as a draft in **Pending Approvals** awaiting your sign-off.'
        : '**Governance Status (`KB-GOV-01`)**: No email was sent. Outbound emails always require staging a draft and explicit CHO approval.'
    );
  }

  const claimsLiveKbMutated =
    /\b(committed\s+to\s+the\s+(?:live\s+)?knowledge\s+base|updated\s+the\s+live\s+knowledge\s+base|wrote\s+directly\s+to\s+kb-|live\s+kb\s+has\s+been\s+updated)\b/i.test(
      cleaned
    );
  if (claimsLiveKbMutated) {
    notices.push(
      stagedKbProposals.length > 0
        ? `**Governance Status (\`KB-GOV-02\`)**: Knowledge Base changes (${stagedKbProposals.map((p) => p.id).join(', ')}) are staged as **pending CHO Decision Packet(s)** and are not live until you click **Approve & Commit to KB**.`
        : '**Governance Status (`KB-GOV-02`)**: The live Knowledge Base was not modified. All `KB-*` updates require a pending proposal and explicit CHO approval.'
    );
  }

  const claimsStagedKbWithoutTool =
    stagedKbProposals.length === 0 &&
    /\b(staged\s+a\s+(?:pending\s+)?kb\s+proposal|submitted\s+`?kb-(?:gov|sop|res)-\d{2,}`?\s+for\s+approval|created\s+a\s+pending\s+kb\s+proposal)\b/i.test(
      cleaned
    );
  if (claimsStagedKbWithoutTool) {
    notices.push(
      '**Verification Note**: No valid `pending` KB Decision Packet was recorded in this turn (`propose_kb_entry` was not committed).'
    );
  }

  const claimsCalendarMutated =
    /\b(added\s+(?:the\s+event\s+)?to\s+your\s+google\s+calendar|created\s+the\s+event\s+on\s+your\s+calendar|updated\s+your\s+google\s+calendar)\b/i.test(
      cleaned
    ) && !/\b(pending|staged|approval|confirm)\b/i.test(cleaned);
  if (claimsCalendarMutated) {
    notices.push(
      approvalProposal?.type === 'calendar_event'
        ? '**Governance Status (`KB-GOV-01`)**: Calendar event is **staged in Pending Approvals** and will only write to Google Calendar after you confirm.'
        : '**Governance Status (`KB-GOV-01`)**: Google Calendar was not modified.'
    );
  }

  const claimsChatSent =
    /\b(i(?:'ve| have)?\s+(?:posted|sent)\s+(?:the\s+)?(?:message|reply)\s+(?:in|to)\s+google\s+chat|google\s+chat\s+reply\s+has\s+been\s+sent)\b/i.test(
      cleaned
    ) && !/\b(pending|staged|approval|confirm)\b/i.test(cleaned);
  if (claimsChatSent) {
    notices.push(
      approvalProposal?.type === 'chat_message'
        ? '**Governance Status (`KB-GOV-01`)**: Google Chat reply was **not** sent yet; it is staged in **Pending Approvals** awaiting your confirmation.'
        : '**Governance Status (`KB-GOV-01`)**: No Google Chat message was sent. Outbound Google Chat replies require explicit CHO confirmation.'
    );
  }

  if (notices.length > 0) {
    cleaned = `${cleaned}\n\n---\n${notices.join('\n')}`;
  }

  return cleaned;
}

interface ThreadExecutionState {
  taskId: string;
  mode: 'interactive' | 'autonomous';
  maxHops: number;
  workflowDeadlineMs: number;
  roster: AgentDossier[];
  liveKnowledgeBase: KnowledgeEntry[];
  houseNotes: Record<string, string[]>;
  workspaceBriefing: WorkspaceBriefingPayload;
  workspaceAuthHeader?: string;
  calendarWriteAccess: boolean;
  clientTime?: ClientTimeContext;
  packets: HandoffPacket[];
  verifiedArtifacts: HandoffArtifact[];
  stagedKbProposals: KnowledgeProposal[];
  stagedApproval: StagedApprovalProposal | null;
  stagedApprovals: StagedApprovalProposal[];
  groundingSources: GroundSource[];
  collaboratorIds: Set<string>;
  hopSequenceIds: string[];
  hopCount: number;
  abortedReason: string | null;
  abortedKind: 'failed' | 'aborted_cap_reached' | null;
}

async function executeReadGoogleChatTool(
  rawArgs: Record<string, unknown>,
  state: ThreadExecutionState
): Promise<Record<string, unknown>> {
  const authHeader = state.workspaceAuthHeader;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error:
        'Google Workspace live token is not attached. Ask the CHO to Sign in with Google (or rely on any Pinned Google Chat transcripts already in context).',
    };
  }

  const action =
    typeof rawArgs.action === 'string' && rawArgs.action.trim() === 'list_spaces'
      ? 'list_spaces'
      : 'read_messages';

  try {
    if (action === 'list_spaces') {
      const listed = await listGoogleChatSpaces(authHeader, { pageSize: 50 });
      return {
        ok: true,
        action: 'list_spaces',
        count: listed.spaces.length,
        spaces: listed.spaces.map((sp) => ({
          spaceName: sp.name,
          displayName: sp.displayName,
          spaceType: sp.spaceType || 'SPACE',
          spaceThreadingState: sp.spaceThreadingState,
          lastActiveTime: sp.lastActiveTime,
        })),
      };
    }

    const fallbackTarget =
      state.workspaceBriefing.pinnedChats?.[0]?.spaceName ||
      state.workspaceBriefing.chatSpaces?.[0]?.name ||
      '';
    const target =
      typeof rawArgs.target === 'string' && rawArgs.target.trim()
        ? rawArgs.target.trim()
        : fallbackTarget;
    if (!target) {
      return {
        ok: false,
        error:
          'Provide "target" (a spaces/AAAA ID, spaces/AAAA/threads/BBBB ID, Google Chat URL, or space displayName) or call action="list_spaces" first.',
      };
    }

    const limitNum =
      typeof rawArgs.limit === 'number' && Number.isFinite(rawArgs.limit)
        ? Math.min(100, Math.max(10, Math.round(rawArgs.limit)))
        : 45;

    const conv = await readGoogleChatConversation(authHeader, {
      target,
      threadName:
        typeof rawArgs.thread_name === 'string' && rawArgs.thread_name.trim()
          ? rawArgs.thread_name.trim()
          : undefined,
      pageSize: limitNum,
      searchQuery:
        typeof rawArgs.search_query === 'string' && rawArgs.search_query.trim()
          ? rawArgs.search_query.trim()
          : undefined,
    });

    return {
      ok: true,
      action: 'read_messages',
      space: {
        spaceName: conv.space.name,
        displayName: conv.space.displayName,
        spaceType: conv.space.spaceType,
        spaceThreadingState: conv.space.spaceThreadingState,
      },
      focusedThreadName: conv.focusedThreadName ?? null,
      messageCount: conv.messages.length,
      threadCount: conv.threads.length,
      threads: conv.threads.slice(0, 15).map((th) => ({
        threadName: th.threadName,
        rootSender: th.rootSenderName,
        rootSnippet: th.rootText.slice(0, 180),
        replyCount: th.replyCount,
        participants: th.participants,
        lastUpdateTime: th.lastUpdateTime,
      })),
      messages: conv.messages.slice(-60).map((m) => ({
        name: m.name,
        threadName: m.threadName ?? null,
        senderName: m.senderName,
        createTime: m.createTime,
        text: m.text.slice(0, 800),
        attachments: m.attachmentNames,
        reactions: m.reactionSummary,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read Google Chat conversation.',
    };
  }
}

async function executeReadGmailTool(
  rawArgs: Record<string, unknown>,
  state: ThreadExecutionState
): Promise<Record<string, unknown>> {
  const authHeader = state.workspaceAuthHeader;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error: 'Google Workspace is not currently signed in. Ask the CHO to Sign in with Google.',
    };
  }
  const action =
    typeof rawArgs.action === 'string' && rawArgs.action.trim() === 'list_labels'
      ? 'list_labels'
      : 'read_messages';

  try {
    if (action === 'list_labels') {
      const labels = await listGmailLabels(authHeader, true);
      return {
        ok: true,
        action: 'list_labels',
        labelCount: labels.length,
        activeMonitoredSources: (state.workspaceBriefing.activeGmailSources ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          messagesUnread: s.messagesUnread ?? 0,
        })),
        labels: labels.map((l) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          messagesUnread: l.messagesUnread ?? 0,
          messagesTotal: l.messagesTotal ?? 0,
        })),
      };
    }

    const rawLabel = typeof rawArgs.label === 'string' ? rawArgs.label.trim() : '';
    const searchQuery =
      typeof rawArgs.search_query === 'string' && rawArgs.search_query.trim()
        ? rawArgs.search_query.trim()
        : undefined;
    const unreadOnly = Boolean(rawArgs.unread_only);
    const limitNum =
      typeof rawArgs.limit === 'number' && Number.isFinite(rawArgs.limit)
        ? Math.min(25, Math.max(1, Math.round(rawArgs.limit)))
        : 12;

    const activeConfiguredIds = (state.workspaceBriefing.activeGmailSources ?? []).map((s) => s.id);
    const useConfiguredSources =
      !rawLabel || rawLabel.toLowerCase() === 'all_monitored' || rawLabel.toLowerCase() === 'all';

    const readRes = await readGmailMessages(authHeader, {
      labelIds: useConfiguredSources
        ? activeConfiguredIds.length > 0
          ? activeConfiguredIds
          : searchQuery
            ? []
            : ['INBOX']
        : [],
      labelQuery: useConfiguredSources ? undefined : rawLabel,
      includeInbox: false,
      query: searchQuery,
      unreadOnly,
      maxResults: limitNum,
      includeBody: true,
    });

    return {
      ok: true,
      action: 'read_messages',
      matchedLabels: readRes.matchedLabels.map((l) => ({ id: l.id, name: l.name })),
      messageCount: readRes.messages.length,
      messages: readRes.messages.map((m) => ({
        id: m.id,
        threadId: m.threadId,
        from: m.from,
        to: m.to,
        subject: m.subject,
        date: m.date,
        isUnread: m.isUnread,
        labels: m.labelNames ?? [],
        snippet: m.snippet,
        bodyExcerpt: m.bodyExcerpt ?? m.snippet,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read Gmail messages.',
    };
  }
}

function executeReadCalendarEventsTool(
  rawArgs: Record<string, unknown>,
  state: ThreadExecutionState
): Record<string, unknown> {
  const datePrefix =
    typeof rawArgs.date_prefix === 'string' && rawArgs.date_prefix.trim()
      ? rawArgs.date_prefix.trim()
      : '';
  const searchQuery =
    typeof rawArgs.search_query === 'string' && rawArgs.search_query.trim()
      ? rawArgs.search_query.trim().toLowerCase()
      : '';
  const limitNum =
    typeof rawArgs.limit === 'number' && Number.isFinite(rawArgs.limit)
      ? Math.min(40, Math.max(1, Math.round(rawArgs.limit)))
      : 20;

  let events = [...(state.workspaceBriefing.upcomingEvents ?? [])];
  if (datePrefix) {
    events = events.filter(
      (ev) => (ev.start || '').startsWith(datePrefix) || (ev.end || '').startsWith(datePrefix)
    );
  }
  if (searchQuery) {
    events = events.filter((ev) => {
      const hay = `${ev.summary || ''} ${ev.location || ''} ${ev.description || ''}`.toLowerCase();
      return hay.includes(searchQuery);
    });
  }

  return {
    ok: true,
    connected: Boolean(state.workspaceBriefing.connected),
    calendarStatus: state.workspaceBriefing.calendarStatus ?? 'unavailable',
    eventCount: events.length,
    events: events.slice(0, limitNum).map((ev) => ({
      id: ev.id,
      summary: ev.summary,
      start: ev.start,
      end: ev.end,
      location: ev.location,
      description: ev.description ? ev.description.slice(0, 400) : undefined,
    })),
  };
}

async function executeReadDriveFilesTool(
  rawArgs: Record<string, unknown>,
  state: ThreadExecutionState
): Promise<Record<string, unknown>> {
  const action =
    typeof rawArgs.action === 'string' && rawArgs.action.trim() === 'read_file'
      ? 'read_file'
      : 'search_files';
  const authHeader = state.workspaceAuthHeader;

  try {
    if (action === 'read_file') {
      const targetId =
        typeof rawArgs.file_id_or_url === 'string' ? rawArgs.file_id_or_url.trim() : '';
      if (!targetId) {
        return { ok: false, error: 'Provide "file_id_or_url" when action="read_file".' };
      }
      const cached = [
        ...(state.workspaceBriefing.pinnedDriveFiles ?? []),
        ...(state.workspaceBriefing.workingFolderFiles ?? []),
        ...(state.workspaceBriefing.driveFiles ?? []),
      ].find((f) => f.id === targetId || f.webViewLink === targetId);
      if ((!authHeader || !authHeader.startsWith('Bearer ')) && cached) {
        return {
          ok: true,
          source: 'cached_snapshot',
          file: {
            id: cached.id,
            name: cached.name,
            mimeType: cached.mimeType,
            modifiedTime: cached.modifiedTime,
            excerpt: cached.content?.slice(0, 3000) || cached.excerpt || '',
          },
        };
      }
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return {
          ok: false,
          error: 'Google Workspace live token is not attached to read uncached Drive files.',
        };
      }
      const file = await readGoogleDriveFileContent(authHeader, targetId);
      return {
        ok: true,
        source: 'live_drive',
        file: {
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          excerpt: (file.content || file.excerpt || '').slice(0, 3500),
        },
      };
    }

    const query = typeof rawArgs.query === 'string' ? rawArgs.query.trim() : '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const files = await searchGoogleDriveFiles(
        authHeader,
        query || undefined,
        state.workspaceBriefing.workingFolder?.id
      );
      return {
        ok: true,
        source: 'live_drive',
        count: files.length,
        files: files.slice(0, 20).map((f) => ({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          modifiedTime: f.modifiedTime,
          isFolder: f.isFolder,
        })),
      };
    }

    const fallbackList = [
      ...(state.workspaceBriefing.workingFolderFiles ?? []),
      ...(state.workspaceBriefing.pinnedDriveFiles ?? []),
      ...(state.workspaceBriefing.driveFiles ?? []),
    ].filter((f) => (!query ? true : f.name.toLowerCase().includes(query.toLowerCase())));

    return {
      ok: true,
      source: 'cached_snapshot',
      count: fallbackList.length,
      files: fallbackList.slice(0, 20).map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        modifiedTime: f.modifiedTime,
        excerpt: f.excerpt,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to read Google Drive files.',
    };
  }
}

function mergeSourcesIntoState(state: ThreadExecutionState, incoming: GroundSource[]) {
  const existingUris = new Set(state.groundingSources.map((s) => s.uri));
  for (const src of incoming) {
    if (src.uri && !existingUris.has(src.uri)) {
      existingUris.add(src.uri);
      state.groundingSources.push(src);
    }
  }
}

function sanitizeKbRefs(rawRefs: unknown, liveEntries: KnowledgeEntry[]): string[] {
  const validCodes = new Set(mergeKnowledgeBase(liveEntries).map((e) => e.code.toUpperCase()));
  const refs: string[] = [];
  if (Array.isArray(rawRefs)) {
    for (const item of rawRefs) {
      if (typeof item !== 'string') continue;
      const upper = item.trim().toUpperCase();
      if (upper && (validCodes.has(upper) || /^KB-(GOV|SOP|RES|MEM)-\d{2,}$/.test(upper))) {
        if (!refs.includes(upper)) refs.push(upper);
      }
    }
  }
  if (refs.length === 0) {
    refs.push('KB-GOV-01', 'KB-SOP-01', 'KB-SOP-02');
  }
  return refs.slice(0, 8);
}

function stageApprovalFromArgs(
  args: Record<string, unknown>,
  caller: AgentDossier,
  state: ThreadExecutionState
): { ok: true; approval: StagedApprovalProposal } | { ok: false; error: string } {
  const rawType = typeof args.type === 'string' ? args.type.trim() : '';
  const validTypes = new Set([
    'email_draft',
    'calendar_event',
    'chat_message',
    'google_doc',
    'drive_file',
    'spend',
    'publish',
  ]);
  if (!validTypes.has(rawType)) {
    return {
      ok: false,
      error: `Invalid approval type "${rawType}". Expected email_draft, calendar_event, chat_message, google_doc, drive_file, spend, or publish.`,
    };
  }

  if (rawType === 'calendar_event' && !state.calendarWriteAccess && state.mode !== 'autonomous') {
    return {
      ok: false,
      error:
        'Calendar Write Access is currently OFF (Read-Only) in Settings → Calendar. Recommend times in text and advise the CHO they can enable Calendar Write Access in Settings.',
    };
  }

  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const description = typeof args.description === 'string' ? args.description.trim() : '';
  if (!title) {
    return { ok: false, error: 'Decision packet title is required.' };
  }

  let eventStart: string | undefined;
  let eventEnd: string | undefined;
  if (rawType === 'calendar_event') {
    const normStart = normalizeIsoTimestamp(
      typeof args.eventStart === 'string' ? args.eventStart : undefined,
      state.clientTime?.offset
    );
    if (!normStart) {
      return {
        ok: false,
        error:
          'Valid ISO-8601 eventStart timestamp is required when staging a calendar_event approval.',
      };
    }
    const normEndRaw = normalizeIsoTimestamp(
      typeof args.eventEnd === 'string' ? args.eventEnd : undefined,
      state.clientTime?.offset
    );
    eventStart = normStart;
    eventEnd =
      normEndRaw && Date.parse(normEndRaw) > Date.parse(normStart)
        ? normEndRaw
        : addMinutesWithOffset(normStart, 30);
  }

  const fallbackPinned = state.workspaceBriefing.pinnedChats?.[0];
  const fallbackSpace = state.workspaceBriefing.chatSpaces?.[0];
  const approval: StagedApprovalProposal = {
    needed: true,
    type: rawType as Exclude<ApprovalType, 'hire'>,
    title,
    description: description || `Staged by ${caller.name} for explicit CHO sign-off.`,
    to: typeof args.to === 'string' ? args.to.trim() : undefined,
    subject: typeof args.subject === 'string' ? args.subject.trim() : undefined,
    body: typeof args.body === 'string' ? args.body : undefined,
    eventSummary:
      typeof args.eventSummary === 'string' && args.eventSummary.trim()
        ? args.eventSummary.trim()
        : rawType === 'calendar_event'
          ? title
          : undefined,
    eventStart,
    eventEnd,
    eventLocation: typeof args.eventLocation === 'string' ? args.eventLocation.trim() : undefined,
    eventDescription:
      typeof args.eventDescription === 'string' ? args.eventDescription.trim() : undefined,
    chatSpaceName:
      typeof args.chatSpaceName === 'string' && args.chatSpaceName.trim()
        ? args.chatSpaceName.trim()
        : rawType === 'chat_message'
          ? fallbackPinned?.spaceName ?? fallbackSpace?.name
          : undefined,
    chatSpaceDisplayName:
      typeof args.chatSpaceDisplayName === 'string' && args.chatSpaceDisplayName.trim()
        ? args.chatSpaceDisplayName.trim()
        : rawType === 'chat_message'
          ? fallbackPinned?.spaceDisplayName ?? fallbackSpace?.displayName
          : undefined,
    chatThreadName:
      typeof args.chatThreadName === 'string' && args.chatThreadName.trim()
        ? args.chatThreadName.trim()
        : rawType === 'chat_message'
          ? fallbackPinned?.threadName
          : undefined,
    docTitle: typeof args.docTitle === 'string' ? args.docTitle.trim() : undefined,
    driveFileName: typeof args.driveFileName === 'string' ? args.driveFileName.trim() : undefined,
    amount: typeof args.amount === 'string' ? args.amount.trim() : undefined,
    vendor: typeof args.vendor === 'string' ? args.vendor.trim() : undefined,
    postPlatform: typeof args.postPlatform === 'string' ? args.postPlatform.trim() : undefined,
    postContent: typeof args.postContent === 'string' ? args.postContent : undefined,
  };

  state.stagedApproval = approval;
  const dedupeKey = `${approval.type}:${approval.title.toLowerCase()}`;
  state.stagedApprovals = [
    ...state.stagedApprovals.filter(
      (item) => `${item.type}:${item.title.toLowerCase()}` !== dedupeKey
    ),
    approval,
  ];
  return { ok: true, approval };
}

/**
 * Executes a single typed collaborator hop (Guild Specialist or Cross-House Director)
 * within the shared task_id thread, enforcing depth, hop, cycle, and timeout caps.
 */
async function executeCollaboratorHop(params: {
  state: ThreadExecutionState;
  fromAgent: AgentDossier;
  rawArgs: Record<string, unknown>;
  depth: number;
  callChain: string[];
}): Promise<HandoffArtifact> {
  const { state, fromAgent, rawArgs, depth, callChain } = params;

  if (Date.now() >= state.workflowDeadlineMs) {
    throw new OrchestrationAbortError(
      'Workflow exceeded total execution time budget. Aborting fail-closed.',
      'aborted_cap_reached'
    );
  }

  if (depth > MAX_HANDOFF_DEPTH) {
    throw new OrchestrationAbortError(
      `Max handoff depth (${MAX_HANDOFF_DEPTH}) exceeded attempting hop from ${fromAgent.name}. Aborting fail-closed.`,
      'aborted_cap_reached'
    );
  }

  if (state.hopCount >= state.maxHops) {
    throw new OrchestrationAbortError(
      `Max agent hops (${state.maxHops}) reached before dispatching next handoff. Aborting fail-closed.`,
      'aborted_cap_reached'
    );
  }

  const rawTarget = typeof rawArgs.to_agent === 'string' ? rawArgs.to_agent : '';
  const targetAgent = resolveRosterAgent(rawTarget, state.roster);
  if (!targetAgent || targetAgent.role === 'cho') {
    throw new OrchestrationAbortError(
      `Handoff target "${rawTarget}" could not be resolved to any valid Guildhaven Director or Specialist.`,
      'failed'
    );
  }

  if (callChain.includes(targetAgent.id)) {
    throw new OrchestrationAbortError(
      `Cyclic handoff detected (${[...callChain, targetAgent.id].join(' -> ')}). Aborting fail-closed.`,
      'aborted_cap_reached'
    );
  }

  const objective = typeof rawArgs.objective === 'string' ? rawArgs.objective.trim() : '';
  if (objective.length < 5) {
    throw new OrchestrationAbortError(
      `Invalid KB-SOP-02 handoff packet from ${fromAgent.name} to ${targetAgent.name}: objective is missing or empty.`,
      'failed'
    );
  }

  const kbRefs = sanitizeKbRefs(rawArgs.kb_refs, state.liveKnowledgeBase);
  const verifiedFacts = Array.isArray(rawArgs.verified_facts)
    ? rawArgs.verified_facts.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  const constraints = Array.isArray(rawArgs.constraints)
    ? rawArgs.constraints.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : ['Honor KB-GOV-01 Human-in-the-Loop guardrails; never execute external writes directly.'];
  const expectedFields = Array.isArray(rawArgs.expected_output_fields)
    ? rawArgs.expected_output_fields.filter(
        (f): f is string => typeof f === 'string' && f.trim().length > 0
      )
    : ['summary', 'deliverable_markdown', 'verified_claims', 'risks'];

  state.hopCount += 1;
  state.collaboratorIds.add(targetAgent.id);
  state.hopSequenceIds.push(targetAgent.id);
  const sequence = state.packets.length + 1;
  const startedMs = Date.now();
  const startedIso = new Date(startedMs).toISOString();

  const packet: HandoffPacket = {
    handoff_id: `hop_${state.taskId}_${sequence}`,
    task_id: state.taskId,
    depth,
    sequence,
    from_agent: fromAgent.id,
    from_agent_name: fromAgent.name,
    from_house: fromAgent.department,
    to_agent: targetAgent.id,
    to_agent_name: targetAgent.name,
    to_house: targetAgent.department,
    objective,
    kb_refs: kbRefs,
    verified_facts: verifiedFacts,
    constraints,
    expected_output_schema: {
      format: 'structured_json',
      required_fields: expectedFields,
    },
    status: 'running',
    started_at: startedIso,
  };
  state.packets.push(packet);

  try {
    const ai = getAiClient();
    const kbContextBlock = buildKnowledgeGroundTruthBlock(
      state.liveKnowledgeBase,
      targetAgent.department,
      state.houseNotes,
      packet.kb_refs
    );
    const workspaceSnippet = formatWorkspaceContextForPrompts(
      state.workspaceBriefing,
      state.calendarWriteAccess,
      state.clientTime
    );

    const canonicalWirePacket = {
      task_id: packet.task_id,
      from_agent: `${fromAgent.id} (${fromAgent.name} · ${fromAgent.department})`,
      to_agent: `${targetAgent.id} (${targetAgent.name} · ${targetAgent.department})`,
      objective: packet.objective,
      kb_refs: packet.kb_refs,
      verified_facts: packet.verified_facts,
      constraints: packet.constraints,
      expected_output_schema: packet.expected_output_schema,
      status: packet.status,
    };

    const priorArtifactsBlock =
      state.verifiedArtifacts.length > 0
        ? `\nPRIOR VERIFIED ARTIFACTS IN THREAD (${state.taskId}):\n${state.verifiedArtifacts
            .map(
              (art, idx) =>
                `[${idx + 1}] ${art.agent_name} (${art.house}): ${art.summary}\n${art.deliverable_markdown.slice(0, 1800)}`
            )
            .join('\n\n')}`
        : '\nPRIOR VERIFIED ARTIFACTS IN THREAD: None yet (you are the first specialist/collaborator hop).';

    const allowKbProposalTool = canAgentProposeKbEntry(targetAgent);
    const allowSubHandoff =
      targetAgent.role === 'director' &&
      depth < MAX_HANDOFF_DEPTH &&
      state.hopCount < state.maxHops;
    const needsSearch =
      targetAgent.id === 'aria' ||
      targetAgent.id === 'worker_aria' ||
      targetAgent.id === 'elena' ||
      targetAgent.id === 'kieran' ||
      /\b(latest|price|pricing|202\d|search|research|compare|benchmark|market|api|rfc|docs|citations|vendor)\b/i.test(
        objective
      );

    const needsGoogleChatRead =
      Boolean(state.workspaceAuthHeader) &&
      (targetAgent.id === 'daniel' ||
        targetAgent.id === 'worker_daniel' ||
        /\b(google\s+chat|chat\s+space|chat\s+thread|spaces\/|chat\.google\.com)\b/i.test(
          objective
        ));

    const needsGmailRead =
      Boolean(state.workspaceAuthHeader) &&
      (targetAgent.id === 'daniel' ||
        targetAgent.id === 'worker_daniel' ||
        /\b(gmail|email|emails|inbox|label|labels|unread|thread)\b/i.test(objective));

    const needsCalendarRead =
      targetAgent.id === 'daniel' ||
      targetAgent.id === 'worker_daniel' ||
      /\b(calendar|schedule|meeting|ooo|buffer|event)\b/i.test(objective);

    const needsDriveRead =
      /\b(drive|doc|docs|sheet|folder|file)\b/i.test(objective);

    const rawFnDeclarations: FunctionDeclaration[] = [];
    if (allowSubHandoff) {
      rawFnDeclarations.push(buildDispatchHandoffDeclaration(state.roster, targetAgent.id));
    }
    if (allowKbProposalTool) {
      rawFnDeclarations.push(buildProposeKbDeclaration(state.liveKnowledgeBase));
    }
    if (needsGoogleChatRead) {
      rawFnDeclarations.push(buildReadGoogleChatDeclaration(state.workspaceBriefing));
    }
    if (needsGmailRead) {
      rawFnDeclarations.push(buildReadGmailDeclaration(state.workspaceBriefing));
    }
    if (needsCalendarRead) {
      rawFnDeclarations.push(buildReadCalendarEventsDeclaration(state.workspaceBriefing));
    }
    if (needsDriveRead) {
      rawFnDeclarations.push(buildReadDriveFilesDeclaration(state.workspaceBriefing));
    }
    const fnDeclarations =
      state.mode === 'autonomous'
        ? rawFnDeclarations.filter((d) => Boolean(d.name && AUTONOMOUS_SAFE_TOOL_WHITELIST.has(d.name)))
        : rawFnDeclarations;

    const collaboratorPrompt = [
      `TYPED HANDOFF PACKET (KB-SOP-02 JSON):`,
      JSON.stringify(canonicalWirePacket, null, 2),
      priorArtifactsBlock,
      workspaceSnippet,
      '',
      kbContextBlock,
      '',
      `Execute your assigned objective thoroughly as ${targetAgent.name} (${targetAgent.title}, ${targetAgent.department}).`,
      allowKbProposalTool
        ? `If your handoff objective explicitly asks you to stage a Knowledge Base entry or update, invoke propose_kb_entry once with a valid KB-* ID.`
        : `Do NOT attempt to write directly to the Knowledge Base; include any recommended SOP/research points in your deliverable for your Director or KB Co-Leads.`,
      `Return your completed work clearly structured with:`,
      `1. A 1-2 sentence Executive Summary at the top`,
      `2. Complete Markdown specification/findings addressing [${expectedFields.join(', ')}]`,
      `3. Bullet list of Verified Claims & Risks.`,
    ].join('\n');

    let finalHopText = '';
    const hopSources: GroundSource[] = [];

    if (fnDeclarations.length > 0 || needsSearch) {
      const tools: Array<Record<string, unknown>> = [];
      if (needsSearch) tools.push({ googleSearch: {} });
      if (fnDeclarations.length > 0) tools.push({ functionDeclarations: fnDeclarations });

      const contents: Content[] = [{ role: 'user', parts: [{ text: collaboratorPrompt }] }];
      const nextChain = [...callChain, targetAgent.id];

      for (let turn = 0; turn < 3; turn += 1) {
        const remainingMs = Math.min(
          STEP_TIMEOUT_MS,
          Math.max(5_000, state.workflowDeadlineMs - Date.now())
        );
        const res = await withTimeout(
          ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents,
            config: {
              tools,
              ...(needsSearch && fnDeclarations.length > 0
                ? { toolConfig: { includeServerSideToolInvocations: true } }
                : {}),
              thinkingConfig: {
                thinkingLevel:
                  targetAgent.role === 'director' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
              },
              systemInstruction: `${targetAgent.instructions}\n\n${VILLAGE_CONSTITUTION}\nOperate strictly from the Centralized Village Knowledge Base (KB-*) and your received KB-SOP-02 handoff packet.`,
            },
          }),
          remainingMs,
          `Collaborator turn (${targetAgent.name})`
        );

        const extracted = extractGroundingSources(res);
        hopSources.push(...extracted);
        mergeSourcesIntoState(state, extracted);

        const calls = res.functionCalls ?? [];
        if (calls.length === 0) {
          finalHopText = (res.text ?? '').trim();
          break;
        }

        const modelContent = res.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const responseParts: Part[] = [];
        for (const call of calls) {
          const callName = call.name || '';
          if (state.mode === 'autonomous' && !AUTONOMOUS_SAFE_TOOL_WHITELIST.has(callName)) {
            throw new OrchestrationAbortError(
              `Blocked unauthorized tool "${callName}" in autonomous safe-zone runner (KB-GOV-01).`,
              'failed'
            );
          }
          const callArgs = (call.args ?? {}) as Record<string, unknown>;
          if (callName === 'dispatch_handoff') {
            const subArtifact = await executeCollaboratorHop({
              state,
              fromAgent: targetAgent,
              rawArgs: callArgs,
              depth: depth + 1,
              callChain: nextChain,
            });
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: { ok: true, artifact: subArtifact },
              },
            });
          } else if (callName === 'propose_kb_entry') {
            const validation = validateKnowledgeProposalInput({
              taskId: state.taskId,
              rawId: typeof callArgs.id === 'string' ? callArgs.id : undefined,
              actionType:
                typeof callArgs.action_type === 'string' ? callArgs.action_type : undefined,
              title: typeof callArgs.title === 'string' ? callArgs.title : undefined,
              scope: typeof callArgs.scope === 'string' ? callArgs.scope : undefined,
              owners: typeof callArgs.owners === 'string' ? callArgs.owners : undefined,
              summary: typeof callArgs.summary === 'string' ? callArgs.summary : undefined,
              details: typeof callArgs.details === 'string' ? callArgs.details : undefined,
              rationale: typeof callArgs.rationale === 'string' ? callArgs.rationale : undefined,
              proposedByAgent: targetAgent,
              sources: hopSources,
              liveKnowledgeBase: state.liveKnowledgeBase,
            });
            if (validation.ok) {
              state.stagedKbProposals = [
                ...state.stagedKbProposals.filter((p) => p.id !== validation.proposal.id),
                validation.proposal,
              ];
              responseParts.push({
                functionResponse: {
                  ...(call.id ? { id: call.id } : {}),
                  name: callName,
                  response: {
                    ok: true,
                    status: 'pending_cho_approval',
                    proposal_id: validation.proposal.proposal_id,
                    id: validation.proposal.id,
                    action_type: validation.proposal.action_type,
                    message: `Staged ${validation.proposal.id} as a pending CHO Decision Packet (not yet live in KB until CHO approves).`,
                  },
                },
              });
            } else {
              responseParts.push({
                functionResponse: {
                  ...(call.id ? { id: call.id } : {}),
                  name: callName,
                  response: { ok: false, error: validation.error },
                },
              });
            }
          } else if (callName === 'read_google_chat') {
            const chatReadResult = await executeReadGoogleChatTool(callArgs, state);
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: chatReadResult,
              },
            });
          } else if (callName === 'read_gmail_messages') {
            const gmailReadResult = await executeReadGmailTool(callArgs, state);
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: gmailReadResult,
              },
            });
          } else if (callName === 'read_calendar_events') {
            const calReadResult = executeReadCalendarEventsTool(callArgs, state);
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: calReadResult,
              },
            });
          } else if (callName === 'read_drive_files') {
            const driveReadResult = await executeReadDriveFilesTool(callArgs, state);
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: driveReadResult,
              },
            });
          } else {
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName || 'unknown',
                response: { ok: false, error: `Unsupported tool "${callName}".` },
              },
            });
          }
        }

        contents.push({ role: 'user', parts: responseParts });
      }
    } else {
      // Fast structured JSON specialist turn on gemini-3.1-flash-lite
      const remainingMs = Math.min(
        STEP_TIMEOUT_MS,
        Math.max(500, state.workflowDeadlineMs - Date.now())
      );
      const res = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: collaboratorPrompt,
          config: {
            systemInstruction: `${targetAgent.instructions}\n\n${VILLAGE_CONSTITUTION}\nOperate strictly from the Centralized Village Knowledge Base (KB-*) and your received KB-SOP-02 handoff packet. Return structured JSON.`,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING },
                deliverable_markdown: { type: Type.STRING },
                verified_claims: { type: Type.ARRAY, items: { type: Type.STRING } },
                risks: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['summary', 'deliverable_markdown', 'verified_claims'],
            },
          },
        }),
        remainingMs,
        `Specialist turn (${targetAgent.name})`
      );

      const parsed = JSON.parse((res.text ?? '{}').trim()) as {
        summary?: string;
        deliverable_markdown?: string;
        verified_claims?: string[];
        risks?: string[];
      };
      const completedMs = Date.now();
      const artifact: HandoffArtifact = {
        agent_id: targetAgent.id,
        agent_name: targetAgent.name,
        house: targetAgent.department,
        summary: (parsed.summary || `Completed specialist brief for ${fromAgent.name}.`).trim(),
        deliverable_markdown: (parsed.deliverable_markdown || res.text || '').trim(),
        verified_claims: Array.isArray(parsed.verified_claims)
          ? parsed.verified_claims.slice(0, 8)
          : [],
        citations: [],
        risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 5) : undefined,
      };
      if (!artifact.deliverable_markdown) {
        throw new OrchestrationAbortError(
          `${targetAgent.name} returned an empty deliverable artifact.`,
          'failed'
        );
      }

      packet.status = 'completed';
      packet.completed_at = new Date(completedMs).toISOString();
      packet.duration_ms = Math.max(80, completedMs - startedMs);
      packet.output_artifact = artifact;
      state.verifiedArtifacts.push(artifact);
      return artifact;
    }

    if (!finalHopText) {
      throw new OrchestrationAbortError(
        `${targetAgent.name} did not produce a final deliverable within tool loop bounds.`,
        'aborted_cap_reached'
      );
    }

    const firstSentence =
      finalHopText
        .replace(/^#+\s*executive\s+summary\s*/i, '')
        .split(/\n+/)
        .map((l) => l.replace(/^[-*#>\s]+/, '').trim())
        .find((l) => l.length > 15) || `Verified contribution from ${targetAgent.name}.`;

    const completedMs = Date.now();
    const artifact: HandoffArtifact = {
      agent_id: targetAgent.id,
      agent_name: targetAgent.name,
      house: targetAgent.department,
      summary: firstSentence.length > 200 ? `${firstSentence.slice(0, 197)}...` : firstSentence,
      deliverable_markdown: finalHopText,
      verified_claims: kbRefs.map((ref) => `Aligned with ${ref}`),
      citations: hopSources.slice(0, 6),
    };

    packet.status = 'completed';
    packet.completed_at = new Date(completedMs).toISOString();
    packet.duration_ms = Math.max(80, completedMs - startedMs);
    packet.output_artifact = artifact;
    state.verifiedArtifacts.push(artifact);
    return artifact;
  } catch (err) {
    const completedMs = Date.now();
    const abortKind =
      err instanceof OrchestrationAbortError ? err.abortKind : 'failed';
    const message =
      err instanceof Error ? err.message : `Unexpected error during ${targetAgent.name} handoff.`;
    packet.status = abortKind;
    packet.completed_at = new Date(completedMs).toISOString();
    packet.duration_ms = Math.max(50, completedMs - startedMs);
    packet.error_detail = message;
    state.abortedReason = message;
    state.abortedKind = abortKind;
    throw err instanceof OrchestrationAbortError
      ? err
      : new OrchestrationAbortError(message, abortKind);
  }
}

function extractSummaryFromMarkdown(markdown: string, fallbackPrompt: string): string {
  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,4}\s*executive\s+summary/i.test(line) && lines[i + 1]) {
      const candidate = lines[i + 1].replace(/^[-*>]\s*/, '').replace(/\*\*/g, '').trim();
      if (candidate.length >= 12) {
        return candidate.length > 220 ? `${candidate.slice(0, 217)}...` : candidate;
      }
    }
  }
  const firstProse = lines.find(
    (l) => !l.startsWith('#') && !l.startsWith('---') && !l.startsWith('|') && l.length >= 16
  );
  if (firstProse) {
    const clean = firstProse.replace(/^[-*>]\s*/, '').replace(/\*\*/g, '').trim();
    return clean.length > 220 ? `${clean.slice(0, 217)}...` : clean;
  }
  return `Completed unified deliverable for "${fallbackPrompt.slice(0, 60)}".`;
}

/**
 * Full Hub-and-Spoke Orchestrated Village Task Runner (KB-SOP-01 & KB-SOP-02):
 * Matt (Triage) -> Coordinating House Director -> Guild Specialist(s) & Cross-House Collaborators
 * -> Coordinating House Director Synthesis -> CHO (one unified deliverable + HandoffTrace + staged packets).
 */
export async function runOrchestratedVillageTask(params: {
  taskId: string;
  prompt: string;
  priority: TaskPriority;
  targetDirectorId?: string | null;
  roster: AgentDossier[];
  liveKnowledgeBase: KnowledgeEntry[];
  houseNotes: Record<string, string[]>;
  workspaceBriefing: WorkspaceBriefingPayload;
  workspaceAuthHeader?: string;
  calendarWriteAccess: boolean;
  clientTime?: ClientTimeContext;
  mode?: 'interactive' | 'autonomous';
  maxDurationMs?: number;
  maxAgentHops?: number;
  simulateDelayMs?: number;
}): Promise<{
  ok: boolean;
  failedClosed: boolean;
  errorBanner?: string;
  routing: Awaited<ReturnType<typeof routeTaskWithMatt>>;
  chosenDirector: AgentDossier;
  primaryWorker: AgentDossier | null;
  collaboratorIds: string[];
  agentTrace: string[];
  summary: string;
  reportMarkdown: string;
  newDirectorNote: string;
  groundingSources: GroundSource[];
  handoffTrace: HandoffTrace;
  stagedKbProposals: KnowledgeProposal[];
  approvalProposal: StagedApprovalProposal | null;
  stagedApprovals: StagedApprovalProposal[];
}> {
  const {
    taskId,
    prompt,
    priority,
    targetDirectorId,
    roster,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    workspaceAuthHeader,
    calendarWriteAccess,
    clientTime,
    mode = 'interactive',
    maxDurationMs,
    maxAgentHops,
    simulateDelayMs,
  } = params;

  const effectiveTimeoutMs =
    typeof maxDurationMs === 'number' && Number.isFinite(maxDurationMs) && maxDurationMs >= 200
      ? Math.round(maxDurationMs)
      : WORKFLOW_TIMEOUT_MS;
  const effectiveMaxHops =
    typeof maxAgentHops === 'number' && Number.isFinite(maxAgentHops) && maxAgentHops >= 1
      ? Math.round(maxAgentHops)
      : MAX_AGENT_CALLS_PER_TASK;

  const workflowStartedMs = Date.now();
  const workflowStartedIso = new Date(workflowStartedMs).toISOString();
  const workflowDeadlineMs = workflowStartedMs + effectiveTimeoutMs;

  const directors = roster.filter((a) => a.role === 'director');
  const fallbackDirector =
    (targetDirectorId ? directors.find((d) => d.id === targetDirectorId) : undefined) ??
    directors[0];

  let routing: Awaited<ReturnType<typeof routeTaskWithMatt>>;
  try {
    if (
      typeof simulateDelayMs === 'number' &&
      Number.isFinite(simulateDelayMs) &&
      simulateDelayMs > 0
    ) {
      await withTimeout(
        new Promise<void>((resolve) => setTimeout(resolve, simulateDelayMs)),
        Math.max(100, workflowDeadlineMs - Date.now()),
        'Autonomous background runner budget'
      );
    }

    const mattBudgetMs = Math.min(
      STEP_TIMEOUT_MS,
      Math.max(250, workflowDeadlineMs - Date.now())
    );
    routing = await withTimeout(
      routeTaskWithMatt(prompt, directors, priority, targetDirectorId),
      mattBudgetMs,
      'Matt triage routing'
    );
  } catch (triageErr) {
    const completedIso = new Date().toISOString();
    const errorBanner =
      triageErr instanceof Error
        ? triageErr.message
        : 'Triage exceeded autonomous execution budget.';
    const primaryWorkerFallback =
      roster.find((w) => w.role === 'worker' && w.buildingId === fallbackDirector.buildingId) ??
      null;
    const abortedTrace: HandoffTrace = {
      task_id: taskId,
      root_agent: 'matt',
      coordinating_director: fallbackDirector.id,
      coordinating_director_name: fallbackDirector.name,
      status: 'aborted_cap_reached',
      total_hops: 0,
      max_hops: effectiveMaxHops,
      max_depth: MAX_HANDOFF_DEPTH,
      started_at: workflowStartedIso,
      completed_at: completedIso,
      error_banner: errorBanner,
      packets: [],
      staged_kb_proposal_ids: [],
    };
    return {
      ok: false,
      failedClosed: true,
      errorBanner,
      routing: {
        directorId: fallbackDirector.id,
        routingNote: `Aborted fail-closed during triage: ${errorBanner}`,
        needsWebSearch: false,
        escalateToAdvisor: false,
        approvalHint: 'none',
      },
      chosenDirector: fallbackDirector,
      primaryWorker: primaryWorkerFallback,
      collaboratorIds: [],
      agentTrace: ['matt'],
      summary: `Workflow halted (fail-closed): ${errorBanner}`,
      reportMarkdown: `### Orchestration Aborted (Fail-Closed)\n- **Reason**: ${errorBanner}`,
      newDirectorNote: `Aborted task ${taskId} (fail-closed): ${errorBanner.slice(0, 72)}`,
      groundingSources: [],
      handoffTrace: abortedTrace,
      stagedKbProposals: [],
      approvalProposal: null,
      stagedApprovals: [],
    };
  }

  const chosenDirector =
    directors.find((d) => d.id === routing.directorId) ?? fallbackDirector;
  const primaryWorker =
    roster.find((w) => w.role === 'worker' && w.buildingId === chosenDirector.buildingId) ?? null;

  const state: ThreadExecutionState = {
    taskId,
    mode,
    maxHops: effectiveMaxHops,
    workflowDeadlineMs,
    roster,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    workspaceAuthHeader,
    calendarWriteAccess,
    clientTime,
    packets: [],
    verifiedArtifacts: [],
    stagedKbProposals: [],
    stagedApproval: null,
    stagedApprovals: [],
    groundingSources: [],
    collaboratorIds: new Set<string>(),
    hopSequenceIds: [],
    hopCount: 1, // Coordinating Director root turn counts as hop 1
    abortedReason: null,
    abortedKind: null,
  };

  // Record initial Triage Handoff Packet (Matt -> Coordinating House Director)
  const triageCompletedIso = new Date().toISOString();
  const triageKbRefs = sanitizeKbRefs(
    mode === 'autonomous'
      ? ['KB-GOV-01', 'KB-SOP-01', 'KB-SOP-02', 'KB-SOP-06', 'KB-RES-06']
      : ['KB-GOV-01', 'KB-SOP-01', 'KB-SOP-02'],
    liveKnowledgeBase
  );
  state.packets.push({
    handoff_id: `hop_${taskId}_1`,
    task_id: taskId,
    depth: 0,
    sequence: 1,
    from_agent: mode === 'autonomous' || !targetDirectorId ? 'matt' : 'cho',
    from_agent_name: mode === 'autonomous' || !targetDirectorId ? 'Matt' : 'You (CHO)',
    from_house:
      mode === 'autonomous' || !targetDirectorId ? 'Town Hall Dispatch' : 'Executive Command',
    to_agent: chosenDirector.id,
    to_agent_name: chosenDirector.name,
    to_house: chosenDirector.department,
    objective: prompt,
    kb_refs: triageKbRefs,
    verified_facts: [
      `Execution Mode: ${mode === 'autonomous' ? 'Supervised Autonomous Background Run' : 'Interactive CHO Dispatch'}`,
      `Priority: ${priority.toUpperCase()}`,
      routing.routingNote,
      workspaceBriefing.connected
        ? `Google Workspace connected (${workspaceBriefing.unreadCount} unread emails)`
        : 'Google Workspace offline snapshot mode',
    ],
    constraints: [
      'Coordinate required Guild Specialists and any cross-House Directors/Specialists via dispatch_handoff (KB-SOP-02).',
      'Stage any KB-* additions/updates via propose_kb_entry (never mutate live KB directly).',
      'Stage external/irreversible actions via stage_cho_decision_packet (KB-GOV-01).',
    ],
    expected_output_schema: {
      format: 'executive_markdown',
      required_fields: ['executive_summary', 'unified_deliverable', 'governance_status'],
    },
    status: 'completed',
    started_at: workflowStartedIso,
    completed_at: triageCompletedIso,
    duration_ms: Math.max(60, Date.now() - workflowStartedMs),
  });

  const ai = getAiClient();
  const kbContext = buildKnowledgeGroundTruthBlock(
    liveKnowledgeBase,
    chosenDirector.department,
    houseNotes,
    triageKbRefs
  );
  const workspaceSnippet = formatWorkspaceContextForPrompts(
    workspaceBriefing,
    calendarWriteAccess,
    clientTime
  );

  const rosterDirectoryLines = roster
    .filter((a) => a.id !== 'matt' && a.role !== 'cho' && a.id !== chosenDirector.id)
    .map(
      (a) =>
        `- ${a.id}: ${a.name} (${a.role === 'director' ? 'House Director' : 'Guild Specialist'} · ${a.department} — ${a.title})`
    )
    .join('\n');

  const urgencyLine =
    priority === 'high'
      ? 'HIGH PRIORITY (Urgent — lead with immediate decisions, critical risks, and crisp execution)'
      : priority === 'low'
        ? 'LOW PRIORITY (Background reference briefing)'
        : 'MEDIUM PRIORITY (Standard executive turnaround)';

  const rawFnDeclarations: FunctionDeclaration[] = [
    buildDispatchHandoffDeclaration(roster, chosenDirector.id),
    buildProposeKbDeclaration(liveKnowledgeBase),
    buildStageDecisionPacketDeclaration(calendarWriteAccess, mode),
    buildReadCalendarEventsDeclaration(workspaceBriefing),
    buildReadDriveFilesDeclaration(workspaceBriefing),
  ];
  if (workspaceAuthHeader && workspaceAuthHeader.startsWith('Bearer ')) {
    rawFnDeclarations.push(buildReadGoogleChatDeclaration(workspaceBriefing));
    rawFnDeclarations.push(buildReadGmailDeclaration(workspaceBriefing));
  }
  const fnDeclarations =
    mode === 'autonomous'
      ? rawFnDeclarations.filter((d) => Boolean(d.name && AUTONOMOUS_SAFE_TOOL_WHITELIST.has(d.name)))
      : rawFnDeclarations;

  const tools: Array<Record<string, unknown>> = [{ functionDeclarations: fnDeclarations }];
  if (routing.needsWebSearch) {
    tools.unshift({ googleSearch: {} });
  }

  const autonomousGuardrailBlock =
    mode === 'autonomous'
      ? [
          `AUTONOMOUS SAFE-ZONE RULES (KB-SOP-01 & KB-GOV-01 — STRICT):`,
          `- You are running headlessly in the background without an active CHO chat prompt.`,
          `- Delegate drafting/inspection to your House Specialist (${primaryWorker?.name ?? 'specialist'}) via dispatch_handoff when helpful (within max ${Math.max(1, effectiveMaxHops - 1)} collaborator hops).`,
          `- ONLY call stage_cho_decision_packet or propose_kb_entry if there is a concrete, high-signal action requiring CHO sign-off. If everything is healthy / routine noise with no action required, DO NOT stage unnecessary packets—simply return a concise 1-2 sentence quiet digest summary under "### Executive Summary".`,
          `- NEVER execute or claim direct external writes (no direct email sends, calendar mutations, chat posts, or live KB edits).`,
        ].join('\n')
      : '';

  const directorPrompt = [
    `ACTIVE TASK THREAD ID: ${taskId}`,
    mode === 'autonomous'
      ? `AUTONOMOUS BACKGROUND TRIGGER OBJECTIVE: "${prompt}"`
      : `CHO REQUEST: "${prompt}"`,
    `URGENCY: ${urgencyLine}`,
    `MATT TRIAGE NOTE: ${routing.routingNote} (Approval Hint: ${routing.approvalHint})`,
    primaryWorker
      ? `YOUR HOUSE GUILD SPECIALIST: ${primaryWorker.id} (${primaryWorker.name} — ${primaryWorker.title})`
      : '',
    `AVAILABLE CROSS-HOUSE COLLABORATORS FOR dispatch_handoff:\n${rosterDirectoryLines}`,
    workspaceSnippet,
    '',
    kbContext,
    '',
    autonomousGuardrailBlock,
    `ORCHESTRATION & GOVERNANCE PROTOCOL (MANDATORY):`,
    `1. Follow KB-SOP-01 Hub-and-Spoke collaboration: invoke dispatch_handoff to delegate specialist drafting/research to your House Specialist (${primaryWorker?.name ?? 'your specialist'}) AND to any cross-House Directors or Specialists needed when work spans multiple Houses.`,
    `2. Maximum ${Math.max(1, effectiveMaxHops - 1)} collaborator handoffs per task. Pass explicit kb_refs, verified_facts, and constraints in every dispatch_handoff call.`,
    `3. If this run warrants creating or updating a Knowledge Base SOP/brief/rule, call propose_kb_entry. Never claim a KB entry is already live; it stages as a pending CHO Decision Packet.`,
    `4. If the run warrants an external or irreversible action (Gmail draft, ${calendarWriteAccess || mode === 'autonomous' ? 'Google Calendar event / Focus Buffer, ' : ''}Google Chat reply, new Google Doc, Google Drive file, spend approval, or public post), call stage_cho_decision_packet. Never claim an email/message/post was already sent.`,
    `5. Once all tool calls have returned, synthesize every collaborator's verified output into ONE unified, polished Markdown deliverable. Begin with "### Executive Summary" (1-2 clear sentences), followed by structured sections.`,
  ]
    .filter(Boolean)
    .join('\n');

  const contents: Content[] = [{ role: 'user', parts: [{ text: directorPrompt }] }];
  let finalMarkdown = '';

  const buildAgentTrace = (): string[] => {
    const ordered: string[] = ['matt'];
    for (const hopId of state.hopSequenceIds) {
      if (!ordered.includes(hopId)) ordered.push(hopId);
    }
    if (!ordered.includes(chosenDirector.id)) {
      ordered.push(chosenDirector.id);
    } else if (ordered[ordered.length - 1] !== chosenDirector.id && state.hopSequenceIds.length > 0) {
      // Show Matt -> Specialist(s) -> Verifying Director pipeline clearly
      const withoutDir = ordered.filter((id) => id !== chosenDirector.id);
      return [...withoutDir, chosenDirector.id];
    }
    return ordered;
  };

  try {
    for (let turn = 0; turn < 5; turn += 1) {
      if (Date.now() >= workflowDeadlineMs) {
        throw new OrchestrationAbortError(
          `Workflow exceeded ${Math.round(effectiveTimeoutMs / 1000)}s execution budget before synthesis completed.`,
          'aborted_cap_reached'
        );
      }

      const remainingMs = Math.min(
        STEP_TIMEOUT_MS,
        Math.max(500, workflowDeadlineMs - Date.now())
      );

      const res = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents,
          config: {
            tools,
            ...(routing.needsWebSearch
              ? { toolConfig: { includeServerSideToolInvocations: true } }
              : {}),
            thinkingConfig: {
              thinkingLevel:
                mode === 'autonomous'
                  ? ThinkingLevel.MEDIUM
                  : routing.escalateToAdvisor
                    ? ThinkingLevel.XHIGH
                    : ThinkingLevel.HIGH,
            },
            systemInstruction: `${chosenDirector.instructions}\n\n${VILLAGE_CONSTITUTION}\n\nYour current House memory notes:\n${
              chosenDirector.notes.map((n) => `- ${n}`).join('\n') || '- None yet.'
            }\n\nYou are the Coordinating House Director for task ${taskId}. Synthesize specialist and cross-House work cleanly without asking the CHO to copy-paste between agents.`,
          },
        }),
        remainingMs,
        `Coordinating Director turn (${chosenDirector.name})`
      );

      mergeSourcesIntoState(state, extractGroundingSources(res));

      const calls = res.functionCalls ?? [];
      if (calls.length === 0) {
        finalMarkdown = (res.text ?? '').trim();
        break;
      }

      const modelContent = res.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      }

      const responseParts: Part[] = [];
      for (const call of calls) {
        const callName = call.name || '';
        if (mode === 'autonomous' && !AUTONOMOUS_SAFE_TOOL_WHITELIST.has(callName)) {
          throw new OrchestrationAbortError(
            `Blocked unauthorized tool "${callName}" in autonomous safe-zone runner (KB-GOV-01).`,
            'failed'
          );
        }
        const callArgs = (call.args ?? {}) as Record<string, unknown>;
        if (callName === 'dispatch_handoff') {
          const artifact = await executeCollaboratorHop({
            state,
            fromAgent: chosenDirector,
            rawArgs: callArgs,
            depth: 1,
            callChain: [chosenDirector.id],
          });
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: {
                ok: true,
                status: 'completed',
                artifact,
              },
            },
          });
        } else if (callName === 'propose_kb_entry') {
          const validation = validateKnowledgeProposalInput({
            taskId,
            rawId: typeof callArgs.id === 'string' ? callArgs.id : undefined,
            actionType:
              typeof callArgs.action_type === 'string' ? callArgs.action_type : undefined,
            title: typeof callArgs.title === 'string' ? callArgs.title : undefined,
            scope: typeof callArgs.scope === 'string' ? callArgs.scope : undefined,
            owners: typeof callArgs.owners === 'string' ? callArgs.owners : undefined,
            summary: typeof callArgs.summary === 'string' ? callArgs.summary : undefined,
            details: typeof callArgs.details === 'string' ? callArgs.details : undefined,
            rationale: typeof callArgs.rationale === 'string' ? callArgs.rationale : undefined,
            proposedByAgent: chosenDirector,
            sources: state.groundingSources,
            liveKnowledgeBase,
          });
          if (validation.ok) {
            state.stagedKbProposals = [
              ...state.stagedKbProposals.filter((p) => p.id !== validation.proposal.id),
              validation.proposal,
            ];
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: {
                  ok: true,
                  status: 'pending_cho_approval',
                  proposal_id: validation.proposal.proposal_id,
                  id: validation.proposal.id,
                  action_type: validation.proposal.action_type,
                  message: `Staged ${validation.proposal.id} in Pending CHO Decision Packets.`,
                },
              },
            });
          } else {
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: callName,
                response: { ok: false, error: validation.error },
              },
            });
          }
        } else if (callName === 'stage_cho_decision_packet') {
          const staged = stageApprovalFromArgs(callArgs, chosenDirector, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: staged.ok
                ? {
                    ok: true,
                    status: 'pending_cho_approval',
                    type: staged.approval.type,
                    title: staged.approval.title,
                  }
                : { ok: false, error: staged.error },
            },
          });
        } else if (callName === 'read_google_chat') {
          const chatReadResult = await executeReadGoogleChatTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: chatReadResult,
            },
          });
        } else if (callName === 'read_gmail_messages') {
          const gmailReadResult = await executeReadGmailTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: gmailReadResult,
            },
          });
        } else if (callName === 'read_calendar_events') {
          const calReadResult = executeReadCalendarEventsTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: calReadResult,
            },
          });
        } else if (callName === 'read_drive_files') {
          const driveReadResult = await executeReadDriveFilesTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName,
              response: driveReadResult,
            },
          });
        } else {
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: callName || 'unknown',
              response: { ok: false, error: `Unknown tool "${callName}".` },
            },
          });
        }
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    if (!finalMarkdown) {
      throw new OrchestrationAbortError(
        `Coordinating Director ${chosenDirector.name} reached tool-turn ceiling without returning unified synthesis. Aborting fail-closed.`,
        'aborted_cap_reached'
      );
    }

    const truthfulMarkdown = enforceGovernanceTruthfulness({
      text: finalMarkdown,
      approvalProposal: state.stagedApproval,
      stagedKbProposals: state.stagedKbProposals,
    });
    const summary = extractSummaryFromMarkdown(truthfulMarkdown, prompt);
    const completedIso = new Date().toISOString();

    const handoffTrace: HandoffTrace = {
      task_id: taskId,
      root_agent: mode === 'autonomous' || !targetDirectorId ? 'matt' : chosenDirector.id,
      coordinating_director: chosenDirector.id,
      coordinating_director_name: chosenDirector.name,
      status: 'completed',
      total_hops: state.packets.length,
      max_hops: effectiveMaxHops,
      max_depth: MAX_HANDOFF_DEPTH,
      started_at: workflowStartedIso,
      completed_at: completedIso,
      packets: state.packets,
      staged_kb_proposal_ids: state.stagedKbProposals.map((p) => p.proposal_id),
    };

    const collabList = Array.from(state.collaboratorIds);
    const collabNames = collabList
      .map((id) => roster.find((a) => a.id === id)?.name)
      .filter(Boolean);

    const newDirectorNote =
      collabNames.length > 0
        ? `Synthesized task ${taskId} with ${collabNames.join(', ')}: ${prompt.slice(0, 56)}`
        : `Completed task ${taskId}: ${prompt.slice(0, 60)}`;

    return {
      ok: true,
      failedClosed: false,
      routing,
      chosenDirector,
      primaryWorker,
      collaboratorIds: collabList,
      agentTrace: buildAgentTrace(),
      summary,
      reportMarkdown: truthfulMarkdown,
      newDirectorNote,
      groundingSources: state.groundingSources.slice(0, 6),
      handoffTrace,
      stagedKbProposals: state.stagedKbProposals,
      approvalProposal: state.stagedApproval,
      stagedApprovals: state.stagedApprovals,
    };
  } catch (err) {
    const completedIso = new Date().toISOString();
    const abortKind =
      state.abortedKind ??
      (err instanceof OrchestrationAbortError ? err.abortKind : 'failed');
    const errorBanner =
      state.abortedReason ??
      (err instanceof Error ? err.message : 'Cross-agent workflow aborted unexpectedly.');

    // Fail-closed rule: autonomous runs NEVER stage orphaned or half-baked decision packets
    const preservedKbProposals = mode === 'autonomous' ? [] : state.stagedKbProposals;

    const handoffTrace: HandoffTrace = {
      task_id: taskId,
      root_agent: mode === 'autonomous' || !targetDirectorId ? 'matt' : chosenDirector.id,
      coordinating_director: chosenDirector.id,
      coordinating_director_name: chosenDirector.name,
      status: abortKind,
      total_hops: state.packets.length,
      max_hops: effectiveMaxHops,
      max_depth: MAX_HANDOFF_DEPTH,
      started_at: workflowStartedIso,
      completed_at: completedIso,
      error_banner: errorBanner,
      packets: state.packets,
      staged_kb_proposal_ids: preservedKbProposals.map((p) => p.proposal_id),
    };

    const completedArtifactsSummary =
      state.verifiedArtifacts.length > 0
        ? `\n\n### Verified Partial Artifacts Prior to Abort\n${state.verifiedArtifacts
            .map((a) => `- **${a.agent_name} (${a.house})**: ${a.summary}`)
            .join('\n')}`
        : '';

    const failClosedReport = [
      `### Orchestration Aborted (Fail-Closed)`,
      `- **Status**: \`${abortKind}\``,
      `- **Task Thread**: \`${taskId}\``,
      `- **Coordinating Director**: ${chosenDirector.name} (${chosenDirector.department})`,
      `- **Reason**: ${errorBanner}`,
      '',
      `Per \`KB-SOP-01\` and \`KB-GOV-01\`, execution halted immediately rather than retrying infinitely or fabricating unverified handoff outputs.${completedArtifactsSummary}`,
    ].join('\n');

    return {
      ok: false,
      failedClosed: true,
      errorBanner,
      routing,
      chosenDirector,
      primaryWorker,
      collaboratorIds: Array.from(state.collaboratorIds),
      agentTrace: buildAgentTrace(),
      summary: `Workflow halted (fail-closed): ${errorBanner}`,
      reportMarkdown: failClosedReport,
      newDirectorNote: `Aborted task ${taskId} (fail-closed): ${errorBanner.slice(0, 72)}`,
      groundingSources: state.groundingSources.slice(0, 6),
      handoffTrace,
      stagedKbProposals: preservedKbProposals,
      approvalProposal: null,
      stagedApprovals: [],
    };
  }
}

/**
 * Orchestrated 1-on-1 Chat Runner:
 * Allows Matt, any House Director, or any Guild Specialist to converse naturally with the CHO
 * AND automatically invoke cross-agent handoffs (`dispatch_handoff`), stage KB proposals (`propose_kb_entry`),
 * or stage external CHO approvals (`stage_cho_decision_packet`) within a shared task_id thread
 * whenever requested—returning one unified reply plus inspectable HandoffTrace.
 */
export async function runOrchestratedAgentChat(params: {
  agent: AgentDossier;
  roster: AgentDossier[];
  message: string;
  history: Array<{ sender: string; text: string }>;
  liveKnowledgeBase: KnowledgeEntry[];
  houseNotes: Record<string, string[]>;
  workspaceBriefing: WorkspaceBriefingPayload;
  workspaceAuthHeader?: string;
  calendarWriteAccess: boolean;
  clientTime?: ClientTimeContext;
}): Promise<{
  reply: string;
  taskId?: string;
  handoffTrace?: HandoffTrace;
  stagedKbProposals?: KnowledgeProposal[];
  approvalProposal?: StagedApprovalProposal | null;
  summonDirectorId?: string | null;
  newNote?: string;
  sources: GroundSource[];
  orchestrationError?: string;
}> {
  const {
    agent,
    roster,
    message,
    history,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    workspaceAuthHeader,
    calendarWriteAccess,
    clientTime,
  } = params;

  const startedMs = Date.now();
  const startedIso = new Date(startedMs).toISOString();
  const taskId = `chat_${startedMs}`;
  const workflowDeadlineMs = startedMs + WORKFLOW_TIMEOUT_MS;

  const state: ThreadExecutionState = {
    taskId,
    mode: 'interactive',
    maxHops: MAX_AGENT_CALLS_PER_TASK,
    workflowDeadlineMs,
    roster,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    workspaceAuthHeader,
    calendarWriteAccess,
    clientTime,
    packets: [],
    verifiedArtifacts: [],
    stagedKbProposals: [],
    stagedApproval: null,
    stagedApprovals: [],
    groundingSources: [],
    collaboratorIds: new Set<string>(),
    hopSequenceIds: [],
    hopCount: 1,
    abortedReason: null,
    abortedKind: null,
  };

  const historyBlock = history
    .slice(-6)
    .map((h) => `${h.sender === 'cho' ? 'CHO' : agent.name}: ${h.text}`)
    .join('\n');

  const kbContext = buildKnowledgeGroundTruthBlock(
    liveKnowledgeBase,
    agent.department,
    houseNotes
  );
  const workspaceBlock = formatWorkspaceContextForPrompts(
    workspaceBriefing,
    calendarWriteAccess,
    clientTime
  );

  const canWriteCalendarNow =
    Boolean(calendarWriteAccess) &&
    Boolean(workspaceBriefing.connected) &&
    workspaceBriefing.calendarStatus === 'connected_write';

  const calendarDirective =
    agent.id === 'daniel' || /\b(calendar|schedule|meeting|event)\b/i.test(message)
      ? canWriteCalendarNow
        ? `CALENDAR WRITE STATUS: ENABLED & AUTHORIZED. Use stage_cho_decision_packet with type="calendar_event" and exact ISO-8601 eventStart/eventEnd (offset ${clientTime?.offset || 'Z'}) if the CHO asks to create/schedule an event.`
        : !calendarWriteAccess
          ? 'CALENDAR WRITE STATUS: READ-ONLY IN SETTINGS. Do NOT stage calendar_event; tell the CHO they can toggle "Write Access Enabled" in Settings → Calendar.'
          : !workspaceBriefing.connected
            ? 'CALENDAR WRITE STATUS: NOT SIGNED IN. Ask the CHO to Sign in with Google first.'
            : 'CALENDAR WRITE STATUS: OAUTH WRITE SCOPE NEEDED. Ask the CHO to click "Grant Calendar Write" in Settings → Calendar.'
      : '';

  const fnDeclarations: FunctionDeclaration[] = [
    buildDispatchHandoffDeclaration(roster, agent.id),
    buildStageDecisionPacketDeclaration(canWriteCalendarNow),
  ];
  if (workspaceAuthHeader && workspaceAuthHeader.startsWith('Bearer ')) {
    fnDeclarations.push(buildReadGoogleChatDeclaration(workspaceBriefing));
    fnDeclarations.push(buildReadGmailDeclaration(workspaceBriefing));
  }
  if (canAgentProposeKbEntry(agent)) {
    fnDeclarations.push(buildProposeKbDeclaration(liveKnowledgeBase));
  }
  if (agent.id === 'matt') {
    fnDeclarations.push(buildSummonDirectorDeclaration(roster));
  }

  const useSearch =
    agent.id === 'aria' ||
    agent.id === 'worker_aria' ||
    /\b(search|latest|today|weather|news|price|pricing|benchmark|api|rfc|docs|202\d)\b/i.test(
      message
    );

  const tools: Array<Record<string, unknown>> = [{ functionDeclarations: fnDeclarations }];
  if (useSearch) {
    tools.unshift({ googleSearch: {} });
  }

  const promptText = [
    historyBlock ? `Recent conversation:\n${historyBlock}\n` : '',
    `CHO says: "${message}"`,
    workspaceBlock,
    calendarDirective,
    '',
    kbContext,
    '',
    `DIRECT CHAT & ORCHESTRATION RULES:`,
    `- For normal 1-on-1 questions, reply directly, warmly, and concisely in character as ${agent.name} (${agent.title}) without unnecessary handoffs.`,
    `- When the CHO asks you to involve, consult, or coordinate with other agents (e.g., "have Kieran and Eli spec this", "ask Zoe and Marcus to compare...", "work with Aria on..."), call dispatch_handoff for each needed agent within this thread (${taskId}), verify their returned artifacts, and present ONE unified response so the CHO never has to copy-paste between agents.`,
    canAgentProposeKbEntry(agent)
      ? `- When the CHO asks to propose, add, or update a Knowledge Base entry (KB-*), invoke propose_kb_entry to stage a pending CHO Decision Packet (never claim it is already live).`
      : `- If the CHO asks to add or update a Knowledge Base entry (KB-*), invoke dispatch_handoff to Aria, Zoe, Eli, or your House Director so an authorized steward stages the pending KB Decision Packet in this thread.`,
    `- When the CHO asks about a specific Google Chat space, room, DM, thread, or pasted Google Chat link (or asks to work with chat messages not yet in the summary), call read_google_chat first to inspect the full messages and thread IDs before answering or handing off to other Houses.`,
    `- When the CHO asks about a specific Gmail label, full email content, or Gmail search query not fully covered in the summary, call read_gmail_messages first to inspect the full email bodies and labels.`,
    `- For any outbound Gmail draft, Calendar write, Google Chat reply (use chatThreadName when replying inside a specific thread), Google Doc, Drive file, spend, or public post, invoke stage_cho_decision_packet so it pauses for explicit CHO approval.`,
  ]
    .filter(Boolean)
    .join('\n');

  const ai = getAiClient();
  const contents: Content[] = [{ role: 'user', parts: [{ text: promptText }] }];
  let summonDirectorId: string | null = null;
  let finalReply = '';

  try {
    for (let turn = 0; turn < 5; turn += 1) {
      const remainingMs = Math.min(
        STEP_TIMEOUT_MS,
        Math.max(5_000, workflowDeadlineMs - Date.now())
      );

      const res = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents,
          config: {
            tools,
            ...(useSearch ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
            thinkingConfig: {
              thinkingLevel: agent.role === 'director' ? ThinkingLevel.MEDIUM : ThinkingLevel.LOW,
            },
            systemInstruction: `${agent.instructions}\n\nYour memory notes:\n${
              agent.notes.map((n) => `- ${n}`).join('\n') || '- None yet.'
            }\n\n${VILLAGE_CONSTITUTION}`,
          },
        }),
        remainingMs,
        `Chat turn (${agent.name})`
      );

      mergeSourcesIntoState(state, extractGroundingSources(res));

      const calls = res.functionCalls ?? [];
      if (calls.length === 0) {
        finalReply = (res.text ?? '').trim();
        break;
      }

      const modelContent = res.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      }

      const responseParts: Part[] = [];
      for (const call of calls) {
        const callArgs = (call.args ?? {}) as Record<string, unknown>;
        if (call.name === 'dispatch_handoff') {
          const artifact = await executeCollaboratorHop({
            state,
            fromAgent: agent,
            rawArgs: callArgs,
            depth: 1,
            callChain: [agent.id],
          });
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              response: { ok: true, status: 'completed', artifact },
            },
          });
        } else if (call.name === 'propose_kb_entry') {
          const validation = validateKnowledgeProposalInput({
            taskId,
            rawId: typeof callArgs.id === 'string' ? callArgs.id : undefined,
            actionType:
              typeof callArgs.action_type === 'string' ? callArgs.action_type : undefined,
            title: typeof callArgs.title === 'string' ? callArgs.title : undefined,
            scope: typeof callArgs.scope === 'string' ? callArgs.scope : undefined,
            owners: typeof callArgs.owners === 'string' ? callArgs.owners : undefined,
            summary: typeof callArgs.summary === 'string' ? callArgs.summary : undefined,
            details: typeof callArgs.details === 'string' ? callArgs.details : undefined,
            rationale: typeof callArgs.rationale === 'string' ? callArgs.rationale : undefined,
            proposedByAgent: agent,
            sources: state.groundingSources,
            liveKnowledgeBase,
          });
          if (validation.ok) {
            state.stagedKbProposals = [
              ...state.stagedKbProposals.filter((p) => p.id !== validation.proposal.id),
              validation.proposal,
            ];
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: call.name,
                response: {
                  ok: true,
                  status: 'pending_cho_approval',
                  proposal_id: validation.proposal.proposal_id,
                  id: validation.proposal.id,
                  action_type: validation.proposal.action_type,
                },
              },
            });
          } else {
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: call.name,
                response: { ok: false, error: validation.error },
              },
            });
          }
        } else if (call.name === 'stage_cho_decision_packet') {
          const staged = stageApprovalFromArgs(callArgs, agent, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              response: staged.ok
                ? {
                    ok: true,
                    status: 'pending_cho_approval',
                    type: staged.approval.type,
                    title: staged.approval.title,
                  }
                : { ok: false, error: staged.error },
            },
          });
        } else if (call.name === 'summon_director') {
          const rawDir = typeof callArgs.director_id === 'string' ? callArgs.director_id : '';
          const resolvedDir = resolveRosterAgent(rawDir, roster);
          if (resolvedDir && resolvedDir.role === 'director') {
            summonDirectorId = resolvedDir.id;
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: call.name,
                response: { ok: true, summoned: resolvedDir.name },
              },
            });
          } else {
            responseParts.push({
              functionResponse: {
                ...(call.id ? { id: call.id } : {}),
                name: call.name,
                response: { ok: false, error: `Unknown director "${rawDir}".` },
              },
            });
          }
        } else if (call.name === 'read_google_chat') {
          const chatReadResult = await executeReadGoogleChatTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              response: chatReadResult,
            },
          });
        } else if (call.name === 'read_gmail_messages') {
          const gmailReadResult = await executeReadGmailTool(callArgs, state);
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name,
              response: gmailReadResult,
            },
          });
        } else {
          responseParts.push({
            functionResponse: {
              ...(call.id ? { id: call.id } : {}),
              name: call.name || 'unknown',
              response: { ok: false, error: `Unsupported tool "${call.name}".` },
            },
          });
        }
      }

      contents.push({ role: 'user', parts: responseParts });
    }

    if (!finalReply) {
      throw new OrchestrationAbortError(
        `${agent.name} reached maximum collaboration turns without completing final synthesis.`,
        'aborted_cap_reached'
      );
    }

    const truthfulReply = enforceGovernanceTruthfulness({
      text: finalReply,
      approvalProposal: state.stagedApproval,
      stagedKbProposals: state.stagedKbProposals,
    });

    const hasOrchestrationActivity =
      state.packets.length > 0 || state.stagedKbProposals.length > 0;
    const handoffTrace: HandoffTrace | undefined = hasOrchestrationActivity
      ? {
          task_id: taskId,
          root_agent: agent.id,
          coordinating_director: agent.id,
          coordinating_director_name: agent.name,
          status: 'completed',
          total_hops: state.packets.length,
          max_hops: MAX_AGENT_CALLS_PER_TASK,
          max_depth: MAX_HANDOFF_DEPTH,
          started_at: startedIso,
          completed_at: new Date().toISOString(),
          packets: state.packets,
          staged_kb_proposal_ids: state.stagedKbProposals.map((p) => p.proposal_id),
        }
      : undefined;

    const collabNames = Array.from(state.collaboratorIds)
      .map((id) => roster.find((a) => a.id === id)?.name)
      .filter(Boolean);

    return {
      reply: truthfulReply,
      taskId: hasOrchestrationActivity ? taskId : undefined,
      handoffTrace,
      stagedKbProposals:
        state.stagedKbProposals.length > 0 ? state.stagedKbProposals : undefined,
      approvalProposal: state.stagedApproval,
      summonDirectorId,
      newNote:
        collabNames.length > 0
          ? `Coordinated in chat (${taskId}) with ${collabNames.join(', ')}: ${message.slice(0, 48)}`
          : undefined,
      sources: state.groundingSources.slice(0, 6),
    };
  } catch (err) {
    const abortKind =
      state.abortedKind ??
      (err instanceof OrchestrationAbortError ? err.abortKind : 'failed');
    const errorBanner =
      state.abortedReason ??
      (err instanceof Error ? err.message : 'Cross-agent collaboration aborted.');

    const handoffTrace: HandoffTrace = {
      task_id: taskId,
      root_agent: agent.id,
      coordinating_director: agent.id,
      coordinating_director_name: agent.name,
      status: abortKind,
      total_hops: state.packets.length,
      max_hops: MAX_AGENT_CALLS_PER_TASK,
      max_depth: MAX_HANDOFF_DEPTH,
      started_at: startedIso,
      completed_at: new Date().toISOString(),
      error_banner: errorBanner,
      packets: state.packets,
      staged_kb_proposal_ids: state.stagedKbProposals.map((p) => p.proposal_id),
    };

    return {
      reply: `**Collaboration Halted (Fail-Closed · \`${abortKind}\`)**: ${errorBanner}\n\nNo unverified handoffs or unauthorized actions were committed.`,
      taskId,
      handoffTrace,
      stagedKbProposals:
        state.stagedKbProposals.length > 0 ? state.stagedKbProposals : undefined,
      approvalProposal: null,
      summonDirectorId,
      sources: state.groundingSources.slice(0, 6),
      orchestrationError: errorBanner,
    };
  }
}

/**
 * Request-Revision Loop (KB-GOV-02 Section 3):
 * Routes CHO revision feedback back to the proposing agent (`proposed_by`) within the original
 * `task_id` thread and returns a newly validated `pending` KnowledgeProposal.
 */
export async function runKbProposalRevisionTurn(params: {
  originalProposal: KnowledgeProposal;
  feedback: string;
  roster: AgentDossier[];
  liveKnowledgeBase: KnowledgeEntry[];
  houseNotes: Record<string, string[]>;
}): Promise<KnowledgeProposal> {
  const { originalProposal, feedback, roster, liveKnowledgeBase, houseNotes } = params;
  const proposer =
    resolveRosterAgent(originalProposal.proposed_by, roster) ??
    resolveRosterAgent('aria', roster) ??
    DEFAULT_ROSTER_FALLBACK[4];

  const kbContext = buildKnowledgeGroundTruthBlock(
    liveKnowledgeBase,
    proposer.department,
    houseNotes,
    [originalProposal.id]
  );

  const ai = getAiClient();
  const res = await withTimeout(
    ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        `ORIGINAL KNOWLEDGE BASE PROPOSAL (${originalProposal.id} · ${originalProposal.action_type}):`,
        JSON.stringify(
          {
            id: originalProposal.id,
            action_type: originalProposal.action_type,
            title: originalProposal.title,
            scope: originalProposal.scope,
            owners: originalProposal.owners,
            summary: originalProposal.summary,
            details: originalProposal.details,
          },
          null,
          2
        ),
        '',
        `CHO REVISION FEEDBACK:`,
        `"${feedback.trim()}"`,
        '',
        kbContext,
        '',
        `Revise this Knowledge Base proposal to incorporate every point of the CHO's feedback while preserving strict KB-* governance and formatting.`,
      ].join('\n'),
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        systemInstruction: `${proposer.instructions}\n\n${VILLAGE_CONSTITUTION}\nYou are revising pending Knowledge Base proposal ${originalProposal.id} in response to Chief Human Officer feedback. Return clean JSON.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            scope: { type: Type.STRING },
            owners: { type: Type.STRING },
            summary: { type: Type.STRING },
            details: { type: Type.STRING },
            rationale: { type: Type.STRING },
          },
          required: ['title', 'scope', 'owners', 'summary', 'details', 'rationale'],
        },
      },
    }),
    STEP_TIMEOUT_MS,
    `KB revision turn (${proposer.name})`
  );

  const parsed = JSON.parse((res.text ?? '{}').trim()) as {
    title?: string;
    scope?: string;
    owners?: string;
    summary?: string;
    details?: string;
    rationale?: string;
  };

  const validation = validateKnowledgeProposalInput({
    taskId: originalProposal.task_id,
    rawId: originalProposal.id,
    actionType: originalProposal.action_type,
    title: parsed.title || originalProposal.title,
    scope: parsed.scope || originalProposal.scope,
    owners: parsed.owners || originalProposal.owners,
    summary: parsed.summary || originalProposal.summary,
    details: parsed.details || originalProposal.details,
    rationale: parsed.rationale || `Revised per CHO feedback: ${feedback.trim()}`,
    proposedByAgent: proposer,
    sources: originalProposal.sources,
    liveKnowledgeBase,
  });

  if (!validation.ok) {
    throw new Error(`Revised proposal failed schema validation: ${validation.error}`);
  }

  return validation.proposal;
}
