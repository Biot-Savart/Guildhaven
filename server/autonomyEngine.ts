import crypto from 'node:crypto';
import {
  formatSourceTriggerLabel,
  isDecisionPacketExpired,
} from '../src/data/automationDefaults.ts';
import type {
  ApprovalItem,
  AutomationRun,
  DecisionPacketSourceTrigger,
  KnowledgeEntry,
  KnowledgeProposal,
  TownAutomationRule,
  TownAutopilotSettings,
} from '../src/types/village.ts';
import {
  runOrchestratedVillageTask,
  type StagedApprovalProposal,
} from './orchestrator.ts';
import {
  readGmailMessages,
  readGoogleChatConversation,
  readGoogleDriveFileContent,
  type AgentDossier,
  type WorkspaceBriefingPayload,
} from './villageEngine.ts';

export const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes per KB-RES-02

/**
 * Strips any accidental Bearer / OAuth2 access tokens from strings before logging or persisting (KB-RES-02).
 */
export function scrubSensitiveTokens(input: string | undefined | null): string {
  if (!input) return '';
  return input
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED_OAUTH_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]');
}

function safeTimingEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies Authorization: Bearer <CRON_SECRET> in fail-closed mode.
 * Uses process.env.CRON_SECRET when configured (non-placeholder), plus ephemeral fallback secret if provided.
 */
export function verifyCronAuthorizationHeader(
  authHeader: string | undefined,
  ephemeralFallbackSecret?: string
): { ok: true } | { ok: false; error: string } {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      ok: false,
      error: 'Unauthorized: Missing Authorization: Bearer <CRON_SECRET> header (fail-closed).',
    };
  }
  const provided = authHeader.slice('Bearer '.length).trim();
  if (!provided) {
    return {
      ok: false,
      error: 'Unauthorized: Empty Bearer token on /api/cron/heartbeat (fail-closed).',
    };
  }

  const envSecretRaw = (process.env.CRON_SECRET || '').trim();
  const hasRealEnvSecret = Boolean(envSecretRaw && envSecretRaw !== 'MY_CRON_SECRET');

  if (hasRealEnvSecret && safeTimingEqual(provided, envSecretRaw)) {
    return { ok: true };
  }
  if (ephemeralFallbackSecret && safeTimingEqual(provided, ephemeralFallbackSecret)) {
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Unauthorized: Invalid CRON_SECRET bearer token (fail-closed).',
  };
}

function parseWebhookTimestampMs(rawHeader: string | undefined): number | null {
  if (!rawHeader) return null;
  const trimmed = rawHeader.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!Number.isFinite(num)) return null;
    // Support both Unix seconds (10 digits) and Unix milliseconds (13 digits)
    return num < 1e11 ? num * 1000 : num;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Verifies raw request bytes BEFORE JSON.parse (KB-RES-02):
 * 1. Enforces <= 5 minute replay protection timestamp window.
 * 2. Verifies HMAC-SHA256 signature over `${timestamp}.${rawBody}` (or rawBody) OR Google OIDC push JWT.
 */
export async function verifyWorkspaceWebhookRawRequest(params: {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  ephemeralFallbackSecret?: string;
  nowMs?: number;
}): Promise<{ ok: true; authMethod: 'hmac' | 'oidc' } | { ok: false; status: number; error: string }> {
  const { rawBody, headers, ephemeralFallbackSecret, nowMs = Date.now() } = params;

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'Rejected empty or non-raw webhook request body (fail-closed).',
    };
  }

  const getHeader = (name: string): string | undefined => {
    const val = headers[name.toLowerCase()];
    if (Array.isArray(val)) return val[0];
    return typeof val === 'string' ? val : undefined;
  };

  const rawTimestamp =
    getHeader('x-webhook-timestamp') ||
    getHeader('x-goog-message-timestamp') ||
    getHeader('x-signature-timestamp');

  const signatureHeader =
    getHeader('x-webhook-signature') ||
    getHeader('x-hub-signature-256') ||
    getHeader('x-guildhaven-signature');

  const authHeader = getHeader('authorization');

  // Path A: HMAC-SHA256 verification on raw request bytes
  if (signatureHeader) {
    if (!rawTimestamp) {
      return {
        ok: false,
        status: 401,
        error: 'Missing X-Webhook-Timestamp header required for replay protection.',
      };
    }
    const tsMs = parseWebhookTimestampMs(rawTimestamp);
    if (tsMs === null) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid X-Webhook-Timestamp format.',
      };
    }
    const ageMs = nowMs - tsMs;
    if (ageMs > WEBHOOK_REPLAY_WINDOW_MS || ageMs < -60_000) {
      return {
        ok: false,
        status: 401,
        error: 'Webhook timestamp outside 5-minute replay protection window (KB-RES-02).',
      };
    }

    const cleanSig = signatureHeader.trim().replace(/^sha256=/i, '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(cleanSig)) {
      return {
        ok: false,
        status: 401,
        error: 'Malformed HMAC-SHA256 webhook signature.',
      };
    }

    const candidateSecrets: string[] = [];
    const envWebhookSecret = (process.env.WORKSPACE_WEBHOOK_SECRET || '').trim();
    if (envWebhookSecret && envWebhookSecret !== 'MY_WORKSPACE_WEBHOOK_SECRET') {
      candidateSecrets.push(envWebhookSecret);
    }
    if (ephemeralFallbackSecret) {
      candidateSecrets.push(ephemeralFallbackSecret);
    }

    if (candidateSecrets.length === 0) {
      return {
        ok: false,
        status: 401,
        error: 'WORKSPACE_WEBHOOK_SECRET is not configured for HMAC verification.',
      };
    }

    const rawText = rawBody.toString('utf-8');
    const matched = candidateSecrets.some((secret) => {
      const boundDigest = crypto
        .createHmac('sha256', secret)
        .update(`${rawTimestamp.trim()}.${rawText}`, 'utf-8')
        .digest('hex');
      if (safeTimingEqual(cleanSig, boundDigest)) return true;

      const bodyOnlyDigest = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');
      return safeTimingEqual(cleanSig, bodyOnlyDigest);
    });

    if (!matched) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid webhook HMAC signature (fail-closed).',
      };
    }

    return { ok: true, authMethod: 'hmac' };
  }

  // Path B: Google Cloud Pub/Sub / Workspace OIDC Bearer token verification
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      return { ok: false, status: 401, error: 'Empty Bearer OIDC push token.' };
    }

    if (rawTimestamp) {
      const headerTsMs = parseWebhookTimestampMs(rawTimestamp);
      if (
        headerTsMs === null ||
        nowMs - headerTsMs > WEBHOOK_REPLAY_WINDOW_MS ||
        nowMs - headerTsMs < -60_000
      ) {
        return {
          ok: false,
          status: 401,
          error: 'OIDC push timestamp outside 5-minute replay window.',
        };
      }
    }

    try {
      const verifyRes = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );
      if (!verifyRes.ok) {
        return {
          ok: false,
          status: 401,
          error: 'Google OIDC push token rejected by tokeninfo.',
        };
      }
      const tokenInfo = (await verifyRes.json()) as {
        iss?: string;
        iat?: string;
        exp?: string;
        email_verified?: string | boolean;
      };
      const validIssuer =
        tokenInfo.iss === 'https://accounts.google.com' ||
        tokenInfo.iss === 'accounts.google.com';
      if (!validIssuer) {
        return { ok: false, status: 401, error: 'Invalid OIDC token issuer.' };
      }
      const iatMs = tokenInfo.iat ? Number(tokenInfo.iat) * 1000 : 0;
      const expMs = tokenInfo.exp ? Number(tokenInfo.exp) * 1000 : 0;
      if (!expMs || expMs <= nowMs) {
        return { ok: false, status: 401, error: 'Expired OIDC push token.' };
      }
      if (iatMs && nowMs - iatMs > WEBHOOK_REPLAY_WINDOW_MS) {
        return {
          ok: false,
          status: 401,
          error: 'OIDC push token issued more than 5 minutes ago (replay rejected).',
        };
      }
      return { ok: true, authMethod: 'oidc' };
    } catch {
      return {
        ok: false,
        status: 401,
        error: 'Failed to verify Google OIDC push token (fail-closed).',
      };
    }
  }

  return {
    ok: false,
    status: 401,
    error:
      'Missing webhook authentication (provide X-Webhook-Signature + X-Webhook-Timestamp or Google OIDC Bearer token).',
  };
}

function matchCronField(
  fieldExpr: string,
  value: number,
  min: number,
  max: number,
  isDayOfWeek = false
): boolean {
  const clean = fieldExpr.trim();
  if (clean === '*') return true;

  const normalizedVal = isDayOfWeek && value === 7 ? 0 : value;

  for (const part of clean.split(',')) {
    const token = part.trim();
    if (!token) continue;

    const [rangePart, stepStr] = token.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    if (!Number.isFinite(step) || step <= 0) continue;

    if (rangePart === '*') {
      if ((normalizedVal - min) % step === 0) return true;
      continue;
    }

    if (rangePart.includes('-')) {
      const [startStr, endStr] = rangePart.split('-');
      let start = Number(startStr);
      let end = Number(endStr);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (isDayOfWeek && end === 7 && start > 0) {
        // e.g. 1-7
        const testVal = normalizedVal === 0 ? 7 : normalizedVal;
        if (testVal >= start && testVal <= end && (testVal - start) % step === 0) {
          return true;
        }
        continue;
      }
      start = Math.max(min, start);
      end = Math.min(max, end);
      if (normalizedVal >= start && normalizedVal <= end && (normalizedVal - start) % step === 0) {
        return true;
      }
      continue;
    }

    let exact = Number(rangePart);
    if (!Number.isFinite(exact)) continue;
    if (isDayOfWeek && exact === 7) exact = 0;
    if (normalizedVal === exact) return true;
  }

  return false;
}

/**
 * Evaluates whether an enabled cron rule is due within the current UTC hour bucket.
 * Note: Cron expressions in TownAutomationRule follow cloud UTC convention
 * (e.g. "30 5 * * 1-5" = 05:30 UTC = 07:30 SAST). Within the matching hour, any minute >= scheduled minute
 * is considered due and deduplicated once per `${rule.id}:${YYYY-MM-DDTHH}` bucket.
 */
export function isCronRuleDueInWindow(rule: TownAutomationRule, now = new Date()): boolean {
  if (rule.type !== 'cron' || !rule.enabled) return false;
  const expr = (rule.schedule_cron || '').trim();
  if (!expr) return false;
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;
  const utcMin = now.getUTCMinutes();
  const utcHour = now.getUTCHours();
  const utcDom = now.getUTCDate();
  const utcMonth = now.getUTCMonth() + 1;
  const utcDow = now.getUTCDay();

  if (!matchCronField(monthExpr, utcMonth, 1, 12)) return false;
  if (!matchCronField(domExpr, utcDom, 1, 31)) return false;
  if (!matchCronField(dowExpr, utcDow, 0, 7, true)) return false;
  if (!matchCronField(hourExpr, utcHour, 0, 23)) return false;

  // Exact minute or catch-up within the same hour bucket (idempotency_key prevents duplicate runs in the hour)
  if (/^\d+$/.test(minExpr.trim()) && /^\d+$/.test(hourExpr.trim())) {
    return utcMin >= Number(minExpr.trim());
  }
  return matchCronField(minExpr, utcMin, 0, 59);
}

export function computeCronIdempotencyKey(rule: TownAutomationRule, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const expr = (rule.schedule_cron || '').trim();
  const minPart = expr.split(/\s+/)[0] || '';
  const baseBucket = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(
    now.getUTCDate()
  )}T${pad(now.getUTCHours())}`;
  // Sub-hourly cron (e.g. */15 * * * *) includes minute bucket; standard hourly/daily cron uses date_hour_bucket
  if (minPart.includes('/') || minPart === '*') {
    return `${rule.id}:${baseBucket}:${pad(now.getUTCMinutes())}`;
  }
  return `${rule.id}:${baseBucket}`;
}

export function deriveCronSourceLabel(rule: TownAutomationRule): string {
  if (rule.id === 'cron_morning_triage') return '07:30 SAST';
  if (rule.id === 'cron_midday_replan') return '12:30 SAST';
  if (rule.id === 'cron_weekly_kb_hygiene') return 'Mon 08:00 SAST';
  const match = /\(([^)]+SAST[^)]*)\)/i.exec(rule.name);
  if (match?.[1]) return match[1].trim();
  return rule.name;
}

/**
 * Transitions any pending ApprovalItem or KnowledgeProposal past ttl_expires_at to 'expired'.
 */
export function sweepExpiredDecisionPackets(params: {
  approvals: Array<Record<string, unknown>>;
  kbProposals: KnowledgeProposal[];
  nowMs?: number;
}): { expiredApprovalsCount: number; expiredKbCount: number; mutated: boolean } {
  const { approvals, kbProposals, nowMs = Date.now() } = params;
  let expiredApprovalsCount = 0;
  let expiredKbCount = 0;

  for (const raw of approvals) {
    if (!raw || typeof raw !== 'object') continue;
    const status = typeof raw.status === 'string' ? raw.status : '';
    const ttl = typeof raw.ttl_expires_at === 'string' ? raw.ttl_expires_at : undefined;
    if (
      status === 'pending' &&
      ttl &&
      isDecisionPacketExpired({ status: 'pending', ttl_expires_at: ttl }, nowMs)
    ) {
      raw.status = 'expired';
      expiredApprovalsCount += 1;
    }
  }

  for (const prop of kbProposals) {
    if (!prop) continue;
    if (prop.status === 'pending' && isDecisionPacketExpired(prop, nowMs)) {
      prop.status = 'expired';
      prop.resolved_at = new Date(nowMs).toISOString();
      expiredKbCount += 1;
    }
  }

  return {
    expiredApprovalsCount,
    expiredKbCount,
    mutated: expiredApprovalsCount > 0 || expiredKbCount > 0,
  };
}

export interface NormalizedWebhookTriggerPayload {
  providerSource: 'Gmail' | 'Chat' | 'Drive' | 'Workspace';
  eventId: string;
  gmailThreadId?: string;
  gmailMessageId?: string;
  gmailLabels?: string[];
  gmailSubject?: string;
  gmailFrom?: string;
  gmailBodyText?: string;
  chatSpaceName?: string;
  chatSpaceDisplayName?: string;
  chatThreadName?: string;
  chatSenderName?: string;
  chatMessageText?: string;
  driveFileId?: string;
  driveFileName?: string;
  isBulkUnreadNoise?: boolean;
}

/**
 * Parses Google Pub/Sub envelope or direct Workspace webhook JSON payload into a canonical trigger descriptor.
 */
export function parseWorkspaceWebhookPayload(
  parsedJson: Record<string, unknown>
): NormalizedWebhookTriggerPayload {
  let inner: Record<string, unknown> = parsedJson;
  let pubsubMessageId = '';

  // Support standard Google Cloud Pub/Sub push envelope: { message: { data: base64, messageId, attributes } }
  if (parsedJson.message && typeof parsedJson.message === 'object') {
    const msg = parsedJson.message as Record<string, unknown>;
    if (typeof msg.messageId === 'string') {
      pubsubMessageId = msg.messageId.trim();
    }
    if (typeof msg.data === 'string' && msg.data.trim()) {
      try {
        const decoded = Buffer.from(msg.data.trim(), 'base64').toString('utf-8');
        const decodedObj = JSON.parse(decoded);
        if (decodedObj && typeof decodedObj === 'object') {
          inner = { ...parsedJson, ...decodedObj };
        }
      } catch {
        // Keep top-level object if data is not JSON
      }
    }
  }

  const rawSource = String(
    inner.source || inner.channel || inner.eventType || inner.provider || ''
  ).toLowerCase();

  const labels = Array.isArray(inner.labels)
    ? inner.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
    : Array.isArray(inner.labelIds)
      ? inner.labelIds.filter((l): l is string => typeof l === 'string' && l.trim().length > 0)
      : [];

  const gmailThreadId =
    typeof inner.threadId === 'string'
      ? inner.threadId.trim()
      : typeof inner.gmailThreadId === 'string'
        ? inner.gmailThreadId.trim()
        : undefined;
  const gmailMessageId =
    typeof inner.messageId === 'string'
      ? inner.messageId.trim()
      : typeof inner.gmailMessageId === 'string'
        ? inner.gmailMessageId.trim()
        : typeof inner.historyId === 'number' || typeof inner.historyId === 'string'
          ? `hist_${String(inner.historyId)}`
          : undefined;

  const chatSpaceName =
    typeof inner.spaceName === 'string'
      ? inner.spaceName.trim()
      : typeof inner.chatSpaceName === 'string'
        ? inner.chatSpaceName.trim()
        : undefined;
  const chatThreadName =
    typeof inner.threadName === 'string'
      ? inner.threadName.trim()
      : typeof inner.chatThreadName === 'string'
        ? inner.chatThreadName.trim()
        : undefined;

  const driveFileId =
    typeof inner.fileId === 'string'
      ? inner.fileId.trim()
      : typeof inner.driveFileId === 'string'
        ? inner.driveFileId.trim()
        : undefined;

  const providerSource: NormalizedWebhookTriggerPayload['providerSource'] =
    rawSource.includes('chat') || Boolean(chatSpaceName || chatThreadName)
      ? 'Chat'
      : rawSource.includes('drive') || Boolean(driveFileId)
        ? 'Drive'
        : rawSource.includes('gmail') ||
            Boolean(gmailThreadId || gmailMessageId || labels.length > 0 || inner.emailAddress)
          ? 'Gmail'
          : 'Workspace';

  const explicitEventId =
    typeof inner.eventId === 'string' && inner.eventId.trim()
      ? inner.eventId.trim()
      : typeof inner.id === 'string' && inner.id.trim()
        ? inner.id.trim()
        : pubsubMessageId ||
          gmailMessageId ||
          gmailThreadId ||
          chatThreadName ||
          driveFileId ||
          crypto
            .createHash('sha256')
            .update(JSON.stringify(parsedJson))
            .digest('hex')
            .slice(0, 20);

  const upperLabels = labels.map((l) => l.toUpperCase());
  const isBulkUnreadNoise =
    upperLabels.includes('CATEGORY_PROMOTIONS') ||
    upperLabels.includes('CATEGORY_SOCIAL') ||
    upperLabels.includes('SPAM');

  return {
    providerSource,
    eventId: explicitEventId,
    gmailThreadId,
    gmailMessageId,
    gmailLabels: labels,
    gmailSubject: typeof inner.subject === 'string' ? inner.subject.trim() : undefined,
    gmailFrom: typeof inner.from === 'string' ? inner.from.trim() : undefined,
    gmailBodyText:
      typeof inner.bodyText === 'string'
        ? inner.bodyText.trim()
        : typeof inner.body === 'string'
          ? inner.body.trim()
          : typeof inner.fullThreadText === 'string'
            ? inner.fullThreadText.trim()
            : undefined,
    chatSpaceName,
    chatSpaceDisplayName:
      typeof inner.spaceDisplayName === 'string' ? inner.spaceDisplayName.trim() : undefined,
    chatThreadName,
    chatSenderName: typeof inner.senderName === 'string' ? inner.senderName.trim() : undefined,
    chatMessageText:
      typeof inner.messageText === 'string'
        ? inner.messageText.trim()
        : typeof inner.text === 'string'
          ? inner.text.trim()
          : undefined,
    driveFileId,
    driveFileName: typeof inner.fileName === 'string' ? inner.fileName.trim() : undefined,
    isBulkUnreadNoise,
  };
}

async function fetchFullGmailThreadContext(
  authHeader: string,
  threadId?: string,
  labelFilter?: string
): Promise<string> {
  if (threadId && !threadId.startsWith('hist_')) {
    try {
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(
          threadId
        )}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
        { headers: { Authorization: authHeader } }
      );
      if (res.ok) {
        const threadData = (await res.json()) as {
          id?: string;
          messages?: Array<{
            id?: string;
            snippet?: string;
            labelIds?: string[];
            payload?: { headers?: Array<{ name?: string; value?: string }> };
          }>;
        };
        const msgs = threadData.messages ?? [];
        if (msgs.length > 0) {
          const formatted = msgs.slice(-6).map((m, idx) => {
            const hdr = (name: string) =>
              m.payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
                ?.value || '';
            return `Message #${idx + 1} (${m.id}): From=${hdr('From')} | Date=${hdr('Date')} | Subject=${hdr('Subject')}\nContent: ${m.snippet || ''}`;
          });
          return `HYDRATED GMAIL THREAD (${threadId}, ${msgs.length} message(s)):\n${formatted.join('\n---\n')}`;
        }
      }
    } catch {
      // Fall through to readGmailMessages
    }
  }

  try {
    const res = await readGmailMessages(authHeader, {
      labelQuery: labelFilter,
      includeInbox: !labelFilter,
      maxResults: 5,
      includeBody: true,
    });
    if (res.messages.length > 0) {
      return `HYDRATED GMAIL MESSAGES (${res.messages.length}):\n${res.messages
        .map(
          (m) =>
            `- [${m.id}] Thread=${m.threadId ?? 'n/a'} | Labels=${(m.labelNames ?? []).join(', ')} | From=${m.from} | Subject="${m.subject}"\n  Full Body Excerpt: ${(m.bodyExcerpt || m.snippet || '').slice(0, 1200)}`
        )
        .join('\n')}`;
    }
  } catch {
    // Ignore live fetch error and fall back to cached workspace snapshot
  }
  return '';
}

/**
 * Hydrates full thread/file context before running the headless pipeline (never acting on truncated snippets alone).
 */
export async function hydrateWebhookEventContext(params: {
  event: NormalizedWebhookTriggerPayload;
  rule: TownAutomationRule;
  workspaceBriefing: WorkspaceBriefingPayload;
  workspaceAuthHeader?: string;
}): Promise<string> {
  const { event, rule, workspaceBriefing, workspaceAuthHeader } = params;
  const hasLiveToken = Boolean(workspaceAuthHeader && workspaceAuthHeader.startsWith('Bearer '));
  const sections: string[] = [];

  if (event.providerSource === 'Gmail') {
    if (hasLiveToken && workspaceAuthHeader) {
      const targetLabel =
        event.gmailLabels?.[0] || rule.config.monitored_gmail_labels?.[0] || undefined;
      const liveThreadBlock = await fetchFullGmailThreadContext(
        workspaceAuthHeader,
        event.gmailThreadId,
        targetLabel
      );
      if (liveThreadBlock) sections.push(liveThreadBlock);
    }

    if (event.gmailBodyText) {
      sections.push(
        [
          `HYDRATED GMAIL THREAD PAYLOAD (Event ${event.eventId}):`,
          `From: ${event.gmailFrom || 'Unknown sender'}`,
          `Subject: ${event.gmailSubject || '(No subject)'}`,
          `Labels: ${(event.gmailLabels ?? []).join(', ') || 'Monitored Label'}`,
          `Full Message Body:\n${event.gmailBodyText.slice(0, 3000)}`,
        ].join('\n')
      );
    } else if (!sections.length) {
      const matchingCached = (workspaceBriefing.recentEmails ?? []).filter((m) =>
        event.gmailThreadId
          ? m.threadId === event.gmailThreadId || m.id === event.gmailMessageId
          : true
      );
      if (matchingCached.length > 0) {
        sections.push(
          `CACHED FULL GMAIL CONTEXT:\n${matchingCached
            .slice(0, 4)
            .map(
              (m) =>
                `- From: ${m.from} | Subject: "${m.subject}" | Labels: ${(m.labelNames ?? []).join(', ')}\n  Body: ${m.bodyExcerpt || m.snippet}`
            )
            .join('\n')}`
        );
      }
    }
  } else if (event.providerSource === 'Chat') {
    if (hasLiveToken && workspaceAuthHeader && (event.chatSpaceName || event.chatThreadName)) {
      try {
        const conv = await readGoogleChatConversation(workspaceAuthHeader, {
          target: event.chatThreadName || event.chatSpaceName || '',
          threadName: event.chatThreadName,
          pageSize: 30,
        });
        sections.push(
          `HYDRATED GOOGLE CHAT THREAD (${conv.space.displayName} · ${conv.focusedThreadName || conv.space.name}):\n` +
            conv.messages
              .slice(-15)
              .map(
                (m) =>
                  `[${m.createTime}] ${m.senderName} (thread=${m.threadName || 'root'}): ${m.text}`
              )
              .join('\n')
        );
      } catch {
        // Fallback to payload/pinned chat context below
      }
    }
    if (event.chatMessageText) {
      sections.push(
        `CHAT EVENT DETAILS:\nSpace: ${event.chatSpaceDisplayName || event.chatSpaceName || 'Watched Space'}\nThread Resource: ${event.chatThreadName || 'n/a'}\nSender: ${event.chatSenderName || 'Colleague'}\nFull Message: ${event.chatMessageText}`
      );
    }
  } else if (event.providerSource === 'Drive') {
    if (hasLiveToken && workspaceAuthHeader && event.driveFileId) {
      try {
        const file = await readGoogleDriveFileContent(workspaceAuthHeader, event.driveFileId);
        sections.push(
          `HYDRATED GOOGLE DRIVE FILE ("${file.name}", ${file.mimeType}):\n${(
            file.content ||
            file.excerpt ||
            ''
          ).slice(0, 3000)}`
        );
      } catch {
        // Ignore live Drive read error
      }
    }
    if (event.driveFileName) {
      sections.push(`DRIVE CHANGE EVENT: File "${event.driveFileName}" (${event.driveFileId || 'id unknown'})`);
    }
  }

  return sections.join('\n\n');
}

export function buildAutomationRuleObjectivePrompt(params: {
  rule: TownAutomationRule;
  hydratedWebhookContext?: string;
  webhookEvent?: NormalizedWebhookTriggerPayload;
}): string {
  const { rule, hydratedWebhookContext, webhookEvent } = params;
  const monitoredLabels =
    (rule.config.monitored_gmail_labels ?? []).join(', ') || 'INBOX_PRIORITY, Meeting Notes';
  const watchedSpaces =
    (rule.config.watched_chat_spaces ?? []).join(', ') ||
    'Product Operations, Backend, Integration, Tiger T: Balwin';

  if (rule.type === 'webhook') {
    return [
      `Supervised Autonomous Webhook Trigger — Rule "${rule.name}" (${rule.id}).`,
      `Monitored Gmail Labels (KB-SOP-06): [${monitoredLabels}]. Ignore bulk unread noise: ${rule.config.ignore_unread_bulk !== false ? 'YES' : 'NO'}.`,
      webhookEvent
        ? `Incoming ${webhookEvent.providerSource} Event ID: ${webhookEvent.eventId}.`
        : '',
      hydratedWebhookContext
        ? `\n${hydratedWebhookContext}\n`
        : 'Use read_gmail_messages / read_google_chat / read_drive_files to inspect full context before deciding if action is needed; never act on truncated snippets alone.',
      `Instructions:`,
      `1. Triage with House Specialist and verify full message/thread context.`,
      `2. If this event requires an outbound response or follow-up action from the CHO, invoke stage_cho_decision_packet (e.g. email_draft or chat_message with chatThreadName pre-filled).`,
      `3. If this is informational/FYI with no action required, do NOT stage a packet—summarize the 1-2 sentence takeaway cleanly for the Town Digest.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (rule.id === 'cron_morning_triage') {
    return [
      `Scheduled Autonomous Heartbeat — 07:30 SAST Morning Triage (${rule.id}).`,
      `1. Inspect today's Google Calendar events via read_calendar_events (checking back-to-back blocks, Focus Buffer gaps, and any Plentify OOO / team availability notices).`,
      `2. Inspect monitored Gmail labels [${monitoredLabels}] (per KB-SOP-06; ${rule.config.ignore_unread_bulk !== false ? 'ignoring bulk unread promotional noise' : 'including unread inbox'}).`,
      `3. Delegate quick synthesis to Sam (worker_daniel) via dispatch_handoff, then have Daniel verify.`,
      `4. ONLY if calendar gaps need a Focus Buffer block or an urgent monitored thread needs a reply draft, call stage_cho_decision_packet once. Otherwise log a calm, concise 1-2 sentence Morning Triage status for the Town Digest.`,
    ].join('\n');
  }

  if (rule.id === 'cron_midday_replan') {
    return [
      `Scheduled Autonomous Heartbeat — 12:30 SAST Midday Replan (${rule.id}).`,
      `1. Inspect watched Google Chat spaces [${watchedSpaces}] (via read_google_chat when live Workspace auth is attached, plus any pinned chat transcripts) for unresolved @mentions, blockers, or unanswered decisions.`,
      `2. Delegate thread review to Sam (worker_daniel) via dispatch_handoff.`,
      `3. If an unresolved blocker or @mention requires a CHO reply, call stage_cho_decision_packet with type="chat_message" and pre-fill chatSpaceName, chatSpaceDisplayName, and chatThreadName.`,
      `4. If all watched spaces are clear, do NOT stage a packet—return a 1-2 sentence Midday Replan digest.`,
    ].join('\n');
  }

  if (rule.id === 'cron_weekly_kb_hygiene') {
    return [
      `Scheduled Autonomous Heartbeat — Monday 08:00 SAST Weekly Sprint & KB Hygiene (${rule.id}).`,
      `1. Audit recent House memory notes, monitored meeting notes [${monitoredLabels}], and live KB-* entries to spot recurring cross-house handoff friction or outdated SOP details.`,
      `2. Coordinate with Eli (worker_devon) or Zoe (worker_aria) via dispatch_handoff.`,
      `3. ONLY if a concrete, non-duplicative KB improvement is warranted, stage a single pending proposal via propose_kb_entry (never KB-GOV-01). Otherwise return a concise 1-2 sentence KB hygiene summary for the Town Digest.`,
    ].join('\n');
  }

  return [
    `Scheduled Autonomous Heartbeat — "${rule.name}" (${rule.id}, target house: ${rule.target_house}).`,
    rule.description || '',
    `Monitored Gmail labels: [${monitoredLabels}]. Watched Chat spaces: [${watchedSpaces}].`,
    `Execute internal read, research, triage, and drafting within KB-SOP-01 safe-zone bounds. Stage a CHO decision packet ONLY if external action is genuinely warranted; otherwise return a concise 1-2 sentence Town Digest summary.`,
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ExecuteAutonomousRuleParams {
  rule: TownAutomationRule;
  autopilotSettings: TownAutopilotSettings;
  idempotencyKey: string;
  sourceTrigger: DecisionPacketSourceTrigger;
  sourceLabel: string;
  roster: AgentDossier[];
  liveKnowledgeBase: KnowledgeEntry[];
  houseNotes: Record<string, string[]>;
  workspaceBriefing: WorkspaceBriefingPayload;
  workspaceAuthHeader?: string;
  calendarWriteAccess: boolean;
  existingRuns: AutomationRun[];
  hydratedWebhookContext?: string;
  webhookEvent?: NormalizedWebhookTriggerPayload;
  simulateDelayMs?: number;
  bypassKillSwitch?: boolean;
}

export interface ExecuteAutonomousRuleResult {
  run: AutomationRun;
  stagedApprovalItems: ApprovalItem[];
  stagedKbProposals: KnowledgeProposal[];
  taskRecord: Record<string, unknown> | null;
  chosenDirectorId?: string;
  newDirectorNote?: string;
}

/**
 * Executes a single supervised background automation run (Layer 2 Safe-Zone Runner, KB-SOP-01 & KB-GOV-01).
 */
export async function executeAutonomousRuleRun(
  params: ExecuteAutonomousRuleParams
): Promise<ExecuteAutonomousRuleResult> {
  const {
    rule,
    autopilotSettings,
    idempotencyKey,
    sourceTrigger,
    sourceLabel,
    roster,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    workspaceAuthHeader,
    calendarWriteAccess,
    existingRuns,
    hydratedWebhookContext,
    webhookEvent,
    simulateDelayMs,
    bypassKillSwitch = false,
  } = params;

  const startedMs = Date.now();
  const startedIso = new Date(startedMs).toISOString();
  const runId = `autorun_${startedMs}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Global Kill-Switch check (strictly enforced for background cron & webhooks; optional bypass only for manual CHO Test Run Now)
  if (!bypassKillSwitch && !autopilotSettings.autopilot_enabled) {
    return {
      run: {
        id: runId,
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.type,
        idempotency_key: idempotencyKey,
        status: 'skipped_paused',
        summary: `Skipped "${rule.name}" because Town Autopilot is paused.`,
        staged_packet_ids: [],
        agent_trace: [],
        duration_ms: 0,
        created_at: startedIso,
      },
      stagedApprovalItems: [],
      stagedKbProposals: [],
      taskRecord: null,
    };
  }

  // 2. Hourly Rate-Limit Guardrail check
  const oneHourAgoMs = startedMs - 3_600_000;
  const runsLastHour = existingRuns.filter((r) => {
    if (r.status === 'skipped_paused') return false;
    const t = Date.parse(r.created_at);
    return Number.isFinite(t) && t >= oneHourAgoMs;
  }).length;

  if (runsLastHour >= autopilotSettings.max_runs_per_hour) {
    const msg = `Rate-limit guardrail reached (${runsLastHour}/${autopilotSettings.max_runs_per_hour} autonomous runs in the past hour). Aborted fail-closed.`;
    return {
      run: {
        id: runId,
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.type,
        idempotency_key: idempotencyKey,
        status: 'failed_closed',
        summary: msg,
        staged_packet_ids: [],
        agent_trace: [],
        duration_ms: Math.max(1, Date.now() - startedMs),
        error_detail: msg,
        created_at: startedIso,
      },
      stagedApprovalItems: [],
      stagedKbProposals: [],
      taskRecord: null,
    };
  }

  const prompt = buildAutomationRuleObjectivePrompt({
    rule,
    hydratedWebhookContext,
    webhookEvent,
  });
  const taskId = `autotask_${startedMs}_${Math.random().toString(36).slice(2, 6)}`;

  const execution = await runOrchestratedVillageTask({
    taskId,
    prompt,
    priority: rule.type === 'webhook' ? 'high' : 'medium',
    targetDirectorId: rule.target_house || null,
    roster,
    liveKnowledgeBase,
    houseNotes,
    workspaceBriefing,
    // Never log or persist workspaceAuthHeader; passed in-memory only for read tools
    workspaceAuthHeader,
    calendarWriteAccess,
    clientTime: {
      localIso: startedIso,
      timeZone: rule.timezone || 'Africa/Johannesburg',
      offset: '+02:00',
    },
    mode: 'autonomous',
    maxDurationMs: autopilotSettings.max_job_duration_ms,
    maxAgentHops: autopilotSettings.max_agent_hops,
    simulateDelayMs,
  });

  const completedMs = Date.now();
  const completedIso = new Date(completedMs).toISOString();
  const durationMs = Math.max(25, completedMs - startedMs);

  // 3. Fail-Closed handling: zero half-baked packets staged
  if (execution.failedClosed || !execution.ok) {
    const cleanErr = scrubSensitiveTokens(
      execution.errorBanner || 'Autonomous run exceeded budget or failed closed.'
    );
    return {
      run: {
        id: runId,
        rule_id: rule.id,
        rule_name: rule.name,
        trigger_type: rule.type,
        idempotency_key: idempotencyKey,
        status: 'failed_closed',
        summary: scrubSensitiveTokens(
          `${rule.name} halted fail-closed (${Math.round(durationMs / 100) / 10}s): ${cleanErr}`
        ).slice(0, 260),
        staged_packet_ids: [],
        agent_trace: execution.agentTrace,
        duration_ms: durationMs,
        error_detail: cleanErr,
        created_at: completedIso,
      },
      stagedApprovalItems: [],
      stagedKbProposals: [],
      taskRecord: null,
    };
  }

  // 4. Stamp TTL & provenance on any staged CHO Decision Packets
  const ttlHours = Math.max(1, Math.min(168, rule.config.packet_ttl_hours || 24));
  const ttlExpiresIso = new Date(completedMs + ttlHours * 3_600_000).toISOString();

  const proposalsToMaterialize: StagedApprovalProposal[] =
    execution.stagedApprovals.length > 0
      ? execution.stagedApprovals
      : execution.approvalProposal?.needed
        ? [execution.approvalProposal]
        : [];

  const stagedApprovalItems: ApprovalItem[] = proposalsToMaterialize.map((prop, idx) => ({
    id: `appr_auto_${completedMs}_${idx + 1}_${Math.random().toString(36).slice(2, 5)}`,
    taskId,
    directorId: execution.chosenDirector.id,
    directorName: execution.chosenDirector.name,
    type: prop.type,
    title: scrubSensitiveTokens(prop.title),
    description: scrubSensitiveTokens(prop.description),
    payload: {
      to: prop.to,
      subject: prop.subject ? scrubSensitiveTokens(prop.subject) : undefined,
      body: prop.body ? scrubSensitiveTokens(prop.body) : undefined,
      eventSummary: prop.eventSummary,
      eventStart: prop.eventStart,
      eventEnd: prop.eventEnd,
      eventLocation: prop.eventLocation,
      eventDescription: prop.eventDescription,
      chatSpaceName: prop.chatSpaceName || webhookEvent?.chatSpaceName,
      chatSpaceDisplayName: prop.chatSpaceDisplayName || webhookEvent?.chatSpaceDisplayName,
      chatThreadName: prop.chatThreadName || webhookEvent?.chatThreadName,
      docTitle: prop.docTitle,
      driveFileName: prop.driveFileName,
      amount: prop.amount,
      vendor: prop.vendor,
      postPlatform: prop.postPlatform,
      postContent: prop.postContent ? scrubSensitiveTokens(prop.postContent) : undefined,
    },
    status: 'pending',
    createdAt: completedIso,
    source_trigger: sourceTrigger,
    source_label: sourceLabel,
    automation_run_id: runId,
    ttl_expires_at: ttlExpiresIso,
  }));

  const stagedKbProposals: KnowledgeProposal[] = execution.stagedKbProposals.map((kbp) => ({
    ...kbp,
    summary: scrubSensitiveTokens(kbp.summary),
    details: scrubSensitiveTokens(kbp.details),
    source_trigger: sourceTrigger,
    source_label: sourceLabel,
    automation_run_id: runId,
    ttl_expires_at: ttlExpiresIso,
  }));

  const stagedPacketIds = [
    ...stagedApprovalItems.map((a) => a.id),
    ...stagedKbProposals.map((p) => p.proposal_id),
  ];

  const hasStaged = stagedPacketIds.length > 0;
  const cleanExecSummary = scrubSensitiveTokens(execution.summary);
  const digestSummary = hasStaged
    ? `Staged ${stagedPacketIds.length} decision packet${stagedPacketIds.length === 1 ? '' : 's'} (${formatSourceTriggerLabel(sourceTrigger, sourceLabel)}) — ${cleanExecSummary}`
    : `${rule.name} completed — ${cleanExecSummary || 'no urgent actions needed.'}`;

  const taskRecord: Record<string, unknown> = {
    id: taskId,
    prompt: `[Autopilot · ${formatSourceTriggerLabel(sourceTrigger, sourceLabel)}] ${rule.name}`,
    createdAt: startedIso,
    completedAt: completedIso,
    fulfillmentMs: durationMs,
    taskSource:
      webhookEvent?.providerSource === 'Gmail'
        ? 'gmail'
        : webhookEvent?.providerSource === 'Chat' || rule.id === 'cron_midday_replan'
          ? 'chat'
          : webhookEvent?.providerSource === 'Drive'
            ? 'drive'
            : rule.id === 'cron_morning_triage'
              ? 'calendar'
              : 'manual',
    priority: rule.type === 'webhook' ? 'high' : 'medium',
    status: hasStaged ? 'needs_approval' : 'completed',
    assignedDirectorId: execution.chosenDirector.id,
    assignedDirectorName: execution.chosenDirector.name,
    assignedWorkerId: execution.primaryWorker?.id ?? null,
    workerModel: 'gemini-3.1-flash-lite',
    directorModel: 'gemini-4-hydrogen (Autopilot Safe-Zone)',
    escalatedToAdvisor: false,
    routingNote: scrubSensitiveTokens(execution.routing.routingNote),
    summary: scrubSensitiveTokens(digestSummary).slice(0, 260),
    reportMarkdown: scrubSensitiveTokens(execution.reportMarkdown),
    groundingSources: execution.groundingSources ?? [],
    approvalId: stagedApprovalItems[0]?.id ?? null,
    handoffTrace: execution.handoffTrace,
    kbProposalIds: stagedKbProposals.map((p) => p.proposal_id),
    collaboratorIds: execution.collaboratorIds,
  };

  return {
    run: {
      id: runId,
      rule_id: rule.id,
      rule_name: rule.name,
      trigger_type: rule.type,
      idempotency_key: idempotencyKey,
      status: hasStaged ? 'staged_packet' : 'completed',
      summary: scrubSensitiveTokens(digestSummary).slice(0, 280),
      staged_packet_ids: stagedPacketIds,
      agent_trace: execution.agentTrace,
      duration_ms: durationMs,
      created_at: completedIso,
    },
    stagedApprovalItems,
    stagedKbProposals,
    taskRecord,
    chosenDirectorId: execution.chosenDirector.id,
    newDirectorNote: scrubSensitiveTokens(execution.newDirectorNote),
  };
}
