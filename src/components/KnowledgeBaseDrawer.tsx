import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  buildConsolidatedHouseMemoryEntries,
} from '../data/knowledgeBase';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';
import { FormattedMarkdown } from './FormattedMarkdown';
import { SpeakButton } from './SpeakButton';
import type {
  Agent,
  KnowledgeCategory,
  KnowledgeEntry,
} from '../types/village';

type FilterTab = 'all' | KnowledgeCategory;

const HOUSE_OPTIONS = [
  'All Houses',
  'Research & Intel',
  'Operations House',
  'Systems & Dev',
  'Inbox & Calendar',
  'Finance & Money',
  'YouTube Studio',
  'Creative & Comms',
  'Health & Home',
  'Town Hall Dispatch',
];

interface KnowledgeBaseDrawerProps {
  entries: KnowledgeEntry[];
  agents: Agent[];
  pendingProposalsCount?: number;
  initialDepartmentFilter?: string;
  isConsolidating: boolean;
  onClose: () => void;
  onOpenProposals?: () => void;
  onSaveEntry: (entry: Partial<KnowledgeEntry>) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onConsolidate: (focusTopic?: string) => Promise<string>;
  onPrefillTask: (prompt: string) => void;
  onOpenAgentChat: (agent: Agent) => void;
}

function formatShortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export const KnowledgeBaseDrawer: React.FC<KnowledgeBaseDrawerProps> = ({
  entries,
  agents,
  pendingProposalsCount = 0,
  initialDepartmentFilter = 'all',
  isConsolidating,
  onClose,
  onOpenProposals,
  onSaveEntry,
  onDeleteEntry,
  onConsolidate,
  onPrefillTask,
  onOpenAgentChat,
}) => {
  const [filterTab, setFilterTab] = useState<FilterTab>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>(initialDepartmentFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(entries[0]?.id ?? null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [focusPrompt, setFocusPrompt] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Create / Edit Form State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formCategory, setFormCategory] = useState<'handoff_template' | 'research_brief'>(
    'handoff_template'
  );
  const [formDepartment, setFormDepartment] = useState<string>('Operations House');
  const [formMaintainedBy, setFormMaintainedBy] = useState<string>('Aria, Zoe & Eli');
  const [formTitle, setFormTitle] = useState<string>('');
  const [formSummary, setFormSummary] = useState<string>('');
  const [formContent, setFormContent] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const coLeads = useMemo(() => {
    const ids = ['aria', 'worker_aria', 'worker_devon'];
    return ids
      .map((id) => agents.find((a) => a.id === id))
      .filter((a): a is Agent => Boolean(a));
  }, [agents]);

  const houseMemoryEntries = useMemo(
    () => buildConsolidatedHouseMemoryEntries(agents),
    [agents]
  );

  const allCombinedEntries = useMemo(
    () => [...entries, ...houseMemoryEntries],
    [entries, houseMemoryEntries]
  );

  const categoryCounts = useMemo(() => {
    return {
      all: allCombinedEntries.length,
      constitution: entries.filter((e) => e.category === 'constitution').length,
      handoff_template: entries.filter((e) => e.category === 'handoff_template').length,
      research_brief: entries.filter((e) => e.category === 'research_brief').length,
      house_memory: houseMemoryEntries.length,
    };
  }, [allCombinedEntries.length, entries, houseMemoryEntries.length]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCombinedEntries.filter((entry) => {
      if (filterTab !== 'all' && entry.category !== filterTab) {
        return false;
      }
      if (
        departmentFilter !== 'all' &&
        entry.department !== 'All Houses' &&
        entry.department !== departmentFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        entry.code.toLowerCase().includes(q) ||
        entry.title.toLowerCase().includes(q) ||
        entry.department.toLowerCase().includes(q) ||
        entry.maintainedBy.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q) ||
        entry.contentMarkdown.toLowerCase().includes(q)
      );
    });
  }, [allCombinedEntries, filterTab, departmentFilter, searchQuery]);

  const openNewEditor = (presetCategory?: 'handoff_template' | 'research_brief') => {
    setEditingId(null);
    setFormCategory(presetCategory ?? 'handoff_template');
    setFormDepartment(
      departmentFilter !== 'all'
        ? departmentFilter
        : presetCategory === 'research_brief'
          ? 'Research & Intel'
          : 'Operations House'
    );
    setFormMaintainedBy(
      presetCategory === 'research_brief'
        ? 'Aria & Zoe · Research & Intel'
        : 'Eli & Devon · Operations House'
    );
    setFormTitle('');
    setFormSummary('');
    setFormContent('');
    setIsEditorOpen(true);
  };

  const openEditEntry = (entry: KnowledgeEntry) => {
    if (entry.locked || entry.category === 'house_memory') return;
    setEditingId(entry.id);
    setFormCategory(
      entry.category === 'research_brief' ? 'research_brief' : 'handoff_template'
    );
    setFormDepartment(entry.department);
    setFormMaintainedBy(entry.maintainedBy);
    setFormTitle(entry.title);
    setFormSummary(entry.summary);
    setFormContent(entry.contentMarkdown);
    setIsEditorOpen(true);
  };

  const handleSubmitEditor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formContent.trim() || isSaving) return;
    setIsSaving(true);
    setStatusBanner(null);
    try {
      await onSaveEntry({
        id: editingId ?? undefined,
        category: formCategory,
        department: formDepartment,
        maintainedBy: formMaintainedBy.trim() || 'Aria, Zoe & Eli',
        title: formTitle.trim(),
        summary: formSummary.trim() || formTitle.trim(),
        contentMarkdown: formContent.trim(),
      });
      setIsEditorOpen(false);
      setStatusBanner(
        editingId
          ? 'Updated entry in the Village Single Source of Truth.'
          : 'Indexed new entry into the Village Single Source of Truth.'
      );
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Unable to save entry.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunConsolidate = async () => {
    if (isConsolidating) return;
    setStatusBanner(null);
    try {
      const msg = await onConsolidate(focusPrompt.trim() || undefined);
      setFocusPrompt('');
      setStatusBanner(msg);
    } catch (err) {
      setStatusBanner(err instanceof Error ? err.message : 'Consolidation failed.');
    }
  };

  return (
    <aside className="absolute right-3 top-3 bottom-3 z-30 w-[580px] max-w-[calc(100vw-1.5rem)] flex flex-col rounded-xl border border-slate-700/80 bg-slate-900/95 shadow-2xl backdrop-blur-md overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-amber-400 shrink-0" />
            <h2 className="text-base font-semibold text-white truncate">
              Village Knowledge Base
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400 truncate tabular-nums">
            Single Source of Truth · Co-led by Aria, Zoe &amp; Eli · {allCombinedEntries.length} indexed records
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => openNewEditor('handoff_template')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-100 hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5 text-amber-400" />
            <span>New Entry</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Knowledge Base"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Co-Leads Strip & AI Consolidation Bar */}
      <div className="border-b border-slate-800 bg-slate-950/60 px-4 py-2.5 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex -space-x-1.5 shrink-0">
              {coLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => onOpenAgentChat(lead)}
                  title={`Talk to ${lead.name} (${lead.department})`}
                  className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 bg-slate-900 hover:border-amber-400 cursor-pointer overflow-hidden"
                >
                  <CharacterSpriteBadge agent={lead} size={26} />
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-300 truncate">
              Replaces fragmented house wikis · Every worker reads identical <span className="font-mono text-amber-300">KB-*</span> rules
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={focusPrompt}
            onChange={(e) => setFocusPrompt(e.target.value)}
            placeholder="Optional focus (e.g., Deduplicate webhook & calendar handoff rules)..."
            className="flex-1 min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void handleRunConsolidate()}
            disabled={isConsolidating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60 cursor-pointer whitespace-nowrap shrink-0"
          >
            {isConsolidating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Consolidating...</span>
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Sync &amp; Deduplicate</span>
              </>
            )}
          </button>
        </div>
      </div>

      {pendingProposalsCount > 0 && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-amber-950/35 px-4 py-2 text-xs text-amber-200">
          <span className="truncate tabular-nums">
            <strong className="font-semibold text-amber-300">{pendingProposalsCount}</strong>{' '}
            pending <span className="font-mono">KB-*</span> proposal
            {pendingProposalsCount === 1 ? '' : 's'} staged for CHO approval
          </span>
          {onOpenProposals && (
            <button
              type="button"
              onClick={onOpenProposals}
              className="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
            >
              Review Decision Packets
            </button>
          )}
        </div>
      )}

      {statusBanner && (
        <div className="border-b border-slate-800 bg-emerald-950/60 px-4 py-2 text-xs text-emerald-200">
          {statusBanner}
        </div>
      )}

      {/* Inline Editor Modal Section */}
      {isEditorOpen ? (
        <form
          onSubmit={(e) => void handleSubmitEditor(e)}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {editingId ? 'Edit Canonical Knowledge Entry' : 'New Canonical Knowledge Entry'}
            </h3>
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Entry Type
              </label>
              <select
                value={formCategory}
                onChange={(e) =>
                  setFormCategory(e.target.value as 'handoff_template' | 'research_brief')
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              >
                <option value="handoff_template">Handoff Template &amp; SOP (KB-SOP-*)</option>
                <option value="research_brief">Verified Research Brief (KB-RES-*)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Target House
              </label>
              <select
                value={formDepartment}
                onChange={(e) => setFormDepartment(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              >
                {HOUSE_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Title
            </label>
            <input
              type="text"
              required
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder="e.g., Stripe → Postgres Webhook Retry & Alerting SOP"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Maintained By
              </label>
              <input
                type="text"
                value={formMaintainedBy}
                onChange={(e) => setFormMaintainedBy(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white focus:border-amber-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                One-Line Summary
              </label>
              <input
                type="text"
                value={formSummary}
                onChange={(e) => setFormSummary(e.target.value)}
                placeholder="Brief ground-truth takeaway for workers"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Canonical Specification / Steps (Markdown)
            </label>
            <textarea
              rows={8}
              required
              value={formContent}
              onChange={(e) => setFormContent(e.target.value)}
              placeholder="Write clear steps, handoff inputs/outputs, or verified facts..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setIsEditorOpen(false)}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || !formTitle.trim() || !formContent.trim()}
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? 'Saving...' : editingId ? 'Save Changes' : 'Index Entry'}
            </button>
          </div>
        </form>
      ) : (
        <>
          {/* Search & Interactive Segmented Filters */}
          <div className="border-b border-slate-800 bg-slate-950/40 px-4 py-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search KB codes, SOPs, handoff templates, house notes..."
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
                />
              </div>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                aria-label="Filter by village house"
                className="rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 focus:border-amber-500 focus:outline-none shrink-0"
              >
                <option value="all">All Houses</option>
                {HOUSE_OPTIONS.filter((h) => h !== 'All Houses').map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              {(
                [
                  ['all', `All (${categoryCounts.all})`],
                  ['constitution', `Constitution (${categoryCounts.constitution})`],
                  ['handoff_template', `Handoffs & SOPs (${categoryCounts.handoff_template})`],
                  ['research_brief', `Research Briefs (${categoryCounts.research_brief})`],
                  ['house_memory', `House Memory (${categoryCounts.house_memory})`],
                ] as Array<[FilterTab, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterTab(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                    filterTab === key
                      ? 'bg-slate-800 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Indexed Ground-Truth Entries List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
            {filteredEntries.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-6 text-center space-y-2.5">
                <p className="text-xs text-slate-300">
                  No Knowledge Base records match your current search or house filter.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterTab('all');
                    setDepartmentFilter('all');
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  Reset Filters
                </button>
              </div>
            ) : (
              filteredEntries.map((entry) => {
                const isExpanded = expandedId === entry.id;
                return (
                  <div
                    key={entry.id}
                    className={`rounded-lg border transition-colors ${
                      isExpanded
                        ? 'border-slate-700 bg-slate-950/85'
                        : 'border-slate-800/90 bg-slate-950/50 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                      className="w-full p-3.5 text-left cursor-pointer"
                    >
                      {/* Clean unboxed inline metadata with typographic separators */}
                      <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5 min-w-0 truncate">
                          <span className="font-mono font-medium text-amber-300 tabular-nums shrink-0">
                            {entry.code}
                          </span>
                          {entry.category !== 'house_memory' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-slate-300 tabular-nums shrink-0">
                                v{entry.version ?? 1}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0">
                            {KNOWLEDGE_CATEGORY_LABELS[entry.category]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{entry.department}</span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{entry.maintainedBy}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                          <span>{formatShortDate(entry.updatedAt)}</span>
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                          )}
                        </div>
                      </div>

                      <h3 className="mt-1 text-sm font-semibold text-white">
                        {entry.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                        {entry.summary}
                      </p>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-800/80 px-3.5 py-3 space-y-3">
                        <div className="rounded-lg border border-slate-800/70 bg-slate-900/60 p-3">
                          <FormattedMarkdown compact content={entry.contentMarkdown} />
                        </div>

                        {entry.versionHistory && entry.versionHistory.length > 0 && (
                          <div className="rounded-lg border border-slate-800/80 bg-slate-950/70 p-2.5 space-y-1.5">
                            <p className="text-[11px] font-semibold text-slate-300 tabular-nums">
                              Committed Version History ({entry.versionHistory.length}{' '}
                              {entry.versionHistory.length === 1 ? 'snapshot' : 'snapshots'})
                            </p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                              {[...entry.versionHistory]
                                .reverse()
                                .map((snap) => (
                                  <div
                                    key={`${snap.version}_${snap.updatedAt}`}
                                    className="flex items-center justify-between gap-2 text-[11px] text-slate-400 border-t border-slate-800/60 pt-1 first:border-t-0 first:pt-0"
                                  >
                                    <span className="truncate">
                                      <span className="font-mono text-amber-300 tabular-nums">
                                        v{snap.version}
                                      </span>{' '}
                                      · {snap.title} · <span className="text-slate-500">{snap.owners}</span>
                                    </span>
                                    <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                                      {formatShortDate(snap.updatedAt)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {entry.sources && entry.sources.length > 0 && (
                          <div className="space-y-1">
                            <p className="text-[11px] font-medium text-slate-400">
                              Verified Citations
                            </p>
                            {entry.sources.map((src) => (
                              <a
                                key={src.uri}
                                href={src.uri}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-xs text-sky-400 hover:underline truncate"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{src.title}</span>
                              </a>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {(() => {
                              const stewardId =
                                entry.category === 'research_brief'
                                  ? 'aria'
                                  : entry.category === 'constitution'
                                    ? 'matt'
                                    : 'worker_devon';
                              const steward = agents.find((a) => a.id === stewardId);
                              return (
                                <SpeakButton
                                  variant="secondary"
                                  itemId={`kb_listen_${entry.id}`}
                                  label={`Listen (${steward?.name ?? 'Aria'})`}
                                  turn={{
                                    agentId: stewardId,
                                    speakerName: steward?.name ?? 'Aria',
                                    title: steward?.title,
                                    department: steward?.department,
                                    voiceName: steward?.voiceName,
                                    text: `${entry.code}: ${entry.title}. ${entry.summary}. ${entry.contentMarkdown}`,
                                    maxChars: 2200,
                                  }}
                                />
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() =>
                                onPrefillTask(
                                  `Apply [${entry.code}] (${entry.title}) to execute: `
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <Send className="h-3 w-3 text-amber-400" />
                              <span>Use in Task</span>
                            </button>

                            {entry.category === 'house_memory' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(null);
                                  setFormCategory('handoff_template');
                                  setFormDepartment(entry.department);
                                  setFormMaintainedBy('Aria, Zoe & Eli');
                                  setFormTitle(`${entry.department} Standard Operating Procedure`);
                                  setFormSummary(
                                    `Formalized SOP synthesized from ${entry.department} house notes.`
                                  );
                                  setFormContent(entry.contentMarkdown);
                                  setIsEditorOpen(true);
                                }}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <Plus className="h-3 w-3 text-emerald-400" />
                                <span>Promote to SOP</span>
                              </button>
                            )}

                            {!entry.locked && entry.category !== 'house_memory' && (
                              <button
                                type="button"
                                onClick={() => openEditEntry(entry)}
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <PencilLine className="h-3 w-3" />
                                <span>Edit</span>
                              </button>
                            )}
                          </div>

                          {!entry.locked && entry.category !== 'house_memory' && (
                            <div>
                              {confirmDeleteId === entry.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteEntry(entry.id);
                                      setConfirmDeleteId(null);
                                    }}
                                    className="rounded-md bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-500 cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Confirm Delete
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(entry.id)}
                                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-rose-950/50 hover:text-rose-300 cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  <span>Remove</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </aside>
  );
};
