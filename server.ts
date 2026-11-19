import 'dotenv/config';
import { LiveServerMessage, Modality } from '@google/genai';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  computeCronIdempotencyKey,
  deriveCronSourceLabel,
  executeAutonomousRuleRun,
  hydrateWebhookEventContext,
  isCronRuleDueInWindow,
  parseWorkspaceWebhookPayload,
  scrubSensitiveTokens,
  sweepExpiredDecisionPackets,
  verifyCronAuthorizationHeader,
  verifyWorkspaceWebhookRawRequest,
} from './server/autonomyEngine.ts';
import {
  buildFullVillageRoster,
  resolveRosterAgent,
  runKbProposalRevisionTurn,
  runOrchestratedAgentChat,
  runOrchestratedVillageTask,
  validateKnowledgeProposalInput,
} from './server/orchestrator.ts';
import {
  GOOGLE_CHAT_CONSOLE_URL,
  buildLiveVoiceSystemInstruction,
  consolidateVillageKnowledge,
  createGoogleCalendarEvent,
  createGoogleDocument,
  deleteGoogleCalendarEvent,
  fetchGoogleDocument,
  fetchWorkspaceBriefing,
  generate4KVillageMap,
  generateExecutiveMorningBriefing,
  generateGroundedCrossTalk,
  getAiClient,
  interviewCandidate,
  isItemInsideWorkingFolder,
  listGmailLabels,
  listGoogleChatSpaces,
  listGoogleDriveFolders,
  proposeHiringCandidate,
  readGmailMessages,
  readGoogleChatConversation,
  readGoogleDriveFileContent,
  runTownHallRoundtable,
  saveGmailDraft,
  saveGoogleDriveFile,
  searchGoogleDriveFiles,
  sendGoogleChatMessage,
  synthesizeAgentSpeech,
  synthesizeMultiSpeakerDialogue,
  trashGoogleDriveFile,
  updateGoogleCalendarEvent,
  updateGoogleDriveFile,
  type AgentDossier,
  type ClientTimeContext,
  type GmailSourcePreferences,
  type WorkspaceBriefingPayload,
} from './server/villageEngine.ts';
import {
  buildKnowledgeGroundTruthBlock,
  categoryFromKbCode,
  isValidCanonicalKbId,
  mergeKnowledgeBase,
  nextKnowledgeCode,
} from './src/data/knowledgeBase.ts';
import {
  isValidAgentVoice,
  resolveAgentVoiceProfile,
  stripMarkdownForSpeech,
} from './src/lib/agentVoices.ts';
import { classifyTaskSource } from './src/lib/taskAnalytics.ts';
import {
  deriveAgentGroundedActivity,
  isLegacyFictionalActivity,
  isLegacyFictionalNote,
  isLegacyRandomActivityEvent,
} from './src/lib/villageActivity.ts';
import {
  DEFAULT_TOWN_AUTOPILOT_SETTINGS,
  mergeTownAutomationRules,
  normalizeTownAutomationRule,
  normalizeTownAutopilotSettings,
  validateCronExpression,
} from './src/data/automationDefaults.ts';
import {
  DEFAULT_VILLAGE_SETTINGS,
  normalizeVillageSettings,
  rebrandLegacyText,
} from './src/lib/villagePersistence.ts';
import type {
  AgentVoiceName,
  ApprovalItem,
  AutomationRun,
  GmailLabelConfig,
  GoogleChatMessageSummary,
  GoogleDocSummary,
  GoogleDriveFileSummary,
  GroundedWorkAnchor,
  KnowledgeEntry,
  KnowledgeProposal,
  KnowledgeVersionSnapshot,
  PinnedChatContext,
  TaskPriority,
  TownAutomationRule,
  TownAutopilotSettings,
  VillageSettings,
} from './src/types/village.ts';

function resolveServerPort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--port' || arg === '-p') && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    if (arg.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return Number(process.env.PORT) || 3000;
}

function resolveServerHost(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if ((arg === '--host' || arg === '-H') && args[i + 1] && !args[i + 1].startsWith('-')) {
      return args[i + 1];
    }
    if (arg.startsWith('--host=')) {
      const val = arg.slice('--host='.length).trim();
      if (val) return val;
    }
  }
  return process.env.HOST || '0.0.0.0';
}

const PORT = resolveServerPort();
const HOST = resolveServerHost();
const CHO_SESSION_TOKEN = crypto.randomBytes(24).toString('hex');
const app = express();

// Keep /api/webhooks/workspace unparsed here so HMAC / OIDC verification inspects exact raw bytes before JSON.parse
app.use((req, res, next) => {
  if (req.path === '/api/webhooks/workspace') {
    next();
    return;
  }
  express.json({ limit: '2mb' })(req, res, next);
});

// Volatile RAM-only Workspace OAuth bearer cache for supervised read-only background hydration (KB-RES-02: NEVER persisted to disk/JSON/logs)
let volatileWorkspaceAuthHeader: string | null = null;
let volatileWorkspaceAuthExpiresMs = 0;

function rememberVolatileWorkspaceAuthHeader(authHeader?: string): void {
  if (authHeader && authHeader.startsWith('Bearer ') && authHeader.length > 20) {
    volatileWorkspaceAuthHeader = authHeader;
    volatileWorkspaceAuthExpiresMs = Date.now() + 45 * 60 * 1000;
  }
}

function getVolatileWorkspaceAuthHeader(): string | undefined {
  if (volatileWorkspaceAuthHeader && Date.now() < volatileWorkspaceAuthExpiresMs) {
    return volatileWorkspaceAuthHeader;
  }
  volatileWorkspaceAuthHeader = null;
  volatileWorkspaceAuthExpiresMs = 0;
  return undefined;
}

const inFlightAutomationKeys = new Set<string>();

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok', port: PORT });
});

// Persistent folder-style storage for full village state, agent dossiers & busy activities
const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'village-memory.json');

interface KbIdempotencyRecord {
  proposalId: string;
  committedVersion: number;
  entry: KnowledgeEntry;
  proposal: KnowledgeProposal;
  committedAt: string;
}

interface PersistedVillageMemory {
  version: number;
  updatedAt: string;
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
  agents: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  approvals: Array<Record<string, unknown>>;
  kbProposals: KnowledgeProposal[];
  kbIdempotencyLedger: Record<string, KbIdempotencyRecord>;
  townAutomationRules: TownAutomationRule[];
  townAutopilotSettings: TownAutopilotSettings;
  automationRuns: AutomationRun[];
  dismissedPacketIds: string[];
  chatHistory: Record<string, Array<Record<string, unknown>>>;
  activityFeed?: Array<Record<string, unknown>>;
  knowledgeBase: KnowledgeEntry[];
  linkedDocs: GoogleDocSummary[];
  pinnedDriveFiles: GoogleDriveFileSummary[];
  pinnedChats: PinnedChatContext[];
  workspaceSnapshot?: Record<string, unknown>;
  settings?: VillageSettings;
  instructions: Record<string, string>;
  notes: Record<string, string[]>;
  voices: Record<string, AgentVoiceName>;
}

function sanitizeMemoryInPlace(mem: PersistedVillageMemory): boolean {
  let mutated = false;

  // 1. Purge legacy random cross-talk events while keeping all real dispatches, tasks, chats & grounded syncs
  if (Array.isArray(mem.activityFeed)) {
    const cleanFeed = mem.activityFeed.filter(
      (ev) => ev && !isLegacyRandomActivityEvent(ev as { kind?: string; contextRef?: unknown; lines?: Array<{ text?: string }> })
    );
    if (cleanFeed.length !== mem.activityFeed.length) {
      mem.activityFeed = cleanFeed;
      mutated = true;
    }
  }

  // 2. Purge legacy fictional starter & canned sync notes per agent, and upgrade brand references
  if (mem.notes && typeof mem.notes === 'object') {
    for (const [agentId, list] of Object.entries(mem.notes)) {
      if (!Array.isArray(list)) continue;
      const filtered = list
        .filter((n): n is string => typeof n === 'string' && !isLegacyFictionalNote(n))
        .map((n) => rebrandLegacyText(n));
      if (
        filtered.length !== list.length ||
        filtered.some((val, i) => val !== list[i])
      ) {
        mem.notes[agentId] = filtered;
        mutated = true;
      }
    }
  }
  if (mem.instructions && typeof mem.instructions === 'object') {
    for (const [agentId, instr] of Object.entries(mem.instructions)) {
      if (typeof instr !== 'string') continue;
      const nextInstr = rebrandLegacyText(instr);
      if (nextInstr !== instr) {
        mem.instructions[agentId] = nextInstr;
        mutated = true;
      }
    }
  }

  // 3. Scrub fictional currentActivity & notes inside persisted agent snapshots
  if (Array.isArray(mem.agents)) {
    const taskList = Array.isArray(mem.tasks)
      ? (mem.tasks as Array<{
          id?: string;
          prompt?: string;
          status?: string;
          assignedDirectorId?: string;
          assignedDirectorName?: string;
          assignedWorkerId?: string | null;
        }>)
      : [];
    const approvalList = Array.isArray(mem.approvals)
      ? (mem.approvals as Array<{ directorId?: string; title?: string; status?: string }>)
      : [];

    mem.agents = mem.agents.map((rawAgent) => {
      if (!rawAgent || typeof rawAgent.id !== 'string') return rawAgent;
      const id = rawAgent.id;
      const role = (typeof rawAgent.role === 'string' ? rawAgent.role : 'worker') as
        | 'cho'
        | 'chief_of_staff'
        | 'director'
        | 'worker';
      const department = typeof rawAgent.department === 'string' ? rawAgent.department : 'Village';

      const prevNotes = Array.isArray(rawAgent.notes) ? rawAgent.notes : [];
      const cleanNotes = prevNotes
        .filter((n): n is string => typeof n === 'string' && !isLegacyFictionalNote(n))
        .map((n) => rebrandLegacyText(n));
      if (
        cleanNotes.length !== prevNotes.length ||
        cleanNotes.some((val, i) => val !== prevNotes[i])
      ) {
        mutated = true;
      }

      const prevAct = typeof rawAgent.currentActivity === 'string' ? rawAgent.currentActivity : '';
      let nextAct = rebrandLegacyText(prevAct);
      if (isLegacyFictionalActivity(nextAct)) {
        nextAct = deriveAgentGroundedActivity({ id, role, department }, taskList, approvalList);
      }
      if (nextAct !== prevAct) {
        mutated = true;
      }

      const prevState = typeof rawAgent.state === 'string' ? rawAgent.state : 'walking';
      const nextState =
        prevState === 'chatting'
          ? role === 'worker'
            ? 'walking'
            : id === 'matt'
              ? 'following_cho'
              : 'idle_yard'
          : prevState;

      return {
        ...rawAgent,
        notes: cleanNotes,
        currentActivity: nextAct,
        state: nextState,
        speechBubble: null,
        speechTimer: 0,
      };
    });
  }

  return mutated;
}

function loadMemory(): PersistedVillageMemory {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as Partial<PersistedVillageMemory>;
      const loaded: PersistedVillageMemory = {
        version: parsed.version ?? 1,
        updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
        activeScreen: parsed.activeScreen,
        activeBuildingId: parsed.activeBuildingId ?? null,
        selectedAgentId: parsed.selectedAgentId ?? null,
        rightDrawerMode: parsed.rightDrawerMode ?? 'none',
        agents: Array.isArray(parsed.agents) ? parsed.agents : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        approvals: Array.isArray(parsed.approvals) ? parsed.approvals : [],
        kbProposals: Array.isArray(parsed.kbProposals) ? parsed.kbProposals : [],
        kbIdempotencyLedger:
          parsed.kbIdempotencyLedger && typeof parsed.kbIdempotencyLedger === 'object'
            ? parsed.kbIdempotencyLedger
            : {},
        townAutomationRules: mergeTownAutomationRules(parsed.townAutomationRules),
        townAutopilotSettings: normalizeTownAutopilotSettings(parsed.townAutopilotSettings),
        automationRuns: Array.isArray(parsed.automationRuns)
          ? parsed.automationRuns.slice(0, 100)
          : [],
        dismissedPacketIds: Array.isArray(parsed.dismissedPacketIds)
          ? parsed.dismissedPacketIds.filter((id): id is string => typeof id === 'string').slice(-300)
          : [],
        chatHistory: parsed.chatHistory && typeof parsed.chatHistory === 'object' ? parsed.chatHistory : {},
        activityFeed: Array.isArray(parsed.activityFeed) ? parsed.activityFeed : [],
        knowledgeBase: mergeKnowledgeBase(parsed.knowledgeBase),
        linkedDocs: Array.isArray(parsed.linkedDocs) ? parsed.linkedDocs : [],
        pinnedDriveFiles: Array.isArray(parsed.pinnedDriveFiles) ? parsed.pinnedDriveFiles : [],
        pinnedChats: Array.isArray(parsed.pinnedChats) ? parsed.pinnedChats : [],
        workspaceSnapshot: parsed.workspaceSnapshot,
        settings: normalizeVillageSettings(parsed.settings),
        instructions: parsed.instructions && typeof parsed.instructions === 'object' ? parsed.instructions : {},
        notes: parsed.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
        voices: parsed.voices && typeof parsed.voices === 'object' ? parsed.voices : {},
      };
      const swept = sweepExpiredDecisionPackets({
        approvals: loaded.approvals,
        kbProposals: loaded.kbProposals,
      });
      if (sanitizeMemoryInPlace(loaded) || swept.mutated) {
        loaded.updatedAt = new Date().toISOString();
        saveMemory(loaded);
      }
      return loaded;
    }
  } catch {
    // Fallback cleanly to empty memory
  }
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    agents: [],
    tasks: [],
    approvals: [],
    kbProposals: [],
    kbIdempotencyLedger: {},
    townAutomationRules: mergeTownAutomationRules([]),
    townAutopilotSettings: { ...DEFAULT_TOWN_AUTOPILOT_SETTINGS },
    automationRuns: [],
    dismissedPacketIds: [],
    chatHistory: {},
    activityFeed: [],
    knowledgeBase: mergeKnowledgeBase([]),
    linkedDocs: [],
    pinnedDriveFiles: [],
    pinnedChats: [],
    settings: { ...DEFAULT_VILLAGE_SETTINGS },
    instructions: {},
    notes: {},
    voices: {},
  };
}

let atomicWriteSeq = 0;

function saveMemory(memory: PersistedVillageMemory) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    atomicWriteSeq += 1;
    const tmpFile = `${STATE_FILE}.tmp.${process.pid}.${atomicWriteSeq}`;
    fs.writeFileSync(tmpFile, JSON.stringify(memory, null, 2), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch {
    // Ignore read-only filesystem errors in ephemeral containers
  }
}

let persistenceMutex: Promise<void> = Promise.resolve();

function runAtomicMutation<T>(mutator: () => Promise<T> | T): Promise<T> {
  const next = persistenceMutex.then(async () => {
    const result = await mutator();
    saveMemory(agentMemory);
    return result;
  });
  persistenceMutex = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

const agentMemory = loadMemory();

function verifyChoRequestAuth(req: express.Request): {
  authorized: boolean;
  choIdentity: string;
  error?: string;
} {
  const tokenHeader =
    typeof req.headers['x-cho-approval-token'] === 'string'
      ? req.headers['x-cho-approval-token'].trim()
      : '';

  if (!tokenHeader) {
    return {
      authorized: false,
      choIdentity: '',
      error:
        'CHO authorization required (missing X-CHO-Approval-Token). Agents and automated background callers cannot commit live Knowledge Base mutations.',
    };
  }

  const expectedBuf = Buffer.from(CHO_SESSION_TOKEN, 'utf-8');
  const receivedBuf = Buffer.from(tokenHeader, 'utf-8');
  if (
    expectedBuf.length !== receivedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    return {
      authorized: false,
      choIdentity: '',
      error:
        'Invalid or expired CHO session token. Reload Guildhaven to refresh your CHO executive session.',
    };
  }

  const headerEmail =
    typeof req.headers['x-cho-email'] === 'string' ? req.headers['x-cho-email'].trim() : '';
  const snapEmail =
    agentMemory.workspaceSnapshot &&
    typeof (agentMemory.workspaceSnapshot as { email?: unknown }).email === 'string'
      ? String((agentMemory.workspaceSnapshot as { email: string }).email).trim()
      : '';
  const choIdentity = headerEmail || snapEmail || 'CHO (Authenticated Executive Session)';

  return { authorized: true, choIdentity };
}

function syncAgentFieldInState(agentId: string, patch: Record<string, unknown>) {
  if (!Array.isArray(agentMemory.agents) || agentMemory.agents.length === 0) return;
  agentMemory.agents = agentMemory.agents.map((a) =>
    a && a.id === agentId ? { ...a, ...patch } : a
  );
}

function mergeDossier(agent: AgentDossier): AgentDossier {
  const savedInstr = agentMemory.instructions[agent.id];
  const isLegacy =
    savedInstr &&
    (savedInstr.toLowerCase().includes('yellow vest') ||
      savedInstr.toLowerCase().includes('yellow safety vest'));
  const savedVoice = agentMemory.voices[agent.id];
  return {
    ...agent,
    voiceName: isValidAgentVoice(savedVoice) ? savedVoice : agent.voiceName,
    instructions: rebrandLegacyText(savedInstr && !isLegacy ? savedInstr : agent.instructions),
    notes: (agentMemory.notes[agent.id] ?? agent.notes).map((n) => rebrandLegacyText(n)),
  };
}

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: 'gemini-4-hydrogen' });
});

const CHAT_AVATAR_PATH = path.resolve(
  process.cwd(),
  'src/assets/images/guildhaven_chat_avatar_1794833257258.jpg'
);

app.get('/guildhaven-chat-avatar.jpg', (_req, res) => {
  if (!fs.existsSync(CHAT_AVATAR_PATH)) {
    res.status(404).send('Avatar asset not found.');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(CHAT_AVATAR_PATH);
});

app.post('/api/workspace/chat/publish-avatar', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sign in with Google first to publish the avatar to Google Drive.' });
    return;
  }
  if (!fs.existsSync(CHAT_AVATAR_PATH)) {
    res.status(404).json({ error: 'Guildhaven avatar asset not found on server.' });
    return;
  }

  try {
    const imgBuffer = fs.readFileSync(CHAT_AVATAR_PATH);
    const parentFolderId = agentMemory.settings?.driveWorkingFolder?.id?.trim();
    const boundary = `guildhaven_avatar_${Date.now()}`;
    const metadata: Record<string, unknown> = {
      name: 'guildhaven-chat-avatar.jpg',
      mimeType: 'image/jpeg',
    };
    if (parentFolderId) {
      metadata.parents = [parentFolderId];
    }

    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata
      )}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`,
      'utf-8'
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--`, 'utf-8');
    const multipartBody = Buffer.concat([preamble, imgBuffer, epilogue]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      res.status(uploadRes.status === 403 ? 403 : 500).json({
        error: `Google Drive upload failed (${uploadRes.status}): ${errText.slice(0, 180)}`,
      });
      return;
    }

    const uploaded = (await uploadRes.json()) as { id: string; webViewLink?: string };
    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        uploaded.id
      )}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );

    if (!permRes.ok) {
      res.status(403).json({
        error:
          'Uploaded to Google Drive, but your Workspace organization restricts "Anyone with the link" public sharing. Use the verified public fallback URL or deploy the app first.',
        webViewLink: uploaded.webViewLink,
      });
      return;
    }

    const candidates = [
      `https://lh3.googleusercontent.com/d/${uploaded.id}=s512`,
      `https://drive.google.com/uc?export=view&id=${uploaded.id}`,
    ];

    let verifiedUrl = candidates[0];
    for (const candidateUrl of candidates) {
      try {
        const checkRes = await fetch(candidateUrl, { redirect: 'follow' });
        const ct = (checkRes.headers.get('content-type') || '').toLowerCase();
        if (checkRes.ok && ct.startsWith('image/')) {
          verifiedUrl = candidateUrl;
          break;
        }
      } catch {
        // Try next candidate
      }
    }

    res.json({
      ok: true,
      fileId: uploaded.id,
      avatarUrl: verifiedUrl,
      webViewLink: uploaded.webViewLink,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to publish Guildhaven avatar.',
    });
  }
});

const MAP_4K_BASE_PATH = path.resolve(process.cwd(), 'src/assets/images/village_with_engineering_lab_1794567133267.jpg');
const MAP_4K_CACHE_PNG = path.join(DATA_DIR, 'village-map-4k-v3.png');
const MAP_4K_CACHE_JPG = path.join(DATA_DIR, 'village-map-4k-v3.jpg');
let active4KRender: Promise<{ filePath: string; mimeType: string; bytes: number }> | null = null;

function findCached4KMap(): { filePath: string; mimeType: string; bytes: number } | null {
  for (const candidate of [
    { filePath: MAP_4K_CACHE_PNG, mimeType: 'image/png' },
    { filePath: MAP_4K_CACHE_JPG, mimeType: 'image/jpeg' },
  ]) {
    try {
      if (fs.existsSync(candidate.filePath)) {
        const stat = fs.statSync(candidate.filePath);
        if (stat.size > 100_000) {
          return { ...candidate, bytes: stat.size };
        }
      }
    } catch {
      // Ignore stat failures
    }
  }
  return null;
}

app.get('/api/village/map-4k/status', (_req, res) => {
  const cached = findCached4KMap();
  res.json({
    ready: Boolean(cached),
    rendering: Boolean(active4KRender),
    bytes: cached?.bytes ?? 0,
    url: cached ? `/api/village/map-4k?v=${cached.bytes}` : null,
  });
});

app.get('/api/village/map-4k', (_req, res) => {
  const cached = findCached4KMap();
  if (!cached) {
    res.status(404).json({ error: '4K village map not rendered yet.' });
    return;
  }
  res.setHeader('Content-Type', cached.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(cached.filePath).pipe(res);
});

app.post('/api/village/render-4k-map', async (req, res) => {
  try {
    const { force } = (req.body ?? {}) as { force?: boolean };
    if (!force) {
      const existing = findCached4KMap();
      if (existing) {
        res.json({
          ok: true,
          cached: true,
          bytes: existing.bytes,
          url: `/api/village/map-4k?v=${existing.bytes}`,
        });
        return;
      }
    }

    if (!active4KRender) {
      active4KRender = (async () => {
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const baseBuffer = fs.readFileSync(MAP_4K_BASE_PATH);
        const { buffer, mimeType } = await generate4KVillageMap(baseBuffer.toString('base64'), 'image/jpeg');
        const isJpeg = mimeType.includes('jpeg') || mimeType.includes('jpg');
        const outPath = isJpeg ? MAP_4K_CACHE_JPG : MAP_4K_CACHE_PNG;
        const stalePath = isJpeg ? MAP_4K_CACHE_PNG : MAP_4K_CACHE_JPG;
        fs.writeFileSync(outPath, buffer);
        if (fs.existsSync(stalePath)) {
          fs.unlinkSync(stalePath);
        }
        return { filePath: outPath, mimeType, bytes: buffer.length };
      })().finally(() => {
        active4KRender = null;
      });
    }

    const result = await active4KRender;
    res.json({
      ok: true,
      cached: false,
      bytes: result.bytes,
      url: `/api/village/map-4k?v=${result.bytes}`,
    });
  } catch (err) {
    console.error('4K map render error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate 4K village diorama map.',
    });
  }
});

// Get full persisted village & agent state (sweeping expired packets & attaching server-issued CHO session token)
app.get('/api/village/state', (_req, res) => {
  const swept = sweepExpiredDecisionPackets({
    approvals: agentMemory.approvals,
    kbProposals: agentMemory.kbProposals,
  });
  if (swept.mutated) {
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
  }
  res.json({
    ...agentMemory,
    choSessionToken: CHO_SESSION_TOKEN,
  });
});

// Save UI & world state snapshot WITHOUT overwriting server-authoritative Knowledge Base, KB Proposals, Autopilot Rules/Runs, or Handoff Traces
app.post('/api/village/state', (req, res) => {
  const body = (req.body ?? {}) as Partial<PersistedVillageMemory>;
  if (typeof body.activeScreen === 'string') {
    agentMemory.activeScreen = body.activeScreen;
  }
  if (body.activeBuildingId !== undefined) {
    agentMemory.activeBuildingId = body.activeBuildingId;
  }
  if (body.selectedAgentId !== undefined) {
    agentMemory.selectedAgentId = body.selectedAgentId;
  }
  if (body.rightDrawerMode !== undefined) {
    agentMemory.rightDrawerMode = body.rightDrawerMode;
  }
  if (Array.isArray(body.agents)) {
    agentMemory.agents = body.agents;
    for (const a of body.agents) {
      if (a && typeof a.id === 'string') {
        if (typeof a.instructions === 'string') {
          agentMemory.instructions[a.id] = a.instructions;
        }
        if (Array.isArray(a.notes)) {
          agentMemory.notes[a.id] = a.notes.filter((n): n is string => typeof n === 'string');
        }
        if (isValidAgentVoice(a.voiceName)) {
          agentMemory.voices[a.id] = a.voiceName;
        }
      }
    }
  }
  if (Array.isArray(body.tasks)) {
    const serverTasksById = new Map<string, Record<string, unknown>>();
    const clientTaskIds = new Set<string>();
    for (const st of agentMemory.tasks) {
      if (st && typeof st.id === 'string') {
        serverTasksById.set(st.id, st);
      }
    }
    const mergedClientTasks = body.tasks.map((ct) => {
      if (!ct || typeof ct.id !== 'string') return ct;
      clientTaskIds.add(ct.id);
      const existing = serverTasksById.get(ct.id);
      if (!existing) return ct;
      return {
        ...ct,
        handoffTrace: ct.handoffTrace ?? existing.handoffTrace,
        kbProposalIds: ct.kbProposalIds ?? existing.kbProposalIds,
        collaboratorIds: ct.collaboratorIds ?? existing.collaboratorIds,
        orchestrationError: ct.orchestrationError ?? existing.orchestrationError,
      };
    });
    const serverAutonomousTasks = agentMemory.tasks.filter(
      (st) =>
        st &&
        typeof st.id === 'string' &&
        st.id.startsWith('autotask_') &&
        !clientTaskIds.has(st.id)
    );
    agentMemory.tasks = [...serverAutonomousTasks, ...mergedClientTasks].slice(0, 45);
  }
  if (Array.isArray(body.approvals)) {
    sweepExpiredDecisionPackets({
      approvals: agentMemory.approvals,
      kbProposals: agentMemory.kbProposals,
    });
    const dismissedSet = new Set(agentMemory.dismissedPacketIds ?? []);
    const serverApprovalsById = new Map<string, Record<string, unknown>>();
    for (const sa of agentMemory.approvals) {
      if (sa && typeof sa.id === 'string') {
        serverApprovalsById.set(sa.id, sa);
      }
    }
    const clientIds = new Set<string>();
    const normalizedClientApprovals: Array<Record<string, unknown>> = [];
    for (const ca of body.approvals) {
      if (!ca || typeof ca.id !== 'string') continue;
      if (dismissedSet.has(ca.id)) continue;
      clientIds.add(ca.id);
      const sa = serverApprovalsById.get(ca.id);
      if (!sa) {
        normalizedClientApprovals.push(ca);
        continue;
      }
      // Never let a stale client snapshot revert an already-'expired' server packet back to 'pending'
      const resolvedStatus =
        sa.status === 'expired' && ca.status === 'pending' ? 'expired' : ca.status ?? sa.status;
      normalizedClientApprovals.push({
        ...sa,
        ...ca,
        status: resolvedStatus,
        source_trigger: ca.source_trigger ?? sa.source_trigger,
        source_label: ca.source_label ?? sa.source_label,
        automation_run_id: ca.automation_run_id ?? sa.automation_run_id,
        ttl_expires_at: ca.ttl_expires_at ?? sa.ttl_expires_at,
      });
    }
    const nowMs = Date.now();
    const preservedServerApprovals = agentMemory.approvals.filter((sa) => {
      if (!sa || typeof sa.id !== 'string' || clientIds.has(sa.id) || dismissedSet.has(sa.id)) {
        return false;
      }
      // Always preserve autonomous background packets not yet synced into the client state
      if (sa.source_trigger === 'cron' || sa.source_trigger === 'webhook') {
        return true;
      }
      if (sa.status !== 'pending') return false;
      const createdMs = typeof sa.createdAt === 'string' ? Date.parse(sa.createdAt) : 0;
      return createdMs > 0 && nowMs - createdMs < 15_000;
    });
    agentMemory.approvals = [...preservedServerApprovals, ...normalizedClientApprovals].slice(0, 60);
  }
  if (body.chatHistory && typeof body.chatHistory === 'object') {
    const mergedChat: Record<string, Array<Record<string, unknown>>> = {};
    for (const [agentId, clientMsgs] of Object.entries(body.chatHistory)) {
      if (!Array.isArray(clientMsgs)) continue;
      const serverMsgs = agentMemory.chatHistory[agentId] ?? [];
      const serverMsgById = new Map<string, Record<string, unknown>>();
      for (const sm of serverMsgs) {
        if (sm && typeof sm.id === 'string') {
          serverMsgById.set(sm.id, sm);
        }
      }
      mergedChat[agentId] = clientMsgs.map((cm) => {
        if (!cm || typeof cm.id !== 'string') return cm;
        const sm = serverMsgById.get(cm.id);
        if (!sm) return cm;
        return {
          ...cm,
          taskId: cm.taskId ?? sm.taskId,
          handoffTrace: cm.handoffTrace ?? sm.handoffTrace,
          kbProposalIds: cm.kbProposalIds ?? sm.kbProposalIds,
          approvalId: cm.approvalId ?? sm.approvalId,
          orchestrationError: cm.orchestrationError ?? sm.orchestrationError,
        };
      });
    }
    agentMemory.chatHistory = mergedChat;
  }
  if (Array.isArray(body.activityFeed)) {
    agentMemory.activityFeed = body.activityFeed
      .filter(
        (ev) =>
          ev &&
          !isLegacyRandomActivityEvent(
            ev as { kind?: string; contextRef?: unknown; lines?: Array<{ text?: string }> }
          )
      )
      .slice(0, 60);
  }
  // NOTE: knowledgeBase, kbProposals, townAutomationRules, townAutopilotSettings, and automationRuns
  // are strictly server-authoritative and NEVER overwritten by periodic client UI snapshots.
  if (Array.isArray(body.linkedDocs)) {
    agentMemory.linkedDocs = body.linkedDocs.slice(0, 25);
  }
  if (Array.isArray(body.pinnedDriveFiles)) {
    agentMemory.pinnedDriveFiles = body.pinnedDriveFiles.slice(0, 25);
  }
  if (Array.isArray(body.pinnedChats)) {
    agentMemory.pinnedChats = body.pinnedChats.slice(0, 20);
  }
  if (body.workspaceSnapshot === null) {
    agentMemory.workspaceSnapshot = undefined;
    volatileWorkspaceAuthHeader = null;
    volatileWorkspaceAuthExpiresMs = 0;
  } else if (body.workspaceSnapshot && typeof body.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...body.workspaceSnapshot,
      linkedDocs: agentMemory.linkedDocs,
      pinnedDriveFiles: agentMemory.pinnedDriveFiles,
      pinnedChats: agentMemory.pinnedChats,
    };
  }
  if (body.settings !== undefined) {
    agentMemory.settings = normalizeVillageSettings(body.settings);
  }
  sanitizeMemoryInPlace(agentMemory);
  agentMemory.updatedAt = typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, updatedAt: agentMemory.updatedAt });
});

// Get persisted agent dossier overrides (instructions & notes)
app.get('/api/village/memory', (_req, res) => {
  res.json({
    instructions: agentMemory.instructions,
    notes: agentMemory.notes,
  });
});

// Save updated instructions for a Director or Worker
app.post('/api/village/agents/:id/instructions', (req, res) => {
  const { id } = req.params;
  const { instructions } = req.body as { instructions?: string };
  if (!instructions || typeof instructions !== 'string') {
    res.status(400).json({ error: 'Instructions string required.' });
    return;
  }
  agentMemory.instructions[id] = instructions.trim();
  syncAgentFieldInState(id, { instructions: agentMemory.instructions[id] });
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, id, instructions: agentMemory.instructions[id] });
});

// Append a memory note (e.g. from cross-agent conversations or completed tasks)
app.post('/api/village/agents/:id/notes', (req, res) => {
  const { id } = req.params;
  const { note, existingNotes } = req.body as { note?: string; existingNotes?: string[] };
  if (!note || typeof note !== 'string') {
    res.status(400).json({ error: 'Note string required.' });
    return;
  }
  const current = agentMemory.notes[id] ?? existingNotes ?? [];
  const updated = [...current, note.trim()].slice(-20);
  agentMemory.notes[id] = updated;
  syncAgentFieldInState(id, { notes: updated });
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, id, notes: updated });
});

// Save custom voice persona selection for an agent
app.post('/api/village/agents/:id/voice', (req, res) => {
  const { id } = req.params;
  const { voiceName } = req.body as { voiceName?: unknown };
  if (!isValidAgentVoice(voiceName)) {
    res.status(400).json({ error: 'Valid voiceName (Puck, Charon, Kore, Fenrir, Zephyr) required.' });
    return;
  }
  agentMemory.voices[id] = voiceName;
  syncAgentFieldInState(id, { voiceName });
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, id, voiceName });
});

// In-memory LRU audio cache so re-playing the same message or deliverable is instant
const ttsCache = new Map<string, { audioBase64: string; mimeType: string }>();
const MAX_TTS_CACHE_ITEMS = 40;

function putTtsCache(key: string, value: { audioBase64: string; mimeType: string }) {
  if (ttsCache.has(key)) {
    ttsCache.delete(key);
  } else if (ttsCache.size >= MAX_TTS_CACHE_ITEMS) {
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) ttsCache.delete(oldestKey);
  }
  ttsCache.set(key, value);
}

// Synthesize distinct villager voices (single-speaker gemini-3.8-flash-lite-tts or 2-speaker gemini-3.8-flash-tts)
app.post('/api/village/tts', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      agentId?: string;
      speakerName?: string;
      title?: string;
      department?: string;
      voiceName?: AgentVoiceName;
      text?: string;
      maxChars?: number;
      dialogue?: Array<{
        agentId?: string;
        speakerName: string;
        title?: string;
        department?: string;
        voiceName?: AgentVoiceName;
        text: string;
      }>;
    };

    // Multi-turn dialogue request (e.g. 2-villager courtyard sync or dispatch exchange)
    if (Array.isArray(body.dialogue) && body.dialogue.length > 0) {
      const sanitizedTurns = body.dialogue
        .map((turn) => {
          const savedVoice = turn.agentId ? agentMemory.voices[turn.agentId] : undefined;
          const profile = resolveAgentVoiceProfile({
            id: turn.agentId,
            name: turn.speakerName,
            title: turn.title,
            department: turn.department,
            voiceName: isValidAgentVoice(turn.voiceName) ? turn.voiceName : savedVoice,
          });
          return {
            speaker: profile.speakerName,
            voiceName: profile.voiceName,
            stylePrompt: profile.stylePrompt,
            text: stripMarkdownForSpeech(turn.text, 600),
          };
        })
        .filter((t) => t.text.length > 0);

      if (sanitizedTurns.length === 0) {
        res.status(400).json({ error: 'No speakable dialogue lines provided.' });
        return;
      }

      const uniqueSpeakerMap = new Map<string, AgentVoiceName>();
      for (const t of sanitizedTurns) {
        if (!uniqueSpeakerMap.has(t.speaker)) {
          uniqueSpeakerMap.set(t.speaker, t.voiceName);
        }
      }
      const uniqueSpeakers = Array.from(uniqueSpeakerMap.entries()).map(([speaker, voiceName]) => ({
        speaker,
        voiceName,
      }));

      const cacheKey = `dlg:${JSON.stringify(sanitizedTurns)}`;
      const cached = ttsCache.get(cacheKey);
      if (cached) {
        res.json({ ok: true, cached: true, ...cached });
        return;
      }

      if (uniqueSpeakers.length === 2) {
        const result = await synthesizeMultiSpeakerDialogue({
          speakers: [uniqueSpeakers[0], uniqueSpeakers[1]],
          turns: sanitizedTurns.map((t) => ({
            speaker: t.speaker,
            text: t.text,
            stylePrompt: t.stylePrompt,
          })),
        });
        putTtsCache(cacheKey, result);
        res.json({ ok: true, cached: false, ...result });
        return;
      }

      // Fallback when 1 or 3+ unique speakers are passed in a single call
      const primary = sanitizedTurns[0];
      const combinedText =
        uniqueSpeakers.length === 1
          ? sanitizedTurns.map((t) => t.text).join(' ')
          : sanitizedTurns.map((t) => `${t.speaker} says: ${t.text}`).join(' ');
      const singleResult = await synthesizeAgentSpeech({
        text: combinedText,
        voiceName: primary.voiceName,
        stylePrompt: primary.stylePrompt,
      });
      putTtsCache(cacheKey, singleResult);
      res.json({ ok: true, cached: false, ...singleResult });
      return;
    }

    // Standard single-agent speech request
    const spokenText = stripMarkdownForSpeech(body.text || '', body.maxChars ?? 2200);
    if (!spokenText) {
      res.status(400).json({ error: 'Speakable text is required.' });
      return;
    }

    const savedVoice = body.agentId ? agentMemory.voices[body.agentId] : undefined;
    const profile = resolveAgentVoiceProfile({
      id: body.agentId,
      name: body.speakerName,
      title: body.title,
      department: body.department,
      voiceName: isValidAgentVoice(body.voiceName) ? body.voiceName : savedVoice,
    });

    const cacheKey = `tts:${profile.voiceName}:${profile.stylePrompt}:${spokenText}`;
    const cached = ttsCache.get(cacheKey);
    if (cached) {
      res.json({
        ok: true,
        cached: true,
        voiceName: profile.voiceName,
        timbreLabel: profile.timbreLabel,
        ...cached,
      });
      return;
    }

    const result = await synthesizeAgentSpeech({
      text: spokenText,
      voiceName: profile.voiceName,
      stylePrompt: profile.stylePrompt,
    });
    putTtsCache(cacheKey, result);
    res.json({
      ok: true,
      cached: false,
      voiceName: profile.voiceName,
      timbreLabel: profile.timbreLabel,
      ...result,
    });
  } catch (err) {
    console.error('TTS generation error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate agent speech.',
    });
  }
});

// Centralized Village Knowledge Base (Single Source of Truth) Routes
app.get('/api/village/knowledge', (_req, res) => {
  res.json({
    entries: agentMemory.knowledgeBase,
    proposals: agentMemory.kbProposals,
  });
});

// Direct CHO-authored Knowledge Base save/edit (strictly requires CHO session auth)
app.post('/api/village/knowledge', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const incoming = req.body as Partial<KnowledgeEntry>;
  if (!incoming || !incoming.title || !incoming.contentMarkdown) {
    res.status(400).json({ error: 'Title and contentMarkdown are required.' });
    return;
  }

  const category =
    incoming.category === 'constitution' ||
    incoming.category === 'handoff_template' ||
    incoming.category === 'research_brief'
      ? incoming.category
      : 'handoff_template';

  try {
    const committed = await runAtomicMutation(() => {
      const existingIdx = incoming.id
        ? agentMemory.knowledgeBase.findIndex((e) => e.id === incoming.id)
        : incoming.sourceTaskId
          ? agentMemory.knowledgeBase.findIndex((e) => e.sourceTaskId === incoming.sourceTaskId)
          : -1;

      const nowIso = new Date().toISOString();

      if (existingIdx >= 0) {
        const prev = agentMemory.knowledgeBase[existingIdx];
        if (prev.code === 'KB-GOV-01') {
          throw new Error('Core KB-GOV-01 Constitution entry is immutable.');
        }
        const prevVer = prev.version ?? 1;
        const snapshot: KnowledgeVersionSnapshot = {
          version: prevVer,
          updatedAt: prev.updatedAt,
          title: prev.title,
          scope: prev.department,
          owners: prev.maintainedBy,
          summary: prev.summary,
          details: prev.contentMarkdown,
          approvedBy: prev.approvedBy,
          changeNote: 'Prior live version before direct CHO edit',
        };
        const updatedEntry: KnowledgeEntry = {
          ...prev,
          title: incoming.title!.trim(),
          category,
          department: (incoming.department || prev.department).trim(),
          maintainedBy: (incoming.maintainedBy || prev.maintainedBy).trim(),
          summary: (incoming.summary || prev.summary).trim(),
          contentMarkdown: incoming.contentMarkdown!.trim(),
          sources: incoming.sources ?? prev.sources,
          updatedAt: nowIso,
          version: prevVer + 1,
          approvedByCho: true,
          approvedBy: choAuth.choIdentity,
          versionHistory: [...(prev.versionHistory ?? []), snapshot].slice(-25),
        };
        agentMemory.knowledgeBase[existingIdx] = updatedEntry;
        agentMemory.updatedAt = nowIso;
        return updatedEntry;
      }

      const rawCode = incoming.code?.trim().toUpperCase();
      const code =
        rawCode && isValidCanonicalKbId(rawCode)
          ? rawCode
          : nextKnowledgeCode(agentMemory.knowledgeBase, category);
      const newEntry: KnowledgeEntry = {
        id: incoming.id || `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        code,
        title: incoming.title!.trim(),
        category: categoryFromKbCode(code),
        department: (incoming.department || 'All Houses').trim(),
        maintainedBy: (incoming.maintainedBy || 'You (CHO) · Aria, Zoe & Eli').trim(),
        summary: (incoming.summary || incoming.title!).trim(),
        contentMarkdown: incoming.contentMarkdown!.trim(),
        sources: incoming.sources ?? [],
        updatedAt: nowIso,
        sourceTaskId: incoming.sourceTaskId,
        version: 1,
        approvedByCho: true,
        approvedBy: choAuth.choIdentity,
        versionHistory: [],
      };
      agentMemory.knowledgeBase = [...agentMemory.knowledgeBase, newEntry];
      agentMemory.updatedAt = nowIso;
      return newEntry;
    });

    res.json({ ok: true, entry: committed, entries: agentMemory.knowledgeBase });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save Knowledge Base entry.';
    res.status(msg.includes('immutable') ? 403 : 400).json({ error: msg });
  }
});

app.delete('/api/village/knowledge/:id', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }
  const { id } = req.params;
  const target = agentMemory.knowledgeBase.find((e) => e.id === id);
  if (!target) {
    res.status(404).json({ error: 'Knowledge Base entry not found.' });
    return;
  }
  if (target.locked) {
    res.status(403).json({ error: 'Core governance entries cannot be deleted.' });
    return;
  }
  await runAtomicMutation(() => {
    agentMemory.knowledgeBase = agentMemory.knowledgeBase.filter((e) => e.id !== id);
    agentMemory.updatedAt = new Date().toISOString();
  });
  res.json({ ok: true, entries: agentMemory.knowledgeBase });
});

// ============================================================================
// Propose & Approve Knowledge Base Workflow Endpoints (KB-GOV-02 & KB-GOV-01)
// ============================================================================

app.get('/api/kb/proposals', (_req, res) => {
  res.json({
    proposals: agentMemory.kbProposals,
    entries: agentMemory.knowledgeBase,
  });
});

app.post('/api/kb/proposals', async (req, res) => {
  const body = (req.body ?? {}) as {
    task_id?: string;
    id?: string;
    title?: string;
    scope?: string;
    owners?: string;
    summary?: string;
    details?: string;
    action_type?: string;
    proposed_by?: string;
    rationale?: string;
  };

  const fullRoster = buildFullVillageRoster(
    (agentMemory.agents ?? []) as unknown as AgentDossier[],
    mergeDossier
  );
  const proposer = resolveRosterAgent(body.proposed_by || 'aria', fullRoster);
  if (!proposer) {
    res.status(400).json({ error: `Unknown proposing agent "${body.proposed_by ?? ''}".` });
    return;
  }

  const validation = validateKnowledgeProposalInput({
    taskId: body.task_id?.trim() || `manual_prop_${Date.now()}`,
    rawId: body.id,
    title: body.title,
    scope: body.scope,
    owners: body.owners,
    summary: body.summary,
    details: body.details,
    actionType: body.action_type,
    proposedByAgent: proposer,
    rationale: body.rationale,
    liveKnowledgeBase: agentMemory.knowledgeBase,
  });

  if (!validation.ok) {
    res.status(400).json({ error: validation.error });
    return;
  }

  await runAtomicMutation(() => {
    agentMemory.kbProposals = [validation.proposal, ...agentMemory.kbProposals].slice(0, 60);
    agentMemory.updatedAt = new Date().toISOString();
  });

  res.status(201).json({
    ok: true,
    proposal: validation.proposal,
    proposals: agentMemory.kbProposals,
  });
});

app.post('/api/kb/proposals/:id/approve', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const idempotencyKey =
    typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key'].trim()
      : '';
  if (!idempotencyKey || idempotencyKey.length < 8) {
    res.status(400).json({
      error: 'Deterministic Idempotency-Key header is required when committing a KB proposal.',
    });
    return;
  }

  const existingCommit = agentMemory.kbIdempotencyLedger[idempotencyKey];
  if (existingCommit) {
    res.json({
      ok: true,
      idempotentReplay: true,
      entry: existingCommit.entry,
      proposal: existingCommit.proposal,
      entries: agentMemory.knowledgeBase,
      proposals: agentMemory.kbProposals,
    });
    return;
  }

  const proposalParam = req.params.id;
  const edits = ((req.body ?? {}) as {
    edits?: {
      title?: string;
      scope?: string;
      owners?: string;
      summary?: string;
      details?: string;
    };
  }).edits;

  try {
    const result = await runAtomicMutation(() => {
      // Re-check idempotency inside mutex in case two identical requests arrived concurrently
      const replayInsideLock = agentMemory.kbIdempotencyLedger[idempotencyKey];
      if (replayInsideLock) {
        return {
          idempotentReplay: true,
          entry: replayInsideLock.entry,
          proposal: replayInsideLock.proposal,
        };
      }

      const propIdx = agentMemory.kbProposals.findIndex(
        (p) => p.proposal_id === proposalParam || p.id === proposalParam
      );
      if (propIdx < 0) {
        throw new Error(`NOT_FOUND:Knowledge Base proposal "${proposalParam}" not found.`);
      }

      const targetProp = agentMemory.kbProposals[propIdx];
      if (targetProp.status !== 'pending') {
        throw new Error(
          `CONFLICT:Proposal ${targetProp.id} (${targetProp.proposal_id}) is already ${targetProp.status}.`
        );
      }

      const finalCode = targetProp.id.trim().toUpperCase();
      if (!isValidCanonicalKbId(finalCode)) {
        throw new Error(
          `VALIDATION:Proposal ID "${finalCode}" does not match ^KB-(GOV|SOP|RES)-\\d{2,}$.`
        );
      }
      if (finalCode === 'KB-GOV-01') {
        throw new Error('FORBIDDEN:KB-GOV-01 Core HITL Constitution cannot be overwritten.');
      }

      const finalTitle = (edits?.title ?? targetProp.title).trim();
      const finalScope = (edits?.scope ?? targetProp.scope).trim();
      const finalOwners = (edits?.owners ?? targetProp.owners).trim();
      const finalSummary = (edits?.summary ?? targetProp.summary).trim();
      const finalDetails = (edits?.details ?? targetProp.details).trim();

      if (
        finalTitle.length < 4 ||
        finalScope.length < 2 ||
        finalOwners.length < 2 ||
        finalSummary.length < 10 ||
        finalDetails.length < 20
      ) {
        throw new Error(
          'VALIDATION:Edited KB fields must be non-empty (title >= 4 chars, summary >= 10 chars, details >= 20 chars).'
        );
      }

      const nowIso = new Date().toISOString();
      const existingIdx = agentMemory.knowledgeBase.findIndex(
        (e) => e.code.trim().toUpperCase() === finalCode
      );

      let committedEntry: KnowledgeEntry;

      if (targetProp.action_type === 'update') {
        if (existingIdx < 0) {
          throw new Error(
            `CONFLICT:Cannot apply update—live entry ${finalCode} no longer exists.`
          );
        }
        const liveEntry = agentMemory.knowledgeBase[existingIdx];
        const liveVersion = liveEntry.version ?? 1;
        if (
          typeof targetProp.base_version === 'number' &&
          targetProp.base_version !== liveVersion
        ) {
          throw new Error(
            `CONFLICT:Version mismatch on ${finalCode}: proposal targeted v${targetProp.base_version}, but live KB is already at v${liveVersion}. Request a revision from ${targetProp.proposed_by_name} to rebase onto v${liveVersion}.`
          );
        }

        const versionSnapshot: KnowledgeVersionSnapshot = {
          version: liveVersion,
          updatedAt: liveEntry.updatedAt,
          title: liveEntry.title,
          scope: liveEntry.department,
          owners: liveEntry.maintainedBy,
          summary: liveEntry.summary,
          details: liveEntry.contentMarkdown,
          proposedBy: targetProp.proposed_by_name,
          approvedBy: liveEntry.approvedBy,
          changeNote: targetProp.rationale || `Prior to proposal ${targetProp.proposal_id}`,
        };

        committedEntry = {
          ...liveEntry,
          code: finalCode,
          title: finalTitle,
          category: categoryFromKbCode(finalCode),
          department: finalScope,
          maintainedBy: finalOwners,
          summary: finalSummary,
          contentMarkdown: finalDetails,
          sources: targetProp.sources ?? liveEntry.sources,
          updatedAt: nowIso,
          sourceTaskId: targetProp.task_id,
          version: liveVersion + 1,
          approvedByCho: true,
          approvedBy: choAuth.choIdentity,
          versionHistory: [...(liveEntry.versionHistory ?? []), versionSnapshot].slice(-30),
        };
        agentMemory.knowledgeBase[existingIdx] = committedEntry;
      } else {
        if (existingIdx >= 0) {
          throw new Error(
            `CONFLICT:Cannot create ${finalCode}—an entry with code ${finalCode} already exists in the live Knowledge Base.`
          );
        }
        committedEntry = {
          id: `kb_${finalCode.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString(36)}`,
          code: finalCode,
          title: finalTitle,
          category: categoryFromKbCode(finalCode),
          department: finalScope,
          maintainedBy: finalOwners,
          summary: finalSummary,
          contentMarkdown: finalDetails,
          sources: targetProp.sources ?? [],
          updatedAt: nowIso,
          locked: finalCode.startsWith('KB-GOV-'),
          sourceTaskId: targetProp.task_id,
          version: 1,
          approvedByCho: true,
          approvedBy: choAuth.choIdentity,
          versionHistory: [],
        };
        agentMemory.knowledgeBase = [...agentMemory.knowledgeBase, committedEntry];
      }

      // Immediately refresh shared KB context/cache in memory
      agentMemory.knowledgeBase = mergeKnowledgeBase(agentMemory.knowledgeBase);
      const refreshedEntry =
        agentMemory.knowledgeBase.find((e) => e.code.toUpperCase() === finalCode) ??
        committedEntry;

      const updatedProposal: KnowledgeProposal = {
        ...targetProp,
        title: finalTitle,
        scope: finalScope,
        owners: finalOwners,
        summary: finalSummary,
        details: finalDetails,
        cho_edits: edits,
        status: 'approved',
        approved_by: choAuth.choIdentity,
        committed_version: refreshedEntry.version ?? 1,
        resolved_at: nowIso,
      };
      agentMemory.kbProposals[propIdx] = updatedProposal;

      // Prune ledger to 100 entries and record deterministic idempotency receipt
      const ledgerKeys = Object.keys(agentMemory.kbIdempotencyLedger);
      if (ledgerKeys.length >= 100) {
        delete agentMemory.kbIdempotencyLedger[ledgerKeys[0]];
      }
      agentMemory.kbIdempotencyLedger[idempotencyKey] = {
        proposalId: updatedProposal.proposal_id,
        committedVersion: refreshedEntry.version ?? 1,
        entry: refreshedEntry,
        proposal: updatedProposal,
        committedAt: nowIso,
      };

      syncAgentFieldInState(targetProp.proposed_by, {
        currentActivity: `CHO approved & committed ${finalCode} (v${refreshedEntry.version ?? 1})`,
      });
      agentMemory.updatedAt = nowIso;

      return {
        idempotentReplay: false,
        entry: refreshedEntry,
        proposal: updatedProposal,
      };
    });

    res.json({
      ok: true,
      idempotentReplay: result.idempotentReplay,
      entry: result.entry,
      proposal: result.proposal,
      entries: agentMemory.knowledgeBase,
      proposals: agentMemory.kbProposals,
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Failed to approve KB proposal.';
    if (rawMsg.startsWith('NOT_FOUND:')) {
      res.status(404).json({ error: rawMsg.slice('NOT_FOUND:'.length) });
    } else if (rawMsg.startsWith('CONFLICT:')) {
      res.status(409).json({ error: rawMsg.slice('CONFLICT:'.length) });
    } else if (rawMsg.startsWith('FORBIDDEN:')) {
      res.status(403).json({ error: rawMsg.slice('FORBIDDEN:'.length) });
    } else if (rawMsg.startsWith('VALIDATION:')) {
      res.status(400).json({ error: rawMsg.slice('VALIDATION:'.length) });
    } else {
      res.status(500).json({ error: rawMsg });
    }
  }
});

app.post('/api/kb/proposals/:id/request-revision', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const proposalParam = req.params.id;
  const { feedback } = (req.body ?? {}) as { feedback?: string };
  if (!feedback || feedback.trim().length < 3) {
    res.status(400).json({ error: 'Revision feedback for the proposing agent is required.' });
    return;
  }

  const existingProposal = agentMemory.kbProposals.find(
    (p) => p.proposal_id === proposalParam || p.id === proposalParam
  );
  if (!existingProposal) {
    res.status(404).json({ error: 'Knowledge Base proposal not found.' });
    return;
  }
  if (existingProposal.status !== 'pending') {
    res.status(409).json({
      error: `Proposal ${existingProposal.id} is already ${existingProposal.status}.`,
    });
    return;
  }

  try {
    const fullRoster = buildFullVillageRoster(
      (agentMemory.agents ?? []) as unknown as AgentDossier[],
      mergeDossier
    );

    const revisedProposal = await runKbProposalRevisionTurn({
      originalProposal: existingProposal,
      feedback: feedback.trim(),
      roster: fullRoster,
      liveKnowledgeBase: agentMemory.knowledgeBase,
      houseNotes: agentMemory.notes,
    });

    const saved = await runAtomicMutation(() => {
      const nowIso = new Date().toISOString();
      const idx = agentMemory.kbProposals.findIndex(
        (p) => p.proposal_id === existingProposal.proposal_id
      );
      const updatedOriginal: KnowledgeProposal = {
        ...existingProposal,
        status: 'revision_requested',
        revision_feedback: feedback.trim(),
        revised_by_proposal_id: revisedProposal.proposal_id,
        resolved_at: nowIso,
      };
      if (idx >= 0) {
        agentMemory.kbProposals[idx] = updatedOriginal;
      }
      agentMemory.kbProposals = [revisedProposal, ...agentMemory.kbProposals].slice(0, 60);

      // Attach revised proposal ID to the originating task if present
      agentMemory.tasks = agentMemory.tasks.map((t) => {
        if (!t || t.id !== existingProposal.task_id) return t;
        const prevIds = Array.isArray(t.kbProposalIds) ? (t.kbProposalIds as string[]) : [];
        return {
          ...t,
          kbProposalIds: Array.from(new Set([...prevIds, revisedProposal.proposal_id])),
        };
      });

      syncAgentFieldInState(revisedProposal.proposed_by, {
        currentActivity: `Revised ${revisedProposal.id} per CHO feedback — awaiting review`,
      });
      agentMemory.updatedAt = nowIso;
      return updatedOriginal;
    });

    res.json({
      ok: true,
      originalProposal: saved,
      revisedProposal,
      proposals: agentMemory.kbProposals,
    });
  } catch (err) {
    console.error('KB revision error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate revised KB proposal.',
    });
  }
});

app.post('/api/kb/proposals/:id/reject', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const proposalParam = req.params.id;
  const { reason } = (req.body ?? {}) as { reason?: string };

  try {
    const rejected = await runAtomicMutation(() => {
      const idx = agentMemory.kbProposals.findIndex(
        (p) => p.proposal_id === proposalParam || p.id === proposalParam
      );
      if (idx < 0) {
        throw new Error('NOT_FOUND');
      }
      const target = agentMemory.kbProposals[idx];
      if (target.status !== 'pending') {
        throw new Error(`CONFLICT:Proposal is already ${target.status}.`);
      }
      const nowIso = new Date().toISOString();
      const updated: KnowledgeProposal = {
        ...target,
        status: 'rejected',
        rejection_reason: reason?.trim() || 'Rejected by Chief Human Officer.',
        resolved_at: nowIso,
      };
      agentMemory.kbProposals[idx] = updated;
      agentMemory.updatedAt = nowIso;
      return updated;
    });

    res.json({
      ok: true,
      proposal: rejected,
      proposals: agentMemory.kbProposals,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to reject proposal.';
    if (msg === 'NOT_FOUND') {
      res.status(404).json({ error: 'Knowledge Base proposal not found.' });
    } else if (msg.startsWith('CONFLICT:')) {
      res.status(409).json({ error: msg.slice('CONFLICT:'.length) });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// Courtyard Consolidation (Aria, Zoe & Eli): Stages pending KB Decision Packets for CHO review (never writes directly to live KB!)
app.post('/api/village/knowledge/consolidate', async (req, res) => {
  try {
    const { focusTopic } = (req.body ?? {}) as { focusTopic?: string };
    const existingEntriesSummary = agentMemory.knowledgeBase
      .map((e) => `- [${e.code} · v${e.version ?? 1}] ${e.title} (${e.category} · ${e.department}): ${e.summary}`)
      .join('\n');

    const houseNotesDump = Object.entries(agentMemory.notes)
      .map(([agentId, notes]) => `- ${agentId}: ${(notes ?? []).slice(-5).join(' | ')}`)
      .join('\n');

    const recentTasksDump = agentMemory.tasks
      .slice(0, 6)
      .map(
        (t) =>
          `- ${String(t.assignedDirectorName ?? 'Director')}: "${String(t.prompt ?? '')}" -> ${String(t.summary ?? '')}`
      )
      .join('\n');

    const result = await consolidateVillageKnowledge({
      existingEntriesSummary,
      houseNotesDump,
      recentTasksDump,
      focusTopic,
    });

    const fullRoster = buildFullVillageRoster(
      (agentMemory.agents ?? []) as unknown as AgentDossier[],
      mergeDossier
    );
    const consolidationTaskId = `kb_sync_${Date.now()}`;

    const stagedProposals = await runAtomicMutation(() => {
      const staged: KnowledgeProposal[] = [];
      const reservedCodes = new Set([
        ...agentMemory.knowledgeBase.map((e) => e.code.toUpperCase()),
        ...agentMemory.kbProposals
          .filter((p) => p.status === 'pending')
          .map((p) => p.id.toUpperCase()),
      ]);

      for (const item of result.synthesizedEntries) {
        const duplicateLive = agentMemory.knowledgeBase.some(
          (e) => e.title.toLowerCase() === item.title.toLowerCase()
        );
        const duplicatePending = agentMemory.kbProposals.some(
          (p) => p.status === 'pending' && p.title.toLowerCase() === item.title.toLowerCase()
        );
        if (duplicateLive || duplicatePending) continue;

        // Pick next unused canonical code across both live entries and pending proposals
        const prefix = item.category === 'research_brief' ? 'KB-RES-' : 'KB-SOP-';
        let seqNum = 1;
        let candidateCode = `${prefix}${String(seqNum).padStart(2, '0')}`;
        while (reservedCodes.has(candidateCode)) {
          seqNum += 1;
          candidateCode = `${prefix}${String(seqNum).padStart(2, '0')}`;
        }
        reservedCodes.add(candidateCode);

        const stewardId = item.category === 'research_brief' ? 'aria' : 'worker_devon';
        const steward =
          resolveRosterAgent(stewardId, fullRoster) ?? fullRoster[0];

        const validated = validateKnowledgeProposalInput({
          taskId: consolidationTaskId,
          rawId: candidateCode,
          title: item.title,
          scope: item.department || 'All Houses',
          owners: item.maintainedBy || 'Aria, Zoe & Eli',
          summary: item.summary,
          details: item.contentMarkdown,
          actionType: 'create',
          proposedByAgent: steward,
          rationale: result.auditSummary,
          liveKnowledgeBase: agentMemory.knowledgeBase,
        });
        if (validated.ok) {
          staged.push(validated.proposal);
        }
      }

      if (staged.length > 0) {
        agentMemory.kbProposals = [...staged, ...agentMemory.kbProposals].slice(0, 60);
      }

      // Deduplicate each agent's notes array in place so repeated courtyard syncs stay clean
      for (const [agentId, notes] of Object.entries(agentMemory.notes)) {
        if (!Array.isArray(notes)) continue;
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const n of notes) {
          const key = n.trim().toLowerCase();
          if (key && !seen.has(key)) {
            seen.add(key);
            deduped.push(n.trim());
          }
        }
        agentMemory.notes[agentId] = deduped.slice(-15);
        syncAgentFieldInState(agentId, { notes: agentMemory.notes[agentId] });
      }

      syncAgentFieldInState('aria', {
        currentActivity: `Staged ${staged.length} KB proposal(s) with Zoe & Eli for CHO approval`,
      });
      syncAgentFieldInState('worker_aria', {
        currentActivity: 'Prepared verified citations for CHO KB Decision Packet',
      });
      syncAgentFieldInState('worker_devon', {
        currentActivity: 'Staged deduplicated KB-SOP proposal(s) for CHO review',
      });

      agentMemory.updatedAt = new Date().toISOString();
      return staged;
    });

    res.json({
      ok: true,
      auditSummary: result.auditSummary,
      stagedProposals,
      addedEntries: [], // Zero direct live writes; committed only upon CHO approval
      proposals: agentMemory.kbProposals,
      entries: agentMemory.knowledgeBase,
    });
  } catch (err) {
    console.error('Knowledge consolidation error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to consolidate Knowledge Base.',
    });
  }
});

async function resolveWorkspaceBriefing(
  authHeader?: string,
  options?: {
    includeWorkingFolder?: boolean;
    gmailPreferences?: GmailSourcePreferences;
  }
): Promise<WorkspaceBriefingPayload> {
  const includeWorkingFolder = options?.includeWorkingFolder ?? true;
  const activeWorkingFolder = includeWorkingFolder
    ? (agentMemory.settings?.driveWorkingFolder ?? null)
    : null;
  const currentSettings = normalizeVillageSettings(agentMemory.settings);
  const gmailPrefs: GmailSourcePreferences = {
    includeInbox: options?.gmailPreferences?.includeInbox ?? currentSettings.gmailIncludeInbox,
    selectedLabels:
      options?.gmailPreferences?.selectedLabels ?? currentSettings.gmailSelectedLabels,
  };

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const live = await fetchWorkspaceBriefing(
      authHeader,
      agentMemory.linkedDocs,
      agentMemory.pinnedDriveFiles,
      activeWorkingFolder,
      agentMemory.pinnedChats,
      gmailPrefs
    );
    if (live.connected) {
      rememberVolatileWorkspaceAuthHeader(authHeader);
      agentMemory.workspaceSnapshot = live as unknown as Record<string, unknown>;
      agentMemory.updatedAt = new Date().toISOString();
      saveMemory(agentMemory);
      return live;
    }
  }
  const snap = agentMemory.workspaceSnapshot as WorkspaceBriefingPayload | undefined;
  if (snap && snap.connected) {
    return {
      ...snap,
      chatConsoleUrl: snap.chatConsoleUrl ?? GOOGLE_CHAT_CONSOLE_URL,
      pinnedChats: agentMemory.pinnedChats,
      linkedDocs: agentMemory.linkedDocs,
      pinnedDriveFiles: agentMemory.pinnedDriveFiles,
      workingFolder: activeWorkingFolder,
      workingFolderFiles: includeWorkingFolder ? (snap.workingFolderFiles ?? []) : [],
    };
  }
  return {
    connected: false,
    unreadCount: 0,
    recentEmails: [],
    gmailLabels: [],
    activeGmailSources: [],
    upcomingEvents: [],
    chatSpaces: [],
    pinnedChats: agentMemory.pinnedChats,
    chatConsoleUrl: GOOGLE_CHAT_CONSOLE_URL,
    linkedDocs: agentMemory.linkedDocs,
    driveFiles: [],
    pinnedDriveFiles: agentMemory.pinnedDriveFiles,
    workingFolder: activeWorkingFolder,
    workingFolderFiles: [],
  };
}

function upsertPinnedChat(chatCtx: PinnedChatContext): PinnedChatContext[] {
  const next = [
    chatCtx,
    ...agentMemory.pinnedChats.filter((c) => c.id !== chatCtx.id),
  ].slice(0, 20);
  agentMemory.pinnedChats = next;
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      pinnedChats: next,
    };
  }
  return next;
}

function upsertLinkedDoc(doc: GoogleDocSummary): GoogleDocSummary[] {
  const next = [
    doc,
    ...agentMemory.linkedDocs.filter((d) => d.documentId !== doc.documentId),
  ].slice(0, 25);
  agentMemory.linkedDocs = next;
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      linkedDocs: next,
    };
  }
  return next;
}

function upsertPinnedDriveFile(file: GoogleDriveFileSummary): GoogleDriveFileSummary[] {
  const next = [
    file,
    ...agentMemory.pinnedDriveFiles.filter((f) => f.id !== file.id),
  ].slice(0, 25);
  agentMemory.pinnedDriveFiles = next;
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      pinnedDriveFiles: next,
    };
  }
  return next;
}

// Google Workspace Briefing (Gmail + Calendar + Google Chat + Google Docs + Google Drive)
app.get('/api/workspace/briefing', async (req, res) => {
  let gmailOverride: GmailSourcePreferences | undefined;
  const rawIncludeInbox = req.query.includeInbox;
  const rawSelectedLabels = req.query.selectedLabels;
  if (typeof rawIncludeInbox === 'string' || typeof rawSelectedLabels === 'string') {
    const current = normalizeVillageSettings(agentMemory.settings);
    const nextIncludeInbox =
      rawIncludeInbox === '0' || rawIncludeInbox === 'false'
        ? false
        : rawIncludeInbox === '1' || rawIncludeInbox === 'true'
          ? true
          : current.gmailIncludeInbox;
    let nextSelectedLabels: GmailLabelConfig[] = current.gmailSelectedLabels;
    if (typeof rawSelectedLabels === 'string') {
      try {
        const parsed = JSON.parse(rawSelectedLabels);
        if (Array.isArray(parsed)) {
          nextSelectedLabels = normalizeVillageSettings({
            ...current,
            gmailSelectedLabels: parsed,
          }).gmailSelectedLabels;
        }
      } catch {
        // Ignore malformed query param
      }
    }
    agentMemory.settings = normalizeVillageSettings({
      ...current,
      gmailIncludeInbox: nextIncludeInbox,
      gmailSelectedLabels: nextSelectedLabels,
    });
    gmailOverride = {
      includeInbox: agentMemory.settings.gmailIncludeInbox,
      selectedLabels: agentMemory.settings.gmailSelectedLabels,
    };
  }

  const briefing = await resolveWorkspaceBriefing(req.headers.authorization, {
    includeWorkingFolder: true,
    gmailPreferences: gmailOverride,
  });
  res.json(briefing);
});

// List available Gmail labels (custom user labels + system labels) with live unread counts
app.get('/api/workspace/gmail/labels', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to load Gmail labels.' });
    return;
  }
  try {
    const labels = await listGmailLabels(authHeader, true);
    res.json({ ok: true, labels });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load Gmail labels.',
    });
  }
});

// Read Gmail messages across specified labels, Inbox, and/or search query (strictly read-only)
app.post('/api/workspace/gmail/messages', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to read Gmail messages.' });
    return;
  }
  const body = (req.body ?? {}) as {
    labelIds?: string[];
    labelQuery?: string;
    includeInbox?: boolean;
    query?: string;
    unreadOnly?: boolean;
    maxResults?: number;
    includeBody?: boolean;
  };
  try {
    const result = await readGmailMessages(authHeader, {
      labelIds: Array.isArray(body.labelIds) ? body.labelIds : undefined,
      labelQuery: typeof body.labelQuery === 'string' ? body.labelQuery : undefined,
      includeInbox: typeof body.includeInbox === 'boolean' ? body.includeInbox : undefined,
      query: typeof body.query === 'string' ? body.query : undefined,
      unreadOnly: Boolean(body.unreadOnly),
      maxResults: typeof body.maxResults === 'number' ? body.maxResults : 20,
      includeBody: Boolean(body.includeBody),
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to read Gmail messages.',
    });
  }
});

// Save a real Gmail Draft ONLY after explicit CHO approval
app.post('/api/workspace/create-draft', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to save a real Gmail draft.' });
    return;
  }
  const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
  if (!subject || !body) {
    res.status(400).json({ error: 'Subject and body are required to save a Gmail draft.' });
    return;
  }
  try {
    const draft = await saveGmailDraft(authHeader, to || '', subject, body);
    res.json({ ok: true, draftId: draft.id });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create Gmail draft.' });
  }
});

// Create a Google Calendar event ONLY when Calendar Write Access is enabled and user confirms
app.post('/api/workspace/calendar/events', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to manage Google Calendar.' });
    return;
  }
  if (!agentMemory.settings?.calendarWriteAccess) {
    res.status(403).json({
      error: 'Calendar write access is currently set to Read-Only in Settings.',
      calendarSettingDisabled: true,
    });
    return;
  }
  const { summary, start, end, location, description } = (req.body ?? {}) as {
    summary?: string;
    start?: string;
    end?: string;
    location?: string;
    description?: string;
  };
  if (!summary?.trim() || !start?.trim() || !end?.trim()) {
    res.status(400).json({ error: 'Event title, start time, and end time are required.' });
    return;
  }
  try {
    const event = await createGoogleCalendarEvent(authHeader, {
      summary,
      start,
      end,
      location,
      description,
    });
    res.json({ ok: true, event });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create Google Calendar event.';
    const status = msg.includes('Missing Google Calendar write permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Update an existing Google Calendar event ONLY when Calendar Write Access is enabled and user confirms
app.patch('/api/workspace/calendar/events/:eventId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to update Google Calendar.' });
    return;
  }
  if (!agentMemory.settings?.calendarWriteAccess) {
    res.status(403).json({
      error: 'Calendar write access is currently set to Read-Only in Settings.',
      calendarSettingDisabled: true,
    });
    return;
  }
  const { eventId } = req.params;
  const { summary, start, end, location, description } = (req.body ?? {}) as {
    summary?: string;
    start?: string;
    end?: string;
    location?: string;
    description?: string;
  };
  try {
    const event = await updateGoogleCalendarEvent(authHeader, eventId, {
      summary,
      start,
      end,
      location,
      description,
    });
    res.json({ ok: true, event });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update Google Calendar event.';
    const status = msg.includes('Missing Google Calendar write permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Delete a Google Calendar event ONLY when Calendar Write Access is enabled and user confirms
app.delete('/api/workspace/calendar/events/:eventId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to remove a Google Calendar event.' });
    return;
  }
  if (!agentMemory.settings?.calendarWriteAccess) {
    res.status(403).json({
      error: 'Calendar write access is currently set to Read-Only in Settings.',
      calendarSettingDisabled: true,
    });
    return;
  }
  const { eventId } = req.params;
  try {
    await deleteGoogleCalendarEvent(authHeader, eventId);
    res.json({ ok: true, deletedId: eventId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to delete Google Calendar event.';
    const status = msg.includes('Missing Google Calendar write permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// List Google Chat spaces with pagination & optional type filter (non-destructive read)
app.get('/api/workspace/chat/spaces', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to browse Google Chat spaces.' });
    return;
  }
  const pageToken = typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined;
  const rawFilter = typeof req.query.filterType === 'string' ? req.query.filterType : 'ALL';
  const filterType =
    rawFilter === 'SPACE' || rawFilter === 'GROUP_CHAT' || rawFilter === 'DIRECT_MESSAGE'
      ? rawFilter
      : 'ALL';
  try {
    const listed = await listGoogleChatSpaces(authHeader, {
      pageSize: 50,
      pageToken,
      filterType,
    });
    res.json({ ok: true, ...listed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list Google Chat spaces.';
    const status = msg.includes('Missing Google Chat permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Read full messages & threads from a specified Google Chat space, URL, or thread (non-destructive read)
app.post('/api/workspace/chat/read', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to read Google Chat messages.' });
    return;
  }
  const { target, threadName, pageSize, pageToken, searchQuery } = (req.body ?? {}) as {
    target?: string;
    threadName?: string;
    pageSize?: number;
    pageToken?: string;
    searchQuery?: string;
  };
  if (!target?.trim()) {
    res.status(400).json({
      error: 'Enter a Google Chat space ID (spaces/AAAA...), thread ID, or Google Chat URL to read.',
    });
    return;
  }
  try {
    const data = await readGoogleChatConversation(authHeader, {
      target,
      threadName,
      pageSize,
      pageToken,
      searchQuery,
    });
    syncAgentFieldInState('daniel', {
      currentActivity: `Reading Google Chat: ${data.space.displayName}${
        data.focusedThreadName ? ' (thread)' : ''
      }`,
    });
    res.json({ ok: true, ...data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read Google Chat conversation.';
    const status = msg.includes('Missing Google Chat permission')
      ? 403
      : msg.includes('not found')
        ? 404
        : 500;
    res.status(status).json({ error: msg });
  }
});

// Pin a Google Chat space or specific thread into active Village / Daniel context (non-destructive read/context pin)
app.post('/api/workspace/chat/pin', async (req, res) => {
  const authHeader = req.headers.authorization;
  const {
    target,
    spaceName: providedSpaceName,
    spaceDisplayName: providedDisplayName,
    spaceType: providedSpaceType,
    threadName,
    label: providedLabel,
    messages: providedMessages,
  } = (req.body ?? {}) as {
    target?: string;
    spaceName?: string;
    spaceDisplayName?: string;
    spaceType?: string;
    threadName?: string;
    label?: string;
    messages?: GoogleChatMessageSummary[];
  };

  try {
    let spaceName = providedSpaceName?.trim() || '';
    let spaceDisplayName = providedDisplayName?.trim() || '';
    let spaceType = providedSpaceType;
    let resolvedThread = threadName?.trim() || undefined;
    let messages = Array.isArray(providedMessages) ? providedMessages : [];

    if ((!spaceName || messages.length === 0) && target?.trim()) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          error: 'Please Sign in with Google first to read and pin this Google Chat conversation.',
        });
        return;
      }
      const loaded = await readGoogleChatConversation(authHeader, {
        target: target.trim(),
        threadName: resolvedThread,
        pageSize: 50,
      });
      spaceName = loaded.space.name;
      spaceDisplayName = loaded.space.displayName;
      spaceType = loaded.space.spaceType;
      resolvedThread = loaded.focusedThreadName || resolvedThread;
      messages = loaded.messages;
    }

    if (!spaceName) {
      res.status(400).json({ error: 'spaceName or target is required to pin a Google Chat conversation.' });
      return;
    }

    const pinId = resolvedThread || spaceName;
    const shortThread = resolvedThread ? resolvedThread.split('/').pop() || 'thread' : '';
    const computedLabel =
      providedLabel?.trim() ||
      (resolvedThread
        ? `${spaceDisplayName || spaceName} · Thread ${shortThread.slice(0, 8)}`
        : spaceDisplayName || spaceName);

    const pinnedEntry: PinnedChatContext = {
      id: pinId,
      spaceName,
      spaceDisplayName: spaceDisplayName || spaceName,
      spaceType,
      threadName: resolvedThread,
      label: computedLabel,
      pinnedAt: new Date().toISOString(),
      messages: messages.slice(-60),
    };

    const pinnedChats = upsertPinnedChat(pinnedEntry);
    syncAgentFieldInState('daniel', {
      currentActivity: `Pinned Google Chat context: ${computedLabel}`,
    });
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
    res.json({ ok: true, pinned: pinnedEntry, pinnedChats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to pin Google Chat conversation.';
    const status = msg.includes('Missing Google Chat permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Unpin a Google Chat space or thread from active Village context
app.post('/api/workspace/chat/unpin', (req, res) => {
  const { id } = (req.body ?? {}) as { id?: string };
  if (!id?.trim()) {
    res.status(400).json({ error: 'Pinned chat id is required.' });
    return;
  }
  const next = agentMemory.pinnedChats.filter((c) => c.id !== id.trim());
  agentMemory.pinnedChats = next;
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      pinnedChats: next,
    };
  }
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, pinnedChats: next });
});

// Send a Google Chat message (in space or specific thread) ONLY after explicit CHO confirmation / approval
app.post('/api/workspace/chat/send', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to send a Google Chat message.' });
    return;
  }
  const { spaceName, text, threadName } = (req.body ?? {}) as {
    spaceName?: string;
    text?: string;
    threadName?: string;
  };
  if (!spaceName?.trim() || !text?.trim()) {
    res.status(400).json({ error: 'Both spaceName and message text are required.' });
    return;
  }
  try {
    const sent = await sendGoogleChatMessage(authHeader, spaceName, text, threadName);
    res.json({
      ok: true,
      messageName: sent.name,
      createTime: sent.createTime,
      threadName: sent.threadName,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send Google Chat message.';
    const status = msg.includes('Missing Google Chat permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Read & link an existing Google Doc by URL or Document ID (non-destructive read)
app.post('/api/workspace/docs/import', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to read a Google Doc.' });
    return;
  }
  const { docIdOrUrl } = (req.body ?? {}) as { docIdOrUrl?: string };
  if (!docIdOrUrl?.trim()) {
    res.status(400).json({ error: 'Please enter a Google Docs URL or Document ID.' });
    return;
  }
  try {
    const doc = await fetchGoogleDocument(authHeader, docIdOrUrl);
    const linkedDocs = upsertLinkedDoc(doc);
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
    res.json({ ok: true, doc, linkedDocs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read Google Doc.';
    const status = msg.includes('Missing Google Docs permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Create & populate a new Google Doc ONLY after explicit CHO confirmation / approval
app.post('/api/workspace/docs/create', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to create a Google Doc.' });
    return;
  }
  const { title, content, sourceTaskId } = (req.body ?? {}) as {
    title?: string;
    content?: string;
    sourceTaskId?: string;
  };
  if (!title?.trim()) {
    res.status(400).json({ error: 'Document title is required.' });
    return;
  }
  try {
    const doc = await createGoogleDocument(authHeader, title, content ?? '', sourceTaskId);
    const linkedDocs = upsertLinkedDoc(doc);
    if (sourceTaskId) {
      agentMemory.tasks = agentMemory.tasks.map((t) =>
        t && t.id === sourceTaskId
          ? { ...t, exportedDocUrl: doc.url, exportedDocTitle: doc.title }
          : t
      );
    }
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
    res.json({ ok: true, doc, linkedDocs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create Google Doc.';
    const status = msg.includes('Missing Google Docs permission') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Unlink a Google Doc from the local Village Workspace Hub (does NOT delete the Google Doc)
app.delete('/api/workspace/docs/:documentId', (req, res) => {
  const { documentId } = req.params;
  agentMemory.linkedDocs = agentMemory.linkedDocs.filter((d) => d.documentId !== documentId);
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      linkedDocs: agentMemory.linkedDocs,
    };
  }
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, linkedDocs: agentMemory.linkedDocs });
});

// Search or list Google Drive files & folders (non-destructive read)
app.get('/api/workspace/drive/files', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to browse Google Drive.' });
    return;
  }
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  const folderId = typeof req.query.folderId === 'string' ? req.query.folderId : undefined;
  try {
    const files = await searchGoogleDriveFiles(authHeader, query, folderId);
    res.json({ ok: true, files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to search Google Drive.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Read & pin a Google Drive file or folder into Village context (non-destructive read)
app.post('/api/workspace/drive/pin', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to read a Google Drive file.' });
    return;
  }
  const { fileIdOrUrl } = (req.body ?? {}) as { fileIdOrUrl?: string };
  if (!fileIdOrUrl?.trim()) {
    res.status(400).json({ error: 'Please enter a Google Drive File/Folder URL or ID.' });
    return;
  }
  try {
    const file = await readGoogleDriveFileContent(authHeader, fileIdOrUrl);
    const pinnedDriveFiles = upsertPinnedDriveFile(file);
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
    res.json({ ok: true, file, pinnedDriveFiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read Google Drive file.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Unpin a Google Drive file from local Village context (does NOT delete from Google Drive)
app.delete('/api/workspace/drive/pin/:fileId', (req, res) => {
  const { fileId } = req.params;
  agentMemory.pinnedDriveFiles = agentMemory.pinnedDriveFiles.filter((f) => f.id !== fileId);
  if (agentMemory.workspaceSnapshot && typeof agentMemory.workspaceSnapshot === 'object') {
    agentMemory.workspaceSnapshot = {
      ...agentMemory.workspaceSnapshot,
      pinnedDriveFiles: agentMemory.pinnedDriveFiles,
    };
  }
  agentMemory.updatedAt = new Date().toISOString();
  saveMemory(agentMemory);
  res.json({ ok: true, pinnedDriveFiles: agentMemory.pinnedDriveFiles });
});

// List Google Drive folders for Settings Working Folder picker
app.get('/api/workspace/drive/folders', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to browse Google Drive folders.' });
    return;
  }
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;
  try {
    const folders = await listGoogleDriveFolders(authHeader, query);
    res.json({ ok: true, folders });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list Google Drive folders.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// List files & subfolders strictly inside the configured Working Folder
app.get('/api/workspace/drive/working-folder/files', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to browse your Working Folder.' });
    return;
  }
  const workingFolderId =
    (typeof req.query.workingFolderId === 'string' && req.query.workingFolderId.trim()) ||
    agentMemory.settings?.driveWorkingFolder?.id;
  if (!workingFolderId) {
    res.status(400).json({ error: 'No Google Drive Working Folder configured yet.' });
    return;
  }
  const targetFolderId =
    (typeof req.query.folderId === 'string' && req.query.folderId.trim()) || workingFolderId;
  const query = typeof req.query.q === 'string' ? req.query.q : undefined;

  try {
    if (targetFolderId !== workingFolderId) {
      const inside = await isItemInsideWorkingFolder(authHeader, targetFolderId, workingFolderId);
      if (!inside) {
        res.status(403).json({
          error: 'Safety block: Folder is outside your configured Google Drive Working Folder.',
        });
        return;
      }
    }
    const files = await searchGoogleDriveFiles(authHeader, query, targetFolderId);
    res.json({ ok: true, files, folderId: targetFolderId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to list Working Folder contents.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Read full metadata & text content of a file inside the configured Working Folder
app.post('/api/workspace/drive/working-folder/read', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to read Working Folder files.' });
    return;
  }
  const { fileId, workingFolderId: rawWorkingId } = (req.body ?? {}) as {
    fileId?: string;
    workingFolderId?: string;
  };
  const workingFolderId = rawWorkingId?.trim() || agentMemory.settings?.driveWorkingFolder?.id;
  if (!fileId?.trim()) {
    res.status(400).json({ error: 'File ID is required.' });
    return;
  }
  try {
    if (workingFolderId && fileId.trim() !== workingFolderId) {
      const inside = await isItemInsideWorkingFolder(authHeader, fileId.trim(), workingFolderId);
      if (!inside) {
        res.status(403).json({
          error: 'Safety block: Target file is outside your configured Google Drive Working Folder.',
        });
        return;
      }
    }
    const file = await readGoogleDriveFileContent(authHeader, fileId.trim());
    res.json({ ok: true, file });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to read file.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Create a new Working Folder root OR create a new file/subfolder inside the Working Folder
app.post('/api/workspace/drive/working-folder/create', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to write to Google Drive.' });
    return;
  }
  const {
    createRootFolder,
    workingFolderId: rawWorkingId,
    parentFolderId,
    name,
    content,
    mimeType,
    isFolder,
  } = (req.body ?? {}) as {
    createRootFolder?: boolean;
    workingFolderId?: string;
    parentFolderId?: string;
    name?: string;
    content?: string;
    mimeType?: string;
    isFolder?: boolean;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'File or folder name is required.' });
    return;
  }

  try {
    if (createRootFolder) {
      const createdFolder = await saveGoogleDriveFile(authHeader, {
        name: name.trim(),
        isFolder: true,
        parentFolderId: parentFolderId?.trim() || undefined,
      });
      const folderConfig = {
        id: createdFolder.id,
        name: createdFolder.name,
        webViewLink:
          createdFolder.webViewLink || `https://drive.google.com/drive/folders/${createdFolder.id}`,
        configuredAt: new Date().toISOString(),
      };
      const currentSettings = normalizeVillageSettings(agentMemory.settings);
      agentMemory.settings = {
        ...currentSettings,
        driveWorkingFolder: folderConfig,
      };
      agentMemory.updatedAt = new Date().toISOString();
      saveMemory(agentMemory);
      res.json({ ok: true, file: createdFolder, workingFolder: folderConfig });
      return;
    }

    const workingFolderId = rawWorkingId?.trim() || agentMemory.settings?.driveWorkingFolder?.id;
    if (!workingFolderId) {
      res.status(400).json({ error: 'Please configure a Google Drive Working Folder first.' });
      return;
    }
    const targetParentId = parentFolderId?.trim() || workingFolderId;
    if (targetParentId !== workingFolderId) {
      const inside = await isItemInsideWorkingFolder(authHeader, targetParentId, workingFolderId);
      if (!inside) {
        res.status(403).json({
          error: 'Safety block: Target parent folder is outside your Working Folder.',
        });
        return;
      }
    }

    const created = await saveGoogleDriveFile(authHeader, {
      name: name.trim(),
      content: isFolder ? undefined : content ?? '',
      mimeType,
      isFolder,
      parentFolderId: targetParentId,
    });
    res.json({ ok: true, file: created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create item in Working Folder.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Edit or rename a file strictly inside the configured Working Folder
app.patch('/api/workspace/drive/working-folder/files/:fileId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to edit Working Folder files.' });
    return;
  }
  const { fileId } = req.params;
  const { workingFolderId: rawWorkingId, name, content } = (req.body ?? {}) as {
    workingFolderId?: string;
    name?: string;
    content?: string;
  };
  const workingFolderId = rawWorkingId?.trim() || agentMemory.settings?.driveWorkingFolder?.id;
  if (!workingFolderId) {
    res.status(400).json({ error: 'No Google Drive Working Folder configured.' });
    return;
  }
  try {
    const updated = await updateGoogleDriveFile(authHeader, {
      fileId,
      workingFolderId,
      name,
      content,
    });
    res.json({ ok: true, file: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update Working Folder file.';
    if (msg.startsWith('READ_ONLY_EXTERNAL_FILE:')) {
      res.status(403).json({
        error: msg.replace('READ_ONLY_EXTERNAL_FILE:', '').trim(),
        readOnlyExternal: true,
      });
      return;
    }
    const status =
      msg.includes('Missing Google Drive') || msg.includes('Safety block') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Move a file or subfolder inside the configured Working Folder to Google Drive Trash
app.delete('/api/workspace/drive/working-folder/files/:fileId', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to delete Working Folder files.' });
    return;
  }
  const { fileId } = req.params;
  const rawWorkingId =
    (typeof req.query.workingFolderId === 'string' && req.query.workingFolderId) ||
    (req.body && typeof (req.body as { workingFolderId?: string }).workingFolderId === 'string'
      ? (req.body as { workingFolderId: string }).workingFolderId
      : undefined);
  const workingFolderId = rawWorkingId?.trim() || agentMemory.settings?.driveWorkingFolder?.id;
  if (!workingFolderId) {
    res.status(400).json({ error: 'No Google Drive Working Folder configured.' });
    return;
  }
  try {
    await trashGoogleDriveFile(authHeader, fileId, workingFolderId);
    res.json({ ok: true, trashedId: fileId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to move file to Trash.';
    if (msg.startsWith('READ_ONLY_EXTERNAL_FILE:')) {
      res.status(403).json({
        error: msg.replace('READ_ONLY_EXTERNAL_FILE:', '').trim(),
        readOnlyExternal: true,
      });
      return;
    }
    const status =
      msg.includes('Missing Google Drive') || msg.includes('Safety block') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Save a new file or create a folder in Google Drive ONLY after explicit CHO confirmation / approval
app.post('/api/workspace/drive/save', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Please Sign in with Google first to save to Google Drive.' });
    return;
  }
  const { name, content, mimeType, parentFolderId, isFolder, sourceTaskId } = (req.body ?? {}) as {
    name?: string;
    content?: string;
    mimeType?: string;
    parentFolderId?: string;
    isFolder?: boolean;
    sourceTaskId?: string;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'File or folder name is required.' });
    return;
  }
  const resolvedParentId =
    parentFolderId?.trim() || agentMemory.settings?.driveWorkingFolder?.id || undefined;
  try {
    const saved = await saveGoogleDriveFile(authHeader, {
      name,
      content,
      mimeType,
      parentFolderId: resolvedParentId,
      isFolder,
    });
    const pinnedDriveFiles = upsertPinnedDriveFile(saved);
    if (sourceTaskId) {
      agentMemory.tasks = agentMemory.tasks.map((t) =>
        t && t.id === sourceTaskId
          ? { ...t, exportedDriveUrl: saved.webViewLink, exportedDriveName: saved.name }
          : t
      );
    }
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
    res.json({ ok: true, file: saved, pinnedDriveFiles });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to save to Google Drive.';
    const status = msg.includes('Missing Google Drive') ? 403 : 500;
    res.status(status).json({ error: msg });
  }
});

// Core Hub-and-Spoke Dispatch Pipeline (KB-SOP-01 & KB-SOP-02):
// CHO -> Matt (Triage) -> Coordinating House Director -> Guild Specialist(s) & Cross-House Collaborators -> Director Synthesis -> CHO
app.post('/api/village/task', async (req, res) => {
  try {
    const {
      prompt,
      priority: rawPriority,
      directors,
      workers,
      allAgents,
      clientTaskId,
      clientTime,
      targetDirectorId,
    } = req.body as {
      prompt?: string;
      priority?: TaskPriority;
      directors?: AgentDossier[];
      workers?: AgentDossier[];
      allAgents?: AgentDossier[];
      clientTaskId?: string;
      clientTime?: ClientTimeContext;
      targetDirectorId?: string | null;
    };

    if (!prompt || (!directors?.length && !allAgents?.length)) {
      res.status(400).json({ error: 'Prompt and village roster are required.' });
      return;
    }

    const priority: TaskPriority =
      rawPriority === 'low' || rawPriority === 'high' ? rawPriority : 'medium';

    const taskStartedMs = Date.now();
    const createdAtIso = new Date(taskStartedMs).toISOString();
    const taskId = clientTaskId || `task_${taskStartedMs}`;

    const fullRoster = buildFullVillageRoster(
      [
        ...((agentMemory.agents ?? []) as unknown as AgentDossier[]),
        ...(directors ?? []),
        ...(workers ?? []),
        ...(allAgents ?? []),
      ],
      mergeDossier
    );

    const includeWorkingFolder = agentMemory.settings?.autoSyncWorkingFolderContext !== false;
    const workspaceBriefing = await resolveWorkspaceBriefing(req.headers.authorization, {
      includeWorkingFolder,
    });

    const execution = await runOrchestratedVillageTask({
      taskId,
      prompt,
      priority,
      targetDirectorId,
      roster: fullRoster,
      liveKnowledgeBase: agentMemory.knowledgeBase,
      houseNotes: agentMemory.notes,
      workspaceBriefing,
      workspaceAuthHeader: req.headers.authorization,
      calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
      clientTime,
    });

    const completedMs = Date.now();
    const fulfillmentMs = Math.max(400, completedMs - taskStartedMs);
    const completedAtIso = new Date(completedMs).toISOString();
    const chosenDirector = execution.chosenDirector;
    const assignedWorker = execution.primaryWorker;
    const routing = execution.routing;

    const taskSource =
      execution.approvalProposal?.needed && execution.approvalProposal.type === 'email_draft'
        ? 'gmail'
        : execution.approvalProposal?.needed && execution.approvalProposal.type === 'calendar_event'
          ? 'calendar'
          : execution.approvalProposal?.needed && execution.approvalProposal.type === 'chat_message'
            ? 'chat'
            : execution.approvalProposal?.needed && execution.approvalProposal.type === 'google_doc'
              ? 'docs'
              : execution.approvalProposal?.needed && execution.approvalProposal.type === 'drive_file'
                ? 'drive'
                : classifyTaskSource(prompt);

    const approvalId = execution.approvalProposal?.needed ? `appr_${completedMs}` : null;
    const stagedKbIds = execution.stagedKbProposals.map((p) => p.proposal_id);
    const hasPendingGate = Boolean(approvalId) || stagedKbIds.length > 0;
    const taskStatus = execution.failedClosed
      ? 'failed'
      : hasPendingGate
        ? 'needs_approval'
        : 'completed';

    const workerModel = routing.needsWebSearch
      ? 'gemini-4-hydrogen (Grounded)'
      : 'gemini-3.1-flash-lite';
    const directorModel = routing.escalateToAdvisor
      ? 'gemini-4-hydrogen (Advisor XHIGH)'
      : 'gemini-4-hydrogen';

    const nextNotes = await runAtomicMutation(() => {
      const currentNotes = agentMemory.notes[chosenDirector.id] ?? chosenDirector.notes;
      const updatedDirectorNotes = [...currentNotes, execution.newDirectorNote].slice(-20);
      agentMemory.notes[chosenDirector.id] = updatedDirectorNotes;

      const shortPrompt = prompt.length > 48 ? `${prompt.slice(0, 45)}...` : prompt;
      syncAgentFieldInState(chosenDirector.id, {
        notes: updatedDirectorNotes,
        activeTaskId: taskId,
        currentActivity: execution.failedClosed
          ? `Halted (fail-closed): ${shortPrompt}`
          : hasPendingGate
            ? `Awaiting CHO approval: ${shortPrompt}`
            : `Synthesized: ${shortPrompt}`,
      });

      for (const collabId of execution.collaboratorIds) {
        syncAgentFieldInState(collabId, {
          activeTaskId: taskId,
          currentActivity: `Delivered handoff artifact to ${chosenDirector.name}: ${shortPrompt}`,
        });
      }

      syncAgentFieldInState('matt', {
        state: 'following_cho',
        currentActivity: `Routed "${shortPrompt}" to ${chosenDirector.name}`,
      });

      const newTaskRecord: Record<string, unknown> = {
        id: taskId,
        prompt,
        createdAt: createdAtIso,
        completedAt: completedAtIso,
        fulfillmentMs,
        taskSource,
        priority,
        status: taskStatus,
        assignedDirectorId: chosenDirector.id,
        assignedDirectorName: chosenDirector.name,
        assignedWorkerId: assignedWorker?.id ?? null,
        workerModel,
        directorModel,
        escalatedToAdvisor: Boolean(routing.escalateToAdvisor),
        routingNote: routing.routingNote ?? '',
        summary: execution.summary,
        reportMarkdown: execution.reportMarkdown,
        groundingSources: execution.groundingSources ?? [],
        approvalId,
        handoffTrace: execution.handoffTrace,
        kbProposalIds: stagedKbIds,
        collaboratorIds: execution.collaboratorIds,
        orchestrationError: execution.errorBanner,
      };
      agentMemory.tasks = [
        newTaskRecord,
        ...agentMemory.tasks.filter((t) => t && t.id !== taskId),
      ].slice(0, 40);

      if (approvalId && execution.approvalProposal?.needed) {
        const newApprovalRecord: Record<string, unknown> = {
          id: approvalId,
          taskId,
          directorId: chosenDirector.id,
          directorName: chosenDirector.name,
          type: execution.approvalProposal.type,
          title: execution.approvalProposal.title,
          description: execution.approvalProposal.description,
          payload: {
            to: execution.approvalProposal.to,
            subject: execution.approvalProposal.subject,
            body: execution.approvalProposal.body,
            eventSummary: execution.approvalProposal.eventSummary,
            eventStart: execution.approvalProposal.eventStart,
            eventEnd: execution.approvalProposal.eventEnd,
            eventLocation: execution.approvalProposal.eventLocation,
            eventDescription: execution.approvalProposal.eventDescription,
            chatSpaceName: execution.approvalProposal.chatSpaceName,
            chatSpaceDisplayName: execution.approvalProposal.chatSpaceDisplayName,
            chatThreadName: execution.approvalProposal.chatThreadName,
            docTitle: execution.approvalProposal.docTitle,
            driveFileName: execution.approvalProposal.driveFileName,
            amount: execution.approvalProposal.amount,
            vendor: execution.approvalProposal.vendor,
            postPlatform: execution.approvalProposal.postPlatform,
            postContent: execution.approvalProposal.postContent,
          },
          status: 'pending',
          createdAt: completedAtIso,
          source_trigger: 'chat',
        };
        agentMemory.approvals = [
          newApprovalRecord,
          ...agentMemory.approvals.filter((a) => a && a.id !== approvalId),
        ].slice(0, 60);
      }

      if (execution.stagedKbProposals.length > 0) {
        const stampedKb = execution.stagedKbProposals.map((p) => ({
          ...p,
          source_trigger: p.source_trigger ?? ('chat' as const),
        }));
        agentMemory.kbProposals = [
          ...stampedKb,
          ...agentMemory.kbProposals,
        ].slice(0, 60);
      }

      agentMemory.updatedAt = completedAtIso;
      return updatedDirectorNotes;
    });

    res.json({
      taskId,
      status: taskStatus,
      failedClosed: execution.failedClosed,
      orchestrationError: execution.errorBanner,
      approvalId,
      createdAt: createdAtIso,
      completedAt: completedAtIso,
      fulfillmentMs,
      taskSource,
      priority,
      routing,
      directorId: chosenDirector.id,
      directorName: chosenDirector.name,
      workerId: assignedWorker?.id ?? null,
      collaboratorIds: execution.collaboratorIds,
      workerModel,
      directorModel,
      escalatedToAdvisor: routing.escalateToAdvisor,
      summary: execution.summary,
      reportMarkdown: execution.reportMarkdown,
      groundingSources: execution.groundingSources,
      updatedDirectorNotes: nextNotes,
      approvalProposal: execution.approvalProposal,
      handoffTrace: execution.handoffTrace,
      stagedKbProposals: execution.stagedKbProposals,
      kbProposals: agentMemory.kbProposals,
    });
  } catch (err) {
    console.error('Task execution error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to process village task.',
    });
  }
});

// Direct 1-on-1 Agent Chat with Cross-Agent Handoff & KB Proposal Orchestration
app.post('/api/village/chat', async (req, res) => {
  try {
    const { agent, allDirectors, allAgents, message, history, clientTime } = req.body as {
      agent?: AgentDossier;
      allDirectors?: AgentDossier[];
      allAgents?: AgentDossier[];
      message?: string;
      history?: Array<{ sender: string; text: string }>;
      clientTime?: ClientTimeContext;
    };
    if (!agent || !message) {
      res.status(400).json({ error: 'Agent and message are required.' });
      return;
    }

    const fullRoster = buildFullVillageRoster(
      [
        ...((agentMemory.agents ?? []) as unknown as AgentDossier[]),
        ...(allDirectors ?? []),
        ...(allAgents ?? []),
        agent,
      ],
      mergeDossier
    );
    const mergedAgent = fullRoster.find((a) => a.id === agent.id) ?? mergeDossier(agent);

    const includeWorkingFolder = agentMemory.settings?.autoSyncWorkingFolderContext !== false;
    const workspaceBriefing = await resolveWorkspaceBriefing(req.headers.authorization, {
      includeWorkingFolder,
    });

    const result = await runOrchestratedAgentChat({
      agent: mergedAgent,
      roster: fullRoster,
      message,
      history: history ?? [],
      liveKnowledgeBase: agentMemory.knowledgeBase,
      houseNotes: agentMemory.notes,
      workspaceBriefing,
      workspaceAuthHeader: req.headers.authorization,
      calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
      clientTime,
    });

    let stagedApprovalId: string | undefined;

    await runAtomicMutation(() => {
      const nowIso = new Date().toISOString();
      if (result.newNote) {
        const currentNotes = agentMemory.notes[mergedAgent.id] ?? mergedAgent.notes;
        const updatedNotes = [...currentNotes, result.newNote].slice(-20);
        agentMemory.notes[mergedAgent.id] = updatedNotes;
        syncAgentFieldInState(mergedAgent.id, { notes: updatedNotes });
      }

      if (result.stagedKbProposals && result.stagedKbProposals.length > 0) {
        const stampedKb = result.stagedKbProposals.map((p) => ({
          ...p,
          source_trigger: p.source_trigger ?? ('chat' as const),
        }));
        agentMemory.kbProposals = [
          ...stampedKb,
          ...agentMemory.kbProposals,
        ].slice(0, 60);
      }

      if (result.approvalProposal?.needed) {
        stagedApprovalId = `appr_chat_${Date.now()}`;
        const newApprovalRecord: Record<string, unknown> = {
          id: stagedApprovalId,
          taskId: result.taskId || `chat_${Date.now()}`,
          directorId: mergedAgent.id,
          directorName: mergedAgent.name,
          type: result.approvalProposal.type,
          title: result.approvalProposal.title,
          description: result.approvalProposal.description,
          payload: {
            to: result.approvalProposal.to,
            subject: result.approvalProposal.subject,
            body: result.approvalProposal.body,
            eventSummary: result.approvalProposal.eventSummary,
            eventStart: result.approvalProposal.eventStart,
            eventEnd: result.approvalProposal.eventEnd,
            eventLocation: result.approvalProposal.eventLocation,
            eventDescription: result.approvalProposal.eventDescription,
            chatSpaceName: result.approvalProposal.chatSpaceName,
            chatSpaceDisplayName: result.approvalProposal.chatSpaceDisplayName,
            chatThreadName: result.approvalProposal.chatThreadName,
            docTitle: result.approvalProposal.docTitle,
            driveFileName: result.approvalProposal.driveFileName,
            amount: result.approvalProposal.amount,
            vendor: result.approvalProposal.vendor,
            postPlatform: result.approvalProposal.postPlatform,
            postContent: result.approvalProposal.postContent,
          },
          status: 'pending',
          createdAt: nowIso,
          source_trigger: 'chat',
        };
        agentMemory.approvals = [
          newApprovalRecord,
          ...agentMemory.approvals,
        ].slice(0, 60);
      }

      agentMemory.updatedAt = nowIso;
    });

    res.json({
      ...result,
      approvalId: stagedApprovalId,
      kbProposals: agentMemory.kbProposals,
    });
  } catch (err) {
    console.error('Agent chat error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to chat with agent.',
    });
  }
});

// Town Hall Roundtable Meeting
app.post('/api/village/town-hall', async (req, res) => {
  try {
    const { mode, prompt, targetDirectorId, directors, recentTasksSummary, pendingApprovalsCount } = req.body as {
      mode?: string;
      prompt?: string;
      targetDirectorId?: string | null;
      directors?: AgentDossier[];
      recentTasksSummary?: string;
      pendingApprovalsCount?: number;
    };
    if (!prompt || !directors) {
      res.status(400).json({ error: 'Prompt and directors required.' });
      return;
    }

    const includeWorkingFolder = agentMemory.settings?.autoSyncWorkingFolderContext !== false;
    const workspaceBriefing = await resolveWorkspaceBriefing(req.headers.authorization, {
      includeWorkingFolder,
    });
    const knowledgeContext = buildKnowledgeGroundTruthBlock(
      agentMemory.knowledgeBase,
      undefined,
      agentMemory.notes
    );
    const result = await runTownHallRoundtable({
      mode: mode || 'general',
      prompt,
      targetDirectorId,
      directors: directors.map(mergeDossier),
      recentTasksSummary: recentTasksSummary || '',
      pendingApprovalsCount: pendingApprovalsCount ?? 0,
      workspaceBriefing,
      knowledgeContext,
    });

    res.json(result);
  } catch (err) {
    console.error('Town Hall error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to run Town Hall briefing.' });
  }
});

// One-Click Executive Morning Briefing (Written + Spoken Summary)
app.post('/api/village/morning-briefing', async (req, res) => {
  try {
    const { clientTime, recentTasks, pendingApprovals } = (req.body ?? {}) as {
      clientTime?: ClientTimeContext;
      recentTasks?: Array<{
        prompt: string;
        status: string;
        assignedDirectorName: string;
        summary: string;
      }>;
      pendingApprovals?: Array<{
        title: string;
        type: string;
        directorName: string;
        description: string;
      }>;
    };

    const includeWorkingFolder = agentMemory.settings?.autoSyncWorkingFolderContext !== false;
    const workspaceBriefing = await resolveWorkspaceBriefing(req.headers.authorization, {
      includeWorkingFolder,
    });

    const fallbackTasks = (agentMemory.tasks ?? []).slice(0, 8).map((t) => ({
      prompt: String(t.prompt ?? ''),
      status: String(t.status ?? 'completed'),
      assignedDirectorName: String(t.assignedDirectorName ?? 'Director'),
      summary: String(t.summary ?? ''),
    }));
    const fallbackApprovals = (agentMemory.approvals ?? [])
      .filter((a) => a && a.status === 'pending')
      .map((a) => ({
        title: String(a.title ?? ''),
        type: String(a.type ?? 'approval'),
        directorName: String(a.directorName ?? 'Director'),
        description: String(a.description ?? ''),
      }));

    const briefing = await generateExecutiveMorningBriefing({
      workspaceBriefing,
      calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
      clientTime,
      recentTasks: Array.isArray(recentTasks) ? recentTasks : fallbackTasks,
      pendingApprovals: Array.isArray(pendingApprovals) ? pendingApprovals : fallbackApprovals,
    });

    res.json({ ok: true, briefing, workspaceConnected: workspaceBriefing.connected });
  } catch (err) {
    console.error('Morning briefing error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to generate Morning Briefing.',
    });
  }
});

// Grounded Agent-to-Agent Plaza Sync (Strictly anchored in real CHO tasks, chats, Workspace, or KB records)
app.post('/api/village/crosstalk', async (req, res) => {
  try {
    const { agentA, agentB, location, anchors } = (req.body ?? {}) as {
      agentA?: { id: string; name: string; role: string; title: string; department: string };
      agentB?: { id: string; name: string; role: string; title: string; department: string };
      location?: string;
      anchors?: GroundedWorkAnchor[];
    };

    if (!agentA || !agentB || !Array.isArray(anchors) || anchors.length === 0) {
      res.json({ shouldSpeak: false });
      return;
    }

    const result = await generateGroundedCrossTalk({
      agentA,
      agentB,
      location: location || 'Town Square Plaza',
      anchors,
    });
    res.json(result);
  } catch (err) {
    console.error('Grounded cross-talk error:', err);
    res.json({ shouldSpeak: false });
  }
});

// Propose Hiring Candidate
app.post('/api/village/hiring/propose', async (req, res) => {
  try {
    const { director } = req.body as { director?: AgentDossier };
    if (!director) {
      res.status(400).json({ error: 'Director dossier required.' });
      return;
    }
    const proposal = await proposeHiringCandidate(mergeDossier(director));
    res.json(proposal);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to propose candidate.' });
  }
});

// Interview Candidate in Town Hall
app.post('/api/village/hiring/interview', async (req, res) => {
  try {
    const { candidateName, specialty, bio, directorName, question } = req.body as {
      candidateName?: string;
      specialty?: string;
      bio?: string;
      directorName?: string;
      question?: string;
    };
    if (!candidateName || !question) {
      res.status(400).json({ error: 'Candidate and question required.' });
      return;
    }
    const answer = await interviewCandidate({
      candidateName,
      specialty: specialty || 'Specialist',
      bio: bio || '',
      directorName: directorName || 'Director',
      question,
    });
    res.json({ answer });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to interview candidate.' });
  }
});

// ============================================================================
// Guildhaven Supervised Autonomy Engine (3-Layer Architecture: KB-SOP-01 / KB-GOV-01 / KB-RES-02)
// ============================================================================

async function persistAutonomousRunOutcome(
  ruleId: string,
  outcome: Awaited<ReturnType<typeof executeAutonomousRuleRun>>
): Promise<void> {
  await runAtomicMutation(() => {
    const nowIso = outcome.run.created_at || new Date().toISOString();

    if (outcome.run.status !== 'skipped_paused') {
      agentMemory.townAutomationRules = agentMemory.townAutomationRules.map((r) =>
        r.id === ruleId ? { ...r, last_run_at: nowIso } : r
      );
    }

    agentMemory.automationRuns = [
      outcome.run,
      ...agentMemory.automationRuns.filter((r) => r.id !== outcome.run.id),
    ].slice(0, 100);

    if (outcome.stagedApprovalItems.length > 0) {
      agentMemory.approvals = [
        ...(outcome.stagedApprovalItems as unknown as Array<Record<string, unknown>>),
        ...agentMemory.approvals,
      ].slice(0, 60);
    }

    if (outcome.stagedKbProposals.length > 0) {
      agentMemory.kbProposals = [
        ...outcome.stagedKbProposals,
        ...agentMemory.kbProposals,
      ].slice(0, 60);
    }

    if (outcome.taskRecord) {
      agentMemory.tasks = [
        outcome.taskRecord,
        ...agentMemory.tasks.filter((t) => t && t.id !== outcome.taskRecord?.id),
      ].slice(0, 45);
    }

    if (outcome.chosenDirectorId && outcome.newDirectorNote) {
      const currentNotes = agentMemory.notes[outcome.chosenDirectorId] ?? [];
      const updatedNotes = [...currentNotes, outcome.newDirectorNote].slice(-20);
      agentMemory.notes[outcome.chosenDirectorId] = updatedNotes;
      syncAgentFieldInState(outcome.chosenDirectorId, {
        notes: updatedNotes,
        currentActivity:
          outcome.run.status === 'staged_packet'
            ? `Autopilot staged CHO packet: ${outcome.run.rule_name ?? ruleId}`
            : `Completed Autopilot check: ${outcome.run.rule_name ?? ruleId}`,
      });
    }

    agentMemory.updatedAt = nowIso;
  });
}

async function runCronHeartbeatSweep(options?: {
  now?: Date;
  targetRuleId?: string;
  forceWindow?: boolean;
  simulateDelayMs?: number;
}): Promise<{
  status: 'paused' | 'ok';
  autopilot_enabled: boolean;
  executed: AutomationRun[];
  skipped_duplicates: string[];
}> {
  const now = options?.now ?? new Date();
  const settings = normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings);
  agentMemory.townAutopilotSettings = settings;

  sweepExpiredDecisionPackets({
    approvals: agentMemory.approvals,
    kbProposals: agentMemory.kbProposals,
    nowMs: now.getTime(),
  });

  if (!settings.autopilot_enabled) {
    return {
      status: 'paused',
      autopilot_enabled: false,
      executed: [],
      skipped_duplicates: [],
    };
  }

  const dueRules = agentMemory.townAutomationRules.filter((rule) => {
    if (rule.type !== 'cron' || !rule.enabled) return false;
    if (options?.targetRuleId) return rule.id === options.targetRuleId;
    if (options?.forceWindow) return true;
    return isCronRuleDueInWindow(rule, now);
  });

  const executed: AutomationRun[] = [];
  const skippedDuplicates: string[] = [];

  for (const rule of dueRules) {
    const idempotencyKey = computeCronIdempotencyKey(rule, now);
    const alreadyExecuted =
      inFlightAutomationKeys.has(idempotencyKey) ||
      agentMemory.automationRuns.some(
        (r) => r.idempotency_key === idempotencyKey && r.status !== 'skipped_paused'
      );

    if (alreadyExecuted) {
      skippedDuplicates.push(idempotencyKey);
      continue;
    }

    inFlightAutomationKeys.add(idempotencyKey);
    try {
      const fullRoster = buildFullVillageRoster(
        (agentMemory.agents ?? []) as unknown as AgentDossier[],
        mergeDossier
      );
      const authHeader = getVolatileWorkspaceAuthHeader();
      const workspaceBriefing = await resolveWorkspaceBriefing(authHeader, {
        includeWorkingFolder: agentMemory.settings?.autoSyncWorkingFolderContext !== false,
      });

      const outcome = await executeAutonomousRuleRun({
        rule,
        autopilotSettings: normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings),
        idempotencyKey,
        sourceTrigger: 'cron',
        sourceLabel: deriveCronSourceLabel(rule),
        roster: fullRoster,
        liveKnowledgeBase: agentMemory.knowledgeBase,
        houseNotes: agentMemory.notes,
        workspaceBriefing,
        workspaceAuthHeader: authHeader,
        calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
        existingRuns: agentMemory.automationRuns,
        simulateDelayMs: options?.simulateDelayMs,
      });

      await persistAutonomousRunOutcome(rule.id, outcome);
      executed.push(outcome.run);
    } finally {
      inFlightAutomationKeys.delete(idempotencyKey);
    }
  }

  return {
    status: 'ok',
    autopilot_enabled: true,
    executed,
    skipped_duplicates: skippedDuplicates,
  };
}

// 1. Scheduled Heartbeat Endpoint (POST /api/cron/heartbeat)
app.post('/api/cron/heartbeat', async (req, res) => {
  const authCheck = verifyCronAuthorizationHeader(
    req.headers.authorization,
    CHO_SESSION_TOKEN
  );
  if (!authCheck.ok) {
    res.status(401).json({ error: authCheck.error });
    return;
  }

  try {
    const body = (req.body ?? {}) as {
      ruleId?: string;
      forceWindow?: boolean;
      simulateDelayMs?: number;
      timestampIso?: string;
    };
    const evalDate =
      typeof body.timestampIso === 'string' && !Number.isNaN(Date.parse(body.timestampIso))
        ? new Date(body.timestampIso)
        : new Date();

    const result = await runCronHeartbeatSweep({
      now: evalDate,
      targetRuleId: typeof body.ruleId === 'string' ? body.ruleId.trim() : undefined,
      forceWindow: Boolean(body.forceWindow),
      simulateDelayMs:
        typeof body.simulateDelayMs === 'number' ? body.simulateDelayMs : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({
      error: scrubSensitiveTokens(
        err instanceof Error ? err.message : 'Heartbeat execution failed.'
      ),
    });
  }
});

// 2. Event-Driven Workspace Webhook Endpoint (POST /api/webhooks/workspace)
// Uses express.raw() so HMAC/OIDC verification runs on exact raw bytes BEFORE JSON.parse (KB-RES-02)
app.post(
  '/api/webhooks/workspace',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === 'string'
        ? Buffer.from(req.body, 'utf-8')
        : Buffer.alloc(0);

    const verification = await verifyWorkspaceWebhookRawRequest({
      rawBody,
      headers: req.headers as Record<string, string | string[] | undefined>,
      ephemeralFallbackSecret: CHO_SESSION_TOKEN,
    });

    if (!verification.ok) {
      res.status(verification.status).json({ error: verification.error });
      return;
    }

    let parsedPayload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody.toString('utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        res.status(400).json({ error: 'Webhook body must be a JSON object.' });
        return;
      }
      parsedPayload = parsed as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Invalid JSON in verified webhook payload.' });
      return;
    }

    const settings = normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings);
    agentMemory.townAutopilotSettings = settings;
    if (!settings.autopilot_enabled) {
      res.status(200).json({ status: 'paused', autopilot_enabled: false });
      return;
    }

    const requestedRuleId =
      typeof parsedPayload.ruleId === 'string' ? parsedPayload.ruleId.trim() : '';
    const matchingRule = agentMemory.townAutomationRules.find(
      (r) =>
        r.type === 'webhook' &&
        r.enabled &&
        (requestedRuleId ? r.id === requestedRuleId : true)
    );

    if (!matchingRule) {
      res.status(200).json({ status: 'no_enabled_webhook_rule' });
      return;
    }

    const event = parseWorkspaceWebhookPayload(parsedPayload);
    const idempotencyKey = `webhook:${matchingRule.id}:${event.eventId}`;

    if (
      inFlightAutomationKeys.has(idempotencyKey) ||
      agentMemory.automationRuns.some(
        (r) => r.idempotency_key === idempotencyKey && r.status !== 'skipped_paused'
      )
    ) {
      res.status(200).json({
        status: 'duplicate_ignored',
        idempotency_key: idempotencyKey,
      });
      return;
    }

    // Filter bulk promotional noise & unmonitored labels per KB-SOP-06
    if (
      event.providerSource === 'Gmail' &&
      matchingRule.config.ignore_unread_bulk !== false &&
      event.isBulkUnreadNoise
    ) {
      const nowIso = new Date().toISOString();
      const quietRun: AutomationRun = {
        id: `autorun_${Date.now()}_bulk`,
        rule_id: matchingRule.id,
        rule_name: matchingRule.name,
        trigger_type: 'webhook',
        idempotency_key: idempotencyKey,
        status: 'completed',
        summary: `${matchingRule.name} ignored bulk promotional/social noise (${event.eventId}).`,
        staged_packet_ids: [],
        agent_trace: ['matt'],
        duration_ms: 5,
        created_at: nowIso,
      };
      await runAtomicMutation(() => {
        agentMemory.automationRuns = [quietRun, ...agentMemory.automationRuns].slice(0, 100);
        agentMemory.updatedAt = nowIso;
      });
      res.status(200).json({ status: 'completed', run: quietRun });
      return;
    }

    if (
      event.providerSource === 'Gmail' &&
      event.gmailLabels &&
      event.gmailLabels.length > 0 &&
      (matchingRule.config.monitored_gmail_labels ?? []).length > 0
    ) {
      const monitoredLower = new Set(
        (matchingRule.config.monitored_gmail_labels ?? []).map((l) => l.toLowerCase())
      );
      const hasMonitoredMatch = event.gmailLabels.some((lbl) =>
        monitoredLower.has(lbl.toLowerCase())
      );
      if (!hasMonitoredMatch) {
        res.status(200).json({
          status: 'ignored_unmonitored_label',
          labels: event.gmailLabels,
        });
        return;
      }
    }

    inFlightAutomationKeys.add(idempotencyKey);
    try {
      const fullRoster = buildFullVillageRoster(
        (agentMemory.agents ?? []) as unknown as AgentDossier[],
        mergeDossier
      );
      const authHeader = getVolatileWorkspaceAuthHeader();
      const workspaceBriefing = await resolveWorkspaceBriefing(authHeader, {
        includeWorkingFolder: agentMemory.settings?.autoSyncWorkingFolderContext !== false,
      });

      const hydratedWebhookContext = await hydrateWebhookEventContext({
        event,
        rule: matchingRule,
        workspaceBriefing,
        workspaceAuthHeader: authHeader,
      });

      const simulateDelayMs =
        typeof parsedPayload.simulateDelayMs === 'number'
          ? parsedPayload.simulateDelayMs
          : undefined;

      const outcome = await executeAutonomousRuleRun({
        rule: matchingRule,
        autopilotSettings: normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings),
        idempotencyKey,
        sourceTrigger: 'webhook',
        sourceLabel: event.providerSource,
        roster: fullRoster,
        liveKnowledgeBase: agentMemory.knowledgeBase,
        houseNotes: agentMemory.notes,
        workspaceBriefing,
        workspaceAuthHeader: authHeader,
        calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
        existingRuns: agentMemory.automationRuns,
        hydratedWebhookContext,
        webhookEvent: event,
        simulateDelayMs,
      });

      await persistAutonomousRunOutcome(matchingRule.id, outcome);

      res.status(200).json({
        status: outcome.run.status,
        idempotency_key: idempotencyKey,
        run: outcome.run,
        staged_packet_ids: outcome.run.staged_packet_ids,
      });
    } catch (err) {
      res.status(500).json({
        error: scrubSensitiveTokens(
          err instanceof Error ? err.message : 'Failed to process Workspace webhook.'
        ),
      });
    } finally {
      inFlightAutomationKeys.delete(idempotencyKey);
    }
  }
);

// 3. Automation Rules & Kill-Switch Configuration (GET & PATCH /api/automation/rules)
app.get('/api/automation/rules', (_req, res) => {
  agentMemory.townAutopilotSettings = normalizeTownAutopilotSettings(
    agentMemory.townAutopilotSettings
  );
  agentMemory.townAutomationRules = mergeTownAutomationRules(agentMemory.townAutomationRules);
  res.json({
    autopilot_settings: agentMemory.townAutopilotSettings,
    rules: agentMemory.townAutomationRules,
  });
});

app.patch('/api/automation/rules', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const body = (req.body ?? {}) as {
    autopilot_settings?: Partial<TownAutopilotSettings>;
    autopilot_enabled?: boolean;
    rules?: Array<Partial<TownAutomationRule>>;
    rule_update?: Partial<TownAutomationRule> & { id: string };
  };

  if (body.rule_update && typeof body.rule_update.schedule_cron === 'string') {
    const cronValidation = validateCronExpression(body.rule_update.schedule_cron);
    if (!cronValidation.valid) {
      res.status(400).json({ error: cronValidation.error || 'Invalid 5-field cron schedule.' });
      return;
    }
  }
  if (Array.isArray(body.rules)) {
    for (const candidate of body.rules) {
      if (candidate && candidate.type !== 'webhook' && typeof candidate.schedule_cron === 'string') {
        const cronValidation = validateCronExpression(candidate.schedule_cron);
        if (!cronValidation.valid) {
          res.status(400).json({
            error: `Rule "${candidate.id || 'cron'}": ${cronValidation.error || 'Invalid cron schedule.'}`,
          });
          return;
        }
      }
    }
  }

  const result = await runAtomicMutation(() => {
    const nowIso = new Date().toISOString();
    const currentSettings = normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings);
    const nextSettingsPatch: Partial<TownAutopilotSettings> = {
      ...currentSettings,
      ...(body.autopilot_settings ?? {}),
      ...(typeof body.autopilot_enabled === 'boolean'
        ? { autopilot_enabled: body.autopilot_enabled }
        : {}),
    };
    agentMemory.townAutopilotSettings = normalizeTownAutopilotSettings(nextSettingsPatch);

    let nextRules = mergeTownAutomationRules(agentMemory.townAutomationRules);
    if (Array.isArray(body.rules)) {
      const patchById = new Map<string, Partial<TownAutomationRule>>();
      for (const item of body.rules) {
        if (item && typeof item.id === 'string' && item.id.trim()) {
          patchById.set(item.id.trim(), item);
        }
      }
      nextRules = nextRules.map((existing) => {
        const patch = patchById.get(existing.id);
        if (!patch) return existing;
        return normalizeTownAutomationRule(
          {
            ...existing,
            ...patch,
            config: { ...existing.config, ...(patch.config ?? {}) },
            updated_at: nowIso,
          },
          existing
        );
      });
    }

    if (body.rule_update && typeof body.rule_update.id === 'string') {
      const targetId = body.rule_update.id.trim();
      const found = nextRules.find((r) => r.id === targetId);
      if (found) {
        nextRules = nextRules.map((r) =>
          r.id === targetId
            ? normalizeTownAutomationRule(
                {
                  ...r,
                  ...body.rule_update,
                  config: { ...r.config, ...(body.rule_update?.config ?? {}) },
                  updated_at: nowIso,
                },
                r
              )
            : r
        );
      } else {
        nextRules = [
          ...nextRules,
          normalizeTownAutomationRule({ ...body.rule_update, updated_at: nowIso }),
        ];
      }
    }

    agentMemory.townAutomationRules = nextRules;
    agentMemory.updatedAt = nowIso;
    return {
      autopilot_settings: agentMemory.townAutopilotSettings,
      rules: agentMemory.townAutomationRules,
    };
  });

  res.json({ ok: true, ...result });
});

// 4. Town Digest Feed & TTL Expiry Sweeper (GET /api/automation/runs)
app.get('/api/automation/runs', (_req, res) => {
  const swept = sweepExpiredDecisionPackets({
    approvals: agentMemory.approvals,
    kbProposals: agentMemory.kbProposals,
  });
  if (swept.mutated) {
    agentMemory.updatedAt = new Date().toISOString();
    saveMemory(agentMemory);
  }
  res.json({
    runs: agentMemory.automationRuns,
    autopilot_settings: normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings),
    rules: mergeTownAutomationRules(agentMemory.townAutomationRules),
    expired_swept: swept.expiredApprovalsCount + swept.expiredKbCount,
    approvals: agentMemory.approvals,
    kbProposals: agentMemory.kbProposals,
  });
});

// 5. CHO Manual "Run Now" Rule Test Endpoint (POST /api/automation/rules/:id/run)
app.post('/api/automation/rules/:id/run', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const ruleId = String(req.params.id || '').trim();
  const rule = agentMemory.townAutomationRules.find((r) => r.id === ruleId);
  if (!rule) {
    res.status(404).json({ error: `Automation rule "${ruleId}" not found.` });
    return;
  }

  const settings = normalizeTownAutopilotSettings(agentMemory.townAutopilotSettings);
  const body = (req.body ?? {}) as {
    idempotencyKey?: string;
    simulateDelayMs?: number;
  };
  const idempotencyKey =
    typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
      ? body.idempotencyKey.trim()
      : `manual:${rule.id}:${Math.floor(Date.now() / 3000)}`;

  if (
    inFlightAutomationKeys.has(idempotencyKey) ||
    agentMemory.automationRuns.some(
      (r) => r.idempotency_key === idempotencyKey && r.status !== 'skipped_paused'
    )
  ) {
    res.status(200).json({
      ok: true,
      status: 'duplicate_ignored',
      idempotency_key: idempotencyKey,
      runs: agentMemory.automationRuns,
    });
    return;
  }

  if (req.headers.authorization?.startsWith('Bearer ')) {
    rememberVolatileWorkspaceAuthHeader(req.headers.authorization);
  }

  inFlightAutomationKeys.add(idempotencyKey);
  try {
    const fullRoster = buildFullVillageRoster(
      (agentMemory.agents ?? []) as unknown as AgentDossier[],
      mergeDossier
    );
    const authHeader = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization
      : getVolatileWorkspaceAuthHeader();
    const workspaceBriefing = await resolveWorkspaceBriefing(authHeader, {
      includeWorkingFolder: agentMemory.settings?.autoSyncWorkingFolderContext !== false,
    });

    const outcome = await executeAutonomousRuleRun({
      rule,
      autopilotSettings: settings,
      idempotencyKey,
      sourceTrigger: rule.type === 'webhook' ? 'webhook' : 'cron',
      sourceLabel: rule.type === 'webhook' ? 'Gmail' : deriveCronSourceLabel(rule),
      roster: fullRoster,
      liveKnowledgeBase: agentMemory.knowledgeBase,
      houseNotes: agentMemory.notes,
      workspaceBriefing,
      workspaceAuthHeader: authHeader,
      calendarWriteAccess: Boolean(agentMemory.settings?.calendarWriteAccess),
      existingRuns: agentMemory.automationRuns,
      simulateDelayMs:
        typeof body.simulateDelayMs === 'number' ? body.simulateDelayMs : undefined,
      bypassKillSwitch: true,
    });

    await persistAutonomousRunOutcome(rule.id, outcome);

    res.json({
      ok: true,
      status: outcome.run.status,
      run: outcome.run,
      stagedApprovalItems: outcome.stagedApprovalItems,
      stagedKbProposals: outcome.stagedKbProposals,
      runs: agentMemory.automationRuns,
      rules: agentMemory.townAutomationRules,
      approvals: agentMemory.approvals as unknown as ApprovalItem[],
      kbProposals: agentMemory.kbProposals,
      tasks: agentMemory.tasks,
    });
  } catch (err) {
    res.status(500).json({
      error: scrubSensitiveTokens(
        err instanceof Error ? err.message : 'Failed to execute automation rule.'
      ),
    });
  } finally {
    inFlightAutomationKeys.delete(idempotencyKey);
  }
});

// 6. Dismiss Expired / Clear Resolved CHO Decision Packets (POST /api/automation/packets/dismiss-expired)
app.post('/api/automation/packets/dismiss-expired', async (req, res) => {
  const choAuth = verifyChoRequestAuth(req);
  if (!choAuth.authorized) {
    res.status(403).json({ error: choAuth.error });
    return;
  }

  const mode =
    (req.body as { mode?: string } | undefined)?.mode === 'clear_all_resolved'
      ? 'clear_all_resolved'
      : 'expired_only';

  const result = await runAtomicMutation(() => {
    sweepExpiredDecisionPackets({
      approvals: agentMemory.approvals,
      kbProposals: agentMemory.kbProposals,
    });

    const newlyDismissed: string[] = [];
    const shouldDropStatus = (status: unknown): boolean => {
      if (status === 'expired') return true;
      if (
        mode === 'clear_all_resolved' &&
        (status === 'approved' || status === 'rejected' || status === 'revision_requested')
      ) {
        return true;
      }
      return false;
    };

    agentMemory.approvals = agentMemory.approvals.filter((a) => {
      if (!a || typeof a.id !== 'string') return false;
      if (shouldDropStatus(a.status)) {
        newlyDismissed.push(a.id);
        return false;
      }
      return true;
    });

    agentMemory.kbProposals = agentMemory.kbProposals.filter((p) => {
      if (!p) return false;
      if (shouldDropStatus(p.status)) {
        newlyDismissed.push(p.proposal_id);
        return false;
      }
      return true;
    });

    if (newlyDismissed.length > 0) {
      const mergedDismissed = new Set([
        ...(agentMemory.dismissedPacketIds ?? []),
        ...newlyDismissed,
      ]);
      agentMemory.dismissedPacketIds = Array.from(mergedDismissed).slice(-300);
      agentMemory.updatedAt = new Date().toISOString();
    }

    return {
      dismissedCount: newlyDismissed.length,
      approvals: agentMemory.approvals,
      kbProposals: agentMemory.kbProposals,
    };
  });

  res.json({ ok: true, ...result });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  // Real-time Gemini Live API (gemini-3.8-live) WebSocket bridge on /ws/live-voice
  const liveWss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname === '/ws/live-voice') {
        liveWss.handleUpgrade(request, socket, head, (ws) => {
          liveWss.emit('connection', ws, request);
        });
      }
    } catch {
      socket.destroy();
    }
  });

  liveWss.on('connection', (clientWs: WebSocket) => {
    let sessionPromise: ReturnType<ReturnType<typeof getAiClient>['live']['connect']> | null = null;
    let closed = false;

    const sendJson = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (rawData) => {
      if (closed) return;
      let parsed: {
        type?: string;
        agent?: AgentDossier;
        bearerToken?: string;
        audio?: string;
        text?: string;
      };
      try {
        parsed = JSON.parse(rawData.toString());
      } catch {
        return;
      }

      if (parsed.type === 'init' && !sessionPromise) {
        const rawAgent: AgentDossier = parsed.agent ?? {
          id: 'matt',
          name: 'Matt',
          role: 'chief_of_staff',
          title: 'Chief of Staff',
          department: 'Town Hall Dispatch',
          buildingId: 'town_hall',
          modelName: 'gemini-3.8-live',
          instructions: 'You are Matt, Chief of Staff of Guildhaven.',
          notes: [],
        };
        const mergedAgent = mergeDossier(rawAgent);
        const profile = resolveAgentVoiceProfile({
          id: mergedAgent.id,
          name: mergedAgent.name,
          title: mergedAgent.title,
          department: mergedAgent.department,
          voiceName: mergedAgent.voiceName,
        });

        try {
          const workspaceBriefing = await resolveWorkspaceBriefing(
            parsed.bearerToken ? `Bearer ${parsed.bearerToken}` : undefined
          );
          const knowledgeContext = buildKnowledgeGroundTruthBlock(
            agentMemory.knowledgeBase,
            mergedAgent.department,
            agentMemory.notes
          );
          const recentTasksSummary = agentMemory.tasks
            .slice(0, 6)
            .map(
              (t) =>
                `- ${String(t.assignedDirectorName ?? 'Director')}: "${String(t.prompt ?? '')}" -> ${String(t.summary ?? '')}`
            )
            .join('\n');

          const systemInstruction = buildLiveVoiceSystemInstruction({
            agent: mergedAgent,
            stylePrompt: profile.stylePrompt,
            workspaceBriefing,
            knowledgeContext,
            recentTasksSummary,
          });

          const ai = getAiClient();
          sessionPromise = ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: profile.voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction,
            },
            callbacks: {
              onopen: () => {
                sendJson({
                  type: 'ready',
                  voiceName: profile.voiceName,
                  timbreLabel: profile.timbreLabel,
                });
              },
              onmessage: (message: LiveServerMessage) => {
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  sendJson({
                    type: 'inputTranscript',
                    text: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  sendJson({
                    type: 'outputTranscript',
                    text: content.outputTranscription.text,
                  });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    sendJson({
                      type: 'audio',
                      audio: part.inlineData.data,
                    });
                  }
                }
                if (content?.interrupted) {
                  sendJson({ type: 'interrupted' });
                }
                if (content?.turnComplete) {
                  sendJson({ type: 'turnComplete' });
                }
              },
              onerror: (err: unknown) => {
                const msg =
                  err instanceof Error
                    ? err.message
                    : typeof err === 'object' && err && 'message' in err
                      ? String((err as { message?: unknown }).message)
                      : 'Live voice session encountered an error.';
                sendJson({ type: 'error', error: msg });
              },
              onclose: () => {
                if (!closed) {
                  sendJson({ type: 'closed' });
                }
              },
            },
          });

          await sessionPromise;
        } catch (err) {
          console.error('Gemini Live connect error:', err);
          sendJson({
            type: 'error',
            error:
              err instanceof Error
                ? err.message
                : 'Unable to open live voice session.',
          });
        }
        return;
      }

      if (!sessionPromise) return;

      if (parsed.type === 'audio' && typeof parsed.audio === 'string') {
        sessionPromise
          .then((session) => {
            if (!closed) {
              session.sendRealtimeInput({
                audio: { data: parsed.audio!, mimeType: 'audio/pcm;rate=16000' },
              });
            }
          })
          .catch(() => {});
      } else if (parsed.type === 'text' && typeof parsed.text === 'string' && parsed.text.trim()) {
        sessionPromise
          .then((session) => {
            if (!closed) {
              session.sendRealtimeInput({
                text: parsed.text!.trim(),
              });
            }
          })
          .catch(() => {});
      }
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (sessionPromise) {
        sessionPromise
          .then((session) => {
            try {
              session.close();
            } catch {
              // Ignore close errors
            }
          })
          .catch(() => {});
        sessionPromise = null;
      }
    };

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);
  });

  let getViteServer: (() => Promise<import('vite').ViteDevServer>) | null = null;

  if (!isProd) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    let vitePromise: Promise<import('vite').ViteDevServer> | null = null;

    getViteServer = () => {
      if (!vitePromise) {
        vitePromise = (async () => {
          const { createServer: createViteServer } = await import('vite');
          return createViteServer({
            server: {
              middlewareMode: true,
              hmr: disableHmr ? false : { server: httpServer },
              ...(disableHmr ? { ws: false, watch: null } : {}),
            },
            appType: 'spa',
          });
        })();
        vitePromise.catch((err) => {
          console.error('Vite middleware initialization failed:', err);
        });
      }
      return vitePromise;
    };

    app.use(async (req, res, next) => {
      try {
        const vite = await getViteServer!();
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.on('error', (err) => {
    console.error('HTTP server error:', err);
    process.exit(1);
  });

  httpServer.listen(PORT, HOST, () => {
    console.log(`Guildhaven server listening on http://${HOST}:${PORT}`);
    if (getViteServer) {
      setImmediate(() => {
        void getViteServer!();
      });
    }

    // Supervised Autonomy 60-second background tick: sweeps TTL-expired packets & runs due cron heartbeats
    const autopilotInterval = setInterval(() => {
      void runCronHeartbeatSweep().catch((err) => {
        console.error(
          'Autopilot background sweep error:',
          scrubSensitiveTokens(err instanceof Error ? err.message : String(err))
        );
      });
    }, 60_000);
    autopilotInterval.unref?.();
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
