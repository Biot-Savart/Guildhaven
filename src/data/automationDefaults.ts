import type {
  ApprovalItem,
  DecisionPacketSourceTrigger,
  KnowledgeProposal,
  TownAutomationRule,
  TownAutopilotSettings,
} from '../types/village.ts';

const SEED_UPDATED_AT = '2026-11-17T05:00:00.000Z';

export const DEFAULT_TOWN_AUTOPILOT_SETTINGS: TownAutopilotSettings = {
  autopilot_enabled: true,
  max_runs_per_hour: 20,
  max_job_duration_ms: 30_000,
  max_agent_hops: 4,
};

export function normalizeTownAutopilotSettings(
  raw?: Partial<TownAutopilotSettings> | null
): TownAutopilotSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TOWN_AUTOPILOT_SETTINGS };
  }
  const maxRuns =
    typeof raw.max_runs_per_hour === 'number' && Number.isFinite(raw.max_runs_per_hour)
      ? Math.max(1, Math.min(120, Math.round(raw.max_runs_per_hour)))
      : DEFAULT_TOWN_AUTOPILOT_SETTINGS.max_runs_per_hour;
  const maxDuration =
    typeof raw.max_job_duration_ms === 'number' && Number.isFinite(raw.max_job_duration_ms)
      ? Math.max(3_000, Math.min(120_000, Math.round(raw.max_job_duration_ms)))
      : DEFAULT_TOWN_AUTOPILOT_SETTINGS.max_job_duration_ms;
  const maxHops =
    typeof raw.max_agent_hops === 'number' && Number.isFinite(raw.max_agent_hops)
      ? Math.max(1, Math.min(8, Math.round(raw.max_agent_hops)))
      : DEFAULT_TOWN_AUTOPILOT_SETTINGS.max_agent_hops;

  return {
    autopilot_enabled:
      typeof raw.autopilot_enabled === 'boolean'
        ? raw.autopilot_enabled
        : DEFAULT_TOWN_AUTOPILOT_SETTINGS.autopilot_enabled,
    max_runs_per_hour: maxRuns,
    max_job_duration_ms: maxDuration,
    max_agent_hops: maxHops,
  };
}

export function createDefaultTownAutomationRules(): TownAutomationRule[] {
  return [
    {
      id: 'cron_morning_triage',
      name: 'Morning Triage (07:30 SAST)',
      description:
        "Scans today's Calendar, monitored Gmail labels (KB-SOP-06), and Plentify OOO; stages a Morning Prep / Focus Buffer packet if gaps or urgent items exist.",
      type: 'cron',
      enabled: true,
      schedule_cron: '30 5 * * 1-5', // 07:30 SAST = 05:30 UTC (Weekdays)
      timezone: 'Africa/Johannesburg',
      target_house: 'daniel',
      config: {
        monitored_gmail_labels: ['INBOX_PRIORITY', 'Meeting Notes'],
        ignore_unread_bulk: true,
        watched_chat_spaces: [],
        packet_ttl_hours: 24,
      },
      updated_at: SEED_UPDATED_AT,
    },
    {
      id: 'cron_midday_replan',
      name: 'Midday Replan (12:30 SAST)',
      description:
        'Checks watched Google Chat spaces (Product Operations, Backend, Integration, Tiger T: Balwin) for unresolved @mentions or blockers; stages thread replies with chatThreadName pre-filled.',
      type: 'cron',
      enabled: true,
      schedule_cron: '30 10 * * 1-5', // 12:30 SAST = 10:30 UTC (Weekdays)
      timezone: 'Africa/Johannesburg',
      target_house: 'daniel',
      config: {
        monitored_gmail_labels: [],
        ignore_unread_bulk: true,
        watched_chat_spaces: [
          'Product Operations',
          'Backend',
          'Integration',
          'Tiger T: Balwin',
        ],
        packet_ttl_hours: 18,
      },
      updated_at: SEED_UPDATED_AT,
    },
    {
      id: 'cron_weekly_kb_hygiene',
      name: 'Weekly Sprint & KB Sync (Mon 08:00 SAST)',
      description:
        'Audits recurring cross-house friction across recent tasks and notes, staging propose_kb_entry updates for CHO review if warranted.',
      type: 'cron',
      enabled: true,
      schedule_cron: '0 6 * * 1', // Monday 08:00 SAST = 06:00 UTC
      timezone: 'Africa/Johannesburg',
      target_house: 'devon',
      config: {
        monitored_gmail_labels: ['Meeting Notes'],
        ignore_unread_bulk: true,
        watched_chat_spaces: ['Product Operations', 'Backend'],
        packet_ttl_hours: 48,
      },
      updated_at: SEED_UPDATED_AT,
    },
    {
      id: 'webhook_gmail_priority',
      name: 'Priority Gmail Label Webhook',
      description:
        'Triggers on new threads in CHO-monitored labels (Meeting Notes, Bitbucket PR tags, CS Insights); hydrates the full thread and stages a Gmail draft when action is needed.',
      type: 'webhook',
      enabled: true,
      timezone: 'Africa/Johannesburg',
      target_house: 'daniel',
      config: {
        monitored_gmail_labels: [
          'Meeting Notes',
          'Bitbucket PR',
          'CS Insights',
          'INBOX_PRIORITY',
        ],
        ignore_unread_bulk: true,
        watched_chat_spaces: [],
        packet_ttl_hours: 24,
      },
      updated_at: SEED_UPDATED_AT,
    },
  ];
}

function cleanStringList(input: unknown, maxItems = 25): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(trimmed);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

export function normalizeTownAutomationRule(
  raw: Partial<TownAutomationRule>,
  fallback?: TownAutomationRule
): TownAutomationRule {
  const base = fallback ?? {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `rule_${Date.now()}`,
    name: 'Automation Rule',
    type: 'cron' as const,
    enabled: true,
    schedule_cron: '30 5 * * 1-5',
    timezone: 'Africa/Johannesburg',
    target_house: 'daniel',
    config: {
      monitored_gmail_labels: [],
      ignore_unread_bulk: true,
      watched_chat_spaces: [],
      packet_ttl_hours: 24,
    },
    updated_at: new Date().toISOString(),
  };

  const type = raw.type === 'webhook' || raw.type === 'cron' ? raw.type : base.type;
  const rawConfig: Partial<TownAutomationRule['config']> = raw.config ?? {};
  const ttlHours =
    typeof rawConfig.packet_ttl_hours === 'number' && Number.isFinite(rawConfig.packet_ttl_hours)
      ? Math.max(1, Math.min(168, Math.round(rawConfig.packet_ttl_hours)))
      : base.config.packet_ttl_hours;

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : base.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : base.name,
    description:
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : base.description,
    type,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
    ...(type === 'cron'
      ? {
          schedule_cron:
            typeof raw.schedule_cron === 'string' && raw.schedule_cron.trim()
              ? raw.schedule_cron.trim()
              : base.schedule_cron || '30 5 * * 1-5',
        }
      : {}),
    timezone:
      typeof raw.timezone === 'string' && raw.timezone.trim()
        ? raw.timezone.trim()
        : base.timezone || 'Africa/Johannesburg',
    target_house:
      typeof raw.target_house === 'string' && raw.target_house.trim()
        ? raw.target_house.trim().toLowerCase()
        : base.target_house || 'daniel',
    config: {
      monitored_gmail_labels:
        rawConfig.monitored_gmail_labels !== undefined
          ? cleanStringList(rawConfig.monitored_gmail_labels)
          : base.config.monitored_gmail_labels ?? [],
      ignore_unread_bulk:
        typeof rawConfig.ignore_unread_bulk === 'boolean'
          ? rawConfig.ignore_unread_bulk
          : base.config.ignore_unread_bulk ?? true,
      watched_chat_spaces:
        rawConfig.watched_chat_spaces !== undefined
          ? cleanStringList(rawConfig.watched_chat_spaces)
          : base.config.watched_chat_spaces ?? [],
      packet_ttl_hours: ttlHours,
    },
    ...(typeof (raw.last_run_at ?? base.last_run_at) === 'string'
      ? { last_run_at: raw.last_run_at ?? base.last_run_at }
      : {}),
    updated_at:
      typeof raw.updated_at === 'string' && raw.updated_at.trim()
        ? raw.updated_at.trim()
        : base.updated_at,
  };
}

export function mergeTownAutomationRules(
  saved?: Partial<TownAutomationRule>[] | null
): TownAutomationRule[] {
  const defaults = createDefaultTownAutomationRules();
  if (!Array.isArray(saved) || saved.length === 0) {
    return defaults;
  }
  const savedById = new Map<string, Partial<TownAutomationRule>>();
  for (const item of saved) {
    if (item && typeof item.id === 'string' && item.id.trim()) {
      savedById.set(item.id.trim(), item);
    }
  }
  const mergedDefaults = defaults.map((def) => {
    const existing = savedById.get(def.id);
    return existing ? normalizeTownAutomationRule(existing, def) : def;
  });
  const defaultIds = new Set(defaults.map((d) => d.id));
  const customRules = saved
    .filter(
      (item): item is Partial<TownAutomationRule> & { id: string } =>
        Boolean(item && typeof item.id === 'string' && item.id.trim() && !defaultIds.has(item.id.trim()))
    )
    .map((item) => normalizeTownAutomationRule(item));
  return [...mergedDefaults, ...customRules];
}

export function isDecisionPacketExpired(
  item: Pick<ApprovalItem | KnowledgeProposal, 'status' | 'ttl_expires_at'>,
  nowMs = Date.now()
): boolean {
  if (item.status === 'expired') return true;
  if (item.status !== 'pending') return false;
  if (!item.ttl_expires_at) return false;
  const expMs = Date.parse(item.ttl_expires_at);
  return Number.isFinite(expMs) && expMs <= nowMs;
}

export function formatPacketTtlLabel(
  ttlExpiresAt?: string,
  nowMs = Date.now()
): { text: string; isUrgent: boolean; isExpired: boolean } | null {
  if (!ttlExpiresAt) return null;
  const expMs = Date.parse(ttlExpiresAt);
  if (!Number.isFinite(expMs)) return null;
  const diffMs = expMs - nowMs;
  if (diffMs <= 0) {
    return { text: 'Expired', isUrgent: true, isExpired: true };
  }
  const totalMins = Math.ceil(diffMs / 60_000);
  if (totalMins < 60) {
    return { text: `Expires in ${totalMins}m`, isUrgent: true, isExpired: false };
  }
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours < 24) {
    return {
      text: mins >= 15 && hours < 4 ? `Expires in ${hours}h ${mins}m` : `Expires in ${hours}h`,
      isUrgent: hours < 3,
      isExpired: false,
    };
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return {
    text: remHours > 0 ? `Expires in ${days}d ${remHours}h` : `Expires in ${days}d`,
    isUrgent: false,
    isExpired: false,
  };
}

export function formatSourceTriggerLabel(
  sourceTrigger?: DecisionPacketSourceTrigger,
  sourceLabel?: string
): string {
  const trigger = sourceTrigger ?? 'chat';
  if (trigger === 'cron') {
    return sourceLabel ? `Cron · ${sourceLabel}` : 'Cron';
  }
  if (trigger === 'webhook') {
    return sourceLabel ? `Webhook · ${sourceLabel}` : 'Webhook';
  }
  return sourceLabel ? `Chat · ${sourceLabel}` : 'Chat';
}

const CRON_DOW_NAMES: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

function isValidCronField(
  token: string,
  min: number,
  max: number
): boolean {
  if (!token) return false;
  const parts = token.split(',');
  for (const part of parts) {
    if (!part) return false;
    const [rangePart, stepPart, extra] = part.split('/');
    if (extra !== undefined) return false;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart) || Number(stepPart) <= 0) return false;
    }
    if (rangePart === '*') continue;
    if (rangePart.includes('-')) {
      const [startStr, endStr, extraDash] = rangePart.split('-');
      if (extraDash !== undefined || !/^\d+$/.test(startStr) || !/^\d+$/.test(endStr)) {
        return false;
      }
      const start = Number(startStr);
      const end = Number(endStr);
      if (start < min || end > max || start > end) return false;
      continue;
    }
    if (!/^\d+$/.test(rangePart)) return false;
    const val = Number(rangePart);
    if (val < min || val > max) return false;
  }
  return true;
}

export function validateCronExpression(cron: string): {
  valid: boolean;
  error?: string;
} {
  const trimmed = cron.trim();
  if (!trimmed) {
    return { valid: false, error: 'Cron schedule cannot be empty.' };
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return {
      valid: false,
      error: `Expected 5 fields (min hour dom month dow), got ${fields.length}.`,
    };
  }
  const [minF, hourF, domF, monF, dowF] = fields;
  if (!isValidCronField(minF, 0, 59)) {
    return { valid: false, error: 'Minute field must be 0–59 (or *, */n, a-b).' };
  }
  if (!isValidCronField(hourF, 0, 23)) {
    return { valid: false, error: 'Hour field must be 0–23 UTC (or *, */n, a-b).' };
  }
  if (!isValidCronField(domF, 1, 31)) {
    return { valid: false, error: 'Day-of-month field must be 1–31 (or *).' };
  }
  if (!isValidCronField(monF, 1, 12)) {
    return { valid: false, error: 'Month field must be 1–12 (or *).' };
  }
  if (!isValidCronField(dowF, 0, 7)) {
    return { valid: false, error: 'Day-of-week field must be 0–7 (0/7=Sun, 1-5=Weekdays).' };
  }
  return { valid: true };
}

function formatDowSummary(dowField: string, dayShift = 0): string {
  if (dowField === '*' || dowField === '0-6' || dowField === '0-7' || dowField === '1-7') {
    return 'Daily';
  }
  if (dowField === '1-5' && dayShift === 0) {
    return 'Weekdays';
  }
  if ((dowField === '0,6' || dowField === '6,0' || dowField === '6-7') && dayShift === 0) {
    return 'Weekends';
  }
  if (/^\d+$/.test(dowField)) {
    const shifted = (((Number(dowField) % 7) + dayShift) % 7 + 7) % 7;
    return CRON_DOW_NAMES[shifted] ?? `DOW ${dowField}`;
  }
  return `DOW ${dowField}`;
}

export function describeCronExpressionSast(
  cronRaw: string,
  timezone = 'Africa/Johannesburg'
): string {
  const trimmed = cronRaw.trim();
  const check = validateCronExpression(trimmed);
  if (!check.valid) {
    return 'Invalid cron syntax';
  }
  const [minF, hourF, domF, monF, dowF] = trimmed.split(/\s+/);
  const isSast = timezone === 'Africa/Johannesburg';

  if (/^\d+$/.test(minF) && /^\d+$/.test(hourF) && domF === '*' && monF === '*') {
    const utcMin = Number(minF);
    const utcHour = Number(hourF);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (isSast) {
      const rawSastHour = utcHour + 2;
      const dayShift = rawSastHour >= 24 ? 1 : 0;
      const sastHour = rawSastHour % 24;
      const dowLabel = formatDowSummary(dowF, dayShift);
      return `${pad(sastHour)}:${pad(utcMin)} SAST (${pad(utcHour)}:${pad(utcMin)} UTC) · ${dowLabel}`;
    }
    return `${pad(utcHour)}:${pad(utcMin)} UTC · ${formatDowSummary(dowF, 0)}`;
  }

  if (minF.startsWith('*/') && hourF === '*' && domF === '*' && monF === '*') {
    return `Every ${minF.slice(2)}m · ${formatDowSummary(dowF, 0)}`;
  }

  if (/^\d+$/.test(minF) && hourF.startsWith('*/') && domF === '*' && monF === '*') {
    return `Every ${hourF.slice(2)}h at :${String(Number(minF)).padStart(2, '0')} · ${formatDowSummary(dowF, 0)}`;
  }

  return `${trimmed} (${isSast ? 'UTC → SAST' : timezone})`;
}

export function describeRuleScheduleLabel(rule: TownAutomationRule): string {
  if (rule.type === 'webhook') {
    return 'Event-driven webhook';
  }
  const cron = (rule.schedule_cron || '').trim();
  if (!cron) return 'Scheduled';
  return describeCronExpressionSast(cron, rule.timezone || 'Africa/Johannesburg');
}
