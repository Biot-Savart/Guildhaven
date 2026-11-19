import React, { useMemo, useState } from 'react';
import {
  Check,
  Edit3,
  FileDiff,
  Loader2,
  RotateCcw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  formatPacketTtlLabel,
  formatSourceTriggerLabel,
  isDecisionPacketExpired,
} from '../data/automationDefaults';
import type { KnowledgeEntry, KnowledgeProposal } from '../types/village';

export interface KbProposalEdits {
  title: string;
  scope: string;
  owners: string;
  summary: string;
  details: string;
}

interface KbDecisionPacketCardProps {
  proposal: KnowledgeProposal;
  liveEntry?: KnowledgeEntry;
  busyState?: 'approving' | 'revising' | 'rejecting' | null;
  onApprove: (proposal: KnowledgeProposal, edits?: KbProposalEdits) => Promise<void> | void;
  onRequestRevision: (proposal: KnowledgeProposal, feedback: string) => Promise<void> | void;
  onReject: (proposal: KnowledgeProposal, reason?: string) => Promise<void> | void;
  nowTickMs?: number;
}

interface DiffLine {
  text: string;
  changed: boolean;
}

function computeSideBySideLines(beforeText: string, afterText: string): {
  left: DiffLine[];
  right: DiffLine[];
} {
  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const afterSet = new Set(afterLines.map((l) => l.trim()));
  const beforeSet = new Set(beforeLines.map((l) => l.trim()));

  return {
    left: beforeLines.map((line) => ({
      text: line,
      changed: Boolean(line.trim()) && !afterSet.has(line.trim()),
    })),
    right: afterLines.map((line) => ({
      text: line,
      changed: Boolean(line.trim()) && !beforeSet.has(line.trim()),
    })),
  };
}

export const KbDecisionPacketCard: React.FC<KbDecisionPacketCardProps> = ({
  proposal,
  liveEntry,
  busyState = null,
  onApprove,
  onRequestRevision,
  onReject,
  nowTickMs = Date.now(),
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(proposal.title);
  const [scope, setScope] = useState(proposal.scope);
  const [owners, setOwners] = useState(proposal.owners);
  const [summary, setSummary] = useState(proposal.summary);
  const [details, setDetails] = useState(proposal.details);

  const [activeDrawer, setActiveDrawer] = useState<'none' | 'revision' | 'reject'>('none');
  const [revisionFeedback, setRevisionFeedback] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const isExpired = isDecisionPacketExpired(proposal, nowTickMs);
  const isPending = proposal.status === 'pending' && !isExpired;
  const isBusy = Boolean(busyState);
  const sourceLabel = formatSourceTriggerLabel(proposal.source_trigger, proposal.source_label);
  const ttlMeta = formatPacketTtlLabel(proposal.ttl_expires_at, nowTickMs);

  const baseline = useMemo(() => {
    if (proposal.previous_snapshot) {
      return proposal.previous_snapshot;
    }
    if (liveEntry) {
      return {
        id: liveEntry.code,
        title: liveEntry.title,
        scope: liveEntry.department,
        owners: liveEntry.maintainedBy,
        summary: liveEntry.summary,
        details: liveEntry.contentMarkdown,
        version: liveEntry.version ?? 1,
        updatedAt: liveEntry.updatedAt,
      };
    }
    return null;
  }, [proposal.previous_snapshot, liveEntry]);

  const hasChoEdits =
    title.trim() !== proposal.title.trim() ||
    scope.trim() !== proposal.scope.trim() ||
    owners.trim() !== proposal.owners.trim() ||
    summary.trim() !== proposal.summary.trim() ||
    details.trim() !== proposal.details.trim();

  const isValidDraft =
    title.trim().length >= 4 &&
    scope.trim().length >= 2 &&
    owners.trim().length >= 2 &&
    summary.trim().length >= 10 &&
    details.trim().length >= 20;

  const sideBySide = useMemo(() => {
    if (proposal.action_type !== 'update' || !baseline) return null;
    return computeSideBySideLines(baseline.details, details);
  }, [proposal.action_type, baseline, details]);

  const handleResetEdits = () => {
    setTitle(proposal.title);
    setScope(proposal.scope);
    setOwners(proposal.owners);
    setSummary(proposal.summary);
    setDetails(proposal.details);
  };

  const handleApproveClick = () => {
    if (!isValidDraft || isBusy) return;
    const editsPayload: KbProposalEdits | undefined = hasChoEdits
      ? {
          title: title.trim(),
          scope: scope.trim(),
          owners: owners.trim(),
          summary: summary.trim(),
          details: details.trim(),
        }
      : undefined;
    onApprove(proposal, editsPayload);
  };

  const handleRevisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (revisionFeedback.trim().length < 3 || isBusy) return;
    await onRequestRevision(proposal, revisionFeedback.trim());
    setRevisionFeedback('');
    setActiveDrawer('none');
  };

  const handleRejectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    await onReject(proposal, rejectReason.trim() || undefined);
    setRejectReason('');
    setActiveDrawer('none');
  };

  const proposerShortName = proposal.proposed_by_name.split(' (')[0];
  const baseVer = baseline?.version ?? proposal.base_version ?? 1;
  const nextVer = proposal.action_type === 'update' ? baseVer + 1 : 1;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/65 p-4 space-y-3.5 text-slate-200">
      {/* Top Identity & Governance Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap text-[11px] font-mono tabular-nums text-slate-400">
            <span className="font-bold text-amber-300">{proposal.id}</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-200">
              {proposal.action_type === 'update'
                ? `Update Existing (v${baseVer} → v${nextVer})`
                : 'Create New Entry (v1)'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-300">{sourceLabel}</span>
            {ttlMeta && (isPending || isExpired) && (
              <>
                <span aria-hidden="true">·</span>
                <span
                  className={
                    ttlMeta.isExpired
                      ? 'text-rose-400 font-semibold'
                      : ttlMeta.isUrgent
                        ? 'text-amber-300 font-semibold'
                        : 'text-slate-300'
                  }
                >
                  {ttlMeta.text}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span>Proposed by {proposal.proposed_by_name}</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-500">{proposal.task_id}</span>
          </div>
          <h4 className="text-sm font-bold text-white leading-snug">{title}</h4>
          <p className="text-xs text-slate-400">
            Scope: <span className="text-slate-200">{scope}</span> · Stewards:{' '}
            <span className="text-slate-200">{owners}</span>
            {hasChoEdits && (
              <span className="ml-2 text-amber-300 font-medium">· Edited by CHO</span>
            )}
          </p>
        </div>

        {/* Status or Edit-in-Place Toggle */}
        <div className="shrink-0 flex items-center gap-2">
          {isPending ? (
            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              disabled={isBusy}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                isEditing
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                  : 'bg-slate-950 border-slate-700/80 text-slate-300 hover:text-white'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              {isEditing ? 'Preview Diff' : 'Edit Before Commit'}
            </button>
          ) : (
            <span
              className={`text-xs font-mono tabular-nums font-semibold whitespace-nowrap ${
                proposal.status === 'approved'
                  ? 'text-emerald-400'
                  : proposal.status === 'revision_requested'
                    ? 'text-amber-300'
                    : isExpired
                      ? 'text-slate-400'
                      : 'text-rose-400'
              }`}
            >
              {proposal.status === 'approved'
                ? `COMMITTED · v${proposal.committed_version ?? nextVer}`
                : proposal.status === 'revision_requested'
                  ? 'REVISION REQUESTED'
                  : isExpired
                    ? 'EXPIRED (TTL)'
                    : 'REJECTED'}
            </span>
          )}
        </div>
      </div>

      {/* Agent Rationale */}
      {proposal.rationale && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
          <span className="font-semibold text-slate-400">Agent Rationale: </span>
          {proposal.rationale}
        </div>
      )}

      {/* Body: Edit-in-Place Form OR Create/Update Diff Inspector */}
      {isPending && isEditing ? (
        <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-300">
              Edit-in-Place Before Committing ({proposal.id})
            </span>
            {hasChoEdits && (
              <button
                type="button"
                onClick={handleResetEdits}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200"
              >
                <RotateCcw className="w-3 h-3" />
                Reset to Agent Draft
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Entry Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Scope (House)
              </label>
              <input
                type="text"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Stewards / Owners
              </label>
              <input
                type="text"
                value={owners}
                onChange={(e) => setOwners(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Executive Summary
              </label>
              <textarea
                rows={2}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Canonical Details (Markdown)
              </label>
              <textarea
                rows={8}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                className="w-full rounded-lg bg-slate-900 border border-slate-700/80 px-2.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-amber-500 leading-relaxed"
              />
            </div>
          </div>

          {!isValidDraft && (
            <p className="text-[11px] text-rose-400">
              All fields are required (Title ≥ 4 chars, Summary ≥ 10 chars, Details ≥ 20 chars).
            </p>
          )}
        </div>
      ) : proposal.action_type === 'update' && baseline && sideBySide ? (
        /* Side-by-Side Diff for Existing KB-* Entry Updates */
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
            <FileDiff className="w-3.5 h-3.5 text-amber-400" />
            <span>Side-by-Side Comparison ({proposal.id})</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {/* Current Live Snapshot */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums border-b border-slate-800/80 pb-1.5">
                <span className="text-slate-400 font-semibold">
                  Current Live · v{baseline.version}
                </span>
                <span className="text-slate-500">{baseline.scope}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">{baseline.summary}</p>
              <div className="rounded bg-slate-950 border border-slate-800/90 p-2 max-h-52 overflow-y-auto font-mono text-[11px] space-y-0.5">
                {sideBySide.left.map((line, i) => (
                  <div
                    key={i}
                    className={`px-1.5 py-0.5 rounded-sm whitespace-pre-wrap break-words ${
                      line.changed
                        ? 'bg-rose-950/45 text-rose-200'
                        : 'text-slate-400'
                    }`}
                  >
                    {line.changed ? `- ${line.text}` : `  ${line.text}`}
                  </div>
                ))}
              </div>
            </div>

            {/* Proposed New Version */}
            <div className="rounded-lg border border-emerald-500/25 bg-slate-950/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums border-b border-slate-800/80 pb-1.5">
                <span className="text-emerald-300 font-semibold">
                  Proposed Commit · v{nextVer}
                </span>
                <span className="text-slate-400">{scope}</span>
              </div>
              <p className="text-[11px] text-slate-200 leading-relaxed">{summary}</p>
              <div className="rounded bg-slate-950 border border-slate-800/90 p-2 max-h-52 overflow-y-auto font-mono text-[11px] space-y-0.5">
                {sideBySide.right.map((line, i) => (
                  <div
                    key={i}
                    className={`px-1.5 py-0.5 rounded-sm whitespace-pre-wrap break-words ${
                      line.changed
                        ? 'bg-emerald-950/45 text-emerald-200'
                        : 'text-slate-300'
                    }`}
                  >
                    {line.changed ? `+ ${line.text}` : `  ${line.text}`}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Create New KB-* Entry Preview */
        <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-3 space-y-2">
          <p className="text-xs text-slate-200 leading-relaxed">{summary}</p>
          <pre className="p-2.5 rounded bg-slate-950 border border-slate-800/90 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed">
            {details}
          </pre>
        </div>
      )}

      {/* Resolved Audit Trail */}
      {!isPending && (
        <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-800/80 space-y-1">
          {proposal.status === 'approved' && (
            <p className="flex items-center gap-1.5 text-emerald-300">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>
                Approved &amp; committed to live SSoT (v{proposal.committed_version ?? 1}) by{' '}
                {proposal.approved_by || 'CHO'}
              </span>
            </p>
          )}
          {proposal.status === 'revision_requested' && proposal.revision_feedback && (
            <p className="text-amber-200/90">
              CHO Revision Feedback to {proposerShortName}: &ldquo;{proposal.revision_feedback}
              &rdquo;
            </p>
          )}
          {proposal.status === 'rejected' && proposal.rejection_reason && (
            <p className="text-rose-300/90">Reason: {proposal.rejection_reason}</p>
          )}
          {isExpired && (
            <p className="text-slate-400 tabular-nums">
              Packet TTL expired without CHO sign-off. No live Knowledge Base changes were committed.
            </p>
          )}
        </div>
      )}

      {/* Pending CHO Decision Actions */}
      {isPending && (
        <div className="pt-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isValidDraft || isBusy}
              onClick={handleApproveClick}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors"
            >
              {busyState === 'approving' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Committing {proposal.id}...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {hasChoEdits
                    ? 'Approve Edits & Commit to KB'
                    : 'Approve & Commit to KB'}
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                setActiveDrawer((cur) => (cur === 'revision' ? 'none' : 'revision'))
              }
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                activeDrawer === 'revision'
                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
              }`}
            >
              {busyState === 'revising' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {proposerShortName} Revising...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Request Revision
                </>
              )}
            </button>

            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                setActiveDrawer((cur) => (cur === 'reject' ? 'none' : 'reject'))
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-950 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-medium transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>

          {/* Inline Request Revision Drawer */}
          {activeDrawer === 'revision' && (
            <form
              onSubmit={handleRevisionSubmit}
              className="rounded-lg border border-amber-500/35 bg-slate-950 p-3 space-y-2"
            >
              <label className="block text-xs font-medium text-amber-200">
                Route revision instructions back to {proposerShortName} (Thread {proposal.task_id}):
              </label>
              <textarea
                rows={2}
                value={revisionFeedback}
                onChange={(e) => setRevisionFeedback(e.target.value)}
                placeholder={`Tell ${proposerShortName} what to tighten, add, or change before committing ${proposal.id}...`}
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveDrawer('none')}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={revisionFeedback.trim().length < 3 || isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-xs transition-colors"
                >
                  {busyState === 'revising' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Generating Revised Proposal...
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      Dispatch Revision to {proposerShortName}
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Inline Reject Drawer */}
          {activeDrawer === 'reject' && (
            <form
              onSubmit={handleRejectSubmit}
              className="rounded-lg border border-rose-500/35 bg-slate-950 p-3 space-y-2"
            >
              <label className="block text-xs font-medium text-rose-200">
                Optional rejection note for {proposal.id}:
              </label>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejecting this KB proposal (optional)..."
                className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-rose-500"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setActiveDrawer('none')}
                  className="px-2.5 py-1 text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors"
                >
                  {busyState === 'rejecting' ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Rejecting...
                    </>
                  ) : (
                    'Confirm Reject'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
