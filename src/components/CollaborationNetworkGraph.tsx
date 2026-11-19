import React, { useMemo, useState } from 'react';
import { FileText, Footprints, MapPin, MessageSquare, Sparkles, X } from 'lucide-react';
import {
  resolveAgentAvailability,
  type AgentAvailabilityLevel,
} from '../lib/villageActivity';
import type {
  Agent,
  ApprovalItem,
  ChatMessage,
  HandoffTrace,
  VillageTask,
} from '../types/village';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';

export type CollaborationScope = 'cross_house' | 'intra_house' | 'dispatch';
export type NetworkFilter = 'all' | 'frequent' | 'cross_house' | 'intra_house';

export interface CollaborationRecord {
  id: string;
  kind: 'handoff' | 'shared_task';
  title: string;
  timestampMs: number;
  fromAgentName?: string;
  toAgentName?: string;
  status?: string;
  taskId?: string;
  trace?: HandoffTrace;
}

export interface CollaborationEdge {
  key: string;
  agentAId: string;
  agentBId: string;
  scope: CollaborationScope;
  sharedTaskCount: number;
  handoffCount: number;
  weight: number;
  lastTimestampMs: number;
  records: CollaborationRecord[];
}

export interface AgentCollaborationStats {
  totalWeight: number;
  partnerCount: number;
  crossHousePartners: number;
  edgeKeys: string[];
}

export interface CollaborationNetworkData {
  edges: CollaborationEdge[];
  edgeByKey: Map<string, CollaborationEdge>;
  statsByAgentId: Map<string, AgentCollaborationStats>;
  totalWeight: number;
  frequentEdgeCount: number;
  crossHouseEdgeCount: number;
  intraHouseEdgeCount: number;
}

function makePairKey(a: string, b: string): [string, string, string] {
  return a < b ? [`${a}::${b}`, a, b] : [`${b}::${a}`, b, a];
}

function parseTimestampMs(iso?: string): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

export function buildCollaborationNetwork(
  agents: Agent[],
  tasks: VillageTask[],
  chatHistory?: Record<string, ChatMessage[]>
): CollaborationNetworkData {
  const validAgents = new Map<string, Agent>();
  for (const agent of agents) {
    if (agent.id !== 'cho') {
      validAgents.set(agent.id, agent);
    }
  }

  interface PairAccumulator {
    key: string;
    agentAId: string;
    agentBId: string;
    sharedThreads: Set<string>;
    handoffIds: Set<string>;
    threadHops: Map<string, number>;
    lastTimestampMs: number;
    records: Map<string, CollaborationRecord>;
  }

  const pairMap = new Map<string, PairAccumulator>();
  const seenPacketIds = new Set<string>();
  const taskById = new Map<string, VillageTask>();

  const ensurePair = (rawA: string, rawB: string): PairAccumulator | null => {
    if (!rawA || !rawB || rawA === rawB || rawA === 'cho' || rawB === 'cho') {
      return null;
    }
    if (!validAgents.has(rawA) || !validAgents.has(rawB)) {
      return null;
    }
    const [key, agentAId, agentBId] = makePairKey(rawA, rawB);
    let acc = pairMap.get(key);
    if (!acc) {
      acc = {
        key,
        agentAId,
        agentBId,
        sharedThreads: new Set<string>(),
        handoffIds: new Set<string>(),
        threadHops: new Map<string, number>(),
        lastTimestampMs: 0,
        records: new Map<string, CollaborationRecord>(),
      };
      pairMap.set(key, acc);
    }
    return acc;
  };

  const recordSharedThread = (
    rawA: string,
    rawB: string,
    threadKey: string,
    record: CollaborationRecord
  ) => {
    const acc = ensurePair(rawA, rawB);
    if (!acc) return;
    acc.sharedThreads.add(threadKey);
    if (!acc.threadHops.has(threadKey)) {
      acc.threadHops.set(threadKey, 0);
    }
    if (record.timestampMs > acc.lastTimestampMs) {
      acc.lastTimestampMs = record.timestampMs;
    }
    if (!acc.records.has(record.id)) {
      acc.records.set(record.id, record);
    }
  };

  const recordHandoffHop = (
    fromId: string,
    toId: string,
    threadKey: string,
    handoffId: string,
    record: CollaborationRecord
  ) => {
    const acc = ensurePair(fromId, toId);
    if (!acc) return;
    acc.sharedThreads.add(threadKey);
    acc.handoffIds.add(handoffId);
    acc.threadHops.set(threadKey, (acc.threadHops.get(threadKey) ?? 0) + 1);
    if (record.timestampMs > acc.lastTimestampMs) {
      acc.lastTimestampMs = record.timestampMs;
    }
    acc.records.set(record.id, record);
  };

  const processTrace = (
    trace: HandoffTrace,
    backingTaskId?: string,
    fallbackTitle?: string
  ) => {
    const threadKey = backingTaskId || trace.task_id;
    const traceTs = parseTimestampMs(trace.completed_at || trace.started_at);

    if (
      trace.root_agent &&
      trace.coordinating_director &&
      trace.root_agent !== 'cho' &&
      trace.coordinating_director !== 'cho' &&
      trace.root_agent !== trace.coordinating_director
    ) {
      recordSharedThread(trace.root_agent, trace.coordinating_director, threadKey, {
        id: `coord_${threadKey}`,
        kind: 'shared_task',
        title: fallbackTitle || `Coordinated ${trace.coordinating_director_name}`,
        timestampMs: traceTs,
        taskId: backingTaskId,
        trace,
      });
    }

    for (const pkt of trace.packets) {
      if (!pkt.handoff_id || seenPacketIds.has(pkt.handoff_id)) continue;
      seenPacketIds.add(pkt.handoff_id);

      const pktTs = parseTimestampMs(pkt.completed_at || pkt.started_at) || traceTs;
      recordHandoffHop(pkt.from_agent, pkt.to_agent, threadKey, pkt.handoff_id, {
        id: `pkt_${pkt.handoff_id}`,
        kind: 'handoff',
        title: pkt.objective || fallbackTitle || 'Cross-agent handoff',
        timestampMs: pktTs,
        fromAgentName: pkt.from_agent_name,
        toAgentName: pkt.to_agent_name,
        status: pkt.status,
        taskId: backingTaskId,
        trace,
      });
    }
  };

  for (const task of tasks) {
    taskById.set(task.id, task);
    const taskTs = parseTimestampMs(task.completedAt || task.createdAt);
    const baseRecord: CollaborationRecord = {
      id: `task_${task.id}`,
      kind: 'shared_task',
      title: task.prompt,
      timestampMs: taskTs,
      status: task.status,
      taskId: task.id,
      trace: task.handoffTrace,
    };

    if (task.assignedDirectorId && task.assignedDirectorId !== 'matt') {
      recordSharedThread('matt', task.assignedDirectorId, task.id, baseRecord);
    }

    if (
      task.assignedDirectorId &&
      task.assignedWorkerId &&
      task.assignedDirectorId !== task.assignedWorkerId
    ) {
      recordSharedThread(
        task.assignedDirectorId,
        task.assignedWorkerId,
        task.id,
        baseRecord
      );
    }

    if (task.collaboratorIds && task.collaboratorIds.length > 0) {
      for (const collabId of task.collaboratorIds) {
        if (collabId && collabId !== task.assignedDirectorId) {
          recordSharedThread(task.assignedDirectorId, collabId, task.id, baseRecord);
        }
      }
    }

    if (task.handoffTrace) {
      processTrace(task.handoffTrace, task.id, task.prompt);
    }
  }

  if (chatHistory) {
    for (const messages of Object.values(chatHistory)) {
      for (const msg of messages) {
        if (!msg.handoffTrace) continue;
        const matchedTask =
          (msg.taskId ? taskById.get(msg.taskId) : undefined) ||
          taskById.get(msg.handoffTrace.task_id);
        processTrace(
          msg.handoffTrace,
          matchedTask?.id,
          matchedTask?.prompt || msg.text
        );
      }
    }
  }

  const edges: CollaborationEdge[] = [];
  const edgeByKey = new Map<string, CollaborationEdge>();
  const statsByAgentId = new Map<string, AgentCollaborationStats>();

  for (const agentId of validAgents.keys()) {
    statsByAgentId.set(agentId, {
      totalWeight: 0,
      partnerCount: 0,
      crossHousePartners: 0,
      edgeKeys: [],
    });
  }

  let totalWeight = 0;
  let frequentEdgeCount = 0;
  let crossHouseEdgeCount = 0;
  let intraHouseEdgeCount = 0;

  for (const acc of pairMap.values()) {
    const agentA = validAgents.get(acc.agentAId);
    const agentB = validAgents.get(acc.agentBId);
    if (!agentA || !agentB) continue;

    let weight = 0;
    for (const hops of acc.threadHops.values()) {
      weight += Math.max(1, hops);
    }
    if (weight <= 0) continue;

    const scope: CollaborationScope =
      agentA.id === 'matt' || agentB.id === 'matt'
        ? 'dispatch'
        : agentA.buildingId !== agentB.buildingId
          ? 'cross_house'
          : 'intra_house';

    const sortedRecords = Array.from(acc.records.values()).sort(
      (a, b) => b.timestampMs - a.timestampMs
    );

    const edge: CollaborationEdge = {
      key: acc.key,
      agentAId: acc.agentAId,
      agentBId: acc.agentBId,
      scope,
      sharedTaskCount: acc.sharedThreads.size,
      handoffCount: acc.handoffIds.size,
      weight,
      lastTimestampMs: acc.lastTimestampMs,
      records: sortedRecords.slice(0, 8),
    };

    edges.push(edge);
    edgeByKey.set(edge.key, edge);

    totalWeight += weight;
    if (weight >= 2) frequentEdgeCount++;
    if (scope === 'cross_house') crossHouseEdgeCount++;
    if (scope === 'intra_house') intraHouseEdgeCount++;

    for (const id of [edge.agentAId, edge.agentBId]) {
      const st = statsByAgentId.get(id);
      if (st) {
        st.totalWeight += weight;
        st.partnerCount += 1;
        if (scope === 'cross_house') st.crossHousePartners += 1;
        st.edgeKeys.push(edge.key);
      }
    }
  }

  edges.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.handoffCount !== a.handoffCount) return b.handoffCount - a.handoffCount;
    return b.lastTimestampMs - a.lastTimestampMs;
  });

  return {
    edges,
    edgeByKey,
    statsByAgentId,
    totalWeight,
    frequentEdgeCount,
    crossHouseEdgeCount,
    intraHouseEdgeCount,
  };
}

const HOUSE_RING_ORDER = [
  'inbox',
  'research',
  'youtube',
  'creative',
  'health',
  'operations',
  'finance',
  'engineering',
] as const;

const GRAPH_W = 520;
const GRAPH_H = 418;
const CX = 260;
const CY = 202;
const DIRECTOR_RX = 112;
const DIRECTOR_RY = 88;
const WORKER_RX = 206;
const WORKER_RY = 154;

interface PositionedNode {
  agent: Agent;
  x: number;
  y: number;
  houseAngle: number;
}

function computeNodePositions(agents: Agent[]): {
  nodes: PositionedNode[];
  nodeById: Map<string, PositionedNode>;
  houseGuides: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }>;
} {
  const roster = agents.filter((a) => a.id !== 'cho');
  const nodes: PositionedNode[] = [];
  const nodeById = new Map<string, PositionedNode>();
  const houseGuides: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    key: string;
  }> = [];

  const matt = roster.find((a) => a.id === 'matt' || a.role === 'chief_of_staff');
  if (matt) {
    const node: PositionedNode = { agent: matt, x: CX, y: CY, houseAngle: 0 };
    nodes.push(node);
    nodeById.set(matt.id, node);
  }

  const houseAngleMap = new Map<string, number>();
  HOUSE_RING_ORDER.forEach((houseId, idx) => {
    const angle = (idx * Math.PI * 2) / HOUSE_RING_ORDER.length - Math.PI / 2;
    houseAngleMap.set(houseId, angle);
  });

  const directors = roster.filter(
    (a) => a.id !== matt?.id && a.role === 'director'
  );
  directors.forEach((dir, idx) => {
    const fallbackAngle =
      (idx * Math.PI * 2) / Math.max(1, directors.length) - Math.PI / 2;
    const angle = houseAngleMap.get(dir.buildingId) ?? fallbackAngle;
    const node: PositionedNode = {
      agent: dir,
      x: CX + Math.cos(angle) * DIRECTOR_RX,
      y: CY + Math.sin(angle) * DIRECTOR_RY,
      houseAngle: angle,
    };
    nodes.push(node);
    nodeById.set(dir.id, node);
  });

  const workersByHouse = new Map<string, Agent[]>();
  for (const ag of roster) {
    if (ag.id === matt?.id || ag.role === 'director') continue;
    const bucket = workersByHouse.get(ag.buildingId) ?? [];
    bucket.push(ag);
    workersByHouse.set(ag.buildingId, bucket);
  }

  let unknownHouseIdx = 0;
  for (const [houseId, houseWorkers] of workersByHouse.entries()) {
    const baseAngle =
      houseAngleMap.get(houseId) ??
      ((unknownHouseIdx++ * Math.PI * 2) / 8 - Math.PI / 2 + 0.2);

    const houseDirector = directors.find((d) => d.buildingId === houseId);
    const dirNode = houseDirector ? nodeById.get(houseDirector.id) : undefined;

    houseWorkers.forEach((worker, idx) => {
      const fanOffset =
        houseWorkers.length > 1
          ? (idx - (houseWorkers.length - 1) / 2) * 0.21
          : 0;
      const angle = baseAngle + fanOffset;
      const wx = CX + Math.cos(angle) * WORKER_RX;
      const wy = CY + Math.sin(angle) * WORKER_RY;
      const wNode: PositionedNode = {
        agent: worker,
        x: wx,
        y: wy,
        houseAngle: angle,
      };
      nodes.push(wNode);
      nodeById.set(worker.id, wNode);

      if (dirNode) {
        houseGuides.push({
          key: `${dirNode.agent.id}_${worker.id}`,
          x1: dirNode.x,
          y1: dirNode.y,
          x2: wx,
          y2: wy,
        });
      }
    });
  }

  return { nodes, nodeById, houseGuides };
}

function computeEdgeGeometry(
  a: PositionedNode,
  b: PositionedNode,
  scope: CollaborationScope
): { pathD: string; midX: number; midY: number } {
  if (scope === 'intra_house') {
    return {
      pathD: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
    };
  }

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chordLen = Math.hypot(dx, dy) || 1;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;

  if (scope === 'dispatch') {
    const nx = -dy / chordLen;
    const ny = dx / chordLen;
    const qx = mx + nx * 12;
    const qy = my + ny * 12;
    return {
      pathD: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
      midX: 0.25 * a.x + 0.5 * qx + 0.25 * b.x,
      midY: 0.25 * a.y + 0.5 * qy + 0.25 * b.y,
    };
  }

  const distFromCenter = Math.hypot(mx - CX, my - CY);
  let qx: number;
  let qy: number;

  if (distFromCenter < 56) {
    const nx = -dy / chordLen;
    const ny = dx / chordLen;
    const sign = ny >= 0 ? 1 : -1;
    qx = CX + nx * 68 * sign;
    qy = CY + ny * 56 * sign;
  } else {
    qx = mx + (CX - mx) * 0.24;
    qy = my + (CY - my) * 0.24;
  }

  return {
    pathD: `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${qx.toFixed(1)} ${qy.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`,
    midX: 0.25 * a.x + 0.5 * qx + 0.25 * b.x,
    midY: 0.25 * a.y + 0.5 * qy + 0.25 * b.y,
  };
}

function formatScopeLabel(scope: CollaborationScope): string {
  switch (scope) {
    case 'cross_house':
      return 'Cross-House';
    case 'intra_house':
      return 'Intra-House';
    case 'dispatch':
      return 'Town Hall Dispatch';
  }
}

function getEdgeStrokeColor(scope: CollaborationScope, highlighted: boolean): string {
  if (scope === 'cross_house') {
    return highlighted ? '#fbbf24' : '#f59e0b';
  }
  if (scope === 'intra_house') {
    return highlighted ? '#34d399' : '#10b981';
  }
  return highlighted ? '#38bdf8' : '#0ea5e9';
}

const AVAILABILITY_DOT: Record<AgentAvailabilityLevel, string> = {
  available: 'bg-emerald-400',
  working: 'bg-orange-400',
  busy: 'bg-rose-500',
};

interface CollaborationNetworkGraphProps {
  agents: Agent[];
  network: CollaborationNetworkData;
  tasks: VillageTask[];
  approvals: ApprovalItem[];
  busyChatAgentId: string | null;
  filter: NetworkFilter;
  searchQuery: string;
  focusedAgentId: string | null;
  onSelectAgentId: (agentId: string | null) => void;
  onOpenAgentChat: (agent: Agent) => void;
  onWalkToAgent: (agent: Agent) => void;
  onOpenTaskReport?: (taskId: string) => void;
  onVisualizeTraceInTown?: (trace: HandoffTrace) => void;
  onPrefillTask?: (prompt: string) => void;
}

export const CollaborationNetworkGraph: React.FC<CollaborationNetworkGraphProps> = ({
  agents,
  network,
  tasks,
  approvals,
  busyChatAgentId,
  filter,
  searchQuery,
  focusedAgentId,
  onSelectAgentId,
  onOpenAgentChat,
  onWalkToAgent,
  onOpenTaskReport,
  onVisualizeTraceInTown,
  onPrefillTask,
}) => {
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [hoveredEdgeKey, setHoveredEdgeKey] = useState<string | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);

  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) {
      if (a.id !== 'cho') m.set(a.id, a);
    }
    return m;
  }, [agents]);

  const { nodes, nodeById, houseGuides } = useMemo(
    () => computeNodePositions(agents),
    [agents]
  );

  const matchingSearchAgentIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const matched = new Set<string>();
    for (const ag of agentById.values()) {
      if (
        ag.name.toLowerCase().includes(q) ||
        ag.department.toLowerCase().includes(q) ||
        ag.title.toLowerCase().includes(q)
      ) {
        matched.add(ag.id);
      }
    }
    return matched;
  }, [agentById, searchQuery]);

  const visibleEdges = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return network.edges.filter((edge) => {
      if (filter === 'frequent' && edge.weight < 2) return false;
      if (filter === 'cross_house' && edge.scope !== 'cross_house') return false;
      if (filter === 'intra_house' && edge.scope !== 'intra_house') return false;

      if (!q) return true;
      const aMatch = matchingSearchAgentIds?.has(edge.agentAId) ?? false;
      const bMatch = matchingSearchAgentIds?.has(edge.agentBId) ?? false;
      const recMatch = edge.records.some((r) => r.title.toLowerCase().includes(q));
      return aMatch || bMatch || recMatch;
    });
  }, [network.edges, filter, searchQuery, matchingSearchAgentIds]);

  const activeEdge = useMemo(() => {
    if (!selectedEdgeKey) return null;
    return network.edgeByKey.get(selectedEdgeKey) ?? null;
  }, [network.edgeByKey, selectedEdgeKey]);

  const activeAgent = useMemo(() => {
    if (!focusedAgentId) return null;
    return agentById.get(focusedAgentId) ?? null;
  }, [agentById, focusedAgentId]);

  const highlightedNodeIds = useMemo(() => {
    if (activeEdge) {
      return new Set<string>([activeEdge.agentAId, activeEdge.agentBId]);
    }
    const targetAgentId = hoveredAgentId || focusedAgentId;
    if (targetAgentId) {
      const s = new Set<string>([targetAgentId]);
      for (const e of visibleEdges) {
        if (e.agentAId === targetAgentId) s.add(e.agentBId);
        if (e.agentBId === targetAgentId) s.add(e.agentAId);
      }
      return s;
    }
    if (hoveredEdgeKey) {
      const hovered = network.edgeByKey.get(hoveredEdgeKey);
      if (hovered) {
        return new Set<string>([hovered.agentAId, hovered.agentBId]);
      }
    }
    if (matchingSearchAgentIds && matchingSearchAgentIds.size > 0) {
      return matchingSearchAgentIds;
    }
    return null;
  }, [
    activeEdge,
    hoveredAgentId,
    focusedAgentId,
    visibleEdges,
    hoveredEdgeKey,
    network.edgeByKey,
    matchingSearchAgentIds,
  ]);

  const agentPartnerEdges = useMemo(() => {
    if (!activeAgent) return [];
    return visibleEdges.filter(
      (e) => e.agentAId === activeAgent.id || e.agentBId === activeAgent.id
    );
  }, [activeAgent, visibleEdges]);

  const handleNodeClick = (agentId: string) => {
    setSelectedEdgeKey(null);
    if (focusedAgentId === agentId) {
      onSelectAgentId(null);
    } else {
      onSelectAgentId(agentId);
    }
  };

  const handleEdgeClick = (edgeKey: string) => {
    onSelectAgentId(null);
    setSelectedEdgeKey((prev) => (prev === edgeKey ? null : edgeKey));
  };

  const clearSelection = () => {
    setSelectedEdgeKey(null);
    onSelectAgentId(null);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Summary & Legend Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 px-4 py-2 text-[11px] text-slate-400 tabular-nums">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span>
            <strong className="font-semibold text-white">{network.totalWeight}</strong>{' '}
            {network.totalWeight === 1 ? 'collaboration' : 'collaborations'}
          </span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <span>
            <strong className="font-semibold text-amber-300">
              {network.crossHouseEdgeCount}
            </strong>{' '}
            cross-house
          </span>
          <span className="text-slate-700" aria-hidden="true">·</span>
          <span>
            <strong className="font-semibold text-slate-200">
              {network.frequentEdgeCount}
            </strong>{' '}
            frequent (2+)
          </span>
        </div>

        {(activeAgent || activeEdge) && (
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-300 hover:text-amber-200 cursor-pointer whitespace-nowrap shrink-0"
          >
            <X className="h-3 w-3" />
            <span>Reset focus</span>
          </button>
        )}
      </div>

      {/* Interactive Network Canvas */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative w-full aspect-[520/418] rounded-lg border border-slate-800 bg-slate-950/80 overflow-hidden select-none">
          <svg
            viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
            className="h-full w-full"
            role="img"
            aria-label="Village agent collaboration network graph"
          >
            {/* Concentric Organizational Ring Guides */}
            <ellipse
              cx={CX}
              cy={CY}
              rx={DIRECTOR_RX}
              ry={DIRECTOR_RY}
              fill="none"
              stroke="#1e293b"
              strokeWidth={1}
              strokeDasharray="3 5"
            />
            <ellipse
              cx={CX}
              cy={CY}
              rx={WORKER_RX}
              ry={WORKER_RY}
              fill="none"
              stroke="#1e293b"
              strokeWidth={1}
              strokeDasharray="3 6"
            />

            {/* Faint House Radial Guides */}
            {houseGuides.map((g) => (
              <line
                key={g.key}
                x1={g.x1}
                y1={g.y1}
                x2={g.x2}
                y2={g.y2}
                stroke="#1e293b"
                strokeOpacity={0.55}
                strokeWidth={1}
              />
            ))}

            {/* Collaboration Edges */}
            {visibleEdges.map((edge) => {
              const nodeA = nodeById.get(edge.agentAId);
              const nodeB = nodeById.get(edge.agentBId);
              if (!nodeA || !nodeB) return null;

              const isSelectedEdge = selectedEdgeKey === edge.key;
              const isHoveredEdge = hoveredEdgeKey === edge.key;
              const isConnectedToFocusedAgent =
                focusedAgentId === edge.agentAId ||
                focusedAgentId === edge.agentBId ||
                hoveredAgentId === edge.agentAId ||
                hoveredAgentId === edge.agentBId;

              const isHighlighted =
                isSelectedEdge || isHoveredEdge || isConnectedToFocusedAgent;

              const hasAnySelection = Boolean(
                selectedEdgeKey || focusedAgentId || hoveredEdgeKey || hoveredAgentId
              );
              const isDimmed = hasAnySelection && !isHighlighted;

              const { pathD, midX, midY } = computeEdgeGeometry(
                nodeA,
                nodeB,
                edge.scope
              );

              const baseStrokeWidth = Math.min(4.6, 1.45 + (edge.weight - 1) * 0.85);
              const strokeWidth = isSelectedEdge
                ? baseStrokeWidth + 1.1
                : isHighlighted
                  ? baseStrokeWidth + 0.5
                  : baseStrokeWidth;

              const strokeColor = getEdgeStrokeColor(edge.scope, isHighlighted);
              const strokeOpacity = isDimmed
                ? 0.14
                : isHighlighted
                  ? 0.96
                  : edge.weight >= 2
                    ? 0.82
                    : 0.5;

              const showWeightMarker =
                !isDimmed && (edge.weight >= 2 || isSelectedEdge || isHoveredEdge);

              return (
                <g key={edge.key}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeOpacity={strokeOpacity}
                    strokeLinecap="round"
                    strokeDasharray={edge.scope === 'dispatch' ? '4 3' : undefined}
                  />
                  {/* Wide transparent hit target for easy line clicking */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredEdgeKey(edge.key)}
                    onMouseLeave={() =>
                      setHoveredEdgeKey((prev) => (prev === edge.key ? null : prev))
                    }
                    onClick={() => handleEdgeClick(edge.key)}
                  >
                    <title>
                      {`${nodeA.agent.name} ↔ ${nodeB.agent.name} · ${formatScopeLabel(
                        edge.scope
                      )} · ${edge.weight} ${
                        edge.weight === 1 ? 'collaboration' : 'collaborations'
                      }`}
                    </title>
                  </path>

                  {showWeightMarker && (
                    <g
                      transform={`translate(${midX.toFixed(1)}, ${midY.toFixed(1)})`}
                      className="cursor-pointer"
                      onMouseEnter={() => setHoveredEdgeKey(edge.key)}
                      onMouseLeave={() =>
                        setHoveredEdgeKey((prev) => (prev === edge.key ? null : prev))
                      }
                      onClick={() => handleEdgeClick(edge.key)}
                    >
                      <rect
                        x={-11}
                        y={-7.5}
                        width={22}
                        height={15}
                        rx={4}
                        fill="#0f172a"
                        stroke={strokeColor}
                        strokeWidth={1}
                      />
                      <text
                        x={0}
                        y={3.2}
                        textAnchor="middle"
                        fill="#f8fafc"
                        fontSize={8.5}
                        fontWeight={600}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      >
                        {edge.weight}×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Villager Avatar Nodes */}
          {nodes.map((node) => {
            const { agent } = node;
            const stats = network.statsByAgentId.get(agent.id);
            const collabWeight = stats?.totalWeight ?? 0;
            const isMatt = agent.id === 'matt' || agent.role === 'chief_of_staff';
            const isFocused = focusedAgentId === agent.id;
            const isInActiveEdge =
              activeEdge?.agentAId === agent.id || activeEdge?.agentBId === agent.id;
            const isHighlighted = highlightedNodeIds
              ? highlightedNodeIds.has(agent.id)
              : true;

            const availability = resolveAgentAvailability(agent, {
              tasks,
              approvals,
              busyChatAgentId,
            });

            const leftPct = (node.x / GRAPH_W) * 100;
            const topPct = (node.y / GRAPH_H) * 100;

            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => handleNodeClick(agent.id)}
                onMouseEnter={() => setHoveredAgentId(agent.id)}
                onMouseLeave={() =>
                  setHoveredAgentId((prev) => (prev === agent.id ? null : prev))
                }
                style={{ left: `${leftPct}%`, top: `${topPct}%` }}
                title={`${agent.name} (${agent.department}) · ${collabWeight} ${
                  collabWeight === 1 ? 'collaboration' : 'collaborations'
                } · ${availability.label}`}
                className={`group absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center cursor-pointer transition-opacity duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded-md ${
                  isHighlighted ? 'opacity-100 z-10' : 'opacity-30 z-0'
                }`}
              >
                <div className="relative">
                  <div
                    className={`flex items-center justify-center rounded-lg border overflow-hidden transition-transform duration-150 group-hover:scale-105 ${
                      isMatt ? 'h-8 w-8' : 'h-7 w-7'
                    } ${
                      isFocused || isInActiveEdge
                        ? 'border-amber-400 bg-slate-900 ring-2 ring-amber-400/40'
                        : collabWeight >= 2
                          ? 'border-slate-600 bg-slate-900/95'
                          : 'border-slate-800 bg-slate-950/90'
                    }`}
                  >
                    <CharacterSpriteBadge agent={agent} size={isMatt ? 30 : 26} />
                  </div>
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${
                      AVAILABILITY_DOT[availability.level]
                    }`}
                  />
                </div>
                <span
                  className={`mt-0.5 px-1 rounded bg-slate-950/85 text-[10px] leading-tight whitespace-nowrap shrink-0 tabular-nums ${
                    isFocused || isInActiveEdge
                      ? 'font-semibold text-amber-300'
                      : collabWeight > 0
                        ? 'font-medium text-slate-200'
                        : 'text-slate-400'
                  }`}
                >
                  {agent.name}
                  {collabWeight > 0 ? ` · ${collabWeight}` : ''}
                </span>
              </button>
            );
          })}
        </div>

        {/* Clean Unboxed Legend */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-0.5 w-3.5 bg-amber-400 rounded" aria-hidden="true" />
              <span>Cross-House</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="inline-block h-0.5 w-3.5 bg-emerald-400 rounded" aria-hidden="true" />
              <span>Intra-House</span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span
                className="inline-block w-3.5 border-t-2 border-dashed border-sky-400"
                aria-hidden="true"
              />
              <span>Matt Dispatch</span>
            </span>
          </div>
          <span className="text-slate-500 whitespace-nowrap">
            Click any villager or line to inspect
          </span>
        </div>
      </div>

      {/* Contextual Detail / Frequent Pairs Table */}
      <div className="border-t border-slate-800/80 mt-1">
        {network.edges.length === 0 ? (
          <div className="p-5 text-center space-y-2.5">
            <p className="text-xs font-semibold text-slate-200">
              No collaboration links recorded yet
            </p>
            <p className="mx-auto max-w-sm text-xs text-slate-400 leading-relaxed">
              Lines between villagers appear and thicken automatically as they execute shared tasks and cross-house handoff traces.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              {onPrefillTask && (
                <button
                  type="button"
                  onClick={() =>
                    onPrefillTask(
                      'Have Aria research top integration patterns and coordinate with Kieran to draft an implementation checklist.'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Load Cross-House Task</span>
                </button>
              )}
              {agentById.get('matt') && (
                <button
                  type="button"
                  onClick={() => {
                    const matt = agentById.get('matt');
                    if (matt) onOpenAgentChat(matt);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                  <span>Chat with Matt</span>
                </button>
              )}
            </div>
          </div>
        ) : activeEdge ? (
          (() => {
            const agentA = agentById.get(activeEdge.agentAId);
            const agentB = agentById.get(activeEdge.agentBId);
            if (!agentA || !agentB) return null;
            return (
              <div>
                <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/50 px-4 py-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
                      <span className="font-semibold text-white">
                        {agentA.name} ↔ {agentB.name}
                      </span>
                      <span className="text-slate-600" aria-hidden="true">·</span>
                      <span
                        className={
                          activeEdge.scope === 'cross_house'
                            ? 'text-amber-300 font-medium'
                            : activeEdge.scope === 'intra_house'
                              ? 'text-emerald-300 font-medium'
                              : 'text-sky-300 font-medium'
                        }
                      >
                        {formatScopeLabel(activeEdge.scope)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      {activeEdge.weight}{' '}
                      {activeEdge.weight === 1 ? 'collaboration' : 'collaborations'} ·{' '}
                      {activeEdge.sharedTaskCount}{' '}
                      {activeEdge.sharedTaskCount === 1 ? 'shared thread' : 'shared threads'} ·{' '}
                      {activeEdge.handoffCount}{' '}
                      {activeEdge.handoffCount === 1 ? 'handoff hop' : 'handoff hops'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenAgentChat(agentA)}
                      className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Chat {agentA.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAgentChat(agentB)}
                      className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Chat {agentB.name}
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-slate-800/80">
                  {activeEdge.records.map((rec) => (
                    <div
                      key={rec.id}
                      className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-slate-950/40 transition-colors"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                          <span className="font-medium text-slate-300">
                            {rec.kind === 'handoff' && rec.fromAgentName && rec.toAgentName
                              ? `${rec.fromAgentName} → ${rec.toAgentName}`
                              : 'Shared Task'}
                          </span>
                          {rec.status && (
                            <>
                              <span className="text-slate-600" aria-hidden="true">·</span>
                              <span>{rec.status.replace(/_/g, ' ')}</span>
                            </>
                          )}
                        </div>
                        <p className="text-xs text-slate-200 leading-snug line-clamp-2">
                          {rec.title}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                        {rec.trace &&
                          rec.trace.packets.length > 0 &&
                          onVisualizeTraceInTown && (
                            <button
                              type="button"
                              onClick={() => onVisualizeTraceInTown(rec.trace!)}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-400/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
                            >
                              <MapPin className="h-3 w-3 text-amber-400" />
                              <span>Town Arc</span>
                            </button>
                          )}
                        {rec.taskId && onOpenTaskReport && (
                          <button
                            type="button"
                            onClick={() => onOpenTaskReport(rec.taskId!)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <FileText className="h-3 w-3 text-slate-400" />
                            <span>Report</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()
        ) : activeAgent ? (
          <div>
            <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/50 px-4 py-3">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-1.5 text-xs">
                  <span className="font-semibold text-white">{activeAgent.name}</span>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-slate-400">{activeAgent.department}</span>
                </div>
                <p className="text-[11px] text-slate-400 tabular-nums">
                  {network.statsByAgentId.get(activeAgent.id)?.totalWeight ?? 0}{' '}
                  collaborations across{' '}
                  {network.statsByAgentId.get(activeAgent.id)?.partnerCount ?? 0} partners
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onWalkToAgent(activeAgent)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Footprints className="h-3 w-3 text-slate-400" />
                  <span>Go To</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenAgentChat(activeAgent)}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-amber-400 cursor-pointer whitespace-nowrap shrink-0"
                >
                  <MessageSquare className="h-3 w-3" />
                  <span>Chat</span>
                </button>
              </div>
            </div>

            {agentPartnerEdges.length === 0 ? (
              <div className="p-4 text-xs text-slate-400">
                No collaborations match the current filter for {activeAgent.name}.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80">
                {agentPartnerEdges.map((edge) => {
                  const partnerId =
                    edge.agentAId === activeAgent.id ? edge.agentBId : edge.agentAId;
                  const partner = agentById.get(partnerId);
                  if (!partner) return null;
                  const latest = edge.records[0];
                  return (
                    <div
                      key={edge.key}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-950/40 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-950/80 overflow-hidden">
                          <CharacterSpriteBadge agent={partner} size={30} />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
                            <span className="font-semibold text-white">{partner.name}</span>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="text-slate-400">{partner.department}</span>
                            <span className="text-slate-600" aria-hidden="true">·</span>
                            <span className="font-medium text-amber-300">
                              {edge.weight}×
                            </span>
                          </div>
                          {latest && (
                            <p className="text-[11px] text-slate-400 truncate">
                              {latest.title}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedEdgeKey(edge.key)}
                          className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          Inspect
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : visibleEdges.length === 0 ? (
          <div className="p-5 text-center text-xs text-slate-400">
            No collaboration pairs match the selected filter.
          </div>
        ) : (
          <div>
            <div className="px-4 py-2 border-b border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-medium text-slate-300">
                Top Collaborating Pairs
              </span>
              <span className="tabular-nums">
                Showing {Math.min(visibleEdges.length, 12)} of {visibleEdges.length}
              </span>
            </div>
            <div className="divide-y divide-slate-800/80">
              {visibleEdges.slice(0, 12).map((edge) => {
                const agentA = agentById.get(edge.agentAId);
                const agentB = agentById.get(edge.agentBId);
                if (!agentA || !agentB) return null;
                const latest = edge.records[0];

                return (
                  <div
                    key={edge.key}
                    onMouseEnter={() => setHoveredEdgeKey(edge.key)}
                    onMouseLeave={() =>
                      setHoveredEdgeKey((prev) => (prev === edge.key ? null : prev))
                    }
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-950/40 transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <div className="flex items-center -space-x-1.5 shrink-0">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-800 bg-slate-950 overflow-hidden">
                          <CharacterSpriteBadge agent={agentA} size={26} />
                        </div>
                        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-800 bg-slate-950 overflow-hidden">
                          <CharacterSpriteBadge agent={agentB} size={26} />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums">
                          <span className="font-semibold text-white">
                            {agentA.name} ↔ {agentB.name}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span
                            className={
                              edge.scope === 'cross_house'
                                ? 'text-amber-300'
                                : edge.scope === 'intra_house'
                                  ? 'text-emerald-300'
                                  : 'text-sky-300'
                            }
                          >
                            {formatScopeLabel(edge.scope)}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-slate-300 font-medium">
                            {edge.weight}{' '}
                            {edge.weight === 1 ? 'collab' : 'collabs'}
                          </span>
                        </div>
                        {latest && (
                          <p className="text-[11px] text-slate-400 truncate">
                            {latest.title}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleEdgeClick(edge.key)}
                        className="rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Inspect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
