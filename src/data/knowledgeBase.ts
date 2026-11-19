import type { Agent, KnowledgeCategory, KnowledgeEntry } from '../types/village.ts';

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  constitution: 'Constitution',
  handoff_template: 'Handoffs & SOPs',
  research_brief: 'Research Briefs',
  house_memory: 'House Memory',
};

export const KB_CANONICAL_ID_REGEX = /^KB-(GOV|SOP|RES)-\d{2,}$/;

export function isValidCanonicalKbId(id: string): boolean {
  return KB_CANONICAL_ID_REGEX.test((id || '').trim());
}

export function categoryFromKbCode(code: string): Exclude<KnowledgeCategory, 'house_memory'> {
  const upper = (code || '').trim().toUpperCase();
  if (upper.startsWith('KB-GOV-')) return 'constitution';
  if (upper.startsWith('KB-RES-')) return 'research_brief';
  return 'handoff_template';
}

const SEED_TIMESTAMP = '2026-11-13T09:00:00.000Z';

export function createInitialKnowledgeBase(): KnowledgeEntry[] {
  return [
    {
      id: 'kb_gov_01',
      code: 'KB-GOV-01',
      title: 'Village Constitution & Human-in-the-Loop Governance',
      category: 'constitution',
      department: 'All Houses',
      maintainedBy: 'You (CHO) & Matt',
      summary:
        'Immutable executive guardrails governing Gmail drafts, spending, public publishing, production systems, and hiring.',
      contentMarkdown: [
        '### Binding Governance Clauses',
        '1. **Draft-Only Email Policy**: Every outbound email prepared by Inbox & Calendar or any guild house remains an un-sent draft until explicitly approved by the Chief Human Officer (CHO).',
        '2. **Zero Autonomous Spend**: No Director or Guild Specialist may purchase SaaS subscriptions, authorize vendor invoices, or book paid travel without explicit CHO sign-off.',
        '3. **Zero Unapproved Public Publishing**: Video uploads, social posts, and newsletters stay staged for CHO approval before external release.',
        '4. **Production & Credentials Boundary**: Systems & Dev never rotates live production secrets or deploys breaking schema migrations without CHO authorization.',
        '5. **Town Hall Hiring Protocol**: Every new Guild Specialist candidate is sourced by Matt, interviewed in Town Hall, and approved by the CHO.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
      locked: true,
      version: 1,
    },
    {
      id: 'kb_gov_02',
      code: 'KB-GOV-02',
      title: 'Single Source of Truth Charter (Replacing Decentralized Wikis)',
      category: 'constitution',
      department: 'All Houses',
      maintainedBy: 'Aria, Zoe & Eli',
      summary:
        'Consolidates all SOPs, handoff contracts, house notes, and verified research into one indexed repository with Propose & Approve CHO governance.',
      contentMarkdown: [
        '### Why Decentralized House Wikis Are Retired',
        '- Separate per-house notes and informal wiki pages caused contradictory SOP steps and repeated courtyard status checks.',
        '- **Canonical Ground Truth**: Every Director and Guild Specialist operates from this indexed `KB-*` repository.',
        '',
        '### Propose & Approve Stewardship Protocol',
        '- **Research & Intel (`Aria` & `Zoe`)** verify external facts, citations, and benchmark briefs (`KB-RES-*`).',
        '- **Operations House (`Eli` & `Devon`)** maintain cross-house handoff templates and standard operating procedures (`KB-SOP-*`).',
        '- **Zero Direct Agent Writes**: Agents propose updates via `propose_kb_entry` as `pending` CHO Decision Packets; only explicit CHO approval commits live `KB-*` versions.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
      locked: true,
      version: 1,
    },
    {
      id: 'kb_sop_01',
      code: 'KB-SOP-01',
      title: 'Hub-and-Spoke Multi-House Orchestration & Director Synthesis SOP',
      category: 'handoff_template',
      department: 'Operations House',
      maintainedBy: 'Eli & Devon · Operations House',
      summary:
        'Canonical Hub-and-Spoke routing hierarchy: Matt → Coordinating House Director → Guild Specialists / Cross-House Directors → Coordinating Director synthesis → CHO.',
      contentMarkdown: [
        '### Hub-and-Spoke Execution Hierarchy',
        '1. **Triage (`Matt`)**: Classify incoming CHO request by primary House, determine live Google Search grounding needs, and route to the Coordinating House Director.',
        '2. **Typed Cross-Agent Handoffs (`dispatch_handoff`)**: Coordinating House Director dispatches structured JSON handoff packets (`KB-SOP-02`) to their Guild Specialist(s) and any required cross-House Directors or Specialists within a shared `task_id` thread.',
        '3. **Director Audit & Unified Synthesis (`House Director`)**: Verify specialist outputs against `KB-*`, enforce `KB-GOV-01` HITL gates, and return **one unified executive deliverable** to the CHO.',
        '4. **Fail-Closed Loop Caps**: Enforce hard depth (`3`) and hop (`6`) ceilings; abort cleanly and surface a status error rather than spinning or fabricating handoffs.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
      version: 1,
    },
    {
      id: 'kb_sop_02',
      code: 'KB-SOP-02',
      title: 'Typed Cross-Agent Handoff Packet & Idempotent Integration Contract',
      category: 'handoff_template',
      department: 'Systems & Dev',
      maintainedBy: 'Eli, Kieran & Toby',
      summary:
        'Strict JSON handoff schema (`task_id`, `from_agent`, `to_agent`, `objective`, `kb_refs`, `verified_facts`, `constraints`, `expected_output_schema`, `status`) and idempotent API rules.',
      contentMarkdown: [
        '### Mandatory Typed Handoff Schema (`KB-SOP-02`)',
        '- **Packet Fields**: `task_id`, `from_agent`, `to_agent`, `objective`, `kb_refs` (`KB-*` array), `verified_facts`, `constraints`, `expected_output_schema`, and `status`.',
        '- **Shared Thread Context**: Every invoked agent receives the live Centralized Knowledge Base (`KB-*`) plus the active `task_id` handoff packet and prior verified thread artifacts.',
        '- **Idempotency & Retry Contract**: Deterministic `Idempotency-Key` header on state-mutating commits, atomic storage writes, and fail-closed error reporting.',
        '- **Auth & Scope Boundary**: Least-privilege OAuth2 scopes and server-side secret isolation; CHO approval required before production or external mutations.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
      version: 1,
    },
    {
      id: 'kb_sop_03',
      code: 'KB-SOP-03',
      title: 'Creator Episode Packaging & Launch Comms Handoff',
      category: 'handoff_template',
      department: 'YouTube Studio',
      maintainedBy: 'Eli, Elena & Layla',
      summary:
        'Unified handoff from Research & Intel and YouTube Studio to Creative & Comms so scripts, titles, and launch posts share identical facts.',
      contentMarkdown: [
        '### Cross-House Packaging Sequence',
        '1. **Verified Fact Sheet (`Aria` & `Zoe`)**: Citation-backed stats and competitive angles logged under `KB-RES-*`.',
        '2. **Script & Retention Package (`Elena` & `Maya`)**: 3 title options, 3-word thumbnail visual brief, and timestamped 10-minute outline.',
        '3. **Launch Copy Staging (`Layla` & `Nora`)**: Companion newsletter and social announcement drafted from the exact approved hook and staged in Pending Approvals.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: 'kb_sop_04',
      code: 'KB-SOP-04',
      title: 'Vendor Quote Comparison & Spend Approval Handoff',
      category: 'handoff_template',
      department: 'Finance & Money',
      maintainedBy: 'Eli, Marcus & Leo',
      summary:
        'Mandatory financial checklist before any vendor purchase, retreat booking, or SaaS tool is queued for CHO spend approval.',
      contentMarkdown: [
        '### Pre-Approval Ledger Checklist',
        '- **3-Option Matrix**: Minimum three comparable vendors or venues with verified current pricing (`Zoe` + `Leo`).',
        '- **Total Cost Breakdown**: Base rate, taxes/fees, seat scaling, and monthly vs. annual commitment.',
        '- **Cancellation & Lock-In Terms**: Refund window and data export guarantees.',
        '- **CHO Approval Payload**: Exact vendor name, total amount, and 1-sentence ROI rationale staged in Approvals.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: 'kb_res_01',
      code: 'KB-RES-01',
      title: 'Single-Repository Knowledge Architecture & Courtyard Sync Reduction',
      category: 'research_brief',
      department: 'Research & Intel',
      maintainedBy: 'Aria & Zoe · Research & Intel',
      summary:
        'Internal audit confirming that consolidating SOPs and house notes into one indexed store eliminates conflicting worker instructions.',
      contentMarkdown: [
        '### Verified Findings',
        '- **Root Cause Identified**: Maintaining separate per-guild mini-wikis caused drift between Operations checklists, Systems & Dev webhook specs, and Creative launch templates.',
        '- **Resolution**: Indexing every governance clause (`KB-GOV-*`), handoff SOP (`KB-SOP-*`), verified brief (`KB-RES-*`), and consolidated house memory (`KB-MEM-*`) gives all 18 village members identical context.',
        '- **Operational Impact**: Courtyard conversations now exchange delta updates tied to canonical `KB-*` IDs instead of re-deriving workflows from scratch.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
    },
    {
      id: 'kb_res_02',
      code: 'KB-RES-02',
      title: 'API Reliability, OAuth Token Hygiene & Idempotent Event Pipelines',
      category: 'research_brief',
      department: 'Systems & Dev',
      maintainedBy: 'Aria, Zoe & Kieran',
      summary:
        'Verified engineering reference for Google Workspace OAuth2 token handling, webhook signature verification, and resilient retries.',
      contentMarkdown: [
        '### Canonical Engineering Standards',
        '- **OAuth2 Memory Discipline**: Google Workspace access tokens live strictly in client memory and renew silently via Google Identity Services; only non-secret briefing metadata is snapshotted.',
        '- **Webhook Verification**: Verify HMAC signatures on raw request bodies before JSON parsing and enforce 5-minute replay windows.',
        '- **Idempotent Writes**: Deduplicate upstream retries on `(provider, event_id)` before mutating downstream state or queueing notifications.',
      ].join('\n'),
      updatedAt: SEED_TIMESTAMP,
    },
  ];
}

/**
 * Merges persisted Knowledge Base entries with canonical seed entries so core
 * locked governance & starter SOPs are always present while preserving user edits and additions.
 */
export function mergeKnowledgeBase(saved?: KnowledgeEntry[] | null): KnowledgeEntry[] {
  const defaults = createInitialKnowledgeBase();
  if (!Array.isArray(saved) || saved.length === 0) {
    return defaults;
  }

  const savedById = new Map<string, KnowledgeEntry>();
  const savedByCode = new Map<string, KnowledgeEntry>();
  for (const item of saved) {
    if (item && typeof item.id === 'string' && typeof item.title === 'string') {
      savedById.set(item.id, item);
      if (typeof item.code === 'string' && item.code.trim()) {
        savedByCode.set(item.code.trim().toUpperCase(), item);
      }
    }
  }

  const mergedDefaults = defaults.map((def) => {
    const existing = savedById.get(def.id) ?? savedByCode.get(def.code.toUpperCase());
    if (!existing) {
      return { ...def, version: def.version ?? 1 };
    }
    // Core KB-GOV-01 & KB-GOV-02 remain locked unless explicitly committed via CHO Approval
    if (def.locked && !existing.approvedByCho) {
      return { ...def, version: def.version ?? 1 };
    }
    return {
      ...def,
      ...existing,
      id: def.id,
      code: existing.code || def.code,
      version: typeof existing.version === 'number' && existing.version >= 1 ? existing.version : 1,
      versionHistory: Array.isArray(existing.versionHistory) ? existing.versionHistory : [],
    };
  });

  const defaultIds = new Set(defaults.map((d) => d.id));
  const defaultCodes = new Set(defaults.map((d) => d.code.toUpperCase()));
  const customEntries = saved
    .filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        !defaultIds.has(item.id) &&
        !(typeof item.code === 'string' && defaultCodes.has(item.code.trim().toUpperCase()))
    )
    .map((item) => ({
      ...item,
      version: typeof item.version === 'number' && item.version >= 1 ? item.version : 1,
      versionHistory: Array.isArray(item.versionHistory) ? item.versionHistory : [],
    }));

  return [...mergedDefaults, ...customEntries];
}

/**
 * Dynamically builds deduplicated House Memory entries (`KB-MEM-*`) from the live village roster
 * so every house's folder notes are searchable in the Single Source of Truth.
 */
export function buildConsolidatedHouseMemoryEntries(agents: Agent[]): KnowledgeEntry[] {
  const byDepartment = new Map<
    string,
    {
      department: string;
      members: string[];
      notes: string[];
    }
  >();

  for (const agent of agents) {
    if (agent.role === 'cho') continue;
    const dept = agent.department || 'Village';
    const bucket = byDepartment.get(dept) ?? {
      department: dept,
      members: [],
      notes: [],
    };
    bucket.members.push(`${agent.name} (${agent.title})`);
    for (const rawNote of agent.notes ?? []) {
      const trimmed = rawNote.trim();
      if (!trimmed) continue;
      const isDuplicate = bucket.notes.some(
        (n) => n.toLowerCase() === trimmed.toLowerCase()
      );
      if (!isDuplicate) {
        bucket.notes.push(trimmed);
      }
    }
    byDepartment.set(dept, bucket);
  }

  let idx = 1;
  const entries: KnowledgeEntry[] = [];
  for (const bucket of byDepartment.values()) {
    const codeNum = String(idx).padStart(2, '0');
    idx += 1;
    const recentNotes = bucket.notes.slice(-8);
    entries.push({
      id: `kb_mem_${bucket.department.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      code: `KB-MEM-${codeNum}`,
      title: `${bucket.department} — Consolidated House Memory`,
      category: 'house_memory',
      department: bucket.department,
      maintainedBy: bucket.members.map((m) => m.split(' (')[0]).join(' & '),
      summary: `${recentNotes.length} deduplicated operational memory notes across ${bucket.members.length} house member(s).`,
      contentMarkdown: [
        `### House Roster`,
        ...bucket.members.map((m) => `- ${m}`),
        '',
        `### Deduplicated Ground-Truth Notes`,
        ...(recentNotes.length > 0
          ? recentNotes.map((n) => `- ${n}`)
          : ['- No house notes logged yet.']),
      ].join('\n'),
      updatedAt: new Date().toISOString(),
      locked: true,
    });
  }

  return entries;
}

/**
 * Formats the Centralized Village Knowledge Base into a concise, structured ground-truth prompt block
 * injected into every Worker, Director, Chief of Staff, and Town Hall Gemini call.
 */
export function buildKnowledgeGroundTruthBlock(
  entries: KnowledgeEntry[],
  targetDepartment?: string,
  houseNotes?: Record<string, string[]>,
  pinnedKbRefs?: string[]
): string {
  const safeEntries = mergeKnowledgeBase(entries);
  const pinnedSet = new Set(
    (pinnedKbRefs ?? []).map((r) => (r || '').trim().toUpperCase()).filter(Boolean)
  );

  const pinnedEntries = safeEntries.filter((e) => pinnedSet.has(e.code.toUpperCase()));
  const prioritized = safeEntries.filter((e) => {
    if (pinnedSet.has(e.code.toUpperCase())) return false;
    if (e.category === 'constitution') return true;
    if (!targetDepartment) return true;
    return (
      e.department === 'All Houses' ||
      e.department === 'Operations House' ||
      e.department === 'Research & Intel' ||
      e.department.toLowerCase() === targetDepartment.toLowerCase()
    );
  });

  const rest = safeEntries
    .filter((e) => !pinnedEntries.includes(e) && !prioritized.includes(e))
    .slice(0, 4);
  const selected = [...pinnedEntries, ...prioritized, ...rest].slice(0, 14);

  const lines: string[] = [
    'CENTRALIZED VILLAGE KNOWLEDGE BASE (SINGLE SOURCE OF TRUTH — CO-LED BY ARIA, ZOE & ELI):',
    'Every Director and Guild Specialist operates from this identical repository. Never invent contradictory local wiki rules, and NEVER write directly to the live Knowledge Base (stage proposals via propose_kb_entry for CHO approval).',
  ];

  for (const entry of selected) {
    const isPinned = pinnedSet.has(entry.code.toUpperCase());
    const verLabel = `v${entry.version ?? 1}`;
    const bodyText = isPinned
      ? entry.contentMarkdown.trim()
      : entry.contentMarkdown
          .replace(/\n+/g, ' ')
          .replace(/\s+/g, ' ')
          .slice(0, 340);
    lines.push(
      `- [${entry.code} · ${verLabel}] ${entry.title} (${entry.department} · ${entry.maintainedBy})${isPinned ? ' [PINNED HANDOFF REF]' : ''}: ${entry.summary} | Details: ${bodyText}`
    );
  }

  if (houseNotes && Object.keys(houseNotes).length > 0) {
    const noteSnippets: string[] = [];
    for (const [agentId, notes] of Object.entries(houseNotes)) {
      if (Array.isArray(notes) && notes.length > 0) {
        noteSnippets.push(`  * ${agentId}: ${notes.slice(-2).join(' ; ')}`);
      }
    }
    if (noteSnippets.length > 0) {
      lines.push('CONSOLIDATED HOUSE MEMORY SNAPSHOT:');
      lines.push(...noteSnippets.slice(0, 10));
    }
  }

  return lines.join('\n');
}

export function nextKnowledgeCode(
  entries: KnowledgeEntry[],
  category: Exclude<KnowledgeCategory, 'house_memory'>
): string {
  const prefix =
    category === 'constitution'
      ? 'KB-GOV-'
      : category === 'handoff_template'
        ? 'KB-SOP-'
        : 'KB-RES-';
  let maxNum = 0;
  for (const e of entries) {
    if (e.code.startsWith(prefix)) {
      const n = Number.parseInt(e.code.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(2, '0')}`;
}
