import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FileCheck2,
  GitBranch,
  Loader2,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import mattPortraitImg from '../assets/images/chief_of_staff_matt_1794560538124.jpg';
import type { Agent, HandoffPacket, HandoffTrace } from '../types/village';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';

interface HandoffTracePanelProps {
  trace: HandoffTrace;
  compact?: boolean;
  isActive?: boolean;
  agents?: Agent[];
  highlightAgentId?: string;
  isVisualizedInTown?: boolean;
  onVisualizeInTown?: (trace: HandoffTrace) => void;
  onSelectAgent?: (agent: Agent) => void;
  onOpenKbProposals?: () => void;
  onInspectInTraceTab?: () => void;
}

interface SequenceNode {
  key: string;
  agentId: string;
  agentName: string;
  houseOrRole: string;
  stepLabel: string;
  isCrossHouseFromPrev: boolean;
  fromHouseLabel?: string;
  status: HandoffTrace['status'] | HandoffPacket['status'];
  isSynthesis?: boolean;
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function normalizeHouseName(house?: string): string {
  return (house ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+house$/i, '')
    .replace(/\s+department$/i, '');
}

function shortHouseLabel(house?: string): string {
  if (!house) return 'Village';
  return house.replace(/\s+House$/i, '').trim() || house;
}

export function isCrossHousePacket(packet: HandoffPacket): boolean {
  const fromNorm = normalizeHouseName(packet.from_house);
  const toNorm = normalizeHouseName(packet.to_house);
  if (!fromNorm || !toNorm) return false;
  return fromNorm !== toNorm;
}

function statusMeta(status: HandoffTrace['status'] | HandoffPacket['status']): {
  textClass: string;
  label: string;
  shortLabel: string;
  Icon: React.FC<{ className?: string }>;
  spin?: boolean;
} {
  switch (status) {
    case 'completed':
      return {
        textClass: 'text-emerald-300',
        label: 'Verified',
        shortLabel: 'Verified',
        Icon: CheckCircle2,
      };
    case 'running':
    case 'queued':
      return {
        textClass: 'text-amber-300',
        label: 'Running',
        shortLabel: 'Running',
        Icon: Loader2,
        spin: true,
      };
    case 'aborted_cap_reached':
      return {
        textClass: 'text-rose-300',
        label: 'Halted · Cap Reached',
        shortLabel: 'Halted',
        Icon: AlertTriangle,
      };
    case 'failed':
    default:
      return {
        textClass: 'text-rose-300',
        label: 'Failed · Fail-Closed',
        shortLabel: 'Failed',
        Icon: AlertTriangle,
      };
  }
}

export const HandoffTracePanel: React.FC<HandoffTracePanelProps> = ({
  trace,
  compact = false,
  isActive = false,
  agents = [],
  highlightAgentId,
  isVisualizedInTown = false,
  onVisualizeInTown,
  onSelectAgent,
  onOpenKbProposals,
  onInspectInTraceTab,
}) => {
  const isErrored =
    trace.status === 'failed' || trace.status === 'aborted_cap_reached';
  const isCollaborating =
    Boolean(isActive) ||
    trace.status === 'running' ||
    trace.packets.some((p) => p.status === 'running' || p.status === 'queued');
  const [panelOpen, setPanelOpen] = useState<boolean>(
    !compact || isErrored || isCollaborating
  );
  const [expandedHopIds, setExpandedHopIds] = useState<Record<string, boolean>>({});
  const [jsonViewHopIds, setJsonViewHopIds] = useState<Record<string, boolean>>({});
  const [copiedHopId, setCopiedHopId] = useState<string | null>(null);

  useEffect(() => {
    if (isCollaborating) {
      setPanelOpen(true);
    }
  }, [isCollaborating]);

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const ag of agents) {
      map.set(ag.id, ag);
    }
    return map;
  }, [agents]);

  const metrics = useMemo(() => {
    let crossHouseCount = 0;
    let verifiedCount = 0;
    let totalDurationMs = 0;
    let hasDuration = false;

    for (const p of trace.packets) {
      if (isCrossHousePacket(p)) crossHouseCount += 1;
      if (p.status === 'completed') verifiedCount += 1;
      if (typeof p.duration_ms === 'number' && Number.isFinite(p.duration_ms)) {
        totalDurationMs += p.duration_ms;
        hasDuration = true;
      }
    }

    if (!hasDuration && trace.started_at && trace.completed_at) {
      const diff =
        new Date(trace.completed_at).getTime() - new Date(trace.started_at).getTime();
      if (Number.isFinite(diff) && diff >= 0) {
        totalDurationMs = diff;
        hasDuration = true;
      }
    }

    return {
      crossHouseCount,
      verifiedCount,
      totalDurationMs: hasDuration ? totalDurationMs : undefined,
    };
  }, [trace]);

  const sequenceNodes = useMemo<SequenceNode[]>(() => {
    const nodes: SequenceNode[] = [];
    const rootAg = agentById.get(trace.root_agent);
    const coordAg = agentById.get(trace.coordinating_director);
    const coordHouse =
      coordAg?.department ??
      trace.packets.find((p) => p.from_agent === trace.coordinating_director)?.from_house ??
      'Coordinating House';

    if (trace.root_agent && trace.root_agent !== trace.coordinating_director) {
      const rootName =
        rootAg?.name ??
        (trace.root_agent === 'matt' ? 'Matt' : trace.root_agent);
      const rootHouse =
        rootAg?.department ??
        (trace.root_agent === 'matt' ? 'Town Hall Triage' : 'Origin');
      nodes.push({
        key: `root_${trace.root_agent}`,
        agentId: trace.root_agent,
        agentName: rootName,
        houseOrRole: shortHouseLabel(rootHouse),
        stepLabel: trace.root_agent === 'matt' ? 'Triage' : 'Origin',
        isCrossHouseFromPrev: false,
        status: 'completed',
      });
    }

    const rootCrossesToCoord =
      nodes.length > 0 &&
      normalizeHouseName(nodes[0].houseOrRole) !== normalizeHouseName(coordHouse) &&
      trace.root_agent !== 'matt';

    nodes.push({
      key: `coord_${trace.coordinating_director}`,
      agentId: trace.coordinating_director,
      agentName: trace.coordinating_director_name,
      houseOrRole: shortHouseLabel(coordHouse),
      stepLabel: 'Coordinator',
      isCrossHouseFromPrev: rootCrossesToCoord,
      status: trace.packets.length === 0 ? trace.status : 'completed',
    });

    for (const pkt of trace.packets) {
      const cross = isCrossHousePacket(pkt);
      nodes.push({
        key: `hop_${pkt.handoff_id}`,
        agentId: pkt.to_agent,
        agentName: pkt.to_agent_name,
        houseOrRole: shortHouseLabel(pkt.to_house),
        stepLabel: `Hop #${pkt.sequence}`,
        isCrossHouseFromPrev: cross,
        fromHouseLabel: shortHouseLabel(pkt.from_house),
        status: pkt.status,
      });
    }

    if (trace.packets.length > 0) {
      const lastPkt = trace.packets[trace.packets.length - 1];
      const returnCross =
        normalizeHouseName(lastPkt.to_house) !== normalizeHouseName(coordHouse);
      nodes.push({
        key: `synth_${trace.coordinating_director}`,
        agentId: trace.coordinating_director,
        agentName: trace.coordinating_director_name,
        houseOrRole: 'CHO Deliverable',
        stepLabel: 'Synthesis',
        isCrossHouseFromPrev: returnCross,
        status: trace.status,
        isSynthesis: true,
      });
    }

    return nodes;
  }, [agentById, trace]);

  const effectiveTraceStatus = isCollaborating ? 'running' : trace.status;
  const traceStatus = statusMeta(effectiveTraceStatus);
  const TraceStatusIcon = traceStatus.Icon;

  const toggleHop = (handoffId: string) => {
    setExpandedHopIds((prev) => ({ ...prev, [handoffId]: !prev[handoffId] }));
  };

  const toggleJson = (handoffId: string) => {
    setJsonViewHopIds((prev) => ({ ...prev, [handoffId]: !prev[handoffId] }));
  };

  const handleCopyPacketJson = async (packet: HandoffPacket) => {
    const wirePacket = {
      task_id: packet.task_id,
      from_agent: packet.from_agent,
      to_agent: packet.to_agent,
      objective: packet.objective,
      kb_refs: packet.kb_refs,
      verified_facts: packet.verified_facts,
      constraints: packet.constraints,
      expected_output_schema: packet.expected_output_schema,
      status: packet.status,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(wirePacket, null, 2));
      setCopiedHopId(packet.handoff_id);
      setTimeout(() => {
        setCopiedHopId((cur) => (cur === packet.handoff_id ? null : cur));
      }, 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const renderNodeAvatar = (agentId: string, agentName: string) => {
    if (agentId === 'matt') {
      return (
        <img
          src={mattPortraitImg}
          alt="Matt"
          referrerPolicy="no-referrer"
          className="h-6 w-6 rounded object-cover border border-amber-500/40 shrink-0"
        />
      );
    }
    const matched = agentById.get(agentId);
    if (matched) {
      return (
        <div className="flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-950 overflow-hidden shrink-0">
          <CharacterSpriteBadge agent={matched} size={24} />
        </div>
      );
    }
    return (
      <div className="flex h-6 w-6 items-center justify-center rounded border border-slate-700 bg-slate-950 text-[10px] font-semibold text-slate-300 shrink-0">
        {agentName.slice(0, 2).toUpperCase()}
      </div>
    );
  };

  return (
    <div
      data-collaborating={isCollaborating ? 'true' : 'false'}
      className={`relative rounded-lg border text-slate-200 overflow-hidden transition-colors duration-300 ${
        isCollaborating
          ? 'border-amber-500/40 bg-slate-950/90'
          : 'border-slate-800 bg-slate-950/80'
      }`}
    >
      {isCollaborating && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 handoff-trace-aura"
        />
      )}

      {/* Header Summary Row */}
      <div className="relative z-10 flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-950/75">
        <button
          type="button"
          onClick={() => setPanelOpen((prev) => !prev)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-white transition-colors cursor-pointer"
        >
          {panelOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <GitBranch className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-100 truncate">
            Agent Activity / Handoff Trace
          </span>
          <span className="text-[11px] text-slate-400 font-mono tabular-nums truncate">
            · {trace.packets.length}/{trace.max_hops} hops
            {metrics.crossHouseCount > 0 && (
              <span className="text-amber-300">
                {' '}
                · {metrics.crossHouseCount} cross-house
              </span>
            )}
          </span>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {onVisualizeInTown && (
            <button
              type="button"
              onClick={() => onVisualizeInTown(trace)}
              title="Project and replay this handoff sequence across the 2.5D village map"
              className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isVisualizedInTown
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-amber-500/60 hover:text-amber-300'
              }`}
            >
              <MapPin className="w-3 h-3 text-amber-400" />
              <span>{isVisualizedInTown ? 'In Town' : 'Show in Town'}</span>
            </button>
          )}
          {onInspectInTraceTab && (
            <button
              type="button"
              onClick={onInspectInTraceTab}
              title="Open in dedicated Handoff Trace panel"
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Trace View</span>
              <ArrowUpRight className="w-3 h-3" />
            </button>
          )}
          <span className="inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap shrink-0">
            <TraceStatusIcon
              className={`w-3.5 h-3.5 shrink-0 ${traceStatus.textClass} ${
                traceStatus.spin ? 'animate-spin' : ''
              }`}
            />
            <span className={traceStatus.textClass}>{traceStatus.shortLabel}</span>
          </span>
        </div>
      </div>

      {panelOpen && (
        <div className="relative z-10 border-t border-slate-800/90 px-3 py-3 space-y-3">
          {/* Telemetry Meta Bar */}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-slate-400 font-mono tabular-nums">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="text-slate-300">{trace.task_id}</span>
              <span>·</span>
              <span>Lead: {trace.coordinating_director_name}</span>
              <span>·</span>
              <span>
                {metrics.verifiedCount}/{trace.packets.length} verified
              </span>
              {metrics.totalDurationMs !== undefined && (
                <>
                  <span>·</span>
                  <span>{formatDuration(metrics.totalDurationMs)}</span>
                </>
              )}
            </div>
            <span className={traceStatus.textClass}>{traceStatus.label}</span>
          </div>

          {/* Visual Agent Sequence & Cross-House Flow Strip */}
          {sequenceNodes.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/45 p-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold text-slate-300">
                  Thread Agent Sequence
                </span>
                <span className="text-slate-400 font-mono tabular-nums">
                  {metrics.crossHouseCount > 0
                    ? `${metrics.crossHouseCount} cross-house boundary handoff${
                        metrics.crossHouseCount === 1 ? '' : 's'
                      }`
                    : 'Intra-house execution'}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {sequenceNodes.map((node, idx) => {
                  const matchedAgent = agentById.get(node.agentId);
                  const isHighlighted =
                    Boolean(highlightAgentId) && node.agentId === highlightAgentId;
                  const isNodeActive =
                    node.status === 'running' ||
                    node.status === 'queued' ||
                    (isCollaborating && trace.packets.length === 0 && node.stepLabel === 'Coordinator');
                  const nodeMeta = statusMeta(isNodeActive ? 'running' : node.status);
                  const NodeStatusIcon = nodeMeta.Icon;
                  const canJump = Boolean(onSelectAgent && matchedAgent);

                  const nodeInner = (
                    <>
                      {renderNodeAvatar(node.agentId, node.agentName)}
                      <div className="min-w-0 text-left">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] font-semibold text-slate-100 truncate max-w-[96px]">
                            {node.agentName}
                          </span>
                          {node.isSynthesis && !isNodeActive ? (
                            <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : (
                            <NodeStatusIcon
                              className={`w-3 h-3 shrink-0 ${nodeMeta.textClass} ${
                                nodeMeta.spin ? 'animate-spin' : ''
                              }`}
                            />
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate max-w-[112px]">
                          {node.stepLabel} · {node.houseOrRole}
                        </p>
                      </div>
                    </>
                  );

                  const nodeSurfaceClass = isNodeActive
                    ? 'border-amber-500/50 bg-amber-950/25 handoff-node-breathing'
                    : isHighlighted
                      ? 'border-amber-500/60 bg-slate-800/90'
                      : 'border-slate-800 bg-slate-950/80';

                  return (
                    <React.Fragment key={node.key}>
                      {idx > 0 && (
                        <div
                          className={`flex flex-col items-center justify-center px-0.5 shrink-0 ${
                            isNodeActive ? 'handoff-rail-breathing' : ''
                          }`}
                          title={
                            node.isCrossHouseFromPrev
                              ? `Cross-House Handoff (${node.fromHouseLabel ?? 'Prior House'} → ${node.houseOrRole})`
                              : 'Intra-House Handoff'
                          }
                        >
                          {node.isCrossHouseFromPrev ? (
                            <>
                              <ArrowRightLeft className="w-3.5 h-3.5 text-amber-400" />
                              <span className="text-[9px] font-mono font-medium text-amber-300 leading-none mt-0.5">
                                X-House
                              </span>
                            </>
                          ) : (
                            <ArrowRight
                              className={`w-3.5 h-3.5 ${
                                isNodeActive ? 'text-amber-300' : 'text-slate-500'
                              }`}
                            />
                          )}
                        </div>
                      )}

                      {canJump && matchedAgent ? (
                        <button
                          type="button"
                          onClick={() => onSelectAgent?.(matchedAgent)}
                          title={`Jump to ${node.agentName} (${node.houseOrRole})`}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors cursor-pointer shrink-0 hover:border-slate-600 ${nodeSurfaceClass}`}
                        >
                          {nodeInner}
                        </button>
                      ) : (
                        <div
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 shrink-0 ${nodeSurfaceClass}`}
                        >
                          {nodeInner}
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fail-Closed Error Banner */}
          {isErrored && trace.error_banner && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-semibold text-rose-200">
                  Orchestration Aborted (Fail-Closed · KB-SOP-01)
                </p>
                <p className="text-xs text-rose-200/90 leading-relaxed break-words">
                  {trace.error_banner}
                </p>
              </div>
            </div>
          )}

          {/* Ordered Typed Handoff Hops & Outcomes Timeline */}
          {trace.packets.length > 0 && (
            <div className="divide-y divide-slate-800 rounded-lg border border-slate-800 bg-slate-900/35">
              {trace.packets.map((packet, idx) => {
                const isExpanded = Boolean(expandedHopIds[packet.handoff_id]);
                const showJson = Boolean(jsonViewHopIds[packet.handoff_id]);
                const hopStatus = statusMeta(packet.status);
                const HopStatusIcon = hopStatus.Icon;
                const crossHouse = isCrossHousePacket(packet);
                const isLastHop = idx === trace.packets.length - 1;
                const toAgentObj = agentById.get(packet.to_agent);

                const canonicalWireJson = JSON.stringify(
                  {
                    task_id: packet.task_id,
                    from_agent: packet.from_agent,
                    to_agent: packet.to_agent,
                    objective: packet.objective,
                    kb_refs: packet.kb_refs,
                    verified_facts: packet.verified_facts,
                    constraints: packet.constraints,
                    expected_output_schema: packet.expected_output_schema,
                    status: packet.status,
                  },
                  null,
                  2
                );

                const isHopActive =
                  packet.status === 'running' || packet.status === 'queued';

                return (
                  <div
                    key={packet.handoff_id}
                    className={`text-xs ${
                      isHopActive ? 'bg-amber-950/15 handoff-rail-breathing' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleHop(packet.handoff_id)}
                      className="w-full px-3 py-2.5 text-left hover:bg-slate-800/35 transition-colors flex items-stretch gap-2.5 cursor-pointer"
                    >
                      {/* Vertical Sequence Rail */}
                      <div className="flex flex-col items-center pt-0.5 shrink-0">
                        <HopStatusIcon
                          className={`w-3.5 h-3.5 shrink-0 ${hopStatus.textClass} ${
                            hopStatus.spin ? 'animate-spin' : ''
                          }`}
                        />
                        {!isLastHop && (
                          <div
                            className={`w-px flex-1 mt-1.5 min-h-[16px] ${
                              isHopActive ? 'bg-amber-500/40' : 'bg-slate-800'
                            }`}
                          />
                        )}
                      </div>

                      {/* Hop Content & Outcome */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                            <span className="font-mono tabular-nums text-[11px] text-slate-400">
                              #{packet.sequence}
                            </span>
                            <span className="font-semibold text-slate-200">
                              {packet.from_agent_name}
                            </span>
                            {crossHouse ? (
                              <ArrowRightLeft className="w-3 h-3 text-amber-400 shrink-0" />
                            ) : (
                              <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                            )}
                            <span className="font-semibold text-amber-300">
                              {packet.to_agent_name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono tabular-nums">
                            <span className="text-slate-500">d{packet.depth}</span>
                            <span className="text-slate-400">
                              {formatDuration(packet.duration_ms)}
                            </span>
                            <span className={hopStatus.textClass}>
                              {hopStatus.shortLabel}
                            </span>
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                            )}
                          </div>
                        </div>

                        {/* Cross-House vs Intra-House Route Line */}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                          {crossHouse ? (
                            <span className="font-medium text-amber-300">
                              Cross-House · {shortHouseLabel(packet.from_house)} →{' '}
                              {shortHouseLabel(packet.to_house)}
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              Intra-House · {shortHouseLabel(packet.to_house)}
                            </span>
                          )}
                          {packet.kb_refs.length > 0 && (
                            <span className="text-[10px] font-mono tabular-nums text-slate-500 truncate">
                              · SSoT: {packet.kb_refs.join(', ')}
                            </span>
                          )}
                        </div>

                        {/* Objective */}
                        <p className="text-[11px] text-slate-300 line-clamp-1">
                          <span className="text-slate-500">Task: </span>
                          {packet.objective}
                        </p>

                        {/* Immediate Outcome Summary */}
                        {packet.output_artifact ? (
                          <div className="pt-0.5 space-y-0.5">
                            <p className="text-[11px] text-emerald-200/95 line-clamp-2 leading-relaxed">
                              <span className="font-semibold text-emerald-300">
                                Outcome:{' '}
                              </span>
                              {packet.output_artifact.summary}
                            </p>
                            <div className="text-[10px] font-mono tabular-nums text-slate-400">
                              {packet.output_artifact.verified_claims.length} verified claim
                              {packet.output_artifact.verified_claims.length === 1 ? '' : 's'} ·{' '}
                              {packet.output_artifact.citations.length} source
                              {packet.output_artifact.citations.length === 1 ? '' : 's'}
                              {packet.output_artifact.risks &&
                              packet.output_artifact.risks.length > 0
                                ? ` · ${packet.output_artifact.risks.length} risk${
                                    packet.output_artifact.risks.length === 1 ? '' : 's'
                                  }`
                                : ''}
                            </div>
                          </div>
                        ) : packet.error_detail ? (
                          <p className="text-[11px] text-rose-300 line-clamp-2">
                            <span className="font-semibold">Outcome: </span>
                            {packet.error_detail}
                          </p>
                        ) : packet.status === 'running' || packet.status === 'queued' ? (
                          <p className="text-[11px] text-amber-300">
                            Outcome: Awaiting specialist artifact...
                          </p>
                        ) : null}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-2 bg-slate-950/70 border-t border-slate-800/80 space-y-2.5">
                        {/* Controls */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-[11px] text-slate-400 font-mono tabular-nums">
                            {packet.handoff_id} · status: {packet.status}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {onSelectAgent && toAgentObj && (
                              <button
                                type="button"
                                onClick={() => onSelectAgent(toAgentObj)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-slate-900 border border-slate-700/80 text-slate-200 hover:border-amber-500/60 hover:text-amber-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                              >
                                <span>Chat with {packet.to_agent_name}</span>
                                <ArrowUpRight className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleJson(packet.handoff_id)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                showJson
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                                  : 'bg-slate-900 border-slate-700/80 text-slate-300 hover:text-white'
                              }`}
                            >
                              <Code2 className="w-3 h-3" />
                              <span>{showJson ? 'Hide JSON' : 'Typed JSON'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyPacketJson(packet)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-slate-900 border border-slate-700/80 text-slate-300 hover:text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
                            >
                              {copiedHopId === packet.handoff_id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span>Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Raw KB-SOP-02 JSON Inspector */}
                        {showJson ? (
                          <pre className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-200 overflow-x-auto leading-relaxed">
                            {canonicalWireJson}
                          </pre>
                        ) : (
                          <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                            <div>
                              <span className="text-slate-400 font-semibold">Objective: </span>
                              <span className="text-slate-200">{packet.objective}</span>
                            </div>
                            {packet.verified_facts.length > 0 && (
                              <div>
                                <span className="text-slate-400 font-semibold">
                                  Verified Context:{' '}
                                </span>
                                <span className="text-slate-300">
                                  {packet.verified_facts.join(' · ')}
                                </span>
                              </div>
                            )}
                            {packet.constraints.length > 0 && (
                              <div>
                                <span className="text-slate-400 font-semibold">
                                  Constraints:{' '}
                                </span>
                                <span className="text-slate-300">
                                  {packet.constraints.join(' · ')}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Hop Error Detail if failed */}
                        {packet.error_detail && (
                          <div className="rounded-md border border-rose-500/35 bg-rose-950/30 p-2 text-[11px] text-rose-200">
                            <span className="font-semibold">Hop Failure: </span>
                            {packet.error_detail}
                          </div>
                        )}

                        {/* Verified Output Artifact Details */}
                        {packet.output_artifact && (
                          <div className="border-t border-slate-800 pt-2.5 space-y-2">
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="font-semibold text-emerald-300">
                                Verified Output Artifact · {packet.output_artifact.agent_name} (
                                {shortHouseLabel(packet.output_artifact.house)})
                              </span>
                            </div>

                            {packet.output_artifact.verified_claims.length > 0 && (
                              <ul className="space-y-1 text-[11px] text-slate-300">
                                {packet.output_artifact.verified_claims.map((claim, cIdx) => (
                                  <li key={cIdx} className="flex items-start gap-1.5">
                                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                    <span>{claim}</span>
                                  </li>
                                ))}
                              </ul>
                            )}

                            {packet.output_artifact.risks &&
                              packet.output_artifact.risks.length > 0 && (
                                <ul className="space-y-1 text-[11px] text-amber-200/90">
                                  {packet.output_artifact.risks.map((risk, rIdx) => (
                                    <li key={rIdx} className="flex items-start gap-1.5">
                                      <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                                      <span>{risk}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}

                            <details className="group">
                              <summary className="cursor-pointer text-[11px] text-amber-300 hover:text-amber-200 select-none">
                                View full specialist deliverable
                              </summary>
                              <pre className="mt-2 p-2.5 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                                {packet.output_artifact.deliverable_markdown}
                              </pre>
                            </details>

                            {packet.output_artifact.citations.length > 0 && (
                              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/70">
                                {packet.output_artifact.citations.map((cit, cIdx) => (
                                  <a
                                    key={cIdx}
                                    href={cit.uri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-sky-300 hover:text-sky-200 underline underline-offset-2"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5" />
                                    <span>{cit.title}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Staged KB Proposals Shortcut */}
          {trace.staged_kb_proposal_ids.length > 0 && onOpenKbProposals && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2">
              <div className="flex items-center gap-2 text-xs text-amber-200 min-w-0">
                <FileCheck2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="truncate">
                  <span className="font-mono tabular-nums font-semibold">
                    {trace.staged_kb_proposal_ids.length}
                  </span>{' '}
                  KB proposal(s) staged for CHO approval
                </span>
              </div>
              <button
                type="button"
                onClick={onOpenKbProposals}
                className="px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-[11px] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                Review Decision Packet
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
