import { createInitialAgents } from '../data/initialAgents.ts';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../data/villageWorld.ts';
import type {
  Agent,
  ApprovalItem,
  GmailLabelConfig,
  PersistedVillageState,
  VillageActivityEvent,
  VillageSettings,
  VillageTask,
} from '../types/village.ts';
import { isValidAgentVoice, resolveAgentVoiceProfile } from './agentVoices.ts';
import {
  deriveAgentGroundedActivity,
  isLegacyFictionalActivity,
  isLegacyFictionalNote,
  isLegacyRandomActivityEvent,
} from './villageActivity.ts';

export const VILLAGE_STORAGE_KEY = 'gemini_village_state_v1';

export const DEFAULT_VILLAGE_SETTINGS: VillageSettings = {
  driveWorkingFolder: null,
  driveWorkingFolderWriteMode: 'direct_in_folder',
  autoSyncWorkingFolderContext: true,
  calendarWriteAccess: false,
  gmailIncludeInbox: true,
  gmailSelectedLabels: [],
  hasDismissedQuickGuide: false,
  workspaceViewMode: 'map',
};

export function normalizeVillageSettings(raw?: Partial<VillageSettings> | null): VillageSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_VILLAGE_SETTINGS, gmailSelectedLabels: [] };
  }
  const folder =
    raw.driveWorkingFolder &&
    typeof raw.driveWorkingFolder.id === 'string' &&
    raw.driveWorkingFolder.id.trim().length > 0
      ? {
          id: raw.driveWorkingFolder.id.trim(),
          name:
            typeof raw.driveWorkingFolder.name === 'string' && raw.driveWorkingFolder.name.trim()
              ? raw.driveWorkingFolder.name.trim()
              : 'Working Folder',
          webViewLink:
            typeof raw.driveWorkingFolder.webViewLink === 'string' &&
            raw.driveWorkingFolder.webViewLink.trim()
              ? raw.driveWorkingFolder.webViewLink.trim()
              : `https://drive.google.com/drive/folders/${raw.driveWorkingFolder.id.trim()}`,
          configuredAt:
            typeof raw.driveWorkingFolder.configuredAt === 'string'
              ? raw.driveWorkingFolder.configuredAt
              : new Date().toISOString(),
        }
      : null;

  const seenLabelIds = new Set<string>();
  const gmailSelectedLabels: GmailLabelConfig[] = [];
  if (Array.isArray(raw.gmailSelectedLabels)) {
    for (const item of raw.gmailSelectedLabels) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id || id.toUpperCase() === 'INBOX' || seenLabelIds.has(id)) continue;
      seenLabelIds.add(id);
      const name =
        typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
      const type: 'system' | 'user' | undefined =
        item.type === 'system' || item.type === 'user' ? item.type : undefined;
      gmailSelectedLabels.push({ id, name, ...(type ? { type } : {}) });
    }
  }

  return {
    driveWorkingFolder: folder,
    driveWorkingFolderWriteMode:
      raw.driveWorkingFolderWriteMode === 'confirm_each_write'
        ? 'confirm_each_write'
        : 'direct_in_folder',
    autoSyncWorkingFolderContext:
      typeof raw.autoSyncWorkingFolderContext === 'boolean'
        ? raw.autoSyncWorkingFolderContext
        : true,
    calendarWriteAccess: Boolean(raw.calendarWriteAccess),
    gmailIncludeInbox:
      typeof raw.gmailIncludeInbox === 'boolean' ? raw.gmailIncludeInbox : true,
    gmailSelectedLabels: gmailSelectedLabels.slice(0, 20),
    hasDismissedQuickGuide: Boolean(raw.hasDismissedQuickGuide),
    workspaceViewMode: raw.workspaceViewMode === 'desk' ? 'desk' : 'map',
  };
}

export function sanitizeActivityFeed(
  feed?: VillageActivityEvent[] | null
): VillageActivityEvent[] {
  if (!Array.isArray(feed)) return [];
  return feed.filter((ev) => ev && !isLegacyRandomActivityEvent(ev));
}

export function rebrandLegacyText(text: string): string {
  return text.replace(/Gemini AI Village/gi, 'Guildhaven');
}

export function sanitizeAgentNotes(notes?: string[] | null): string[] {
  if (!Array.isArray(notes)) return [];
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of notes) {
    if (typeof raw !== 'string') continue;
    const trimmed = rebrandLegacyText(raw.trim());
    if (!trimmed || isLegacyFictionalNote(trimmed)) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(trimmed);
    }
  }
  return cleaned.slice(-20);
}

export function readLocalVillageState(): PersistedVillageState | null {
  try {
    const raw = localStorage.getItem(VILLAGE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedVillageState;
    if (!parsed || typeof parsed !== 'object') return null;
    if (Array.isArray(parsed.activityFeed)) {
      parsed.activityFeed = sanitizeActivityFeed(parsed.activityFeed);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalVillageState(state: PersistedVillageState): void {
  try {
    localStorage.setItem(VILLAGE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

const LEGACY_PRE_KB_PREFIXES = [
  'you are aria, director of research & intel. you conduct deep multi-source research',
  'you are devon, director of operations. you convert high-level goals into structured sops',
  'you are zoe, field scout & cartographer reporting to aria at research & intel. you gather verified facts',
  'you are eli, master wright & checklist quartermaster reporting to devon at operations house. you forge step-by-step runbooks',
];

function isLegacyVestInstruction(text?: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (lower.includes('yellow vest') || lower.includes('yellow safety vest')) {
    return true;
  }
  return LEGACY_PRE_KB_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function mergePersistedAgents(
  savedAgents?: Agent[],
  instructions?: Record<string, string>,
  notes?: Record<string, string[]>,
  tasks: VillageTask[] = [],
  approvals: ApprovalItem[] = []
): Agent[] {
  const defaults = createInitialAgents();
  const savedMap = new Map<string, Agent>();
  for (const sa of savedAgents ?? []) {
    if (sa && typeof sa.id === 'string') {
      savedMap.set(sa.id, sa);
    }
  }

  const sanitizeCoord = (val: unknown, fallback: number, max: number) =>
    typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= max ? val : fallback;

  const mergedDefaults = defaults.map((def) => {
    const saved = savedMap.get(def.id);
    const candidateInstructions = instructions?.[def.id] ?? saved?.instructions;
    const mergedInstructions = rebrandLegacyText(
      candidateInstructions && !isLegacyVestInstruction(candidateInstructions)
        ? candidateInstructions
        : def.instructions
    );
    const rawNotes =
      Array.isArray(notes?.[def.id]) && notes![def.id].length > 0
        ? notes![def.id]
        : Array.isArray(saved?.notes)
          ? saved!.notes
          : def.notes;
    const mergedNotes =
      def.id === 'cho' || def.id === 'matt'
        ? rawNotes
            .filter((n) => typeof n === 'string' && !isLegacyFictionalNote(n))
            .map((n) => rebrandLegacyText(n))
        : sanitizeAgentNotes(rawNotes);

    const groundedFallbackActivity = deriveAgentGroundedActivity(def, tasks, approvals);

    if (!saved) {
      return {
        ...def,
        instructions: mergedInstructions,
        notes: mergedNotes,
        currentActivity: groundedFallbackActivity,
      };
    }

    const cleanState =
      saved.state === 'chatting'
        ? def.role === 'worker'
          ? 'walking'
          : def.id === 'matt'
            ? 'following_cho'
            : 'idle_yard'
        : saved.state ?? def.state;

    const cleanActivity = rebrandLegacyText(
      saved.currentActivity && !isLegacyFictionalActivity(saved.currentActivity)
        ? saved.currentActivity
        : groundedFallbackActivity
    );

    return {
      ...def,
      ...saved,
      // Canonical village appearance, role & guild identity always stay synced with current art design
      name: def.name,
      role: def.role,
      title: def.title,
      department: def.department,
      buildingId: def.buildingId,
      voiceName: isValidAgentVoice(saved.voiceName) ? saved.voiceName : def.voiceName,
      shirtColor: def.shirtColor,
      pantsColor: def.pantsColor,
      hairColor: def.hairColor,
      skinColor: def.skinColor,
      hasYellowVest: def.hasYellowVest,
      hasGlasses: def.hasGlasses,
      x: sanitizeCoord(saved.x, def.x, WORLD_WIDTH),
      y: sanitizeCoord(saved.y, def.y, WORLD_HEIGHT),
      direction: saved.direction ?? def.direction,
      walkFrame: typeof saved.walkFrame === 'number' ? saved.walkFrame : 0,
      isMoving: false,
      state: cleanState,
      speechBubble: null,
      speechTimer: 0,
      path: Array.isArray(saved.path) ? saved.path : [],
      talkedTodayWith: Array.isArray(saved.talkedTodayWith) ? saved.talkedTodayWith : [],
      activeTaskId: saved.activeTaskId ?? null,
      patrolTimer: typeof saved.patrolTimer === 'number' ? saved.patrolTimer : def.patrolTimer,
      currentActivity: cleanActivity,
      busyUntil: saved.state === 'chatting' ? null : saved.busyUntil ?? null,
      instructions: mergedInstructions,
      notes: mergedNotes,
    };
  });

  // Rehydrate any custom guild specialists hired by the CHO in Town Hall
  const defaultIds = new Set(defaults.map((d) => d.id));
  const extraHires = (savedAgents ?? [])
    .filter((sa) => sa && typeof sa.id === 'string' && !defaultIds.has(sa.id))
    .map((sa) => {
      const rawInstr = instructions?.[sa.id] ?? sa.instructions ?? '';
      const cleanInstr = rebrandLegacyText(rawInstr.replace(/yellow-vest worker/gi, 'guild specialist'));
      const fallbackAct = deriveAgentGroundedActivity(sa, tasks, approvals);
      const cleanAct = rebrandLegacyText(
        sa.currentActivity && !isLegacyFictionalActivity(sa.currentActivity)
          ? sa.currentActivity
          : fallbackAct
      );
      const cleanName = sa.name.replace(' (Worker)', '');
      return {
        ...sa,
        name: cleanName,
        voiceName: isValidAgentVoice(sa.voiceName)
          ? sa.voiceName
          : resolveAgentVoiceProfile({ ...sa, name: cleanName }).voiceName,
        hasYellowVest: false,
        isMoving: false,
        state: sa.state === 'chatting' ? 'walking' : sa.state ?? 'walking',
        speechBubble: null,
        speechTimer: 0,
        path: Array.isArray(sa.path) ? sa.path : [],
        talkedTodayWith: Array.isArray(sa.talkedTodayWith) ? sa.talkedTodayWith : [],
        notes: sanitizeAgentNotes(notes?.[sa.id] ?? sa.notes ?? []),
        instructions: cleanInstr,
        currentActivity: cleanAct,
      };
    });

  return [...mergedDefaults, ...extraHires];
}

export function hasMeaningfulState(s?: Partial<PersistedVillageState> | null): boolean {
  if (!s) return false;
  return Boolean(
    (s.agents && s.agents.length > 0) ||
      (s.tasks && s.tasks.length > 0) ||
      (s.approvals && s.approvals.length > 0) ||
      (s.chatHistory && Object.keys(s.chatHistory).length > 0) ||
      Boolean(s.settings?.driveWorkingFolder?.id) ||
      (s.settings?.gmailSelectedLabels && s.settings.gmailSelectedLabels.length > 0) ||
      s.settings?.gmailIncludeInbox === false ||
      s.activeScreen === 'PLAYING'
  );
}
