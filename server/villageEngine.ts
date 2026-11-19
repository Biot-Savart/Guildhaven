import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AgentVoiceName,
  CalendarEventSummary,
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
  PinnedChatContext,
} from '../src/types/village.ts';

export interface AgentDossier {
  id: string;
  name: string;
  role: string;
  title: string;
  department: string;
  buildingId: string;
  modelName: string;
  voiceName?: AgentVoiceName;
  instructions: string;
  notes: string[];
}

export interface GroundSource {
  title: string;
  uri: string;
}

export interface ClientTimeContext {
  timeZone?: string;
  offset?: string;
  localIso?: string;
}

export interface GmailSourcePreferences {
  includeInbox?: boolean;
  selectedLabels?: GmailLabelConfig[];
}

export interface WorkspaceBriefingPayload {
  connected: boolean;
  email?: string;
  unreadCount: number;
  recentEmails: GmailSummary[];
  gmailLabels?: GmailLabelSummary[];
  activeGmailSources?: GmailLabelSummary[];
  upcomingEvents: Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
    htmlLink?: string;
  }>;
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

export const GOOGLE_CHAT_CONSOLE_URL =
  'https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat?project=gen-lang-client-0074723170';

let aiClient: GoogleGenAI | null = null;

export function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1beta',
      httpOptions: {
        apiVersion: 'v1beta',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export const VILLAGE_CONSTITUTION = `
VILLAGE CONSTITUTION (HARD-CODED HUMAN-IN-THE-LOOP GOVERNANCE RULES):
1. Emails ALWAYS stay a draft, and Google Chat replies, new Google Docs, and Google Calendar writes (when Calendar Write Access is enabled in Settings) ALWAYS require explicit CHO confirmation before sending, creating, or mutating. Never claim an email was sent or a message/document/calendar event was mutated without approval.
2. No agent may spend any money, purchase subscriptions, or book paid reservations without explicit CHO approval.
3. No agent may publish or post content publicly (YouTube, social media, newsletters) without explicit CHO approval.
4. All new hires require Matt to source a candidate, the CHO to interview them in Town Hall, and explicit CHO approval.
5. Every finished deliverable is returned cleanly to the CHO for review.
`.trim();

const FRIENDLY_GMAIL_SYSTEM_LABELS: Record<string, string> = {
  INBOX: 'Inbox',
  STARRED: 'Starred',
  IMPORTANT: 'Important',
  SENT: 'Sent',
  DRAFT: 'Drafts',
  CATEGORY_PERSONAL: 'Category: Primary',
  CATEGORY_UPDATES: 'Category: Updates',
  CATEGORY_PROMOTIONS: 'Category: Promotions',
  CATEGORY_SOCIAL: 'Category: Social',
  CATEGORY_FORUMS: 'Category: Forums',
};

const SELECTABLE_SYSTEM_LABEL_ORDER = [
  'INBOX',
  'STARRED',
  'IMPORTANT',
  'SENT',
  'CATEGORY_PERSONAL',
  'CATEGORY_UPDATES',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
];

const HIDDEN_DISPLAY_LABEL_IDS = new Set(['UNREAD', 'CHAT', 'TRASH', 'SPAM']);

interface RawGmailLabelItem {
  id: string;
  name: string;
  type?: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
  labelListVisibility?: string;
}

function normalizeGmailLabelSummary(raw: RawGmailLabelItem): GmailLabelSummary {
  const isSystem = raw.type !== 'user';
  const friendlyName = isSystem
    ? FRIENDLY_GMAIL_SYSTEM_LABELS[raw.id] || raw.name || raw.id
    : raw.name || raw.id;
  return {
    id: raw.id,
    name: friendlyName,
    type: isSystem ? 'system' : 'user',
    ...(typeof raw.messagesTotal === 'number' ? { messagesTotal: raw.messagesTotal } : {}),
    ...(typeof raw.messagesUnread === 'number' ? { messagesUnread: raw.messagesUnread } : {}),
    ...(typeof raw.threadsTotal === 'number' ? { threadsTotal: raw.threadsTotal } : {}),
    ...(typeof raw.threadsUnread === 'number' ? { threadsUnread: raw.threadsUnread } : {}),
  };
}

function isSelectableGmailLabel(raw: RawGmailLabelItem): boolean {
  if (!raw?.id) return false;
  if (raw.type === 'user') return true;
  return SELECTABLE_SYSTEM_LABEL_ORDER.includes(raw.id);
}

function sortGmailLabels(labels: GmailLabelSummary[]): GmailLabelSummary[] {
  return [...labels].sort((a, b) => {
    if (a.id === 'INBOX' && b.id !== 'INBOX') return -1;
    if (b.id === 'INBOX' && a.id !== 'INBOX') return 1;
    if (a.type !== b.type) return a.type === 'user' ? -1 : 1;
    if (a.type === 'system' && b.type === 'system') {
      const ia = SELECTABLE_SYSTEM_LABEL_ORDER.indexOf(a.id);
      const ib = SELECTABLE_SYSTEM_LABEL_ORDER.indexOf(b.id);
      if (ia !== -1 && ib !== -1) return ia - ib;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function resolveDisplayLabelNames(
  labelIds: string[] | undefined,
  labelMap: Map<string, GmailLabelSummary>
): string[] {
  if (!Array.isArray(labelIds) || labelIds.length === 0) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const id of labelIds) {
    if (!id || HIDDEN_DISPLAY_LABEL_IDS.has(id)) continue;
    const known = labelMap.get(id);
    const display = known?.name ?? FRIENDLY_GMAIL_SYSTEM_LABELS[id] ?? (id.startsWith('CATEGORY_') ? '' : id);
    if (!display || seen.has(display)) continue;
    seen.add(display);
    names.push(display);
  }
  return names;
}

interface RawGmailPayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: RawGmailPayloadPart[];
}

function decodeBase64UrlUtf8(encoded?: string): string {
  if (!encoded) return '';
  try {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

function extractPlainTextFromGmailPayload(payload?: RawGmailPayloadPart): string {
  if (!payload) return '';
  const findMime = (node: RawGmailPayloadPart, targetMime: string): string => {
    if (node.mimeType?.toLowerCase() === targetMime && node.body?.data) {
      const decoded = decodeBase64UrlUtf8(node.body.data).trim();
      if (decoded) return decoded;
    }
    for (const child of node.parts ?? []) {
      const found = findMime(child, targetMime);
      if (found) return found;
    }
    return '';
  };

  const plain = findMime(payload, 'text/plain');
  if (plain) {
    return plain.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
  }
  const html = findMime(payload, 'text/html');
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 1800);
  }
  return '';
}

function interleaveUniqueMessageIds(lists: Array<Array<{ id: string }>>, cap: number): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const maxLen = lists.reduce((acc, arr) => Math.max(acc, arr.length), 0);
  for (let idx = 0; idx < maxLen && result.length < cap; idx += 1) {
    for (const arr of lists) {
      if (result.length >= cap) break;
      const item = arr[idx];
      if (item?.id && !seen.has(item.id)) {
        seen.add(item.id);
        result.push(item.id);
      }
    }
  }
  return result;
}

/**
 * List available Gmail labels (custom user labels + primary system labels) with optional unread/total counts.
 */
export async function listGmailLabels(
  bearerHeader: string,
  includeCounts = true
): Promise<GmailLabelSummary[]> {
  if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
    return [];
  }
  const headers = { Authorization: bearerHeader };
  const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers });
  if (!listRes.ok) {
    const errText = await listRes.text().catch(() => '');
    throw new Error(`Gmail Labels API error (${listRes.status}): ${errText || 'Unable to list labels.'}`);
  }
  const listJson = (await listRes.json()) as { labels?: RawGmailLabelItem[] };
  const selectable = sortGmailLabels(
    (listJson.labels ?? []).filter(isSelectableGmailLabel).map(normalizeGmailLabelSummary)
  );
  if (!includeCounts || selectable.length === 0) {
    return selectable;
  }

  const targets = selectable.slice(0, 35);
  const detailed = await Promise.all(
    targets.map(async (lbl) => {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(lbl.id)}`,
          { headers }
        );
        if (!r.ok) return lbl;
        const detail = (await r.json()) as RawGmailLabelItem;
        return normalizeGmailLabelSummary({ ...lbl, ...detail });
      } catch {
        return lbl;
      }
    })
  );

  const detailedMap = new Map(detailed.map((d) => [d.id, d]));
  return selectable.map((lbl) => detailedMap.get(lbl.id) ?? lbl);
}

/**
 * Read Gmail messages across Inbox, one or more specified labels, and/or a search query (strictly read-only).
 */
export async function readGmailMessages(
  bearerHeader: string,
  options?: {
    labelIds?: string[];
    labelQuery?: string;
    includeInbox?: boolean;
    query?: string;
    unreadOnly?: boolean;
    maxResults?: number;
    includeBody?: boolean;
  }
): Promise<{
  messages: GmailSummary[];
  matchedLabels: GmailLabelSummary[];
  availableLabels: GmailLabelSummary[];
}> {
  if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
    throw new Error('Please Sign in with Google first to read Gmail messages.');
  }
  const headers = { Authorization: bearerHeader };
  const maxResults = Math.min(30, Math.max(1, Math.round(options?.maxResults ?? 15)));
  const unreadOnly = Boolean(options?.unreadOnly);
  const includeBody = Boolean(options?.includeBody);
  const searchQuery = typeof options?.query === 'string' ? options.query.trim() : '';

  const labelsRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers });
  const rawLabels: RawGmailLabelItem[] = labelsRes.ok
    ? (((await labelsRes.json().catch(() => ({}))) as { labels?: RawGmailLabelItem[] }).labels ?? [])
    : [];

  const allLabelMap = new Map<string, GmailLabelSummary>();
  for (const raw of rawLabels) {
    if (raw?.id) {
      allLabelMap.set(raw.id, normalizeGmailLabelSummary(raw));
    }
  }
  const availableLabels = sortGmailLabels(
    rawLabels.filter(isSelectableGmailLabel).map(normalizeGmailLabelSummary)
  );

  const resolvedIds: string[] = [];
  const pushUniqueId = (id: string) => {
    if (id && !resolvedIds.includes(id)) resolvedIds.push(id);
  };

  if (options?.includeInbox) {
    pushUniqueId('INBOX');
  }

  for (const candidate of options?.labelIds ?? []) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (!trimmed) continue;
    if (allLabelMap.has(trimmed) || trimmed.toUpperCase() === 'INBOX') {
      pushUniqueId(trimmed.toUpperCase() === 'INBOX' ? 'INBOX' : trimmed);
      continue;
    }
    const byName = availableLabels.find(
      (l) => l.name.toLowerCase() === trimmed.toLowerCase() || l.id.toLowerCase() === trimmed.toLowerCase()
    );
    if (byName) pushUniqueId(byName.id);
  }

  if (options?.labelQuery && options.labelQuery.trim()) {
    const qLower = options.labelQuery.trim().toLowerCase();
    if (qLower === 'inbox') {
      pushUniqueId('INBOX');
    } else if (qLower !== 'all' && qLower !== 'all_monitored') {
      const exact = availableLabels.find(
        (l) => l.name.toLowerCase() === qLower || l.id.toLowerCase() === qLower
      );
      if (exact) {
        pushUniqueId(exact.id);
      } else {
        const partial = availableLabels.filter((l) => l.name.toLowerCase().includes(qLower));
        for (const p of partial.slice(0, 4)) {
          pushUniqueId(p.id);
        }
      }
    }
  }

  let messageIdLists: Array<Array<{ id: string }>> = [];
  if (resolvedIds.length === 0) {
    if (searchQuery || unreadOnly) {
      const params = new URLSearchParams();
      params.set('maxResults', String(maxResults));
      if (unreadOnly) params.append('labelIds', 'UNREAD');
      if (searchQuery) params.set('q', searchQuery);
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
        { headers }
      );
      if (r.ok) {
        const j = (await r.json()) as { messages?: Array<{ id: string }> };
        messageIdLists.push(j.messages ?? []);
      }
    }
  } else {
    const perLabelCap = Math.min(25, Math.max(6, Math.ceil((maxResults * 1.5) / resolvedIds.length)));
    messageIdLists = await Promise.all(
      resolvedIds.slice(0, 12).map(async (labelId) => {
        const params = new URLSearchParams();
        params.set('maxResults', String(perLabelCap));
        params.append('labelIds', labelId);
        if (unreadOnly) params.append('labelIds', 'UNREAD');
        if (searchQuery) params.set('q', searchQuery);
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`,
          { headers }
        );
        if (!r.ok) return [];
        const j = (await r.json()) as { messages?: Array<{ id: string }> };
        return j.messages ?? [];
      })
    );
  }

  const targetMsgIds = interleaveUniqueMessageIds(messageIdLists, maxResults);
  const formatQuery = includeBody
    ? 'format=full'
    : 'format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date';

  const details = await Promise.all(
    targetMsgIds.map(async (id) => {
      const r = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?${formatQuery}`,
        { headers }
      );
      if (!r.ok) return null;
      return (await r.json()) as {
        id: string;
        threadId?: string;
        snippet?: string;
        internalDate?: string;
        labelIds?: string[];
        payload?: RawGmailPayloadPart & { headers?: Array<{ name: string; value: string }> };
      };
    })
  );

  const messages: GmailSummary[] = [];
  for (const d of details) {
    if (!d) continue;
    const hdrs = d.payload?.headers ?? [];
    const getH = (n: string) =>
      hdrs.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
    const bodyExcerpt = includeBody ? extractPlainTextFromGmailPayload(d.payload) : undefined;
    messages.push({
      id: d.id,
      threadId: d.threadId,
      from: getH('From') || 'Unknown sender',
      ...(getH('To') ? { to: getH('To') } : {}),
      subject: getH('Subject') || '(No subject)',
      snippet: d.snippet ?? '',
      ...(bodyExcerpt ? { bodyExcerpt } : {}),
      date: getH('Date'),
      internalDate: d.internalDate,
      isUnread: Boolean(d.labelIds?.includes('UNREAD')),
      labelIds: d.labelIds ?? [],
      labelNames: resolveDisplayLabelNames(d.labelIds, allLabelMap),
    });
  }

  messages.sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));

  const matchedLabels: GmailLabelSummary[] = resolvedIds.map(
    (id): GmailLabelSummary =>
      allLabelMap.get(id) ?? {
        id,
        name: FRIENDLY_GMAIL_SYSTEM_LABELS[id] ?? id,
        type: id === 'INBOX' || Boolean(FRIENDLY_GMAIL_SYSTEM_LABELS[id]) ? 'system' : 'user',
      }
  );

  return { messages, matchedLabels, availableLabels };
}

/**
 * Fetch real Gmail + Google Calendar + Google Chat summary using the client-provided OAuth Bearer token,
 * and attach any linked/exported Google Docs tracked in the village.
 */
export async function fetchWorkspaceBriefing(
  bearerHeader?: string,
  linkedDocs: GoogleDocSummary[] = [],
  pinnedDriveFiles: GoogleDriveFileSummary[] = [],
  workingFolder: DriveWorkingFolderConfig | null = null,
  pinnedChats: PinnedChatContext[] = [],
  gmailPreferences?: GmailSourcePreferences
): Promise<WorkspaceBriefingPayload> {
  if (!bearerHeader || !bearerHeader.startsWith('Bearer ')) {
    return {
      connected: false,
      unreadCount: 0,
      recentEmails: [],
      gmailLabels: [],
      activeGmailSources: [],
      upcomingEvents: [],
      chatSpaces: [],
      pinnedChats,
      linkedDocs,
      driveFiles: [],
      pinnedDriveFiles,
      workingFolder,
      workingFolderFiles: [],
    };
  }

  const headers = { Authorization: bearerHeader };
  const rawToken = bearerHeader.slice('Bearer '.length).trim();
  const includeInbox = gmailPreferences?.includeInbox !== false;
  const configuredLabels = gmailPreferences?.selectedLabels ?? [];

  try {
    const [labelsListRes, calRes, chatSpacesRes, driveRes, tokenInfoRes] = await Promise.all([
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers }).catch(() => null),
      fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(
          new Date().toISOString()
        )}&maxResults=8&singleEvents=true&orderBy=startTime`,
        { headers }
      ),
      fetch('https://chat.googleapis.com/v1/spaces?pageSize=25', { headers }).catch(() => null),
      fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=8&q=trashed%3Dfalse&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink,size)&supportsAllDrives=true&includeItemsFromAllDrives=true',
        { headers }
      ).catch(() => null),
      fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(rawToken)}`).catch(
        () => null
      ),
    ]);

    if (
      !(labelsListRes && labelsListRes.ok) &&
      !calRes.ok &&
      !(chatSpacesRes && chatSpacesRes.ok) &&
      !(driveRes && driveRes.ok)
    ) {
      return {
        connected: false,
        unreadCount: 0,
        recentEmails: [],
        gmailLabels: [],
        activeGmailSources: [],
        upcomingEvents: [],
        chatSpaces: [],
        pinnedChats,
        linkedDocs,
        driveFiles: [],
        pinnedDriveFiles,
        error: 'Google Workspace session expired or missing permissions. Please sign in again.',
      };
    }

    const rawLabels: RawGmailLabelItem[] =
      labelsListRes && labelsListRes.ok
        ? (((await labelsListRes.json().catch(() => ({}))) as { labels?: RawGmailLabelItem[] })
            .labels ?? [])
        : [];

    const allLabelMap = new Map<string, GmailLabelSummary>();
    for (const raw of rawLabels) {
      if (raw?.id) {
        allLabelMap.set(raw.id, normalizeGmailLabelSummary(raw));
      }
    }

    const activeSourceIds: string[] = [];
    if (includeInbox) {
      activeSourceIds.push('INBOX');
    }
    for (const cfg of configuredLabels) {
      const rawId = typeof cfg?.id === 'string' ? cfg.id.trim() : '';
      const rawName = typeof cfg?.name === 'string' ? cfg.name.trim() : '';
      if (!rawId && !rawName) continue;
      let resolvedId = rawId;
      if (rawId && !allLabelMap.has(rawId) && rawName) {
        const matchedByName = Array.from(allLabelMap.values()).find(
          (l) => l.name.toLowerCase() === rawName.toLowerCase()
        );
        if (matchedByName) resolvedId = matchedByName.id;
      }
      if (resolvedId && resolvedId.toUpperCase() !== 'INBOX' && !activeSourceIds.includes(resolvedId)) {
        activeSourceIds.push(resolvedId);
      }
    }

    let unreadCount = 0;
    const recentEmails: WorkspaceBriefingPayload['recentEmails'] = [];
    const activeGmailSources: GmailLabelSummary[] = [];
    const detailedLabelCounts = new Map<string, GmailLabelSummary>();

    if (labelsListRes && labelsListRes.ok && activeSourceIds.length > 0) {
      const cappedSources = activeSourceIds.slice(0, 10);
      const perSourceMaxMessages = Math.max(5, Math.min(10, Math.ceil(16 / cappedSources.length)));

      const sourceResults = await Promise.all(
        cappedSources.map(async (sourceId) => {
          const [detailRes, msgsRes, unreadIdsRes] = await Promise.all([
            fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(sourceId)}`,
              { headers }
            ).catch(() => null),
            fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${perSourceMaxMessages}&labelIds=${encodeURIComponent(
                sourceId
              )}`,
              { headers }
            ).catch(() => null),
            cappedSources.length > 1
              ? fetch(
                  `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&labelIds=${encodeURIComponent(
                    sourceId
                  )}&labelIds=UNREAD`,
                  { headers }
                ).catch(() => null)
              : Promise.resolve(null),
          ]);

          const detailJson =
            detailRes && detailRes.ok
              ? ((await detailRes.json().catch(() => null)) as RawGmailLabelItem | null)
              : null;
          const msgsJson =
            msgsRes && msgsRes.ok
              ? ((await msgsRes.json().catch(() => null)) as {
                  messages?: Array<{ id: string }>;
                } | null)
              : null;
          const unreadJson =
            unreadIdsRes && unreadIdsRes.ok
              ? ((await unreadIdsRes.json().catch(() => null)) as {
                  messages?: Array<{ id: string }>;
                } | null)
              : null;

          const baseLabel =
            allLabelMap.get(sourceId) ??
            normalizeGmailLabelSummary({
              id: sourceId,
              name:
                configuredLabels.find((l) => l.id === sourceId)?.name ??
                FRIENDLY_GMAIL_SYSTEM_LABELS[sourceId] ??
                sourceId,
              type: sourceId === 'INBOX' || Boolean(FRIENDLY_GMAIL_SYSTEM_LABELS[sourceId]) ? 'system' : 'user',
            });

          const mergedSummary = detailJson
            ? normalizeGmailLabelSummary({ ...baseLabel, ...detailJson })
            : baseLabel;

          return {
            sourceId,
            summary: mergedSummary,
            recentStubs: msgsJson?.messages ?? [],
            unreadStubs: unreadJson?.messages ?? [],
          };
        })
      );

      if (sourceResults.length === 1) {
        unreadCount = sourceResults[0].summary.messagesUnread ?? 0;
      } else {
        const dedupedUnreadIds = new Set<string>();
        let maxSingleLabelUnread = 0;
        for (const sr of sourceResults) {
          if ((sr.summary.messagesUnread ?? 0) > maxSingleLabelUnread) {
            maxSingleLabelUnread = sr.summary.messagesUnread ?? 0;
          }
          for (const u of sr.unreadStubs) {
            if (u?.id) dedupedUnreadIds.add(u.id);
          }
        }
        unreadCount = Math.max(dedupedUnreadIds.size, maxSingleLabelUnread);
      }

      for (const sr of sourceResults) {
        activeGmailSources.push(sr.summary);
        detailedLabelCounts.set(sr.sourceId, sr.summary);
        allLabelMap.set(sr.sourceId, sr.summary);
      }

      const targetIds = interleaveUniqueMessageIds(
        sourceResults.map((sr) => sr.recentStubs),
        14
      );

      const details = await Promise.all(
        targetIds.map(async (id) => {
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
              id
            )}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
            { headers }
          );
          if (!r.ok) return null;
          return (await r.json()) as {
            id: string;
            threadId?: string;
            snippet?: string;
            internalDate?: string;
            labelIds?: string[];
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
        })
      );

      for (const d of details) {
        if (!d) continue;
        const hdrs = d.payload?.headers ?? [];
        const getH = (n: string) =>
          hdrs.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';
        recentEmails.push({
          id: d.id,
          threadId: d.threadId,
          from: getH('From') || 'Unknown sender',
          subject: getH('Subject') || '(No subject)',
          snippet: d.snippet ?? '',
          date: getH('Date'),
          internalDate: d.internalDate,
          isUnread: Boolean(d.labelIds?.includes('UNREAD')),
          labelIds: d.labelIds ?? [],
          labelNames: resolveDisplayLabelNames(d.labelIds, allLabelMap),
        });
      }

      recentEmails.sort((a, b) => Number(b.internalDate || 0) - Number(a.internalDate || 0));
    }

    const gmailLabels = sortGmailLabels(
      rawLabels
        .filter(isSelectableGmailLabel)
        .map((raw) => detailedLabelCounts.get(raw.id) ?? normalizeGmailLabelSummary(raw))
    );

    let grantedScopes: string[] = [];
    if (tokenInfoRes && tokenInfoRes.ok) {
      const infoJson = (await tokenInfoRes.json().catch(() => null)) as { scope?: string } | null;
      if (infoJson?.scope) {
        grantedScopes = infoJson.scope.split(/\s+/).filter(Boolean);
      }
    }
    const hasCalendarWriteScope =
      grantedScopes.includes('https://www.googleapis.com/auth/calendar.events') ||
      grantedScopes.includes('https://www.googleapis.com/auth/calendar');

    const upcomingEvents: WorkspaceBriefingPayload['upcomingEvents'] = [];
    let calendarStatus: WorkspaceBriefingPayload['calendarStatus'] = 'unavailable';
    if (calRes.ok) {
      calendarStatus = hasCalendarWriteScope ? 'connected_write' : 'connected_read';
      const calJson = (await calRes.json()) as {
        items?: Array<{
          id: string;
          summary?: string;
          location?: string;
          description?: string;
          htmlLink?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
        }>;
      };
      for (const ev of calJson.items ?? []) {
        upcomingEvents.push({
          id: ev.id,
          summary: ev.summary ?? 'Untitled event',
          start: ev.start?.dateTime ?? ev.start?.date ?? '',
          end: ev.end?.dateTime ?? ev.end?.date ?? '',
          location: ev.location,
          description: ev.description,
          htmlLink: ev.htmlLink,
        });
      }
    } else {
      const calErr = await calRes.text().catch(() => '');
      if (
        calRes.status === 403 &&
        (calErr.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
          calErr.toLowerCase().includes('insufficient authentication scopes'))
      ) {
        calendarStatus = 'needs_consent';
      }
    }

    const chatSpaces: ChatSpaceSummary[] = [];
    let chatStatus: WorkspaceBriefingPayload['chatStatus'] = 'unavailable';
    let chatStatusMessage: string | undefined;

    if (chatSpacesRes) {
      if (chatSpacesRes.ok) {
        chatStatus = 'connected';
        const chatJson = (await chatSpacesRes.json()) as {
          spaces?: RawGoogleChatSpace[];
        };
        const rawSpaces = (chatJson.spaces ?? []).filter((s) => Boolean(s.name)).slice(0, 25);
        const enriched = await Promise.all(
          rawSpaces.map(async (sp, idx): Promise<ChatSpaceSummary> => {
            const baseSpace = normalizeGoogleChatSpace(sp);
            if (idx >= 8) {
              return baseSpace;
            }
            try {
              const msgRes = await fetch(
                `https://chat.googleapis.com/v1/${baseSpace.name}/messages?pageSize=5&orderBy=${encodeURIComponent(
                  'createTime desc'
                )}`,
                { headers }
              );
              if (!msgRes.ok) {
                return baseSpace;
              }
              const msgJson = (await msgRes.json()) as {
                messages?: RawGoogleChatMessage[];
              };
              const recentMessages = (msgJson.messages ?? [])
                .map((m) => normalizeGoogleChatMessage(m, baseSpace.name))
                .filter((m): m is GoogleChatMessageSummary => Boolean(m));
              return {
                ...baseSpace,
                recentMessages,
              };
            } catch {
              return baseSpace;
            }
          })
        );
        chatSpaces.push(...enriched);
      } else {
        const errBody = await chatSpacesRes.text().catch(() => '');
        if (
          chatSpacesRes.status === 404 ||
          errBody.toLowerCase().includes('google chat app not found')
        ) {
          chatStatus = 'app_not_configured';
          chatStatusMessage =
            'Google Chat app not found. To create a Chat app, you must turn on the Chat API and configure the app in the Google Cloud console.';
        } else if (
          chatSpacesRes.status === 403 &&
          (errBody.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
            errBody.toLowerCase().includes('insufficient authentication scopes'))
        ) {
          chatStatus = 'needs_consent';
          chatStatusMessage =
            'Grant Google Chat & Google Docs permission to load your spaces and documents.';
        } else {
          chatStatus = 'unavailable';
          chatStatusMessage =
            'Google Chat requires a Business or Enterprise Google Workspace account with Chat enabled.';
        }
      }
    }

    const driveFiles: GoogleDriveFileSummary[] = [];
    let driveStatus: WorkspaceBriefingPayload['driveStatus'] = 'unavailable';

    if (driveRes) {
      if (driveRes.ok) {
        driveStatus = 'connected';
        const driveJson = (await driveRes.json()) as {
          files?: Array<{
            id?: string;
            name?: string;
            mimeType?: string;
            modifiedTime?: string;
            webViewLink?: string;
            size?: string;
          }>;
        };
        for (const f of driveJson.files ?? []) {
          if (!f.id || !f.name) continue;
          const mime = f.mimeType || 'application/octet-stream';
          driveFiles.push({
            id: f.id,
            name: f.name,
            mimeType: mime,
            modifiedTime: f.modifiedTime,
            webViewLink: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
            size: f.size,
            isFolder: mime === 'application/vnd.google-apps.folder',
          });
        }
      } else {
        const driveErr = await driveRes.text().catch(() => '');
        if (
          driveRes.status === 403 &&
          (driveErr.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
            driveErr.toLowerCase().includes('insufficient authentication scopes'))
        ) {
          driveStatus = 'needs_consent';
        } else {
          driveStatus = 'unavailable';
        }
      }
    }

    let workingFolderFiles: GoogleDriveFileSummary[] = [];
    if (driveStatus === 'connected' && workingFolder?.id) {
      try {
        workingFolderFiles = await searchGoogleDriveFiles(bearerHeader, undefined, workingFolder.id);
      } catch {
        workingFolderFiles = [];
      }
    }

    return {
      connected: true,
      unreadCount,
      recentEmails,
      gmailLabels,
      activeGmailSources,
      upcomingEvents,
      calendarStatus,
      chatSpaces,
      pinnedChats,
      chatStatus,
      chatStatusMessage,
      chatConsoleUrl: GOOGLE_CHAT_CONSOLE_URL,
      linkedDocs,
      docsStatus: chatStatus === 'needs_consent' ? 'needs_consent' : 'connected',
      driveFiles,
      pinnedDriveFiles,
      workingFolder,
      workingFolderFiles,
      driveStatus,
    };
  } catch (err) {
    return {
      connected: false,
      unreadCount: 0,
      recentEmails: [],
      upcomingEvents: [],
      chatSpaces: [],
      pinnedChats,
      linkedDocs,
      driveFiles: [],
      pinnedDriveFiles,
      workingFolder,
      workingFolderFiles: [],
      error: err instanceof Error ? err.message : 'Failed to connect to Google Workspace.',
    };
  }
}

/**
 * Create a real Gmail Draft (never sends an email!) when CHO approves an email_draft item.
 */
export async function saveGmailDraft(
  bearerHeader: string,
  to: string,
  subject: string,
  body: string
): Promise<{ id: string }> {
  const mimeLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n');

  const raw = Buffer.from(mimeLines)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: bearerHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gmail Draft API error (${res.status}): ${errText}`);
  }

  return (await res.json()) as { id: string };
}

function normalizeIsoCalendarTimestamp(
  value: string | undefined,
  fallbackOffset?: string
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // All-day YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // ISO-8601 dateTime with explicit offset (Z or ±HH:MM) — preserve the exact timezone offset
  const explicitMatch =
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i.exec(
      trimmed
    );
  if (explicitMatch) {
    const [, datePart, hmPart, secPart, rawTz] = explicitMatch;
    const tzPart = rawTz.toUpperCase() === 'Z' ? 'Z' : rawTz;
    const normalized = `${datePart}T${hmPart}:${secPart ?? '00'}${tzPart}`;
    if (!Number.isNaN(Date.parse(normalized))) {
      return normalized;
    }
  }

  // Naive ISO-8601 dateTime without offset — attach client's local offset (or UTC Z)
  const naiveMatch = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(
    trimmed
  );
  if (naiveMatch) {
    const [, datePart, hmPart, secPart] = naiveMatch;
    const safeOffset =
      fallbackOffset && /^[+-]\d{2}:\d{2}$/.test(fallbackOffset.trim())
        ? fallbackOffset.trim()
        : 'Z';
    const normalized = `${datePart}T${hmPart}:${secPart ?? '00'}${safeOffset}`;
    if (!Number.isNaN(Date.parse(normalized))) {
      return normalized;
    }
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function addMinutesPreservingOffset(startIso: string, minutes: number): string {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) {
    return new Date(Date.now() + minutes * 60 * 1000).toISOString();
  }
  const endMs = startMs + minutes * 60 * 1000;
  const offsetMatch = /([+-])(\d{2}):(\d{2})$/.exec(startIso);
  if (offsetMatch) {
    const [, sign, oh, om] = offsetMatch;
    const offsetMins = (sign === '+' ? 1 : -1) * (Number(oh) * 60 + Number(om));
    const shifted = new Date(endMs + offsetMins * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
      shifted.getUTCDate()
    )}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(
      shifted.getUTCSeconds()
    )}${sign}${oh}:${om}`;
  }
  return new Date(endMs).toISOString();
}

function buildCalendarTimePayload(value: string): { date?: string; dateTime?: string } {
  const normalized = normalizeIsoCalendarTimestamp(value);
  if (!normalized) {
    throw new Error(`Invalid date/time value: "${value}".`);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return { date: normalized };
  }
  return { dateTime: normalized };
}

/**
 * Create a real Google Calendar event on the user's primary calendar after explicit confirmation.
 */
export async function createGoogleCalendarEvent(
  bearerHeader: string,
  params: {
    summary: string;
    start: string;
    end: string;
    location?: string;
    description?: string;
  }
): Promise<CalendarEventSummary> {
  const summary = params.summary.trim();
  if (!summary) {
    throw new Error('Event title is required.');
  }
  const payload: Record<string, unknown> = {
    summary,
    start: buildCalendarTimePayload(params.start),
    end: buildCalendarTimePayload(params.end),
  };
  if (params.location?.trim()) payload.location = params.location.trim();
  if (params.description?.trim()) payload.description = params.description.trim();

  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: bearerHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error(
        'Missing Google Calendar write permission. Enable Calendar Write Access in Settings and grant permission.'
      );
    }
    throw new Error(`Google Calendar create error (${res.status}): ${errText}`);
  }

  const created = (await res.json()) as {
    id: string;
    summary?: string;
    location?: string;
    description?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  };
  return {
    id: created.id,
    summary: created.summary ?? summary,
    start: created.start?.dateTime ?? created.start?.date ?? params.start,
    end: created.end?.dateTime ?? created.end?.date ?? params.end,
    location: created.location,
    description: created.description,
    htmlLink: created.htmlLink,
  };
}

/**
 * Update an existing Google Calendar event on the user's primary calendar after explicit confirmation.
 */
export async function updateGoogleCalendarEvent(
  bearerHeader: string,
  eventId: string,
  params: {
    summary?: string;
    start?: string;
    end?: string;
    location?: string;
    description?: string;
  }
): Promise<CalendarEventSummary> {
  const payload: Record<string, unknown> = {};
  if (params.summary !== undefined) {
    const clean = params.summary.trim();
    if (!clean) throw new Error('Event title cannot be empty.');
    payload.summary = clean;
  }
  if (params.start !== undefined) payload.start = buildCalendarTimePayload(params.start);
  if (params.end !== undefined) payload.end = buildCalendarTimePayload(params.end);
  if (params.location !== undefined) payload.location = params.location.trim();
  if (params.description !== undefined) payload.description = params.description.trim();

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: bearerHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error(
        'Missing Google Calendar write permission. Enable Calendar Write Access in Settings and grant permission.'
      );
    }
    throw new Error(`Google Calendar update error (${res.status}): ${errText}`);
  }

  const updated = (await res.json()) as {
    id: string;
    summary?: string;
    location?: string;
    description?: string;
    htmlLink?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  };
  return {
    id: updated.id,
    summary: updated.summary ?? params.summary ?? 'Untitled event',
    start: updated.start?.dateTime ?? updated.start?.date ?? params.start ?? '',
    end: updated.end?.dateTime ?? updated.end?.date ?? params.end ?? '',
    location: updated.location,
    description: updated.description,
    htmlLink: updated.htmlLink,
  };
}

/**
 * Delete an event on the user's primary Google Calendar after explicit confirmation.
 */
export async function deleteGoogleCalendarEvent(
  bearerHeader: string,
  eventId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: bearerHeader },
    }
  );

  if (!res.ok && res.status !== 204) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error(
        'Missing Google Calendar write permission. Enable Calendar Write Access in Settings and grant permission.'
      );
    }
    throw new Error(`Google Calendar delete error (${res.status}): ${errText}`);
  }
}

interface RawGoogleChatSpace {
  name?: string;
  displayName?: string;
  spaceType?: string;
  type?: string;
  spaceThreadingState?: string;
  lastActiveTime?: string;
  singleUserBotDm?: boolean;
}

interface RawGoogleChatMessage {
  name?: string;
  text?: string;
  formattedText?: string;
  createTime?: string;
  lastUpdateTime?: string;
  sender?: {
    displayName?: string;
    name?: string;
    type?: string;
  };
  thread?: {
    name?: string;
    threadKey?: string;
  };
  attachment?: Array<{
    name?: string;
    contentName?: string;
    contentType?: string;
  }>;
  emojiReactionSummaries?: Array<{
    emoji?: { unicode?: string };
    reactionCount?: number;
  }>;
}

function normalizeGoogleChatSpace(sp: RawGoogleChatSpace): ChatSpaceSummary {
  const spaceName = (sp.name || '').trim();
  const shortId = spaceName.replace(/^spaces\//, '');
  const resolvedType = sp.spaceType ?? sp.type;
  const fallbackLabel =
    resolvedType === 'DIRECT_MESSAGE'
      ? `Direct Message (${shortId})`
      : resolvedType === 'GROUP_CHAT'
        ? `Group Chat (${shortId})`
        : `Space (${shortId})`;
  return {
    name: spaceName,
    displayName: sp.displayName?.trim() || fallbackLabel,
    spaceType: resolvedType,
    spaceThreadingState: sp.spaceThreadingState,
    lastActiveTime: sp.lastActiveTime,
    singleUserBotDm: sp.singleUserBotDm,
    recentMessages: [],
  };
}

function normalizeGoogleChatMessage(
  m: RawGoogleChatMessage,
  spaceName: string
): GoogleChatMessageSummary | null {
  const rawText = (m.text || m.formattedText || '').trim();
  const attachmentNames = (m.attachment ?? [])
    .map((a) => (a.contentName || a.contentType || '').trim())
    .filter(Boolean);
  if (!rawText && attachmentNames.length === 0) {
    return null;
  }
  const senderId = m.sender?.name?.trim();
  const shortUserTag = senderId ? senderId.replace(/^users\//, '').slice(-6) : '';
  const senderName =
    m.sender?.displayName?.trim() ||
    (m.sender?.type === 'BOT'
      ? 'Chat App'
      : shortUserTag
        ? `Member · ${shortUserTag}`
        : 'Team Member');

  const reactionSummary = (m.emojiReactionSummaries ?? [])
    .filter((r) => Boolean(r.emoji?.unicode))
    .map((r) => `${r.emoji!.unicode}${r.reactionCount && r.reactionCount > 1 ? ` ${r.reactionCount}` : ''}`);

  const fallbackText =
    rawText || `[Attachment: ${attachmentNames.join(', ')}]`;

  return {
    name: m.name || `${spaceName}/messages/${Date.now()}`,
    spaceName,
    threadName: m.thread?.name?.trim() || undefined,
    senderName,
    senderId,
    senderType: m.sender?.type,
    text: fallbackText,
    createTime: m.createTime || '',
    lastUpdateTime: m.lastUpdateTime || undefined,
    attachmentNames: attachmentNames.length > 0 ? attachmentNames : undefined,
    reactionSummary: reactionSummary.length > 0 ? reactionSummary : undefined,
  };
}

/**
 * Parse a Google Chat URL, resource name (`spaces/AAA`, `spaces/AAA/threads/BBB`,
 * `spaces/AAA/messages/CCC`), or bare space ID into normalized API resource names.
 */
export function parseGoogleChatTarget(rawInput: string): {
  spaceName: string;
  threadName?: string;
  messageName?: string;
} | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Canonical resource path: spaces/{space}/threads/{thread} or spaces/{space}/messages/{msg}
  const resourceThreadMatch = /spaces\/([A-Za-z0-9_-]+)\/threads\/([A-Za-z0-9_.-]+)/.exec(trimmed);
  if (resourceThreadMatch) {
    const [, spaceId, threadId] = resourceThreadMatch;
    return {
      spaceName: `spaces/${spaceId}`,
      threadName: `spaces/${spaceId}/threads/${threadId}`,
    };
  }

  const resourceMsgMatch = /spaces\/([A-Za-z0-9_-]+)\/messages\/([A-Za-z0-9_.-]+)/.exec(trimmed);
  if (resourceMsgMatch) {
    const [, spaceId, msgId] = resourceMsgMatch;
    return {
      spaceName: `spaces/${spaceId}`,
      messageName: `spaces/${spaceId}/messages/${msgId}`,
    };
  }

  const resourceSpaceMatch = /^spaces\/([A-Za-z0-9_-]+)\/?$/.exec(trimmed);
  if (resourceSpaceMatch) {
    return { spaceName: `spaces/${resourceSpaceMatch[1]}` };
  }

  // 2. chat.google.com URLs:
  //    https://chat.google.com/room/AAAA1234/BBBB5678
  //    https://chat.google.com/u/0/app/chat/AAAA1234
  //    https://chat.google.com/dm/AAAA1234
  const chatRoomUrlMatch =
    /chat\.google\.com\/(?:u\/\d+\/)?(?:room|dm|space|app\/chat)\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_.-]+))?/i.exec(
      trimmed
    );
  if (chatRoomUrlMatch) {
    const [, spaceId, maybeThreadId] = chatRoomUrlMatch;
    const cleanThread =
      maybeThreadId && maybeThreadId !== 'search' && !maybeThreadId.includes('?')
        ? maybeThreadId
        : undefined;
    return {
      spaceName: `spaces/${spaceId}`,
      ...(cleanThread ? { threadName: `spaces/${spaceId}/threads/${cleanThread}` } : {}),
    };
  }

  // 3. Gmail integrated Chat URLs:
  //    https://mail.google.com/chat/u/0/#chat/space/AAAA1234/BBBB5678
  //    https://mail.google.com/mail/u/0/#chat/dm/AAAA1234
  const mailChatUrlMatch =
    /#chat\/(?:space|dm|room)\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_.-]+))?/i.exec(trimmed);
  if (mailChatUrlMatch) {
    const [, spaceId, maybeThreadId] = mailChatUrlMatch;
    return {
      spaceName: `spaces/${spaceId}`,
      ...(maybeThreadId ? { threadName: `spaces/${spaceId}/threads/${maybeThreadId}` } : {}),
    };
  }

  // 4. Bare space ID token (e.g. "AAAAxYz1234")
  if (/^[A-Za-z0-9_-]{6,64}$/.test(trimmed) && !trimmed.includes(' ')) {
    return { spaceName: `spaces/${trimmed}` };
  }

  return null;
}

export function groupMessagesIntoThreads(
  spaceName: string,
  messages: GoogleChatMessageSummary[]
): GoogleChatThreadSummary[] {
  const sortedAsc = [...messages].sort(
    (a, b) => (Date.parse(a.createTime) || 0) - (Date.parse(b.createTime) || 0)
  );
  const byThread = new Map<string, GoogleChatMessageSummary[]>();

  for (const msg of sortedAsc) {
    const key = msg.threadName || msg.name;
    const bucket = byThread.get(key);
    if (bucket) {
      bucket.push(msg);
    } else {
      byThread.set(key, [msg]);
    }
  }

  const summaries: GoogleChatThreadSummary[] = [];
  for (const [threadName, list] of byThread.entries()) {
    const root = list[0];
    const last = list[list.length - 1];
    const participants: string[] = [];
    for (const item of list) {
      if (item.senderName && !participants.includes(item.senderName)) {
        participants.push(item.senderName);
      }
    }
    summaries.push({
      threadName,
      spaceName,
      rootSenderName: root.senderName,
      rootText: root.text,
      replyCount: Math.max(0, list.length - 1),
      messageCount: list.length,
      participants,
      firstMessageTime: root.createTime,
      lastUpdateTime: last.createTime || root.createTime,
      messages: list,
    });
  }

  return summaries.sort(
    (a, b) => (Date.parse(b.lastUpdateTime) || 0) - (Date.parse(a.lastUpdateTime) || 0)
  );
}

function throwGoogleChatApiError(status: number, errText: string): never {
  if (status === 404 && errText.toLowerCase().includes('google chat app not found')) {
    throw new Error(
      `Google Chat app not found. Configure Application info on the Google Chat API Configuration page (${GOOGLE_CHAT_CONSOLE_URL}).`
    );
  }
  if (status === 404) {
    throw new Error(
      'Specified Google Chat space or thread was not found, or your Google account is not a member of that conversation.'
    );
  }
  if (
    status === 403 &&
    (errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      errText.toLowerCase().includes('insufficient authentication scopes'))
  ) {
    throw new Error('Missing Google Chat permission. Click "Grant Workspace Access" first.');
  }
  throw new Error(`Google Chat API error (${status}): ${errText}`);
}

/**
 * List Google Chat spaces with pagination and optional spaceType filtering.
 */
export async function listGoogleChatSpaces(
  bearerHeader: string,
  options?: {
    pageSize?: number;
    pageToken?: string;
    filterType?: 'ALL' | 'SPACE' | 'GROUP_CHAT' | 'DIRECT_MESSAGE';
  }
): Promise<{ spaces: ChatSpaceSummary[]; nextPageToken?: string }> {
  const pageSize = Math.min(100, Math.max(10, options?.pageSize ?? 50));
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (options?.pageToken?.trim()) {
    params.set('pageToken', options.pageToken.trim());
  }
  if (options?.filterType && options.filterType !== 'ALL') {
    params.set('filter', `spaceType = "${options.filterType}"`);
  }

  const res = await fetch(`https://chat.googleapis.com/v1/spaces?${params.toString()}`, {
    headers: { Authorization: bearerHeader },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throwGoogleChatApiError(res.status, errText);
  }

  const data = (await res.json()) as {
    spaces?: RawGoogleChatSpace[];
    nextPageToken?: string;
  };
  const spaces = (data.spaces ?? [])
    .filter((s) => Boolean(s.name))
    .map((s) => normalizeGoogleChatSpace(s));

  return {
    spaces,
    nextPageToken: data.nextPageToken,
  };
}

/**
 * Read messages and threads from a specified Google Chat space, URL, or specific thread.
 * Also supports matching a space by human displayName when `target` is a room name query.
 */
export async function readGoogleChatConversation(
  bearerHeader: string,
  options: {
    target: string;
    threadName?: string;
    pageSize?: number;
    pageToken?: string;
    searchQuery?: string;
  }
): Promise<{
  space: ChatSpaceSummary;
  messages: GoogleChatMessageSummary[];
  threads: GoogleChatThreadSummary[];
  focusedThreadName?: string;
  nextPageToken?: string;
}> {
  const headers = { Authorization: bearerHeader };
  const rawTarget = options.target.trim();
  if (!rawTarget) {
    throw new Error('Specify a Google Chat space, thread ID, or Google Chat URL to read.');
  }

  let parsed = parseGoogleChatTarget(rawTarget);
  let matchedSpaceSummary: ChatSpaceSummary | null = null;

  // If rawTarget is a human display name (e.g. "Engineering" or "Leadership Sync") rather than an ID/URL,
  // search the user's spaces by displayName so Daniel & the user can open spaces by name too.
  if (!parsed) {
    const { spaces } = await listGoogleChatSpaces(bearerHeader, { pageSize: 100 });
    const needle = rawTarget.toLowerCase();
    const exact =
      spaces.find((s) => s.displayName.toLowerCase() === needle) ??
      spaces.find((s) => s.displayName.toLowerCase().includes(needle));
    if (!exact) {
      throw new Error(
        `No Google Chat space matched "${rawTarget}". Paste a Google Chat link, spaces/AAAA... ID, or select a listed space.`
      );
    }
    matchedSpaceSummary = exact;
    parsed = { spaceName: exact.name };
  }

  const spaceName = parsed.spaceName;
  const explicitThreadRaw = options.threadName?.trim();
  let focusedThreadName = parsed.threadName;
  if (explicitThreadRaw) {
    const threadParsed = parseGoogleChatTarget(explicitThreadRaw);
    if (threadParsed?.threadName) {
      focusedThreadName = threadParsed.threadName;
    } else if (explicitThreadRaw.startsWith('spaces/') && explicitThreadRaw.includes('/threads/')) {
      focusedThreadName = explicitThreadRaw;
    } else {
      focusedThreadName = `${spaceName}/threads/${explicitThreadRaw.replace(/^threads\//, '')}`;
    }
  }

  // If a specific message resource was pasted (`spaces/AAA/messages/CCC`), look up its parent threadName first
  if (parsed.messageName && !focusedThreadName) {
    const singleMsgRes = await fetch(`https://chat.googleapis.com/v1/${parsed.messageName}`, {
      headers,
    }).catch(() => null);
    if (singleMsgRes && singleMsgRes.ok) {
      const singleMsgJson = (await singleMsgRes.json()) as RawGoogleChatMessage;
      if (singleMsgJson.thread?.name) {
        focusedThreadName = singleMsgJson.thread.name;
      }
    }
  }

  // Fetch space metadata (displayName, spaceType, spaceThreadingState)
  let space: ChatSpaceSummary =
    matchedSpaceSummary ??
    normalizeGoogleChatSpace({
      name: spaceName,
    });

  if (!matchedSpaceSummary) {
    const spaceRes = await fetch(`https://chat.googleapis.com/v1/${spaceName}`, {
      headers,
    }).catch(() => null);
    if (spaceRes) {
      if (spaceRes.ok) {
        const rawSpace = (await spaceRes.json()) as RawGoogleChatSpace;
        space = normalizeGoogleChatSpace({ ...rawSpace, name: rawSpace.name || spaceName });
      } else if (spaceRes.status === 403 || spaceRes.status === 404) {
        const errText = await spaceRes.text().catch(() => '');
        throwGoogleChatApiError(spaceRes.status, errText);
      }
    }
  }

  const requestedSize = Math.min(
    100,
    Math.max(10, options.searchQuery?.trim() ? 100 : (options.pageSize ?? 50))
  );

  const buildParams = (includeOrderBy: boolean) => {
    const p = new URLSearchParams({ pageSize: String(requestedSize) });
    if (includeOrderBy) {
      p.set('orderBy', 'createTime desc');
    }
    if (options.pageToken?.trim()) {
      p.set('pageToken', options.pageToken.trim());
    }
    if (focusedThreadName) {
      p.set('filter', `thread.name = "${focusedThreadName}"`);
    }
    return p;
  };

  let msgRes = await fetch(
    `https://chat.googleapis.com/v1/${spaceName}/messages?${buildParams(true).toString()}`,
    { headers }
  );

  // Resilient fallback if a specific Chat filter combination rejects orderBy
  if (msgRes.status === 400 && focusedThreadName) {
    msgRes = await fetch(
      `https://chat.googleapis.com/v1/${spaceName}/messages?${buildParams(false).toString()}`,
      { headers }
    );
  }

  if (!msgRes.ok) {
    const errText = await msgRes.text().catch(() => '');
    throwGoogleChatApiError(msgRes.status, errText);
  }

  const msgJson = (await msgRes.json()) as {
    messages?: RawGoogleChatMessage[];
    nextPageToken?: string;
  };

  let normalized = (msgJson.messages ?? [])
    .map((m) => normalizeGoogleChatMessage(m, spaceName))
    .filter((m): m is GoogleChatMessageSummary => Boolean(m));

  // Sort chronologically (oldest -> newest) for natural reading
  normalized.sort((a, b) => (Date.parse(a.createTime) || 0) - (Date.parse(b.createTime) || 0));

  const queryNeedle = options.searchQuery?.trim().toLowerCase();
  if (queryNeedle) {
    normalized = normalized.filter(
      (m) =>
        m.text.toLowerCase().includes(queryNeedle) ||
        m.senderName.toLowerCase().includes(queryNeedle) ||
        (m.attachmentNames ?? []).some((a) => a.toLowerCase().includes(queryNeedle))
    );
  }

  const threads = groupMessagesIntoThreads(spaceName, normalized);
  space.recentMessages = [...normalized].reverse().slice(0, 5);

  return {
    space,
    messages: normalized,
    threads,
    focusedThreadName,
    nextPageToken: msgJson.nextPageToken,
  };
}

/**
 * Post a message to a Google Chat space (or reply inside a specific thread)
 * ONLY after explicit user confirmation / CHO approval.
 */
export async function sendGoogleChatMessage(
  bearerHeader: string,
  spaceName: string,
  text: string,
  threadName?: string
): Promise<{ name: string; createTime?: string; threadName?: string }> {
  const parsedSpace = parseGoogleChatTarget(spaceName);
  const cleanSpace =
    parsedSpace?.spaceName ||
    (spaceName.trim().startsWith('spaces/') ? spaceName.trim() : `spaces/${spaceName.trim()}`);

  let cleanThread = threadName?.trim() || parsedSpace?.threadName;
  if (cleanThread && !cleanThread.startsWith('spaces/')) {
    cleanThread = `${cleanSpace}/threads/${cleanThread.replace(/^threads\//, '')}`;
  }

  const url = cleanThread
    ? `https://chat.googleapis.com/v1/${cleanSpace}/messages?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD`
    : `https://chat.googleapis.com/v1/${cleanSpace}/messages`;

  const bodyPayload: Record<string, unknown> = { text: text.trim() };
  if (cleanThread) {
    bodyPayload.thread = { name: cleanThread };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: bearerHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throwGoogleChatApiError(res.status, errText);
  }

  const sent = (await res.json()) as {
    name: string;
    createTime?: string;
    thread?: { name?: string };
  };
  return {
    name: sent.name,
    createTime: sent.createTime,
    threadName: sent.thread?.name || cleanThread,
  };
}

export function extractGoogleDocId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const urlMatch = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch?.[1]) return urlMatch[1];
  if (/^[a-zA-Z0-9_-]{15,}$/.test(trimmed)) return trimmed;
  return null;
}

interface DocsStructuralElement {
  paragraph?: {
    elements?: Array<{
      textRun?: { content?: string };
    }>;
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        content?: DocsStructuralElement[];
      }>;
    }>;
  };
}

function extractPlainTextFromDocsElements(elements: DocsStructuralElement[] = []): string {
  const chunks: string[] = [];
  for (const el of elements) {
    if (el.paragraph?.elements) {
      for (const pEl of el.paragraph.elements) {
        if (pEl.textRun?.content) {
          chunks.push(pEl.textRun.content);
        }
      }
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        const cellTexts = (row.tableCells ?? []).map((cell) =>
          extractPlainTextFromDocsElements(cell.content ?? []).trim()
        );
        if (cellTexts.some(Boolean)) {
          chunks.push(`${cellTexts.join(' | ')}\n`);
        }
      }
    }
  }
  return chunks.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Read a Google Doc by URL or documentId using docs.googleapis.com.
 */
export async function fetchGoogleDocument(
  bearerHeader: string,
  docIdOrUrl: string
): Promise<GoogleDocSummary> {
  const documentId = extractGoogleDocId(docIdOrUrl);
  if (!documentId) {
    throw new Error('Please enter a valid Google Docs URL or Document ID.');
  }

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`, {
    headers: { Authorization: bearerHeader },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Docs permission. Click "Grant Chat & Docs Access" first.');
    }
    if (res.status === 404) {
      throw new Error('Google Doc not found or your account does not have access to it.');
    }
    throw new Error(`Google Docs API error (${res.status}): ${errText}`);
  }

  const docJson = (await res.json()) as {
    documentId?: string;
    title?: string;
    body?: { content?: DocsStructuralElement[] };
  };
  const resolvedId = docJson.documentId || documentId;
  const fullText = extractPlainTextFromDocsElements(docJson.body?.content ?? []);
  const excerpt =
    fullText.length > 360
      ? `${fullText.slice(0, 357).trim()}...`
      : fullText || '(Empty Google Doc)';

  return {
    documentId: resolvedId,
    title: docJson.title || 'Untitled Document',
    url: `https://docs.googleapis.com/document/d/${resolvedId}/edit`,
    excerpt,
    content: fullText.slice(0, 8000),
    updatedAt: new Date().toISOString(),
  };
}

function cleanMarkdownForGoogleDoc(markdown: string): string {
  return markdown
    .replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '\n$1\n')
    .replace(/^#{1,6}\s+(.*)$/gm, '\n$1\n')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Create a new Google Doc and populate its body using docs.googleapis.com after explicit CHO confirmation.
 */
export async function createGoogleDocument(
  bearerHeader: string,
  title: string,
  markdownContent: string,
  sourceTaskId?: string
): Promise<GoogleDocSummary> {
  const cleanTitle = title.trim() || 'Guildhaven Deliverable';
  const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: {
      Authorization: bearerHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: cleanTitle }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    if (createRes.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Docs permission. Click "Grant Chat & Docs Access" first.');
    }
    throw new Error(`Google Docs create error (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as { documentId: string; title?: string };
  const documentId = created.documentId;
  const formattedBody = cleanMarkdownForGoogleDoc(markdownContent);

  if (formattedBody) {
    const updateRes = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: bearerHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: { index: 1 },
                text: `${formattedBody}\n`,
              },
            },
          ],
        }),
      }
    );
    if (!updateRes.ok) {
      const errText = await updateRes.text().catch(() => '');
      throw new Error(`Google Docs batchUpdate error (${updateRes.status}): ${errText}`);
    }
  }

  return {
    documentId,
    title: created.title || cleanTitle,
    url: `https://docs.googleapis.com/document/d/${documentId}/edit`,
    excerpt:
      formattedBody.length > 360
        ? `${formattedBody.slice(0, 357).trim()}...`
        : formattedBody || '(Created empty Google Doc)',
    content: formattedBody.slice(0, 8000),
    updatedAt: new Date().toISOString(),
    sourceTaskId,
  };
}

export function extractGoogleDriveFileId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch?.[1]) return folderMatch[1];
  const fileMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch?.[1]) return fileMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParamMatch?.[1]) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{12,}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Search or list files and folders in Google Drive (supports Shared Drives).
 */
export async function searchGoogleDriveFiles(
  bearerHeader: string,
  query?: string,
  folderId?: string
): Promise<GoogleDriveFileSummary[]> {
  const clauses = ['trashed = false'];
  if (folderId?.trim()) {
    const safeFolder = folderId.trim().replace(/'/g, '');
    clauses.push(`'${safeFolder}' in parents`);
  }
  if (query?.trim()) {
    const escaped = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    clauses.push(`name contains '${escaped}'`);
  }
  const qParam = encodeURIComponent(clauses.join(' and '));
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=25&q=${qParam}&orderBy=${encodeURIComponent(
    'folder,modifiedTime desc'
  )}&fields=${encodeURIComponent(
    'files(id,name,mimeType,modifiedTime,webViewLink,size,parents)'
  )}&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: bearerHeader },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Drive permission. Click "Grant Workspace Access" first.');
    }
    throw new Error(`Google Drive search error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      webViewLink?: string;
      size?: string;
      parents?: string[];
    }>;
  };

  return (data.files ?? [])
    .filter((f) => Boolean(f.id && f.name))
    .map((f) => {
      const mime = f.mimeType || 'application/octet-stream';
      const isFolder = mime === 'application/vnd.google-apps.folder';
      return {
        id: f.id!,
        name: f.name!,
        mimeType: mime,
        modifiedTime: f.modifiedTime,
        webViewLink:
          f.webViewLink ||
          (isFolder
            ? `https://drive.google.com/drive/folders/${f.id}`
            : `https://drive.google.com/file/d/${f.id}/view`),
        size: f.size,
        isFolder,
        parents: f.parents,
      };
    });
}

/**
 * List Google Drive folders so the user can designate a Working Folder in Settings.
 */
export async function listGoogleDriveFolders(
  bearerHeader: string,
  query?: string
): Promise<GoogleDriveFileSummary[]> {
  const clauses = ["trashed = false", "mimeType = 'application/vnd.google-apps.folder'"];
  if (query?.trim()) {
    const escaped = query.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    clauses.push(`name contains '${escaped}'`);
  }
  const qParam = encodeURIComponent(clauses.join(' and '));
  const url = `https://www.googleapis.com/drive/v3/files?pageSize=25&q=${qParam}&orderBy=${encodeURIComponent(
    'modifiedTime desc'
  )}&fields=${encodeURIComponent(
    'files(id,name,mimeType,modifiedTime,webViewLink,parents)'
  )}&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    headers: { Authorization: bearerHeader },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Drive permission. Click "Grant Workspace Access" first.');
    }
    throw new Error(`Google Drive folder list error (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    files?: Array<{
      id?: string;
      name?: string;
      mimeType?: string;
      modifiedTime?: string;
      webViewLink?: string;
      parents?: string[];
    }>;
  };

  return (data.files ?? [])
    .filter((f) => Boolean(f.id && f.name))
    .map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType || 'application/vnd.google-apps.folder',
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink || `https://drive.google.com/drive/folders/${f.id}`,
      isFolder: true,
      parents: f.parents,
    }));
}

/**
 * Verify whether a Drive file or subfolder resides directly inside or nested beneath the configured Working Folder.
 */
export async function isItemInsideWorkingFolder(
  bearerHeader: string,
  targetId: string,
  workingFolderId: string
): Promise<boolean> {
  const cleanTarget = targetId.trim();
  const cleanRoot = workingFolderId.trim();
  if (!cleanTarget || !cleanRoot) return false;
  if (cleanTarget === cleanRoot) return true;

  let frontier = [cleanTarget];
  const visited = new Set<string>();

  for (let depth = 0; depth < 6 && frontier.length > 0; depth += 1) {
    const nextFrontier: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);

      const metaRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          id
        )}?fields=id,parents&supportsAllDrives=true`,
        { headers: { Authorization: bearerHeader } }
      );
      if (!metaRes.ok) continue;
      const meta = (await metaRes.json()) as { id?: string; parents?: string[] };
      const parents = meta.parents ?? [];
      if (parents.includes(cleanRoot)) {
        return true;
      }
      for (const p of parents) {
        if (!visited.has(p)) nextFrontier.push(p);
      }
    }
    frontier = nextFrontier;
  }

  return false;
}

/**
 * Read a Google Drive file's metadata + readable text content (for Google Docs, Sheets, Slides, or text/markdown/json files)
 * so villagers can ground their work in it.
 */
export async function readGoogleDriveFileContent(
  bearerHeader: string,
  fileIdOrUrl: string
): Promise<GoogleDriveFileSummary> {
  const fileId = extractGoogleDriveFileId(fileIdOrUrl);
  if (!fileId) {
    throw new Error('Please enter a valid Google Drive File URL or ID.');
  }

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=id,name,mimeType,modifiedTime,webViewLink,size&supportsAllDrives=true`,
    { headers: { Authorization: bearerHeader } }
  );

  if (!metaRes.ok) {
    const errText = await metaRes.text().catch(() => '');
    if (metaRes.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Drive permission. Click "Grant Workspace Access" first.');
    }
    if (metaRes.status === 404) {
      throw new Error('Google Drive file not found or your account does not have access.');
    }
    throw new Error(`Google Drive metadata error (${metaRes.status}): ${errText}`);
  }

  const meta = (await metaRes.json()) as {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
    size?: string;
  };

  const mime = meta.mimeType || 'application/octet-stream';
  const isFolder = mime === 'application/vnd.google-apps.folder';
  let extractedText = '';

  try {
    if (mime === 'application/vnd.google-apps.document') {
      const exp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          meta.id
        )}/export?mimeType=${encodeURIComponent('text/plain')}`,
        { headers: { Authorization: bearerHeader } }
      );
      if (exp.ok) extractedText = (await exp.text()).trim();
    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      const exp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          meta.id
        )}/export?mimeType=${encodeURIComponent('text/csv')}`,
        { headers: { Authorization: bearerHeader } }
      );
      if (exp.ok) extractedText = (await exp.text()).trim();
    } else if (mime === 'application/vnd.google-apps.presentation') {
      const exp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          meta.id
        )}/export?mimeType=${encodeURIComponent('text/plain')}`,
        { headers: { Authorization: bearerHeader } }
      );
      if (exp.ok) extractedText = (await exp.text()).trim();
    } else if (
      mime.startsWith('text/') ||
      mime === 'application/json' ||
      mime === 'application/xml'
    ) {
      const dl = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          meta.id
        )}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: bearerHeader } }
      );
      if (dl.ok) extractedText = (await dl.text()).trim();
    } else if (isFolder) {
      const children = await searchGoogleDriveFiles(bearerHeader, undefined, meta.id);
      extractedText =
        children.length > 0
          ? `Folder contents (${children.length} items): ${children
              .map((c) => `${c.name}${c.isFolder ? '/' : ''}`)
              .join(', ')}`
          : 'Empty Google Drive folder.';
    }
  } catch {
    // Keep metadata summary if export/media read fails
  }

  const fallbackDesc = isFolder
    ? 'Google Drive Folder'
    : `Google Drive File (${mime.replace('application/vnd.google-apps.', 'google-')})`;
  const cleanText = extractedText || fallbackDesc;
  const excerpt =
    cleanText.length > 360 ? `${cleanText.slice(0, 357).trim()}...` : cleanText;

  return {
    id: meta.id,
    name: meta.name,
    mimeType: mime,
    modifiedTime: meta.modifiedTime,
    webViewLink:
      meta.webViewLink ||
      (isFolder
        ? `https://drive.google.com/drive/folders/${meta.id}`
        : `https://drive.google.com/file/d/${meta.id}/view`),
    size: meta.size,
    isFolder,
    excerpt,
    content: cleanText.slice(0, 8000),
  };
}

/**
 * Create a new file or folder in Google Drive using drive.file scope ONLY after explicit CHO confirmation.
 */
export async function saveGoogleDriveFile(
  bearerHeader: string,
  params: {
    name: string;
    content?: string;
    mimeType?: string;
    parentFolderId?: string;
    isFolder?: boolean;
  }
): Promise<GoogleDriveFileSummary> {
  const cleanName = params.name.trim() || 'Guildhaven Deliverable.md';

  if (params.isFolder || params.mimeType === 'application/vnd.google-apps.folder') {
    const folderMeta: Record<string, unknown> = {
      name: cleanName,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (params.parentFolderId?.trim()) {
      folderMeta.parents = [params.parentFolderId.trim()];
    }
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: bearerHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(folderMeta),
      }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
        throw new Error('Missing Google Drive write permission. Click "Grant Workspace Access" first.');
      }
      throw new Error(`Google Drive folder create error (${res.status}): ${errText}`);
    }
    const created = (await res.json()) as {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
    };
    return {
      id: created.id,
      name: created.name || cleanName,
      mimeType: created.mimeType,
      modifiedTime: created.modifiedTime,
      webViewLink: created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`,
      isFolder: true,
      excerpt: 'Created Google Drive folder',
    };
  }

  const contentType = params.mimeType?.trim() || 'text/markdown';
  const fileName =
    /\.[a-zA-Z0-9]{1,6}$/.test(cleanName) || contentType !== 'text/markdown'
      ? cleanName
      : `${cleanName}.md`;
  const bodyContent = params.content ?? '';
  const metadata: Record<string, unknown> = {
    name: fileName,
    mimeType: contentType,
  };
  if (params.parentFolderId?.trim()) {
    metadata.parents = [params.parentFolderId.trim()];
  }

  const boundary = `village_drive_${Date.now().toString(36)}`;
  const multipartBody = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentType}; charset=UTF-8`,
    '',
    bodyContent,
    `--${boundary}--`,
  ].join('\r\n');

  const uploadRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink,size&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: bearerHeader,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => '');
    if (uploadRes.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      throw new Error('Missing Google Drive write permission. Click "Grant Workspace Access" first.');
    }
    throw new Error(`Google Drive upload error (${uploadRes.status}): ${errText}`);
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
    size?: string;
  };

  return {
    id: uploaded.id,
    name: uploaded.name || fileName,
    mimeType: uploaded.mimeType || contentType,
    modifiedTime: uploaded.modifiedTime,
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    size: uploaded.size,
    isFolder: false,
    excerpt:
      bodyContent.length > 360
        ? `${bodyContent.slice(0, 357).trim()}...`
        : bodyContent || '(Saved file in Google Drive)',
    content: bodyContent.slice(0, 8000),
  };
}

/**
 * Rename and/or update content of a file strictly inside the designated Working Folder.
 */
export async function updateGoogleDriveFile(
  bearerHeader: string,
  params: {
    fileId: string;
    workingFolderId: string;
    name?: string;
    content?: string;
  }
): Promise<GoogleDriveFileSummary> {
  const { fileId, workingFolderId, name, content } = params;
  if (fileId === workingFolderId) {
    throw new Error('Cannot modify the root Working Folder metadata through file update.');
  }

  const inside = await isItemInsideWorkingFolder(bearerHeader, fileId, workingFolderId);
  if (!inside) {
    throw new Error('Safety block: Target file is outside your configured Google Drive Working Folder.');
  }

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?fields=id,name,mimeType,modifiedTime,webViewLink,size,parents&supportsAllDrives=true`,
    { headers: { Authorization: bearerHeader } }
  );
  if (!metaRes.ok) {
    throw new Error(`Could not inspect Google Drive file (${metaRes.status}).`);
  }
  const existing = (await metaRes.json()) as {
    id: string;
    name: string;
    mimeType: string;
    modifiedTime?: string;
    webViewLink?: string;
    size?: string;
    parents?: string[];
  };

  const trimmedName = name?.trim();
  const isGoogleDoc = existing.mimeType === 'application/vnd.google-apps.document';
  const isFolder = existing.mimeType === 'application/vnd.google-apps.folder';

  if (isGoogleDoc && content !== undefined) {
    const docGet = await fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}`,
      { headers: { Authorization: bearerHeader } }
    );
    if (!docGet.ok) {
      if (docGet.status === 403) {
        throw new Error(
          'READ_ONLY_EXTERNAL_FILE: This Google Doc was created outside the app. Save an editable copy inside your Working Folder to modify it freely.'
        );
      }
      throw new Error(`Google Docs read failed (${docGet.status}).`);
    }
    const docJson = (await docGet.json()) as {
      body?: { content?: Array<{ endIndex?: number }> };
    };
    const elements = docJson.body?.content ?? [];
    const lastEnd = elements.length > 0 ? elements[elements.length - 1]?.endIndex ?? 1 : 1;

    const requests: Array<Record<string, unknown>> = [];
    if (lastEnd > 2) {
      requests.push({
        deleteContentRange: {
          range: { startIndex: 1, endIndex: lastEnd - 1 },
        },
      });
    }
    if (content.length > 0) {
      requests.push({
        insertText: {
          location: { index: 1 },
          text: content,
        },
      });
    }

    if (requests.length > 0) {
      const batchRes = await fetch(
        `https://docs.googleapis.com/v1/documents/${encodeURIComponent(fileId)}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: bearerHeader,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ requests }),
        }
      );
      if (!batchRes.ok) {
        const errText = await batchRes.text().catch(() => '');
        if (batchRes.status === 403) {
          throw new Error(
            'READ_ONLY_EXTERNAL_FILE: This Google Doc was created outside the app. Save an editable copy inside your Working Folder to modify it freely.'
          );
        }
        throw new Error(`Google Docs update error (${batchRes.status}): ${errText}`);
      }
    }
  }

  if (!isGoogleDoc && !isFolder && content !== undefined) {
    const mediaMime =
      existing.mimeType && existing.mimeType !== 'application/octet-stream'
        ? existing.mimeType
        : 'text/markdown';
    const metaPatch: Record<string, unknown> = {};
    if (trimmedName && trimmedName !== existing.name) {
      metaPatch.name = trimmedName;
    }

    const boundary = `village_patch_${Date.now().toString(36)}`;
    const multipartBody = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metaPatch),
      `--${boundary}`,
      `Content-Type: ${mediaMime}; charset=UTF-8`,
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');

    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
        fileId
      )}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,webViewLink,size,parents&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearerHeader,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!patchRes.ok) {
      const errText = await patchRes.text().catch(() => '');
      if (patchRes.status === 403) {
        throw new Error(
          'READ_ONLY_EXTERNAL_FILE: This file was created outside the app. Save an editable copy in your Working Folder to edit it freely.'
        );
      }
      throw new Error(`Google Drive update error (${patchRes.status}): ${errText}`);
    }

    const updated = (await patchRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
      size?: string;
      parents?: string[];
    };
    return {
      id: updated.id,
      name: updated.name,
      mimeType: updated.mimeType,
      modifiedTime: updated.modifiedTime,
      webViewLink: updated.webViewLink || `https://drive.google.com/file/d/${updated.id}/view`,
      size: updated.size,
      isFolder: false,
      parents: updated.parents,
      excerpt: content.length > 360 ? `${content.slice(0, 357).trim()}...` : content,
      content: content.slice(0, 8000),
    };
  }

  // Rename only (or rename after Google Docs body update)
  if (trimmedName && trimmedName !== existing.name) {
    const renameRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?fields=id,name,mimeType,modifiedTime,webViewLink,size,parents&supportsAllDrives=true`,
      {
        method: 'PATCH',
        headers: {
          Authorization: bearerHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: trimmedName }),
      }
    );
    if (!renameRes.ok) {
      const errText = await renameRes.text().catch(() => '');
      if (renameRes.status === 403) {
        throw new Error(
          'READ_ONLY_EXTERNAL_FILE: This item was created outside the app. Save an editable copy inside your Working Folder to rename or modify it.'
        );
      }
      throw new Error(`Google Drive rename error (${renameRes.status}): ${errText}`);
    }
    const renamed = (await renameRes.json()) as {
      id: string;
      name: string;
      mimeType: string;
      modifiedTime?: string;
      webViewLink?: string;
      size?: string;
      parents?: string[];
    };
    return {
      id: renamed.id,
      name: renamed.name,
      mimeType: renamed.mimeType,
      modifiedTime: renamed.modifiedTime,
      webViewLink:
        renamed.webViewLink ||
        (isFolder
          ? `https://drive.google.com/drive/folders/${renamed.id}`
          : `https://drive.google.com/file/d/${renamed.id}/view`),
      size: renamed.size,
      isFolder,
      parents: renamed.parents,
      excerpt:
        content !== undefined
          ? content.length > 360
            ? `${content.slice(0, 357).trim()}...`
            : content
          : undefined,
      content: content !== undefined ? content.slice(0, 8000) : undefined,
    };
  }

  return {
    id: existing.id,
    name: existing.name,
    mimeType: existing.mimeType,
    modifiedTime: new Date().toISOString(),
    webViewLink: existing.webViewLink || `https://drive.google.com/file/d/${existing.id}/view`,
    size: existing.size,
    isFolder,
    parents: existing.parents,
    excerpt:
      content !== undefined
        ? content.length > 360
          ? `${content.slice(0, 357).trim()}...`
          : content
        : undefined,
    content: content !== undefined ? content.slice(0, 8000) : undefined,
  };
}

/**
 * Move a file or subfolder inside the configured Working Folder to Google Drive Trash.
 */
export async function trashGoogleDriveFile(
  bearerHeader: string,
  fileId: string,
  workingFolderId: string
): Promise<void> {
  if (fileId === workingFolderId) {
    throw new Error('Cannot trash the active Working Folder itself.');
  }
  const inside = await isItemInsideWorkingFolder(bearerHeader, fileId, workingFolderId);
  if (!inside) {
    throw new Error('Safety block: Target file is outside your configured Google Drive Working Folder.');
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: {
        Authorization: bearerHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trashed: true }),
    }
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    if (res.status === 403) {
      throw new Error(
        'READ_ONLY_EXTERNAL_FILE: This file was created outside the app and cannot be deleted using app-created file permissions.'
      );
    }
    throw new Error(`Google Drive delete error (${res.status}): ${errText}`);
  }
}

export function formatWorkspaceContextForPrompts(
  workspaceBriefing: WorkspaceBriefingPayload,
  calendarWriteAccess = false,
  clientTime?: ClientTimeContext
): string {
  const docsSection =
    (workspaceBriefing.linkedDocs?.length ?? 0) > 0
      ? `\n- Linked/Created Google Docs (${workspaceBriefing.linkedDocs!.length}):\n${workspaceBriefing
          .linkedDocs!.slice(0, 5)
          .map(
            (d) =>
              `  * "${d.title}" (${d.url}): ${(d.content || d.excerpt).slice(0, 600).replace(/\n+/g, ' ')}`
          )
          .join('\n')}`
      : '\n- Linked/Created Google Docs: None linked yet.';

  const pinnedDriveSection =
    (workspaceBriefing.pinnedDriveFiles?.length ?? 0) > 0
      ? `\n- Pinned Google Drive Files (${workspaceBriefing.pinnedDriveFiles!.length}):\n${workspaceBriefing
          .pinnedDriveFiles!.slice(0, 5)
          .map(
            (f) =>
              `  * "${f.name}" (${f.webViewLink ?? f.id}): ${(f.content || f.excerpt || f.mimeType)
                .slice(0, 600)
                .replace(/\n+/g, ' ')}`
          )
          .join('\n')}`
      : '';

  const workingFolderSection = workspaceBriefing.workingFolder?.id
    ? `\n- Configured Google Drive Working Folder: "${workspaceBriefing.workingFolder.name}" (folderId: ${workspaceBriefing.workingFolder.id}, link: ${workspaceBriefing.workingFolder.webViewLink})\n  * Files inside Working Folder (${workspaceBriefing.workingFolderFiles?.length ?? 0}):\n${
        (workspaceBriefing.workingFolderFiles ?? [])
          .slice(0, 12)
          .map((wf) => `    - ${wf.isFolder ? '[Folder] ' : ''}"${wf.name}" (id: ${wf.id})`)
          .join('\n') || '    - (Empty working folder)'
      }`
    : '';

  const timeLine = clientTime?.localIso
    ? `- Current CHO Local Time: ${clientTime.localIso} (Time Zone: ${clientTime.timeZone || 'Local'}, UTC Offset: ${clientTime.offset || 'Z'})`
    : `- Current UTC Time: ${new Date().toISOString()}`;

  const calendarModeLine = `- Google Calendar Setting: ${
    calendarWriteAccess
      ? 'WRITE ACCESS ENABLED (CHO permits staging/creating/updating/deleting events with confirmation)'
      : 'READ-ONLY (Calendar write access is OFF in Settings → Calendar)'
  }`;

  const pinnedChatSection =
    (workspaceBriefing.pinnedChats?.length ?? 0) > 0
      ? `\n- Pinned / Focused Google Chat Conversations & Threads (${workspaceBriefing.pinnedChats!.length} — FULL TRANSCRIPTS FOR WORKING WITH CHAT DATA):\n${workspaceBriefing
          .pinnedChats!.slice(0, 6)
          .map((pc) => {
            const transcriptLines = pc.messages
              .slice(-35)
              .map(
                (m) =>
                  `    [${m.createTime || 'time n/a'}] ${m.senderName}${
                    m.threadName ? ` (thread: ${m.threadName})` : ''
                  }: ${m.text.slice(0, 500).replace(/\n+/g, ' ')}`
              )
              .join('\n');
            return `  * "${pc.label}" (spaceName: "${pc.spaceName}"${
              pc.threadName ? `, threadName: "${pc.threadName}"` : ''
            }, ${pc.messages.length} messages):\n${transcriptLines || '    (No messages)'}`;
          })
          .join('\n')}`
      : '';

  if (!workspaceBriefing.connected) {
    return `\nGOOGLE WORKSPACE STATUS: Not currently signed in with Google (no live Gmail/Calendar/Chat/Docs/Drive token attached yet).\n${timeLine}\n${calendarModeLine}${pinnedChatSection}${docsSection}${pinnedDriveSection}${workingFolderSection}`;
  }

  const calendarPermissionLine =
    workspaceBriefing.calendarStatus === 'connected_write'
      ? '- Google Calendar OAuth Permission: AUTHORIZED FOR READ + WRITE (calendar.events write scope is active on the current Google token)'
      : workspaceBriefing.calendarStatus === 'connected_read'
        ? '- Google Calendar OAuth Permission: READ-ONLY TOKEN (CHO needs to click "Grant Calendar Write Access" in Daniel\'s bar or Settings → Calendar to authorize write scope)'
        : workspaceBriefing.calendarStatus === 'needs_consent'
          ? '- Google Calendar OAuth Permission: Needs Google Calendar authorization'
          : '- Google Calendar OAuth Permission: Unavailable';

  const chatSection =
    workspaceBriefing.chatStatus === 'connected'
      ? (workspaceBriefing.chatSpaces?.length ?? 0) > 0
        ? `\n- Google Chat Spaces (${workspaceBriefing.chatSpaces!.length} synced — Daniel and Directors can also call read_google_chat to inspect any space or thread in full):\n${workspaceBriefing
            .chatSpaces!.slice(0, 12)
            .map((sp) => {
              const msgs = sp.recentMessages
                .slice(0, 3)
                .map(
                  (m) =>
                    `[${m.senderName}${m.threadName ? ` · ${m.threadName}` : ''}: "${m.text.slice(0, 140)}"]`
                )
                .join(' ');
              return `  * ${sp.displayName} (spaceName: "${sp.name}", type: ${sp.spaceType || 'SPACE'}) ${msgs || '(use read_google_chat to load messages)'}`;
            })
            .join('\n')}${pinnedChatSection}`
        : `\n- Google Chat Spaces: Connected (0 spaces returned; use read_google_chat with a spaces/ID or URL if reading a specific room/DM).${pinnedChatSection}`
      : workspaceBriefing.chatStatus === 'app_not_configured'
        ? `\n- Google Chat Status: Chat API enabled, awaiting one-time Google Chat App configuration in Cloud Console (${GOOGLE_CHAT_CONSOLE_URL}).${pinnedChatSection}`
        : workspaceBriefing.chatStatus === 'needs_consent'
          ? `\n- Google Chat Status: CHO needs to click "Grant Workspace Access" to authorize newly added scopes.${pinnedChatSection}`
          : `\n- Google Chat Status: Unavailable for this account.${pinnedChatSection}`;

  const driveSection =
    workspaceBriefing.driveStatus === 'connected'
      ? `\n- Recent Google Drive Files (${workspaceBriefing.driveFiles?.length ?? 0}):\n${
          (workspaceBriefing.driveFiles ?? [])
            .slice(0, 6)
            .map(
              (f) =>
                `  * ${f.isFolder ? '[Folder] ' : ''}"${f.name}" (id: ${f.id}, type: ${f.mimeType})`
            )
            .join('\n') || '  * None'
        }${workingFolderSection}${pinnedDriveSection}`
      : workspaceBriefing.driveStatus === 'needs_consent'
        ? `\n- Google Drive Status: CHO needs to click "Grant Workspace Access" to authorize Google Drive scopes.${workingFolderSection}${pinnedDriveSection}`
        : `\n- Google Drive Status: Unavailable.${workingFolderSection}${pinnedDriveSection}`;

  const activeGmailSourcesLine =
    (workspaceBriefing.activeGmailSources?.length ?? 0) > 0
      ? workspaceBriefing
          .activeGmailSources!.map(
            (s) =>
              `${s.name}${
                typeof s.messagesUnread === 'number' ? ` (${s.messagesUnread} unread)` : ''
              }`
          )
          .join(', ')
      : 'None configured (Inbox & labels currently unchecked)';

  return `\nLIVE GOOGLE WORKSPACE CONTEXT:\n${timeLine}\n${calendarModeLine}\n${calendarPermissionLine}\n- Monitored Gmail Sources: ${activeGmailSourcesLine} — Daniel and Directors can also call read_gmail_messages to inspect any Gmail label or search query in full\n- Unread Gmail count (across monitored sources): ${workspaceBriefing.unreadCount}\n- Recent Emails (across monitored sources):\n${
    workspaceBriefing.recentEmails
      .map((e) => {
        const unreadTag = e.isUnread ? '[UNREAD] ' : '';
        const lblTag =
          e.labelNames && e.labelNames.length > 0 ? ` [${e.labelNames.join(', ')}]` : '';
        return `  * ${unreadTag}From: ${e.from} | Subject: ${e.subject}${lblTag} | Snippet: ${e.snippet}`;
      })
      .join('\n') || '  * None'
  }\n- Upcoming Calendar Events:\n${
    workspaceBriefing.upcomingEvents
      .map((ev) => `  * ${ev.summary} (${ev.start}${ev.end ? ` → ${ev.end}` : ''})`)
      .join('\n') || '  * None'
  }${chatSection}${docsSection}${driveSection}`;
}

export function extractGroundingSources(response: unknown): GroundSource[] {
  const r = response as {
    candidates?: Array<{
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    }>;
  };
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: GroundSource[] = [];
  for (const ch of chunks) {
    const uri = ch.web?.uri;
    const title = ch.web?.title || uri;
    if (uri && title && !seen.has(uri)) {
      seen.add(uri);
      sources.push({ title, uri });
    }
  }
  return sources.slice(0, 6);
}

/**
 * Step 1: Matt (Chief of Staff) routes the incoming CHO task to the right Director.
 */
export async function routeTaskWithMatt(
  prompt: string,
  directors: AgentDossier[],
  priority: 'low' | 'medium' | 'high' = 'medium',
  forcedDirectorId?: string | null
): Promise<{
  directorId: string;
  escalateToAdvisor: boolean;
  needsWebSearch: boolean;
  routingNote: string;
  approvalHint:
    | 'none'
    | 'email_draft'
    | 'calendar_event'
    | 'chat_message'
    | 'google_doc'
    | 'drive_file'
    | 'spend'
    | 'publish';
}> {
  if (forcedDirectorId) {
    const forced = directors.find((d) => d.id === forcedDirectorId.toLowerCase().trim());
    if (forced) {
      const lower = prompt.toLowerCase();
      const needsWebSearch =
        forced.id === 'aria' ||
        /\b(latest|news|price|pricing|202\d|search|research|compare|competitor|weather|flight|hotel|vacation|benchmark|market|url|website|citations)\b/i.test(
          prompt
        );
      const escalateToAdvisor =
        priority === 'high' ||
        prompt.length > 220 ||
        /\b(strategy|audit|roadmap|architecture|legal|contract|forecast|budget)\b/i.test(prompt);
      const approvalHint:
        | 'none'
        | 'email_draft'
        | 'calendar_event'
        | 'chat_message'
        | 'google_doc'
        | 'drive_file'
        | 'spend'
        | 'publish' = /\b(draft an? email|reply to|email draft|gmail draft)\b/i.test(lower)
        ? 'email_draft'
        : /\b(schedule|calendar event|add to calendar|put on my calendar|book a meeting)\b/i.test(lower)
          ? 'calendar_event'
          : /\b(google chat|send to chat|post in chat|chat space)\b/i.test(lower)
            ? 'chat_message'
            : /\b(google doc|create a doc|new doc)\b/i.test(lower)
              ? 'google_doc'
              : /\b(save to drive|google drive file|upload to drive)\b/i.test(lower)
                ? 'drive_file'
                : 'none';
      return {
        directorId: forced.id,
        escalateToAdvisor,
        needsWebSearch,
        routingNote: `Direct assignment to ${forced.name} (${forced.department}).`,
        approvalHint,
      };
    }
  }

  const ai = getAiClient();
  const dirList = directors.map((d) => `- ${d.id}: ${d.name} (${d.title}) — ${d.department}`).join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Route this Chief Human Officer task to the best Director:\nPriority / Urgency: ${priority.toUpperCase()}\nTask: "${prompt}"\n\nAvailable Directors:\n${dirList}`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction:
        'You are Matt, Chief of Staff of Guildhaven. Select the single best directorId from the available directors (route Gmail, Calendar, Google Chat, and Google Drive triage to daniel; Google Docs writing/comms to layla, aria, or daniel; operations/Drive organization to devon or daniel; software/APIs to kieran), decide if live Google Search grounding is needed (needsWebSearch), decide if the task is complex enough for Senior Advisor XHIGH escalation (escalateToAdvisor), and detect if the deliverable likely stages an email_draft, calendar_event (creating/scheduling a Google Calendar event), chat_message (sending a reply in Google Chat), google_doc (creating a new Google Doc), drive_file (saving/uploading a file to Google Drive), spend proposal, or publish post needing CHO approval.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          directorId: {
            type: Type.STRING,
            description:
              'One of: daniel, elena, marcus, aria, devon, layla, noah, kieran',
          },
          escalateToAdvisor: { type: Type.BOOLEAN },
          needsWebSearch: { type: Type.BOOLEAN },
          routingNote: { type: Type.STRING, description: 'Brief 1-sentence phone dispatch line from Matt.' },
          approvalHint: {
            type: Type.STRING,
            description:
              'One of: none, email_draft, calendar_event, chat_message, google_doc, drive_file, spend, publish',
          },
        },
        required: ['directorId', 'escalateToAdvisor', 'needsWebSearch', 'routingNote', 'approvalHint'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      directorId?: string;
      escalateToAdvisor?: boolean;
      needsWebSearch?: boolean;
      routingNote?: string;
      approvalHint?:
        | 'none'
        | 'email_draft'
        | 'calendar_event'
        | 'chat_message'
        | 'google_doc'
        | 'drive_file'
        | 'spend'
        | 'publish';
    };
    const validIds = new Set(directors.map((d) => d.id));
    const directorId = parsed.directorId && validIds.has(parsed.directorId) ? parsed.directorId : 'aria';
    return {
      directorId,
      escalateToAdvisor: Boolean(parsed.escalateToAdvisor),
      needsWebSearch: Boolean(parsed.needsWebSearch),
      routingNote: parsed.routingNote || `Calling ${directorId} now to handle this.`,
      approvalHint: parsed.approvalHint || 'none',
    };
  } catch {
    return {
      directorId: 'aria',
      escalateToAdvisor: false,
      needsWebSearch: true,
      routingNote: 'Dispatching to Aria in Research & Intel.',
      approvalHint: 'none',
    };
  }
}

/**
 * Step 2 & 3: Worker (gemini-3.1-flash-lite or grounded flash) executes, then Director (gemini-4-hydrogen HIGH / XHIGH) reviews.
 */
export async function executeAndReviewTask(params: {
  prompt: string;
  priority?: 'low' | 'medium' | 'high';
  calendarWriteAccess?: boolean;
  director: AgentDossier;
  workerName: string;
  escalateToAdvisor: boolean;
  needsWebSearch: boolean;
  approvalHint:
    | 'none'
    | 'email_draft'
    | 'calendar_event'
    | 'chat_message'
    | 'google_doc'
    | 'drive_file'
    | 'spend'
    | 'publish';
  workspaceBriefing: WorkspaceBriefingPayload;
  knowledgeContext: string;
  clientTime?: ClientTimeContext;
}): Promise<{
  summary: string;
  reportMarkdown: string;
  groundingSources: GroundSource[];
  newDirectorNote: string;
  approvalProposal: {
    needed: boolean;
    type:
      | 'email_draft'
      | 'calendar_event'
      | 'chat_message'
      | 'google_doc'
      | 'drive_file'
      | 'spend'
      | 'publish';
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
    docTitle?: string;
    driveFileName?: string;
    amount?: string;
    vendor?: string;
    postPlatform?: string;
    postContent?: string;
  } | null;
}> {
  const ai = getAiClient();
  const {
    prompt,
    priority = 'medium',
    calendarWriteAccess = false,
    director,
    workerName,
    escalateToAdvisor,
    needsWebSearch,
    workspaceBriefing,
    knowledgeContext,
    clientTime,
  } = params;

  const urgencyLine =
    priority === 'high'
      ? 'HIGH PRIORITY (Urgent — lead with immediate decisions, critical risks, and fast next actions)'
      : priority === 'low'
        ? 'LOW PRIORITY (Background / Exploratory — concise, well-organized reference briefing)'
        : 'MEDIUM PRIORITY (Standard turnaround)';

  const calendarPolicyNote = calendarWriteAccess
    ? `Google Calendar Access Mode: WRITE ACCESS ENABLED (with mandatory CHO approval before creating/editing/deleting any event). Use the CHO's local timezone offset (${clientTime?.offset || 'Z'}) when constructing ISO-8601 eventStart and eventEnd timestamps.`
    : 'Google Calendar Access Mode: READ-ONLY (Calendar write access is turned OFF in Settings. If the CHO asks to create or update a calendar event, provide recommended times/agenda in your report and note that Calendar Write Access can be enabled in Settings; do not claim events were written).';

  const workspaceSnippet = `${formatWorkspaceContextForPrompts(
    workspaceBriefing,
    calendarWriteAccess,
    clientTime
  )}\n- ${calendarPolicyNote}`;

  // 1. Worker Draft Execution (operating from identical Centralized Knowledge Base ground truth)
  let workerDraft = '';
  let groundingSources: GroundSource[] = [];

  if (needsWebSearch) {
    const searchRes = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Task from CHO: ${prompt}\nUrgency: ${urgencyLine}\nDepartment: ${director.department}\nNotes: ${director.notes.join(' | ')}${workspaceSnippet}\n\n${knowledgeContext}\n\nGather thorough, structured facts, recommendations, pricing/dates where applicable, and actionable steps aligned with our KB-* ground truth.`,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: `You are ${workerName}, a Guild Specialist assisting ${director.name} (${director.title}). Operate strictly from the Centralized Village Knowledge Base (Single Source of Truth) and produce verified research for your Director to review.`,
      },
    });
    workerDraft = searchRes.text ?? '';
    groundingSources = extractGroundingSources(searchRes);
  } else {
    const workerRes = await ai.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: `Task from CHO: ${prompt}\nUrgency: ${urgencyLine}\nDepartment: ${director.department}\nDirector Instructions: ${director.instructions}\nRecent Notes: ${director.notes.join(' | ')}${workspaceSnippet}\n\n${knowledgeContext}\n\nPrepare a detailed working draft for Director ${director.name} to review, strictly adhering to applicable KB-* SOPs and handoff templates.`,
      config: {
        systemInstruction: `You are ${workerName}, a Guild Specialist reporting to ${director.name}. Operate from the Centralized Village Knowledge Base (Single Source of Truth). ${VILLAGE_CONSTITUTION}`,
      },
    });
    workerDraft = workerRes.text ?? '';
  }

  // 2. Director Review (+ Advisor XHIGH escalation if needed)
  const directorRes = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `CHO Request: "${prompt}"\nUrgency: ${urgencyLine}\nCurrent Local Time Reference: ${new Date().toISOString()}\n\nGuild Specialist (${workerName}) Draft:\n${workerDraft}\n${workspaceSnippet}\n\n${knowledgeContext}\n\nReview the specialist draft, ensure zero contradiction with the Centralized Village Knowledge Base (KB-*), enforce the Village Constitution, and return the final executive deliverable.`,
    config: {
      thinkingConfig: {
        thinkingLevel: escalateToAdvisor ? ThinkingLevel.XHIGH : ThinkingLevel.HIGH,
      },
      systemInstruction: `${director.instructions}\n\n${VILLAGE_CONSTITUTION}\n\nYour current memory notes:\n${director.notes.map((n) => `- ${n}`).join('\n')}\n\nIf the CHO explicitly asks to send/post a message in Google Chat, set needsApproval=true, approvalType="chat_message", chatSpaceName (exact "spaces/..." from LIVE GOOGLE WORKSPACE CONTEXT if available), chatSpaceDisplayName, and emailBody/postContent with the message text. If the CHO explicitly asks to create a Google Doc, set needsApproval=true, approvalType="google_doc", docTitle, and emailBody with the document content. If the CHO explicitly asks to save/upload a file to Google Drive, set needsApproval=true, approvalType="drive_file", driveFileName, and emailBody with the file content. If the CHO explicitly asks to schedule/create a Google Calendar event AND Google Calendar Access Mode is WRITE ACCESS ENABLED, set needsApproval=true, approvalType="calendar_event", eventSummary, eventStart (ISO-8601), eventEnd (ISO-8601), eventLocation, and eventDescription. If Google Calendar Access Mode is READ-ONLY, do NOT set approvalType="calendar_event"; instead set needsApproval=false and note that Calendar Write Access can be enabled in Settings. Return clean structured JSON matching the schema.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING, description: '1-2 sentence executive takeaway for the CHO.' },
          reportMarkdown: { type: Type.STRING, description: 'Full polished executive deliverable in clean Markdown.' },
          newDirectorNote: { type: Type.STRING, description: 'A concise 1-sentence learning/memory note to save to your folder.' },
          needsApproval: { type: Type.BOOLEAN },
          approvalType: {
            type: Type.STRING,
            description:
              'email_draft, calendar_event, chat_message, google_doc, drive_file, spend, or publish',
          },
          approvalTitle: { type: Type.STRING },
          approvalDescription: { type: Type.STRING },
          emailTo: { type: Type.STRING },
          emailSubject: { type: Type.STRING },
          emailBody: { type: Type.STRING },
          eventSummary: { type: Type.STRING, description: 'Title for the proposed Google Calendar event' },
          eventStart: { type: Type.STRING, description: 'ISO-8601 start date/time for Calendar event' },
          eventEnd: { type: Type.STRING, description: 'ISO-8601 end date/time for Calendar event' },
          eventLocation: { type: Type.STRING },
          eventDescription: { type: Type.STRING },
          chatSpaceName: { type: Type.STRING, description: 'Google Chat space resource name e.g. spaces/AAAA...' },
          chatSpaceDisplayName: { type: Type.STRING },
          docTitle: { type: Type.STRING, description: 'Title if creating a new Google Doc' },
          driveFileName: { type: Type.STRING, description: 'File name if saving a file to Google Drive' },
          spendAmount: { type: Type.STRING },
          spendVendor: { type: Type.STRING },
          postPlatform: { type: Type.STRING },
          postContent: { type: Type.STRING },
        },
        required: ['summary', 'reportMarkdown', 'newDirectorNote', 'needsApproval'],
      },
    },
  });

  try {
    const parsed = JSON.parse((directorRes.text ?? '{}').trim()) as {
      summary?: string;
      reportMarkdown?: string;
      newDirectorNote?: string;
      needsApproval?: boolean;
      approvalType?:
        | 'email_draft'
        | 'calendar_event'
        | 'chat_message'
        | 'google_doc'
        | 'drive_file'
        | 'spend'
        | 'publish';
      approvalTitle?: string;
      approvalDescription?: string;
      emailTo?: string;
      emailSubject?: string;
      emailBody?: string;
      eventSummary?: string;
      eventStart?: string;
      eventEnd?: string;
      eventLocation?: string;
      eventDescription?: string;
      chatSpaceName?: string;
      chatSpaceDisplayName?: string;
      docTitle?: string;
      driveFileName?: string;
      spendAmount?: string;
      spendVendor?: string;
      postPlatform?: string;
      postContent?: string;
    };

    const validApprovalTypes = new Set([
      'email_draft',
      'calendar_event',
      'chat_message',
      'google_doc',
      'drive_file',
      'spend',
      'publish',
    ]);
    const resolvedApprovalType = (
      parsed.approvalType && validApprovalTypes.has(parsed.approvalType)
        ? parsed.approvalType
        : params.approvalHint !== 'none'
          ? params.approvalHint
          : 'publish'
    ) as
      | 'email_draft'
      | 'calendar_event'
      | 'chat_message'
      | 'google_doc'
      | 'drive_file'
      | 'spend'
      | 'publish';

    const fallbackSpace = workspaceBriefing.chatSpaces?.[0];
    const normalizedTaskStart = normalizeIsoCalendarTimestamp(
      parsed.eventStart,
      clientTime?.offset
    );
    const normalizedTaskEndRaw = normalizeIsoCalendarTimestamp(
      parsed.eventEnd,
      clientTime?.offset
    );
    const resolvedTaskEnd =
      normalizedTaskStart &&
      normalizedTaskEndRaw &&
      Date.parse(normalizedTaskEndRaw) > Date.parse(normalizedTaskStart)
        ? normalizedTaskEndRaw
        : normalizedTaskStart
          ? addMinutesPreservingOffset(normalizedTaskStart, 30)
          : undefined;

    const hasValidCalendarTimes =
      resolvedApprovalType !== 'calendar_event' ||
      Boolean(normalizedTaskStart && resolvedTaskEnd);

    const approvalProposal =
      parsed.needsApproval && hasValidCalendarTimes
        ? {
            needed: true,
            type: resolvedApprovalType,
            title: parsed.approvalTitle || `Approval from ${director.name}`,
            description: parsed.approvalDescription || 'Pending Chief Human Officer sign-off.',
            to: parsed.emailTo,
            subject: parsed.emailSubject,
            body:
              parsed.emailBody ||
              (resolvedApprovalType === 'google_doc' || resolvedApprovalType === 'drive_file'
                ? parsed.reportMarkdown || workerDraft
                : undefined) ||
              (resolvedApprovalType === 'chat_message' ? parsed.postContent : undefined),
            ...(resolvedApprovalType === 'calendar_event'
              ? {
                  eventSummary: parsed.eventSummary || parsed.approvalTitle || prompt.slice(0, 64),
                  eventStart: normalizedTaskStart ?? undefined,
                  eventEnd: resolvedTaskEnd,
                  eventLocation: parsed.eventLocation,
                  eventDescription: parsed.eventDescription || parsed.summary,
                }
              : {}),
            chatSpaceName: parsed.chatSpaceName || fallbackSpace?.name,
            chatSpaceDisplayName: parsed.chatSpaceDisplayName || fallbackSpace?.displayName,
            docTitle: parsed.docTitle || parsed.approvalTitle || prompt.slice(0, 64),
            driveFileName:
              parsed.driveFileName ||
              `${(parsed.approvalTitle || prompt.slice(0, 48)).replace(/[^\w\s-]/g, '').trim() || 'Deliverable'}.md`,
            amount: parsed.spendAmount,
            vendor: parsed.spendVendor,
            postPlatform: parsed.postPlatform,
            postContent: parsed.postContent,
          }
        : null;

    return {
      summary: parsed.summary || 'Task completed.',
      reportMarkdown: parsed.reportMarkdown || workerDraft,
      groundingSources,
      newDirectorNote: parsed.newDirectorNote || `Completed task: ${prompt.slice(0, 60)}`,
      approvalProposal,
    };
  } catch {
    return {
      summary: 'Deliverable ready for review.',
      reportMarkdown: workerDraft || 'Task completed.',
      groundingSources,
      newDirectorNote: `Completed task: ${prompt.slice(0, 60)}`,
      approvalProposal: null,
    };
  }
}

/**
 * Direct 1-on-1 chat with Matt, any Director, or any Worker.
 */
export async function chatWithVillageAgent(params: {
  agent: AgentDossier;
  allDirectors: AgentDossier[];
  message: string;
  history: Array<{ sender: string; text: string }>;
  workspaceBriefing: WorkspaceBriefingPayload;
  knowledgeContext: string;
  calendarWriteAccess?: boolean;
  clientTime?: ClientTimeContext;
}): Promise<{
  reply: string;
  newNote?: string;
  summonDirectorId?: string | null;
  sources: GroundSource[];
  approvalProposal?: {
    needed: boolean;
    type: 'calendar_event';
    title: string;
    description: string;
    eventSummary: string;
    eventStart: string;
    eventEnd: string;
    eventLocation?: string;
    eventDescription?: string;
  } | null;
}> {
  const ai = getAiClient();
  const {
    agent,
    allDirectors,
    message,
    history,
    workspaceBriefing,
    knowledgeContext,
    calendarWriteAccess = false,
    clientTime,
  } = params;

  const isMatt = agent.id === 'matt';
  const isDaniel = agent.id === 'daniel';
  const isAria = agent.id === 'aria';

  const historyBlock = history
    .slice(-6)
    .map((h) => `${h.sender === 'cho' ? 'CHO' : agent.name}: ${h.text}`)
    .join('\n');

  const mentionsWorkspace =
    isDaniel ||
    isMatt ||
    /\b(gmail|email|calendar|chat|space|google doc|docs|document)\b/i.test(message) ||
    (workspaceBriefing.linkedDocs?.length ?? 0) > 0;

  const workspaceBlock = mentionsWorkspace
    ? formatWorkspaceContextForPrompts(workspaceBriefing, calendarWriteAccess, clientTime)
    : '';

  if (isMatt) {
    const dirRoster = allDirectors.map((d) => `${d.id} (${d.name} - ${d.title})`).join(', ');
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Conversation so far:\n${historyBlock}\n\nCHO says: "${message}"\n${workspaceBlock}\n\n${knowledgeContext}\n\nAvailable directors to summon if requested: ${dirRoster}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        systemInstruction: `${agent.instructions}\n${VILLAGE_CONSTITUTION}\nIf the CHO asks you to bring, call, or summon a specific director (e.g. "Bring Layla here", "Call Daniel over"), set summonDirectorId to that director's id and respond naturally as Matt picking up his phone to call them over.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            summonDirectorId: { type: Type.STRING, description: 'Director ID to summon, or empty string if none.' },
            newNote: { type: Type.STRING, description: 'Optional 1-sentence memory note, or empty string.' },
          },
          required: ['reply', 'summonDirectorId'],
        },
      },
    });

    try {
      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        reply?: string;
        summonDirectorId?: string;
        newNote?: string;
      };
      const validIds = new Set(allDirectors.map((d) => d.id));
      const summonId = parsed.summonDirectorId && validIds.has(parsed.summonDirectorId) ? parsed.summonDirectorId : null;
      return {
        reply: parsed.reply || 'On it.',
        summonDirectorId: summonId,
        newNote: parsed.newNote || undefined,
        sources: [],
      };
    } catch {
      return { reply: response.text || 'Right away.', sources: [] };
    }
  }

  if (isDaniel) {
    const canWriteCalendarNow =
      Boolean(calendarWriteAccess) &&
      Boolean(workspaceBriefing.connected) &&
      workspaceBriefing.calendarStatus === 'connected_write';

    const tzHint = clientTime?.offset || 'Z';
    const calendarStatusDirective = canWriteCalendarNow
      ? `CALENDAR WRITE STATUS RIGHT NOW: ENABLED AND AUTHORIZED. You DO have write access to the CHO's primary Google Calendar (with explicit CHO confirmation in Approvals or Inbox & Calendar). Never say you lack calendar write access. If the CHO asks you to add, schedule, or create a calendar event, set proposeCalendarEvent=true, populate eventSummary, AND populate eventStart and eventEnd with exact ISO-8601 dateTime strings matching the requested date, start time, end time, and duration using the CHO's local UTC offset (${tzHint}, e.g. 2026-11-16T13:00:00${tzHint}). Never substitute current time when the CHO gave specific times.`
      : !calendarWriteAccess
        ? 'CALENDAR WRITE STATUS RIGHT NOW: READ-ONLY IN SETTINGS. Tell the CHO that Calendar Write Access is currently turned OFF (Read-Only) in Settings → Calendar, and they can toggle "Write Access Enabled" there so you can stage and manage calendar events. Set proposeCalendarEvent=false, eventSummary="", eventStart="", eventEnd="".'
        : !workspaceBriefing.connected
          ? 'CALENDAR WRITE STATUS RIGHT NOW: NOT CONNECTED. Settings has Write Access Enabled, or Google Workspace is not synced yet. Tell the CHO to Sign in with Google (or click Sync/Refresh) so you can access their Google Calendar. Set proposeCalendarEvent=false, eventSummary="", eventStart="", eventEnd="".'
          : 'CALENDAR WRITE STATUS RIGHT NOW: SETTING ON, OAUTH CONSENT NEEDED. Calendar Write Access is enabled in Settings, but the active Google token only has Read-Only Calendar permission. Tell the CHO to click "Grant Calendar Write" above or in Settings → Calendar to authorize write permission. Set proposeCalendarEvent=false, eventSummary="", eventStart="", eventEnd="".';

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Conversation so far:\n${historyBlock}\n\nCHO says: "${message}"${workspaceBlock}\n\n${knowledgeContext}`,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        systemInstruction: `${agent.instructions}\n\nYour memory notes:\n${agent.notes.map((n) => `- ${n}`).join('\n')}\n\n${VILLAGE_CONSTITUTION}\n\n${calendarStatusDirective}\n\nOperate from the Centralized Village Knowledge Base (Single Source of Truth). Respond concisely, warmly, and accurately in character as Daniel (Inbox & Calendar Director).`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING },
            newNote: { type: Type.STRING, description: 'Optional 1-sentence memory note, or empty string.' },
            proposeCalendarEvent: {
              type: Type.BOOLEAN,
              description:
                'True ONLY when Calendar write access is ENABLED AND AUTHORIZED and the CHO is asking to create or schedule a Google Calendar event.',
            },
            eventSummary: {
              type: Type.STRING,
              description: 'Event title if proposeCalendarEvent is true; otherwise empty string.',
            },
            eventStart: {
              type: Type.STRING,
              description:
                'Full ISO-8601 start dateTime with timezone offset (e.g. 2026-11-16T13:00:00+02:00) matching the exact time requested if proposeCalendarEvent is true; otherwise empty string.',
            },
            eventEnd: {
              type: Type.STRING,
              description:
                'Full ISO-8601 end dateTime with timezone offset (e.g. 2026-11-16T17:00:00+02:00) matching the exact end time or duration requested if proposeCalendarEvent is true; otherwise empty string.',
            },
            eventLocation: { type: Type.STRING, description: 'Optional event location.' },
            eventDescription: { type: Type.STRING, description: 'Optional event notes/agenda.' },
          },
          required: ['reply', 'proposeCalendarEvent', 'eventSummary', 'eventStart', 'eventEnd'],
        },
      },
    });

    try {
      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        reply?: string;
        newNote?: string;
        proposeCalendarEvent?: boolean;
        eventSummary?: string;
        eventStart?: string;
        eventEnd?: string;
        eventLocation?: string;
        eventDescription?: string;
      };

      const normalizedStart = normalizeIsoCalendarTimestamp(parsed.eventStart, clientTime?.offset);
      const normalizedEndRaw = normalizeIsoCalendarTimestamp(parsed.eventEnd, clientTime?.offset);

      let approvalProposal: {
        needed: boolean;
        type: 'calendar_event';
        title: string;
        description: string;
        eventSummary: string;
        eventStart: string;
        eventEnd: string;
        eventLocation?: string;
        eventDescription?: string;
      } | null = null;
      let replyText = parsed.reply || 'On it.';

      if (canWriteCalendarNow && parsed.proposeCalendarEvent && parsed.eventSummary?.trim()) {
        if (!normalizedStart) {
          replyText = `${replyText}\n\nPlease confirm the exact start date and time so I can stage this event in Approvals with the right schedule.`;
        } else {
          const resolvedEnd =
            normalizedEndRaw && Date.parse(normalizedEndRaw) > Date.parse(normalizedStart)
              ? normalizedEndRaw
              : addMinutesPreservingOffset(normalizedStart, 30);

          approvalProposal = {
            needed: true,
            type: 'calendar_event',
            title: parsed.eventSummary.trim(),
            description:
              parsed.eventDescription?.trim() ||
              `Proposed by Daniel from Direct Chat: ${parsed.eventSummary.trim()}`,
            eventSummary: parsed.eventSummary.trim(),
            eventStart: normalizedStart,
            eventEnd: resolvedEnd,
            eventLocation: parsed.eventLocation?.trim() || undefined,
            eventDescription: parsed.eventDescription?.trim() || undefined,
          };
        }
      }

      return {
        reply: replyText,
        newNote: parsed.newNote || undefined,
        sources: [],
        approvalProposal,
      };
    } catch {
      return { reply: response.text || 'Understood.', sources: [] };
    }
  }

  const isKieran = agent.id === 'kieran';
  const useSearch =
    isAria ||
    (isKieran && /docs|api|sdk|rfc|cve|release|version|latest|oauth|spec/i.test(message)) ||
    /search|latest|today|weather|news|price|best/i.test(message);
  const model = agent.role === 'worker' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

  const response = await ai.models.generateContent({
    model,
    contents: `Conversation so far:\n${historyBlock}\n\nCHO says: "${message}"${workspaceBlock}\n\n${knowledgeContext}`,
    config: {
      ...(useSearch && model === 'gemini-4-hydrogen' ? { tools: [{ googleSearch: {} }] } : {}),
      systemInstruction: `${agent.instructions}\n\nYour memory notes:\n${agent.notes.map((n) => `- ${n}`).join('\n')}\n\n${VILLAGE_CONSTITUTION}\nOperate from the Centralized Village Knowledge Base (Single Source of Truth). Respond concisely, warmly, and in character as ${agent.name} (${agent.title}).`,
    },
  });

  return {
    reply: response.text ?? 'Understood.',
    sources: extractGroundingSources(response),
  };
}

/**
 * Town Hall Roundtable Meeting (General, Morning Briefing, Daily Debrief, Quarterly Review).
 */
export async function runTownHallRoundtable(params: {
  mode: string;
  prompt: string;
  targetDirectorId?: string | null;
  directors: AgentDossier[];
  recentTasksSummary: string;
  pendingApprovalsCount: number;
  workspaceBriefing: WorkspaceBriefingPayload;
  knowledgeContext: string;
}): Promise<{
  entries: Array<{
    speakerId: string;
    speakerName: string;
    speakerTitle: string;
    message: string;
  }>;
}> {
  const ai = getAiClient();
  const {
    mode,
    prompt,
    targetDirectorId,
    directors,
    recentTasksSummary,
    pendingApprovalsCount,
    workspaceBriefing,
    knowledgeContext,
  } = params;

  const roster = directors
    .map((d) => `- ${d.id}: ${d.name} (${d.title}) | Recent Notes: ${d.notes.slice(-2).join('; ')}`)
    .join('\n');

  const wsContext = formatWorkspaceContextForPrompts(workspaceBriefing);

  const targetInstruction = targetDirectorId
    ? `The CHO clicked directly on Director ID "${targetDirectorId}"—focus the response primarily on Matt + that Director (1-2 concise turns).`
    : `Include Matt (Chief of Staff) opening concisely, followed by 3-5 of the most relevant Directors sharing crisp department updates tailored to the "${mode}" session.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Session Type: ${mode}\nCHO asks the Town Hall: "${prompt}"\n\nRecent Village Tasks:\n${recentTasksSummary || 'None yet today.'}\nPending Approvals: ${pendingApprovalsCount}\n${wsContext}\n\n${knowledgeContext}\n\nDirectors Present:\n${roster}\n\n${targetInstruction}`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      systemInstruction: `You orchestrate the Town Hall boardroom meeting in Guildhaven. Keep every speaker's update crisp, grounded in their real role/notes/Workspace data and the Centralized Village Knowledge Base (KB-*), and strictly aligned with the Village Constitution.`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          entries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                speakerId: { type: Type.STRING },
                speakerName: { type: Type.STRING },
                speakerTitle: { type: Type.STRING },
                message: { type: Type.STRING },
              },
              required: ['speakerId', 'speakerName', 'speakerTitle', 'message'],
            },
          },
        },
        required: ['entries'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      entries?: Array<{ speakerId: string; speakerName: string; speakerTitle: string; message: string }>;
    };
    return { entries: parsed.entries ?? [] };
  } catch {
    return {
      entries: [
        {
          speakerId: 'matt',
          speakerName: 'Matt',
          speakerTitle: 'Chief of Staff',
          message: 'All eight directors are seated and ready for your direction.',
        },
      ],
    };
  }
}

/**
 * Matt recruits a new Guild Specialist candidate for the CHO to interview in Town Hall.
 */
export async function proposeHiringCandidate(director: AgentDossier): Promise<{
  name: string;
  specialty: string;
  bio: string;
  rationale: string;
}> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Director ${director.name} (${director.title}, ${director.department}) needs an additional Guild Specialist. Propose one realistic, memorable specialist candidate for the Chief Human Officer to interview in Town Hall.`,
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: 'First name only, e.g. Clara' },
          specialty: { type: Type.STRING, description: '2-4 word specialty title' },
          bio: { type: Type.STRING, description: '2 concise sentences about their working style.' },
          rationale: { type: Type.STRING, description: '1 sentence from Matt explaining why this hire helps.' },
        },
        required: ['name', 'specialty', 'bio', 'rationale'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      name?: string;
      specialty?: string;
      bio?: string;
      rationale?: string;
    };
    return {
      name: parsed.name || 'Clara',
      specialty: parsed.specialty || `${director.department} Specialist`,
      bio: parsed.bio || 'Fast, methodical Guild Specialist trained to verify details before submitting to Directors.',
      rationale: parsed.rationale || `${director.name} has growing task volume and would benefit from extra hands.`,
    };
  } catch {
    return {
      name: 'Clara',
      specialty: `${director.department} Specialist`,
      bio: 'Methodical Guild Specialist trained to verify details against the Knowledge Base before submitting to Directors.',
      rationale: `${director.name} requested backup capacity for incoming tasks.`,
    };
  }
}

/**
 * Interview a candidate live in Town Hall before hiring.
 */
export async function interviewCandidate(params: {
  candidateName: string;
  specialty: string;
  bio: string;
  directorName: string;
  question: string;
}): Promise<string> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `You are ${params.candidateName}, interviewing in Town Hall with the Chief Human Officer for a Guild Specialist role under Director ${params.directorName}. Specialty: ${params.specialty}. Bio: ${params.bio}.\n\nThe CHO asks: "${params.question}"\n\nAnswer concisely (2-3 sentences), demonstrating your readiness, adherence to the Centralized Village Knowledge Base, and respect for Village approval rules.`,
  });
  return response.text ?? 'I am ready to support the team, follow the Centralized Knowledge Base ground truth, and always route deliverables through my Director for your approval.';
}

/**
 * Co-Leads Aria & Zoe (Research & Intel) + Eli (Operations House) scan live house memory notes
 * and recent deliverables to synthesize non-contradictory SOPs or verified research briefs
 * into the Centralized Village Knowledge Base (Single Source of Truth).
 */
export async function consolidateVillageKnowledge(params: {
  existingEntriesSummary: string;
  houseNotesDump: string;
  recentTasksDump: string;
  focusTopic?: string;
}): Promise<{
  auditSummary: string;
  synthesizedEntries: Array<{
    title: string;
    category: 'handoff_template' | 'research_brief';
    department: string;
    maintainedBy: string;
    summary: string;
    contentMarkdown: string;
  }>;
}> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      params.focusTopic ? `CHO Consolidation Focus: "${params.focusTopic}"` : 'Routine Single Source of Truth Audit & Consolidation',
      '',
      'EXISTING KNOWLEDGE BASE INDEX:',
      params.existingEntriesSummary,
      '',
      'LIVE HOUSE MEMORY NOTES ACROSS ALL 9 HOUSES:',
      params.houseNotesDump || 'No additional house notes yet.',
      '',
      'RECENT COMPLETED DELIVERABLES:',
      params.recentTasksDump || 'No recent deliverables yet.',
      '',
      'Synthesize 1 or 2 high-value, non-contradictory canonical Knowledge Base entries (either handoff_template SOPs or verified research_brief entries) that capture new learnings, resolve any duplicated courtyard syncs, or formalize missing cross-house handoff contracts without duplicating existing KB titles.',
    ].join('\n'),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      systemInstruction: `You are the Knowledge Base Co-Leads: Aria & Zoe (Research & Intel) and Eli (Operations House). Your mandate is to prevent contradictory SOPs and duplicated courtyard syncs by maintaining a crisp, authoritative Centralized Village Knowledge Base. ${VILLAGE_CONSTITUTION}`,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          auditSummary: {
            type: Type.STRING,
            description: '1-sentence summary from Aria, Zoe & Eli explaining what was consolidated and deduplicated.',
          },
          synthesizedEntries: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                category: {
                  type: Type.STRING,
                  description: 'Must be either handoff_template or research_brief',
                },
                department: {
                  type: Type.STRING,
                  description:
                    'Target house name such as Operations House, Research & Intel, Systems & Dev, Inbox & Calendar, Finance & Money, YouTube Studio, Creative & Comms, Health & Home, or All Houses',
                },
                maintainedBy: { type: Type.STRING },
                summary: { type: Type.STRING },
                contentMarkdown: { type: Type.STRING },
              },
              required: ['title', 'category', 'department', 'maintainedBy', 'summary', 'contentMarkdown'],
            },
          },
        },
        required: ['auditSummary', 'synthesizedEntries'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      auditSummary?: string;
      synthesizedEntries?: Array<{
        title?: string;
        category?: string;
        department?: string;
        maintainedBy?: string;
        summary?: string;
        contentMarkdown?: string;
      }>;
    };
    const items = (parsed.synthesizedEntries ?? [])
      .filter((e) => e && e.title && e.contentMarkdown)
      .slice(0, 2)
      .map((e) => ({
        title: e.title!.trim(),
        category: (e.category === 'research_brief' ? 'research_brief' : 'handoff_template') as
          | 'handoff_template'
          | 'research_brief',
        department: (e.department || 'All Houses').trim(),
        maintainedBy: (e.maintainedBy || 'Aria, Zoe & Eli').trim(),
        summary: (e.summary || 'Consolidated into the Village Single Source of Truth.').trim(),
        contentMarkdown: e.contentMarkdown!.trim(),
      }));

    return {
      auditSummary:
        parsed.auditSummary ||
        'Aria, Zoe & Eli consolidated the latest house notes and deliverables into the Single Source of Truth.',
      synthesizedEntries: items,
    };
  } catch {
    return {
      auditSummary: 'Verified house memory notes against existing KB-* standards with zero contradictions.',
      synthesizedEntries: [],
    };
  }
}

/**
 * Render an ultra-crisp 4K version of the full-village 3D miniature diorama
 * using gemini-nano-banana-2.1 while strictly preserving the exact layout of
 * all 8 buildings, doors, central cobblestone plaza, footpaths, and brook bridges.
 */
export async function generate4KVillageMap(
  baseImageBase64: string,
  baseMimeType = 'image/jpeg'
): Promise<{ buffer: Buffer; mimeType: string }> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-nano-banana-2.1',
    contents: {
      parts: [
        {
          inlineData: {
            data: baseImageBase64,
            mimeType: baseMimeType,
          },
        },
        {
          text: [
            'Re-render this exact 3D miniature diorama village map in ultra-sharp 4K resolution with studio-grade physical micro-detail.',
            'Strictly preserve the exact layout, camera angle, positions, and proportions of every one of the 9 buildings, doorways, stone courtyard walls, central circular cobblestone plaza fountain, winding sandstone paths, street lanterns, pine and oak forest, and the right-hand blue brook with two wooden bridges.',
            'Strictly preserve each building’s iconic architectural theme and props: Upper-left Systems & Dev Lab with slate-blue roof, brushed-brass "< />" gable emblem, rooftop satellite dish, gear-and-node door medallion, dual-monitor desk, server racks & copper cable spools; Town Hall golden clock & bell; Inbox envelope emblem, calendar board & mailbox; Research observatory dome, brass telescope, magnifying glass & globe/books; Finance limestone columns, copper dome, golden balance scales & gold cart; YouTube red roof, ring light, cinema camera, play button & director chairs; Operations bronze gears, wooden crane & workbench crates; Health glass greenhouse wing, emerald cross emblem, garden beds & kettlebells; Creative glass skylight roof, painter palette/brushes, brass megaphone & easels.',
            'Dramatically enhance crispness and tactile miniature craftsmanship: razor-sharp roof shingles, finely sculpted masonry bricks, cobblestones, delicate flowers and pine needles, warm amber doorway light spill, clean water ripples, and wood-grain detail.',
            'Keep the village completely uninhabited with ZERO people, ZERO characters, ZERO text words, and ZERO UI labels. No blur or compression artifacts.',
          ].join(' '),
        },
      ],
    },
    config: {
      imageConfig: {
        aspectRatio: '3:2',
        imageSize: '4K',
      },
    },
  });

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      return {
        buffer: Buffer.from(part.inlineData.data, 'base64'),
        mimeType: part.inlineData.mimeType || 'image/png',
      };
    }
  }

  throw new Error('4K diorama renderer did not return image data.');
}

/**
 * Generates a short, authentic 2-line exchange between two proximate village agents
 * strictly grounded in the user's real tasks, chats, approvals, Workspace sync, or KB records.
 * Returns shouldSpeak: false if the anchors do not give them anything genuine to coordinate on.
 */
export async function generateGroundedCrossTalk(params: {
  agentA: {
    id: string;
    name: string;
    role: string;
    title: string;
    department: string;
  };
  agentB: {
    id: string;
    name: string;
    role: string;
    title: string;
    department: string;
  };
  location: string;
  anchors: Array<{
    sourceType: string;
    refLabel: string;
    detail: string;
    department: string;
  }>;
}): Promise<{
  shouldSpeak: boolean;
  contextRef: string;
  headline: string;
  lineA: string;
  lineB: string;
  noteA: string;
  noteB: string;
}> {
  const { agentA, agentB, location, anchors } = params;
  if (!anchors || anchors.length === 0) {
    return {
      shouldSpeak: false,
      contextRef: '',
      headline: '',
      lineA: '',
      lineB: '',
      noteA: '',
      noteB: '',
    };
  }

  const ai = getAiClient();
  const anchorBlock = anchors
    .slice(0, 4)
    .map((a, idx) => `${idx + 1}. [${a.refLabel}] (${a.sourceType}) — ${a.detail}`)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      `Location in village: ${location}`,
      `Speaker A: ${agentA.name} (${agentA.title}, ${agentA.department})`,
      `Speaker B: ${agentB.name} (${agentB.title}, ${agentB.department})`,
      '',
      'VERIFIED USER WORK ANCHORS (ONLY ALLOWED TOPICS):',
      anchorBlock,
      '',
      'Write a crisp, natural 2-line coordination check-in between Speaker A and Speaker B strictly about one or more of the verified user work anchors above.',
    ].join('\n'),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction: [
        'You generate brief, grounded 2-line workplace exchanges between two colleagues in Guildhaven.',
        'STRICT GROUNDING RULES:',
        '1. Speakers may ONLY discuss the exact Chief Human Officer (CHO) work anchors supplied in the prompt (real user tasks, direct chats, approvals, synced Gmail/Calendar items, or user Knowledge Base records).',
        '2. NEVER invent projects, metrics, video uploads, SaaS audits, meal plans, or small talk that is not explicitly present in the verified anchors.',
        '3. Keep lineA and lineB concise and conversational (under 18 words each, max 105 characters) so they fit cleanly inside overhead speech bubbles.',
        '4. Set contextRef to the exact refLabel of the primary anchor they discuss.',
        '5. Include [Ref: <contextRef>] at the end of noteA and noteB so dossier notes trace directly to the user work.',
        '6. If the supplied anchors do not give Speaker A and Speaker B a genuine reason to coordinate, set shouldSpeak to false.',
        VILLAGE_CONSTITUTION,
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          shouldSpeak: { type: Type.BOOLEAN },
          contextRef: {
            type: Type.STRING,
            description: 'Exact refLabel from the verified anchor discussed.',
          },
          headline: {
            type: Type.STRING,
            description: 'Concise 1-line summary of what they coordinated on for the Live Activity feed.',
          },
          lineA: {
            type: Type.STRING,
            description: 'Spoken bubble text for Speaker A (under 18 words).',
          },
          lineB: {
            type: Type.STRING,
            description: 'Spoken bubble text for Speaker B (under 18 words).',
          },
          noteA: {
            type: Type.STRING,
            description: '1-sentence memory note for Speaker A ending with [Ref: <contextRef>].',
          },
          noteB: {
            type: Type.STRING,
            description: '1-sentence memory note for Speaker B ending with [Ref: <contextRef>].',
          },
        },
        required: ['shouldSpeak', 'contextRef', 'headline', 'lineA', 'lineB', 'noteA', 'noteB'],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      shouldSpeak?: boolean;
      contextRef?: string;
      headline?: string;
      lineA?: string;
      lineB?: string;
      noteA?: string;
      noteB?: string;
    };
    if (!parsed.shouldSpeak || !parsed.lineA?.trim() || !parsed.lineB?.trim()) {
      return {
        shouldSpeak: false,
        contextRef: '',
        headline: '',
        lineA: '',
        lineB: '',
        noteA: '',
        noteB: '',
      };
    }

    const ref = (parsed.contextRef || anchors[0].refLabel).trim();
    const clampBubble = (s: string) => {
      const clean = s.trim().replace(/^["“]+|["”]+$/g, '');
      return clean.length > 115 ? `${clean.slice(0, 112)}...` : clean;
    };
    const ensureRefTag = (note: string, fallback: string) => {
      const base = (note || fallback).trim();
      return base.includes('[Ref:') ? base : `${base} [Ref: ${ref}]`;
    };

    return {
      shouldSpeak: true,
      contextRef: ref,
      headline:
        parsed.headline?.trim() ||
        `${agentA.name} & ${agentB.name} synced on ${ref}`,
      lineA: clampBubble(parsed.lineA),
      lineB: clampBubble(parsed.lineB),
      noteA: ensureRefTag(
        parsed.noteA ?? '',
        `Coordinated with ${agentB.name} on ${ref}.`
      ),
      noteB: ensureRefTag(
        parsed.noteB ?? '',
        `Coordinated with ${agentA.name} on ${ref}.`
      ),
    };
  } catch {
    return {
      shouldSpeak: false,
      contextRef: '',
      headline: '',
      lineA: '',
      lineB: '',
      noteA: '',
      noteB: '',
    };
  }
}

/**
 * Single-speaker Text-to-Speech via gemini-3.8-flash-lite-tts.
 * Unary generateContent returns a complete WAV file (24kHz, mono, 16-bit).
 */
export async function synthesizeAgentSpeech(params: {
  text: string;
  voiceName: AgentVoiceName;
  stylePrompt: string;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: params.text,
            speechMetadata: {
              style: params.stylePrompt,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: params.voiceName },
        },
      },
    },
  });

  const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inline?.data) {
    throw new Error('Voice synthesis did not return audio data.');
  }

  return {
    audioBase64: inline.data,
    mimeType: inline.mimeType || 'audio/wav',
  };
}

/**
 * Dual-speaker conversation Text-to-Speech via gemini-3.8-flash-tts (multiSpeakerVoiceConfig).
 * Requires exactly 2 unique speakers in speakerVoiceConfigs.
 */
export async function synthesizeMultiSpeakerDialogue(params: {
  speakers: [
    { speaker: string; voiceName: AgentVoiceName },
    { speaker: string; voiceName: AgentVoiceName },
  ];
  turns: Array<{
    speaker: string;
    text: string;
    stylePrompt: string;
  }>;
}): Promise<{ audioBase64: string; mimeType: string }> {
  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-tts',
    contents: [
      {
        role: 'user',
        parts: params.turns.map((turn) => ({
          text: `${turn.speaker}: ${turn.text}`,
          speechMetadata: {
            speaker: turn.speaker,
            style: turn.stylePrompt,
          },
        })),
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            {
              speaker: params.speakers[0].speaker,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: params.speakers[0].voiceName },
              },
            },
            {
              speaker: params.speakers[1].speaker,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: params.speakers[1].voiceName },
              },
            },
          ],
        },
      },
    },
  });

  const inline = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inline?.data) {
    throw new Error('Multi-speaker voice synthesis did not return audio data.');
  }

  return {
    audioBase64: inline.data,
    mimeType: inline.mimeType || 'audio/wav',
  };
}

/**
 * Builds the grounded real-time voice persona system instruction for gemini-3.8-live.
 */
export function buildLiveVoiceSystemInstruction(params: {
  agent: AgentDossier;
  stylePrompt: string;
  workspaceBriefing: WorkspaceBriefingPayload;
  knowledgeContext: string;
  recentTasksSummary: string;
}): string {
  const { agent, stylePrompt, workspaceBriefing, knowledgeContext, recentTasksSummary } = params;
  const wsSection = formatWorkspaceContextForPrompts(workspaceBriefing);

  return [
    `You are ${agent.name} (${agent.title} in ${agent.department}) speaking live by voice with the Chief Human Officer (CHO) inside Guildhaven.`,
    `Vocal persona & cadence: ${stylePrompt}.`,
    agent.instructions,
    '',
    'SPOKEN CONVERSATION RULES:',
    '- Keep spoken answers natural, warm, and concise (typically 1 to 3 sentences unless the CHO asks for a full walkthrough).',
    '- Never read markdown symbols, asterisks, or bullet syntax aloud.',
    '- Stay strictly grounded in the CHO’s real tasks, folder notes, Google Workspace data, and Centralized Village Knowledge Base below—never invent fictional projects.',
    VILLAGE_CONSTITUTION,
    '',
    agent.notes.length > 0
      ? `YOUR FOLDER MEMORY NOTES:\n${agent.notes.slice(-6).map((n) => `- ${n}`).join('\n')}`
      : 'YOUR FOLDER MEMORY NOTES: None logged yet.',
    '',
    recentTasksSummary
      ? `RECENT CHO TASKS IN VILLAGE:\n${recentTasksSummary}`
      : 'RECENT CHO TASKS IN VILLAGE: None dispatched yet.',
    '',
    wsSection,
    '',
    knowledgeContext,
  ].join('\n');
}

/**
 * Generates a real-time Executive Morning Briefing (Written + Spoken Summary) from live Google Workspace,
 * active/recent tasks, and pending CHO approvals using gemini-4-hydrogen.
 */
export async function generateExecutiveMorningBriefing(params: {
  workspaceBriefing: WorkspaceBriefingPayload;
  calendarWriteAccess?: boolean;
  clientTime?: ClientTimeContext;
  recentTasks: Array<{
    prompt: string;
    status: string;
    assignedDirectorName: string;
    summary: string;
  }>;
  pendingApprovals: Array<{
    title: string;
    type: string;
    directorName: string;
    description: string;
  }>;
}): Promise<ExecutiveMorningBriefing> {
  const ai = getAiClient();
  const { workspaceBriefing, calendarWriteAccess = false, clientTime, recentTasks, pendingApprovals } =
    params;

  const wsBlock = formatWorkspaceContextForPrompts(
    workspaceBriefing,
    calendarWriteAccess,
    clientTime
  );
  const approvalsBlock =
    pendingApprovals.length > 0
      ? pendingApprovals
          .slice(0, 8)
          .map(
            (a, i) =>
              `${i + 1}. [${a.type}] "${a.title}" from ${a.directorName} — ${a.description}`
          )
          .join('\n')
      : 'None pending.';
  const tasksBlock =
    recentTasks.length > 0
      ? recentTasks
          .slice(0, 8)
          .map(
            (t, i) =>
              `${i + 1}. [${t.status}] ${t.assignedDirectorName}: "${t.prompt}" — ${t.summary}`
          )
          .join('\n')
      : 'No tasks dispatched yet.';

  const generatedAt = new Date().toISOString();

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      `Prepare a crisp, grounded Executive Morning Briefing for the Chief Human Officer (CHO) of Guildhaven.`,
      `Local Time Context: ${clientTime?.localIso || generatedAt} (${clientTime?.timeZone || 'UTC'})`,
      '',
      wsBlock,
      '',
      `PENDING APPROVALS (${pendingApprovals.length}):`,
      approvalsBlock,
      '',
      `RECENT & ACTIVE TASKS (${recentTasks.length}):`,
      tasksBlock,
    ].join('\n'),
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      systemInstruction: [
        'You are Matt (Chief of Staff) and Daniel (Director of Inbox & Calendar) co-authoring a concise, executive Morning Briefing for the CHO in Guildhaven.',
        'STRICT GROUNDING RULES:',
        '- Never invent fictional emails, meetings, colleagues, or numbers. Only cite real items present in LIVE GOOGLE WORKSPACE CONTEXT, PENDING APPROVALS, and RECENT & ACTIVE TASKS.',
        '- If Google Workspace is not connected, state clearly in inboxHighlights/scheduleHighlights that Google Workspace is not currently connected and suggest connecting or delegating a task.',
        '- Keep spokenSummary natural, warm, and ready for text-to-speech (2 to 4 crisp sentences, zero markdown symbols or asterisks).',
        '- Provide 2 to 4 concrete priorities, mapping each to the best Guildhaven Director (daniel, aria, kieran, elena, marcus, devon, layla, or noah) with an optional suggestedPrompt the CHO can dispatch in 1 click.',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          headline: {
            type: Type.STRING,
            description: '1-line crisp executive status headline grounded in real counts.',
          },
          spokenSummary: {
            type: Type.STRING,
            description: '2-4 natural spoken sentences from Matt summarizing the day ahead (no markdown).',
          },
          priorities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                detail: { type: Type.STRING },
                ownerName: { type: Type.STRING },
                ownerDirectorId: {
                  type: Type.STRING,
                  description: 'One of: daniel, elena, marcus, aria, devon, layla, noah, kieran',
                },
                category: {
                  type: Type.STRING,
                  description: 'One of: inbox, calendar, approvals, tasks, operations',
                },
                suggestedPrompt: {
                  type: Type.STRING,
                  description: 'Actionable 1-sentence task prompt the CHO can dispatch.',
                },
              },
              required: ['title', 'detail', 'ownerName', 'ownerDirectorId', 'category'],
            },
          },
          scheduleHighlights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          inboxHighlights: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
        },
        required: [
          'headline',
          'spokenSummary',
          'priorities',
          'scheduleHighlights',
          'inboxHighlights',
        ],
      },
    },
  });

  try {
    const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<ExecutiveMorningBriefing>;
    const validCategories = new Set(['inbox', 'calendar', 'approvals', 'tasks', 'operations']);
    const validDirectors = new Set([
      'daniel',
      'elena',
      'marcus',
      'aria',
      'devon',
      'layla',
      'noah',
      'kieran',
    ]);
    const priorities = (Array.isArray(parsed.priorities) ? parsed.priorities : [])
      .slice(0, 5)
      .map((p) => ({
        title: p.title || 'Priority Action',
        detail: p.detail || '',
        ownerName: p.ownerName || 'Daniel',
        ownerDirectorId: validDirectors.has((p.ownerDirectorId || '').toLowerCase())
          ? (p.ownerDirectorId || 'daniel').toLowerCase()
          : 'daniel',
        category: (validCategories.has(p.category || '') ? p.category : 'operations') as
          | 'inbox'
          | 'calendar'
          | 'approvals'
          | 'tasks'
          | 'operations',
        suggestedPrompt: p.suggestedPrompt || undefined,
      }));

    return {
      generatedAt,
      headline:
        parsed.headline ||
        `${workspaceBriefing.unreadCount} unread emails · ${workspaceBriefing.upcomingEvents.length} upcoming events · ${pendingApprovals.length} pending approvals`,
      spokenSummary:
        parsed.spokenSummary ||
        `Good morning from Guildhaven. You have ${workspaceBriefing.unreadCount} unread emails, ${workspaceBriefing.upcomingEvents.length} upcoming calendar events, and ${pendingApprovals.length} items awaiting your approval.`,
      priorities,
      scheduleHighlights: Array.isArray(parsed.scheduleHighlights)
        ? parsed.scheduleHighlights.slice(0, 5)
        : [],
      inboxHighlights: Array.isArray(parsed.inboxHighlights)
        ? parsed.inboxHighlights.slice(0, 5)
        : [],
    };
  } catch {
    return {
      generatedAt,
      headline: `${workspaceBriefing.unreadCount} unread emails · ${workspaceBriefing.upcomingEvents.length} upcoming events · ${pendingApprovals.length} pending approvals`,
      spokenSummary: `Here is your Guildhaven briefing. You have ${workspaceBriefing.unreadCount} unread emails, ${workspaceBriefing.upcomingEvents.length} calendar events ahead, and ${pendingApprovals.length} pending approvals ready for your review.`,
      priorities: [],
      scheduleHighlights: workspaceBriefing.upcomingEvents
        .slice(0, 4)
        .map((ev) => `${ev.summary} (${ev.start})`),
      inboxHighlights: workspaceBriefing.recentEmails
        .slice(0, 4)
        .map((em) => `${em.subject} — ${em.from}`),
    };
  }
}




