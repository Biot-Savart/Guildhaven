import React from 'react';
import {
  ArrowRight,
  Calendar,
  Mail,
  RefreshCw,
  ShieldAlert,
  Sun,
  X,
} from 'lucide-react';
import { SpeakButton } from './SpeakButton';
import type { Agent, ExecutiveMorningBriefing } from '../types/village';

interface MorningBriefingModalProps {
  isOpen: boolean;
  isLoading: boolean;
  error: string | null;
  briefing: ExecutiveMorningBriefing | null;
  isGoogleConnected: boolean;
  pendingApprovalsCount: number;
  agents: Agent[];
  onClose: () => void;
  onRefresh: () => void;
  onGoogleSignIn: () => void;
  onOpenApprovals: () => void;
  onAssignPriorityPrompt: (prompt: string, targetDirectorId?: string) => void;
}

function formatBriefingTime(iso?: string): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MorningBriefingModal: React.FC<MorningBriefingModalProps> = ({
  isOpen,
  isLoading,
  error,
  briefing,
  isGoogleConnected,
  pendingApprovalsCount,
  agents,
  onClose,
  onRefresh,
  onGoogleSignIn,
  onOpenApprovals,
  onAssignPriorityPrompt,
}) => {
  if (!isOpen) return null;

  const mattAgent = agents.find((a) => a.id === 'matt');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sun className="h-4 w-4 text-amber-400 shrink-0" />
            <h2 className="text-sm font-bold text-white whitespace-nowrap">
              Executive Morning Briefing
            </h2>
            {briefing?.generatedAt && (
              <>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">
                  {formatBriefingTime(briefing.generatedAt)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {briefing && !isLoading && (
              <SpeakButton
                variant="secondary"
                itemId={`morning_brief_${briefing.generatedAt}`}
                label="Listen to Briefing"
                turn={{
                  agentId: 'matt',
                  speakerName: 'Matt',
                  voiceName: mattAgent?.voiceName,
                  text: briefing.spokenSummary,
                }}
              />
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh Morning Briefing"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Morning Briefing"
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!isGoogleConnected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 px-3.5 py-2.5 text-xs">
              <span className="text-slate-300">
                Connect Google Workspace so Matt &amp; Daniel include live Gmail, Calendar, and Chat updates.
              </span>
              <button
                type="button"
                onClick={onGoogleSignIn}
                className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
              >
                Sign in with Google
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-3 text-xs text-rose-200">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3 py-2">
              <div className="h-5 w-2/3 animate-pulse rounded bg-slate-800" />
              <div className="h-16 w-full animate-pulse rounded-lg bg-slate-800/70" />
              <div className="space-y-2 pt-2">
                <div className="h-14 w-full animate-pulse rounded-lg bg-slate-800/60" />
                <div className="h-14 w-full animate-pulse rounded-lg bg-slate-800/60" />
                <div className="h-14 w-full animate-pulse rounded-lg bg-slate-800/60" />
              </div>
            </div>
          ) : briefing ? (
            <>
              {/* Headline & Spoken Digest */}
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4 space-y-2">
                <p className="text-xs font-semibold text-amber-300 tabular-nums">
                  {briefing.headline}
                </p>
                <p className="text-sm text-slate-200 leading-relaxed">
                  {briefing.spokenSummary}
                </p>
                {pendingApprovalsCount > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenApprovals();
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      <span className="tabular-nums">
                        Review {pendingApprovalsCount} pending{' '}
                        {pendingApprovalsCount === 1 ? 'approval' : 'approvals'}
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Top Priorities */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Prioritized Action Plan
                </h3>
                {briefing.priorities.length === 0 ? (
                  <p className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
                    All queues are clear right now. Assign a new goal from the command bar whenever ready.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-950/50">
                    {briefing.priorities.map((item, idx) => (
                      <div
                        key={`${item.title}_${idx}`}
                        className="flex flex-wrap items-start justify-between gap-3 p-3.5"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span className="font-semibold text-amber-300">
                              @{item.ownerName}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="capitalize">{item.category}</span>
                          </div>
                          <p className="text-xs font-semibold text-white">{item.title}</p>
                          <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
                        </div>
                        {item.suggestedPrompt && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onAssignPriorityPrompt(item.suggestedPrompt!, item.ownerDirectorId);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-amber-300 hover:border-amber-500/60 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <span>Assign @{item.ownerName}</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Schedule & Inbox Highlights Side-by-Side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Calendar className="h-3.5 w-3.5 text-sky-400" />
                    <span>Schedule Highlights</span>
                  </div>
                  {briefing.scheduleHighlights.length === 0 ? (
                    <p className="text-xs text-slate-500">No upcoming meetings on deck.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {briefing.scheduleHighlights.map((line, i) => (
                        <li key={i} className="leading-relaxed">
                          • {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3.5 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Mail className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Inbox &amp; Comms</span>
                  </div>
                  {briefing.inboxHighlights.length === 0 ? (
                    <p className="text-xs text-slate-500">No urgent unread threads flagged.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {briefing.inboxHighlights.map((line, i) => (
                        <li key={i} className="leading-relaxed">
                          • {line}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
