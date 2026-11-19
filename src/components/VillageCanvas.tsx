import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Map as MapIcon, Minimize2 } from 'lucide-react';
import villageDioramaMapImg from '../assets/images/village_with_engineering_lab_1794567133267.jpg';
import {
  MAP_COLS,
  MAP_ROWS,
  TILE_SIZE,
  VILLAGE_BUILDINGS,
  VILLAGE_MAP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  findGridPath,
  tileToWorldCenter,
  worldToTile,
} from '../data/villageWorld';
import { drawStorybookCharacter } from '../lib/characterRenderer';
import {
  defaultStandbyActivity,
  describeVillageLocation,
  formatLiveStateLabel,
  resolveAgentAvailability,
} from '../lib/villageActivity';
import { CharacterSpriteBadge } from './CharacterSpriteBadge';
import type {
  Agent,
  ApprovalItem,
  Building,
  HandoffPacket,
  HandoffTrace,
  VillageActivityEvent,
  VillageTask,
} from '../types/village';

export interface GroundedCrossTalkResult {
  shouldSpeak: boolean;
  contextRef: string;
  headline: string;
  lineA: string;
  lineB: string;
  noteA: string;
  noteB: string;
}

interface VillageCanvasProps {
  agentsRef: React.MutableRefObject<Agent[]>;
  tasks?: VillageTask[];
  approvals?: ApprovalItem[];
  busyChatAgentId?: string | null;
  isRightDrawerOpen?: boolean;
  isCommandBarCollapsed?: boolean;
  selectedAgentId: string | null;
  showWalkability: boolean;
  isModalOpen: boolean;
  mapImageUrl?: string | null;
  activeHandoffTrace?: HandoffTrace | null;
  handoffReplayNonce?: number;
  cameraSpotlight?: { x: number; y: number; nonce: number } | null;
  onClickHandoffHop?: (trace: HandoffTrace, agentId: string) => void;
  onInspectBuildingTask?: (task: VillageTask) => void;
  onOpenApprovals?: () => void;
  onSelectAgent: (agent: Agent) => void;
  onEnterBuilding: (building: Building) => void;
  onNearDoorChange: (building: Building | null) => void;
  onNearAgentChange: (agent: Agent | null) => void;
  getBaselineActivity: (agent: Agent) => string;
  canAgentsCrossTalk?: (a: Agent, b: Agent) => boolean;
  onRequestGroundedCrossTalk: (
    a: Agent,
    b: Agent,
    location: string
  ) => Promise<GroundedCrossTalkResult | null>;
  onAgentsCrossTalk: (
    aId: string,
    bId: string,
    noteA: string,
    noteB: string,
    event: VillageActivityEvent
  ) => void;
}

interface ActiveVillagerChat {
  id: string;
  agentAId: string;
  agentBId: string;
  phase: 'warming_up' | 'turn_a' | 'turn_b';
  turnSwitchAtMs: number;
  endAtMs: number;
  lineA: string;
  lineB: string;
}

interface HopHitBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  agentId: string;
  trace: HandoffTrace;
}

interface BuildingBadgeHitBox {
  buildingId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'task' | 'approval';
  task?: VillageTask;
}

interface HoverInspectTarget {
  kind: 'agent' | 'building';
  id: string;
  screenX: number;
  screenY: number;
  containerW: number;
  containerH: number;
}

const MINIMAP_W = 192;
const MINIMAP_H = 128;

function isTaskActivelyRunning(task: VillageTask): boolean {
  return (
    !task.archived &&
    (task.status === 'queued' ||
      task.status === 'matt_routing' ||
      task.status === 'worker_executing' ||
      task.status === 'director_review' ||
      task.status === 'advisor_escalated')
  );
}

interface TownTraceLink {
  key: string;
  focusAgentId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  ctrlX: number;
  ctrlY: number;
  isCrossHouse: boolean;
  status: HandoffTrace['status'] | HandoffPacket['status'];
  primaryLabel: string;
  secondaryLabel: string;
}

function normalizeTownHouse(raw?: string): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+house$/i, '')
    .replace(/\s+department$/i, '');
}

function shortTownHouse(raw?: string): string {
  if (!raw) return 'Village';
  return raw.replace(/\s+House$/i, '').trim() || raw;
}

function resolveBuildingForTrace(agent?: Agent, houseName?: string): Building | null {
  if (agent?.buildingId) {
    const byId = VILLAGE_BUILDINGS.find((b) => b.id === agent.buildingId);
    if (byId) return byId;
  }
  const norm = normalizeTownHouse(houseName);
  if (!norm) return null;
  return (
    VILLAGE_BUILDINGS.find((b) => {
      const bn = normalizeTownHouse(b.name);
      return bn === norm || bn.includes(norm) || norm.includes(bn);
    }) ?? null
  );
}

function shortStatusTag(status: HandoffTrace['status'] | HandoffPacket['status']): string {
  switch (status) {
    case 'completed':
      return 'Verified';
    case 'running':
    case 'queued':
      return 'Running';
    case 'aborted_cap_reached':
      return 'Halted';
    case 'failed':
    default:
      return 'Failed';
  }
}

interface SmokeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  phase: number;
}

interface DustPuff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
}

interface FireflyMote {
  baseX: number;
  baseY: number;
  radius: number;
  speed: number;
  phase: number;
}

interface FountainDrop {
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  zDepth: number;
  tier: 'upper' | 'outer';
  life: number;
}

interface FountainSplash {
  x: number;
  y: number;
  radius: number;
  alpha: number;
}

interface Bird {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  scale: number;
}

const TALK_PROXIMITY_RADIUS = TILE_SIZE * 2.35;

// Normalized coordinates aligned directly to the 4K diorama landmarks
const LANTERN_POSITIONS: Array<[number, number]> = [
  [0.397, 0.34],
  [0.608, 0.34],
  [0.332, 0.436],
  [0.68, 0.438],
  [0.365, 0.588],
  [0.64, 0.592],
];

const CHIMNEY_POSITIONS: Array<[number, number]> = [
  [0.172, 0.082], // Systems & Dev Lab chimney
  [0.351, 0.145], // Inbox & Calendar chimney
  [0.793, 0.125], // Research observatory chimney
  [0.835, 0.34], // YouTube Studio chimney
  [0.205, 0.625], // Operations workshop chimney
  [0.583, 0.635], // Health & Home chimney
];

interface RiverSample {
  x: number;
  y: number;
  halfWidth: number;
  tx: number;
  ty: number;
}

// Control points calibrated directly to the eastern brook in the 4K village diorama
const RIVER_CONTROL_POINTS: Array<{ yNorm: number; xNorm: number; halfWidth: number }> = [
  { yNorm: 0.05, xNorm: 0.946, halfWidth: 13 },
  { yNorm: 0.14, xNorm: 0.916, halfWidth: 16 },
  { yNorm: 0.24, xNorm: 0.908, halfWidth: 18 },
  { yNorm: 0.34, xNorm: 0.933, halfWidth: 19 },
  { yNorm: 0.42, xNorm: 0.941, halfWidth: 19.5 },
  { yNorm: 0.52, xNorm: 0.937, halfWidth: 20 },
  { yNorm: 0.62, xNorm: 0.944, halfWidth: 20.5 },
  { yNorm: 0.72, xNorm: 0.928, halfWidth: 21 },
  { yNorm: 0.82, xNorm: 0.904, halfWidth: 22.5 },
  { yNorm: 0.91, xNorm: 0.87, halfWidth: 24 },
  { yNorm: 1.0, xNorm: 0.834, halfWidth: 25.5 },
];

const RIVER_OPEN_SEGMENTS: Array<[number, number]> = [
  [0.068, 0.335], // Upper forest stretch above first bridge
  [0.379, 0.615], // Middle stretch between the two wooden bridges
  [0.662, 0.998], // Lower diagonal bend below second bridge
];

function evalRiverRaw(yNorm: number): { x: number; halfWidth: number } {
  const pts = RIVER_CONTROL_POINTS;
  if (yNorm <= pts[0].yNorm) {
    return { x: pts[0].xNorm * WORLD_WIDTH, halfWidth: pts[0].halfWidth };
  }
  if (yNorm >= pts[pts.length - 1].yNorm) {
    const last = pts[pts.length - 1];
    return { x: last.xNorm * WORLD_WIDTH, halfWidth: last.halfWidth };
  }
  let idx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    if (yNorm >= pts[i].yNorm && yNorm <= pts[i + 1].yNorm) {
      idx = i;
      break;
    }
  }
  const p0 = pts[Math.max(0, idx - 1)];
  const p1 = pts[idx];
  const p2 = pts[idx + 1];
  const p3 = pts[Math.min(pts.length - 1, idx + 2)];
  const t = (yNorm - p1.yNorm) / Math.max(0.0001, p2.yNorm - p1.yNorm);
  const t2 = t * t;
  const t3 = t2 * t;

  // Catmull-Rom spline interpolation for smooth natural river bends
  const xNorm =
    0.5 *
    (2 * p1.xNorm +
      (-p0.xNorm + p2.xNorm) * t +
      (2 * p0.xNorm - 5 * p1.xNorm + 4 * p2.xNorm - p3.xNorm) * t2 +
      (-p0.xNorm + 3 * p1.xNorm - 3 * p2.xNorm + p3.xNorm) * t3);
  const halfWidth = p1.halfWidth + (p2.halfWidth - p1.halfWidth) * t;
  return { x: xNorm * WORLD_WIDTH, halfWidth };
}

function sampleRiver(yNorm: number): RiverSample {
  const clamped = Math.max(0.05, Math.min(1.0, yNorm));
  const cur = evalRiverRaw(clamped);
  const eps = 0.006;
  const prev = evalRiverRaw(Math.max(0.05, clamped - eps));
  const next = evalRiverRaw(Math.min(1.0, clamped + eps));
  const dx = next.x - prev.x;
  const dy = (Math.min(1.0, clamped + eps) - Math.max(0.05, clamped - eps)) * WORLD_HEIGHT;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: cur.x,
    y: clamped * WORLD_HEIGHT,
    halfWidth: cur.halfWidth,
    tx: dx / len,
    ty: dy / len,
  };
}

function clipRiverSegments(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  for (const [yStart, yEnd] of RIVER_OPEN_SEGMENTS) {
    const steps = 14;
    const leftPts: Array<{ x: number; y: number }> = [];
    const rightPts: Array<{ x: number; y: number }> = [];
    for (let s = 0; s <= steps; s++) {
      const yn = yStart + ((yEnd - yStart) * s) / steps;
      const pt = sampleRiver(yn);
      // Perpendicular normal pointing across river width
      const nx = pt.ty;
      const ny = -pt.tx;
      leftPts.push({ x: pt.x - nx * pt.halfWidth, y: pt.y - ny * pt.halfWidth });
      rightPts.push({ x: pt.x + nx * pt.halfWidth, y: pt.y + ny * pt.halfWidth });
    }
    ctx.moveTo(leftPts[0].x, leftPts[0].y);
    for (let i = 1; i < leftPts.length; i++) {
      ctx.lineTo(leftPts[i].x, leftPts[i].y);
    }
    for (let i = rightPts.length - 1; i >= 0; i--) {
      ctx.lineTo(rightPts[i].x, rightPts[i].y);
    }
    ctx.closePath();
  }
  ctx.clip();
}

export const VillageCanvas: React.FC<VillageCanvasProps> = ({
  agentsRef,
  tasks = [],
  approvals = [],
  busyChatAgentId = null,
  isRightDrawerOpen = false,
  isCommandBarCollapsed = false,
  selectedAgentId,
  showWalkability,
  isModalOpen,
  mapImageUrl,
  activeHandoffTrace = null,
  handoffReplayNonce = 0,
  cameraSpotlight = null,
  onClickHandoffHop,
  onInspectBuildingTask,
  onOpenApprovals,
  onSelectAgent,
  onEnterBuilding,
  onNearDoorChange,
  onNearAgentChange,
  getBaselineActivity,
  canAgentsCrossTalk,
  onRequestGroundedCrossTalk,
  onAgentsCrossTalk,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDraggingMiniMapRef = useRef<boolean>(false);
  const [miniMapExpanded, setMiniMapExpanded] = useState<boolean>(true);
  const [hoverInspect, setHoverInspect] = useState<HoverInspectTarget | null>(null);
  const hoverInspectRef = useRef<HoverInspectTarget | null>(null);

  const worldMapImgRef = useRef<HTMLImageElement | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const cameraRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hoveredBuildingIdRef = useRef<string | null>(null);
  const hoveredAgentIdRef = useRef<string | null>(null);
  const hoveredHopKeyRef = useRef<string | null>(null);
  const hopHitBoxesRef = useRef<HopHitBox[]>([]);
  const buildingBadgeHitBoxesRef = useRef<BuildingBadgeHitBox[]>([]);
  const liveContextRef = useRef<{
    tasks: VillageTask[];
    approvals: ApprovalItem[];
    busyChatAgentId: string | null;
  }>({ tasks, approvals, busyChatAgentId });
  const activeTraceRef = useRef<HandoffTrace | null>(activeHandoffTrace);
  const replayStartMsRef = useRef<number>(performance.now());
  const spotlightRef = useRef<{ x: number; y: number; untilMs: number } | null>(null);
  const nearDoorIdRef = useRef<string | null>(null);
  const nearAgentIdRef = useRef<string | null>(null);
  const hasCenteredCamRef = useRef(false);
  const clickTargetRef = useRef<{ x: number; y: number; alpha: number } | null>(null);

  const smokeRef = useRef<SmokeParticle[]>([]);
  const dustRef = useRef<DustPuff[]>([]);
  const firefliesRef = useRef<FireflyMote[]>(
    Array.from({ length: 20 }, (_, i) => ({
      baseX: WORLD_WIDTH * (0.12 + ((i * 37) % 76) / 100),
      baseY: WORLD_HEIGHT * (0.14 + ((i * 53) % 74) / 100),
      radius: 1.4 + (i % 3) * 0.55,
      speed: 0.018 + (i % 5) * 0.004,
      phase: i * 1.17,
    }))
  );
  const fountainDropsRef = useRef<FountainDrop[]>(
    Array.from({ length: 26 }, (_, i) => {
      const fx = WORLD_WIDTH * 0.503;
      const peakY = WORLD_HEIGHT * 0.424;
      const angle = (i / 26) * Math.PI * 2 + (i % 3) * 0.17;
      const tier = i % 2 === 0 ? 'upper' : 'outer';
      const radialSpeed = tier === 'upper' ? 0.36 + (i % 4) * 0.06 : 0.62 + (i % 5) * 0.07;
      const vx = Math.cos(angle) * radialSpeed;
      const vy = -0.65 - (i % 3) * 0.14 + Math.sin(angle) * radialSpeed * 0.42;
      const startSteps = (i * 7) % 28;
      let px = fx;
      let py = peakY;
      let curVy = vy;
      for (let s = 0; s < startSteps; s++) {
        px += vx;
        curVy += 0.068;
        py += curVy;
      }
      return {
        x: px,
        y: py,
        prevX: px - vx,
        prevY: py - curVy,
        vx,
        vy: curVy,
        zDepth: Math.sin(angle),
        tier,
        life: startSteps,
      };
    })
  );
  const fountainSplashesRef = useRef<FountainSplash[]>([]);
  const birdsRef = useRef<Bird[]>([
    { x: 180, y: 180, vx: 0.68, vy: 0.1, phase: 0, scale: 1 },
    { x: 640, y: 260, vx: -0.58, vy: 0.08, phase: 2.1, scale: 0.85 },
    { x: 1120, y: 140, vx: 0.76, vy: -0.08, phase: 4.2, scale: 0.92 },
  ]);

  const lastDoorRef = useRef<string | null>(null);
  const lastNearAgentRef = useRef<string | null>(null);
  const crossTalkCooldownRef = useRef<Map<string, number>>(new Map());
  const lastGlobalCrossTalkRef = useRef<number>(0);
  const crossTalkInFlightRef = useRef<boolean>(false);
  const activeChatsRef = useRef<ActiveVillagerChat[]>([]);
  const callbacksRef = useRef({
    onClickHandoffHop,
    onInspectBuildingTask,
    onOpenApprovals,
    onSelectAgent,
    onEnterBuilding,
    onNearDoorChange,
    onNearAgentChange,
    getBaselineActivity,
    canAgentsCrossTalk,
    onRequestGroundedCrossTalk,
    onAgentsCrossTalk,
  });

  useEffect(() => {
    callbacksRef.current = {
      onClickHandoffHop,
      onInspectBuildingTask,
      onOpenApprovals,
      onSelectAgent,
      onEnterBuilding,
      onNearDoorChange,
      onNearAgentChange,
      getBaselineActivity,
      canAgentsCrossTalk,
      onRequestGroundedCrossTalk,
      onAgentsCrossTalk,
    };
  }, [
    onClickHandoffHop,
    onInspectBuildingTask,
    onOpenApprovals,
    onSelectAgent,
    onEnterBuilding,
    onNearDoorChange,
    onNearAgentChange,
    getBaselineActivity,
    canAgentsCrossTalk,
    onRequestGroundedCrossTalk,
    onAgentsCrossTalk,
  ]);

  useEffect(() => {
    liveContextRef.current = { tasks, approvals, busyChatAgentId };
  }, [tasks, approvals, busyChatAgentId]);

  useEffect(() => {
    activeTraceRef.current = activeHandoffTrace;
    if (activeHandoffTrace) {
      replayStartMsRef.current = performance.now();
    } else {
      hopHitBoxesRef.current = [];
      hoveredHopKeyRef.current = null;
    }
  }, [activeHandoffTrace, handoffReplayNonce]);

  useEffect(() => {
    if (!cameraSpotlight) return;
    spotlightRef.current = {
      x: cameraSpotlight.x,
      y: cameraSpotlight.y,
      untilMs: performance.now() + 5500,
    };
  }, [cameraSpotlight]);

  // Preload fallback bundled map, then seamlessly hot-swap when 4K map URL is ready
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      if (!worldMapImgRef.current) {
        worldMapImgRef.current = img;
      }
    };
    img.src = villageDioramaMapImg;
  }, []);

  useEffect(() => {
    if (!mapImageUrl) return;
    const hiResImg = new Image();
    hiResImg.onload = () => {
      worldMapImgRef.current = hiResImg;
    };
    hiResImg.src = mapImageUrl;
  }, [mapImageUrl]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (
        e.key.toLowerCase() === 'n' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        setMiniMapExpanded((prev) => !prev);
        return;
      }
      keysRef.current.add(e.key.toLowerCase());
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    const handleWindowMouseUp = () => {
      isDraggingMiniMapRef.current = false;
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let tick = 0;
    let smokeAccumulator = 0;
    let lastTime = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = parent.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && canvas.parentElement
        ? new ResizeObserver(() => resize())
        : null;
    if (resizeObserver && canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    const isPositionWalkable = (px: number, py: number) => {
      const margin = 9;
      const corners = [
        worldToTile(px - margin, py - margin),
        worldToTile(px + margin, py - margin),
        worldToTile(px - margin, py + margin),
        worldToTile(px + margin, py + margin),
      ];
      return corners.every((c) => VILLAGE_MAP.walkable[c.y]?.[c.x] === true);
    };

    const spawnWalkDust = (agent: Agent, dtScale: number) => {
      if (Math.random() < 0.22 * dtScale) {
        dustRef.current.push({
          x: agent.x + (Math.random() - 0.5) * 8,
          y: agent.y + 11,
          vx: (Math.random() - 0.5) * 0.35,
          vy: -0.15 - Math.random() * 0.2,
          radius: 2 + Math.random() * 1.8,
          alpha: 0.36,
        });
      }
    };

    const moveAlongPath = (agent: Agent, baseSpeed: number, dtScale: number) => {
      if (!agent.path || agent.path.length === 0) {
        agent.isMoving = false;
        return false;
      }
      const speed = baseSpeed * dtScale;
      const nextTile = agent.path[0];
      const target = tileToWorldCenter(nextTile.x, nextTile.y);
      const dx = target.x - agent.x;
      const dy = target.y - agent.y;
      const dist = Math.hypot(dx, dy);

      if (dist <= speed) {
        agent.x = target.x;
        agent.y = target.y;
        agent.path.shift();
        if (agent.path.length === 0) {
          agent.isMoving = false;
          return true;
        }
      } else {
        agent.x += (dx / dist) * speed;
        agent.y += (dy / dist) * speed;
        agent.isMoving = true;
        agent.walkFrame += speed * 0.16;
        if (Math.abs(dx) > Math.abs(dy)) agent.direction = dx > 0 ? 'right' : 'left';
        else agent.direction = dy > 0 ? 'down' : 'up';
        if (baseSpeed >= 3.2) spawnWalkDust(agent, dtScale);
      }
      return false;
    };

    const stepSimulation = (dtScale: number) => {
      const agents = agentsRef.current;
      const cho = agents.find((a) => a.id === 'cho');
      const matt = agents.find((a) => a.id === 'matt');
      const periodic12 = Math.floor(tick) % 12 === 0 && Math.floor(tick - dtScale) % 12 !== 0;

      if (cho && !isModalOpen) {
        const keys = keysRef.current;
        let mx = 0;
        let my = 0;
        if (keys.has('arrowleft') || keys.has('a')) mx -= 1;
        if (keys.has('arrowright') || keys.has('d')) mx += 1;
        if (keys.has('arrowup') || keys.has('w')) my -= 1;
        if (keys.has('arrowdown') || keys.has('s')) my += 1;

        const isRunning = keys.has('shift');
        const speed = (isRunning ? 4.4 : 2.55) * dtScale;

        if (mx !== 0 || my !== 0) {
          cho.path = [];
          clickTargetRef.current = null;
          spotlightRef.current = null;
          const len = Math.hypot(mx, my);
          const nx = (mx / len) * speed;
          const ny = (my / len) * speed;
          if (isPositionWalkable(cho.x + nx, cho.y)) cho.x += nx;
          if (isPositionWalkable(cho.x, cho.y + ny)) cho.y += ny;
          cho.isMoving = true;
          cho.walkFrame += (isRunning ? 0.42 : 0.24) * dtScale;
          if (Math.abs(mx) >= Math.abs(my)) cho.direction = mx > 0 ? 'right' : 'left';
          else cho.direction = my > 0 ? 'down' : 'up';
          if (isRunning) spawnWalkDust(cho, dtScale);
        } else if (cho.path.length > 0) {
          const arrived = moveAlongPath(cho, isRunning ? 4.2 : 2.75, dtScale);
          if (arrived) clickTargetRef.current = null;
        } else {
          cho.isMoving = false;
          clickTargetRef.current = null;
        }
      }

      const nowMs = Date.now();

      const faceEachOther = (a: Agent, b: Agent) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) >= Math.abs(dy) * 0.65) {
          a.direction = dx >= 0 ? 'right' : 'left';
          b.direction = dx >= 0 ? 'left' : 'right';
        } else {
          a.direction = dy >= 0 ? 'down' : 'up';
          b.direction = dy >= 0 ? 'up' : 'down';
        }
      };

      const releaseChatVillager = (ag: Agent | undefined) => {
        if (!ag || ag.id === 'cho') return;
        ag.speechBubble = null;
        ag.speechTimer = 0;
        ag.busyUntil = null;
        if (ag.state === 'chatting') {
          ag.state =
            ag.role === 'worker'
              ? 'walking'
              : ag.id === 'matt'
                ? 'following_cho'
                : 'idle_yard';
          if (ag.role === 'worker') {
            ag.patrolTimer = Math.min(ag.patrolTimer, 8);
          }
          if (ag.currentActivity?.startsWith('Talking with ')) {
            ag.currentActivity =
              callbacksRef.current.getBaselineActivity(ag) || defaultStandbyActivity(ag);
          }
        }
      };

      const positionPairForChat = (a: Agent, b: Agent) => {
        const anchorToB = b.id === 'matt' || b.role === 'director';
        const anchorToA = !anchorToB && (a.id === 'matt' || a.role === 'director');
        const halfGap = 21;

        if (anchorToB || anchorToA) {
          const fixed = anchorToB ? b : a;
          const mover = anchorToB ? a : b;
          const preferLeft = mover.x <= fixed.x;
          const sideOffsets = preferLeft ? [-42, 42] : [42, -42];
          for (const ox of sideOffsets) {
            if (isPositionWalkable(fixed.x + ox, fixed.y)) {
              mover.x = fixed.x + ox;
              mover.y = fixed.y;
              faceEachOther(a, b);
              return;
            }
          }
          for (const oy of [38, -38]) {
            if (isPositionWalkable(fixed.x, fixed.y + oy)) {
              mover.x = fixed.x;
              mover.y = fixed.y + oy;
              faceEachOther(a, b);
              return;
            }
          }
          faceEachOther(a, b);
          return;
        }

        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const aLeft = a.x <= b.x;
        const lx = mx - halfGap;
        const rx = mx + halfGap;
        if (isPositionWalkable(lx, my) && isPositionWalkable(rx, my)) {
          if (aLeft) {
            a.x = lx;
            a.y = my;
            b.x = rx;
            b.y = my;
          } else {
            b.x = lx;
            b.y = my;
            a.x = rx;
            a.y = my;
          }
        }
        faceEachOther(a, b);
      };

      // Advance active back-and-forth villager conversations
      if (activeChatsRef.current.length > 0) {
        const interruptStates = new Set([
          'working_inside',
          'phone_call',
          'town_hall_seated',
          'summoned',
        ]);
        const remainingChats: ActiveVillagerChat[] = [];
        for (const chat of activeChatsRef.current) {
          const liveA = agents.find((x) => x.id === chat.agentAId);
          const liveB = agents.find((x) => x.id === chat.agentBId);
          const mattPulledByCho =
            (liveA?.id === 'matt' || liveB?.id === 'matt') &&
            cho &&
            matt &&
            Math.hypot(cho.x - matt.x, cho.y - matt.y) > TILE_SIZE * 2.9;

          if (
            !liveA ||
            !liveB ||
            interruptStates.has(liveA.state) ||
            interruptStates.has(liveB.state) ||
            mattPulledByCho
          ) {
            if (liveA && !interruptStates.has(liveA.state)) releaseChatVillager(liveA);
            if (liveB && !interruptStates.has(liveB.state)) releaseChatVillager(liveB);
            continue;
          }

          if (chat.phase === 'turn_a' && nowMs >= chat.turnSwitchAtMs) {
            chat.phase = 'turn_b';
            liveA.speechBubble = null;
            liveA.speechTimer = 0;
            liveB.speechBubble = chat.lineB;
            liveB.speechTimer = 270;
          }

          if (chat.phase !== 'warming_up' && nowMs >= chat.endAtMs) {
            releaseChatVillager(liveA);
            releaseChatVillager(liveB);
            continue;
          }

          liveA.isMoving = false;
          liveA.path = [];
          liveB.isMoving = false;
          liveB.path = [];
          faceEachOther(liveA, liveB);
          remainingChats.push(chat);
        }
        activeChatsRef.current = remainingChats;
      }

      if (matt && cho && matt.state !== 'town_hall_seated') {
        const distToCho = Math.hypot(cho.x - matt.x, cho.y - matt.y);
        if (matt.state === 'chatting' && distToCho <= TILE_SIZE * 2.9) {
          matt.path = [];
          matt.isMoving = false;
        } else if (distToCho > TILE_SIZE * 1.8) {
          if (Math.floor(tick) % 14 === 0 || matt.path.length === 0) {
            const choTile = worldToTile(cho.x, cho.y);
            const mattTile = worldToTile(matt.x, matt.y);
            const followCandidates = [
              { x: choTile.x - 1, y: choTile.y },
              { x: choTile.x + 1, y: choTile.y },
              { x: choTile.x, y: choTile.y - 1 },
              { x: choTile.x, y: choTile.y + 1 },
            ].filter((p) => VILLAGE_MAP.walkable[p.y]?.[p.x] && !(p.x === choTile.x && p.y === choTile.y));
            const bestCandidate =
              followCandidates.sort(
                (a, b) =>
                  Math.hypot(a.x - mattTile.x, a.y - mattTile.y) -
                  Math.hypot(b.x - mattTile.x, b.y - mattTile.y)
              )[0] ?? choTile;
            matt.path = findGridPath(mattTile, bestCandidate, VILLAGE_MAP.walkable);
          }
          moveAlongPath(matt, distToCho > TILE_SIZE * 4 ? 3.8 : 2.45, dtScale);
        } else {
          matt.path = [];
          matt.isMoving = false;
          const dx = cho.x - matt.x;
          const dy = cho.y - matt.y;
          if (Math.abs(dx) > Math.abs(dy)) matt.direction = dx > 0 ? 'right' : 'left';
          else matt.direction = dy > 0 ? 'down' : 'up';
        }
      }
      for (const agent of agents) {
        if (agent.speechTimer > 0) {
          agent.speechTimer -= dtScale;
          if (agent.speechTimer <= 0) agent.speechBubble = null;
        }
        if (agent.busyUntil && nowMs >= agent.busyUntil) {
          agent.busyUntil = null;
          if (agent.state === 'working_inside') {
            agent.state = agent.role === 'worker' ? 'walking' : 'idle_yard';
            if (agent.role === 'director') {
              agent.speechBubble = 'Report ready for you!';
              agent.speechTimer = 180;
            }
          } else if (agent.state === 'phone_call' && agent.id === 'matt') {
            agent.state = 'following_cho';
          } else if (agent.state === 'chatting' && agent.id !== 'cho') {
            agent.state =
              agent.role === 'worker'
                ? 'walking'
                : agent.id === 'matt'
                  ? 'following_cho'
                  : 'idle_yard';
            if (agent.currentActivity?.startsWith('Talking with ')) {
              agent.currentActivity =
                callbacksRef.current.getBaselineActivity(agent) || defaultStandbyActivity(agent);
            }
          }
        }
        if (agent.id === 'cho' || agent.id === 'matt') continue;

        const homeBuilding = VILLAGE_BUILDINGS.find((b) => b.id === agent.buildingId);

        if (agent.state === 'summoned' && cho) {
          if (Math.floor(tick) % 18 === 0 || agent.path.length === 0) {
            const ct = worldToTile(cho.x, cho.y);
            const at = worldToTile(agent.x, agent.y);
            agent.path = findGridPath(
              at,
              { x: Math.min(MAP_COLS - 2, ct.x + 1), y: ct.y },
              VILLAGE_MAP.walkable
            );
          }
          const arrived = moveAlongPath(agent, 3.85, dtScale);
          if (arrived || Math.hypot(cho.x - agent.x, cho.y - agent.y) < TILE_SIZE * 1.7) {
            agent.state = 'chatting';
            agent.currentActivity = 'Waiting at your side to talk';
            agent.path = [];
            agent.isMoving = false;
            agent.speechBubble = "I'm here, what do you need?";
            agent.speechTimer = 180;
          }
          continue;
        }

        if (agent.state === 'town_hall_seated') {
          const th = VILLAGE_BUILDINGS.find((b) => b.id === 'town_hall');
          if (th) {
            const distDoor = Math.hypot(
              agent.x - (th.doorTileX * TILE_SIZE + TILE_SIZE / 2),
              agent.y - (th.doorTileY * TILE_SIZE + TILE_SIZE / 2)
            );
            if (distDoor > TILE_SIZE * 1.2) {
              if (agent.path.length === 0) {
                agent.path = findGridPath(
                  worldToTile(agent.x, agent.y),
                  { x: th.doorTileX, y: th.doorTileY },
                  VILLAGE_MAP.walkable
                );
              }
              moveAlongPath(agent, 3.2, dtScale);
            } else {
              agent.isMoving = false;
              agent.direction = 'up';
            }
          }
          continue;
        }

        if (agent.state === 'working_inside' && homeBuilding) {
          const doorCenter = tileToWorldCenter(homeBuilding.doorTileX, homeBuilding.doorTileY);
          if (Math.hypot(agent.x - doorCenter.x, agent.y - doorCenter.y) > 10) {
            if (agent.path.length === 0) {
              agent.path = findGridPath(
                worldToTile(agent.x, agent.y),
                { x: homeBuilding.doorTileX, y: homeBuilding.doorTileY },
                VILLAGE_MAP.walkable
              );
            }
            moveAlongPath(agent, 2.5, dtScale);
          } else {
            agent.isMoving = false;
            agent.direction = 'up';
          }
          continue;
        }

        // Directors stroll naturally around their building gate/courtyard, pause when chatting, & face CHO nearby
        if (agent.role === 'director' && homeBuilding) {
          if (agent.state === 'chatting' && agent.busyUntil && nowMs < agent.busyUntil) {
            agent.isMoving = false;
            agent.path = [];
          } else if (agent.path.length > 0) {
            moveAlongPath(agent, 1.8, dtScale);
          } else if (cho && Math.hypot(cho.x - agent.x, cho.y - agent.y) < TILE_SIZE * 3.8) {
            agent.isMoving = false;
            const dx = cho.x - agent.x;
            const dy = cho.y - agent.y;
            if (Math.abs(dx) > Math.abs(dy)) agent.direction = dx > 0 ? 'right' : 'left';
            else agent.direction = dy > 0 ? 'down' : 'up';
          } else {
            const yardCenter = tileToWorldCenter(homeBuilding.yardTileX, homeBuilding.yardTileY);
            const distFromYard = Math.hypot(agent.x - yardCenter.x, agent.y - yardCenter.y);
            if (distFromYard > TILE_SIZE * 2.5 && agent.state !== 'chatting') {
              agent.path = findGridPath(
                worldToTile(agent.x, agent.y),
                { x: homeBuilding.yardTileX, y: homeBuilding.yardTileY },
                VILLAGE_MAP.walkable
              );
            } else {
              agent.patrolTimer -= dtScale;
              if (agent.patrolTimer <= 0) {
                agent.patrolTimer = 180 + Math.floor(Math.random() * 180);
                const localNeighbors = [
                  { x: homeBuilding.yardTileX, y: homeBuilding.yardTileY },
                  { x: homeBuilding.doorTileX, y: homeBuilding.doorTileY },
                  { x: homeBuilding.yardTileX + 1, y: homeBuilding.yardTileY },
                  { x: homeBuilding.yardTileX - 1, y: homeBuilding.yardTileY },
                  { x: homeBuilding.yardTileX, y: homeBuilding.yardTileY + 1 },
                  { x: homeBuilding.yardTileX, y: homeBuilding.yardTileY - 1 },
                ].filter((p) => VILLAGE_MAP.walkable[p.y]?.[p.x]);
                if (localNeighbors.length > 0) {
                  const pick = localNeighbors[Math.floor(Math.random() * localNeighbors.length)];
                  agent.path = findGridPath(worldToTile(agent.x, agent.y), pick, VILLAGE_MAP.walkable);
                }
              }
            }
          }
        }

        // Workers patrol avenues, Town Square fountain plaza, courtyards & wooden bridges
        if (agent.role === 'worker') {
          if (agent.state === 'chatting' && agent.busyUntil && nowMs < agent.busyUntil) {
            agent.isMoving = false;
            agent.path = [];
          } else if (agent.path.length > 0) {
            moveAlongPath(agent, 1.7, dtScale);
          } else {
            agent.patrolTimer -= dtScale;
            if (agent.patrolTimer <= 0) {
              agent.patrolTimer = 60 + Math.floor(Math.random() * 95);
              const socialSpots = [
                { x: 20, y: 14 },
                { x: 25, y: 14 },
                { x: 21, y: 16 },
                { x: 24, y: 16 },
                ...VILLAGE_BUILDINGS.filter((b) => b.id !== 'town_hall').map((b) => ({
                  x: b.yardTileX,
                  y: b.yardTileY,
                })),
              ].filter((p) => VILLAGE_MAP.walkable[p.y]?.[p.x]);

              const avenueWaypoints = [
                { x: 18, y: 12 },
                { x: 26, y: 12 },
                { x: 18, y: 17 },
                { x: 26, y: 17 },
                { x: 14, y: 15 },
                { x: 29, y: 15 },
                { x: 17, y: 24 },
                { x: 28, y: 24 },
                { x: 12, y: 28 },
                { x: 22, y: 28 },
                { x: 34, y: 28 },
                { x: 34, y: 19 },
                { x: 31, y: 10 },
                { x: 8, y: 9 },
                { x: 11, y: 9 },
                { x: 14, y: 10 },
                { x: 41, y: 10 },
                { x: 41, y: 19 },
              ];

              const pool =
                socialSpots.length > 0 && Math.random() < 0.45
                  ? socialSpots
                  : avenueWaypoints;
              const pick = pool[Math.floor(Math.random() * pool.length)];
              agent.path = findGridPath(worldToTile(agent.x, agent.y), pick, VILLAGE_MAP.walkable);
            }
          }
        }

        // Face-to-face villager encounters & turn-taking cross-talk
        if (
          periodic12 &&
          !crossTalkInFlightRef.current &&
          activeChatsRef.current.length < 2 &&
          nowMs - lastGlobalCrossTalkRef.current > 16_000 &&
          agent.state !== 'chatting' &&
          agent.state !== 'working_inside' &&
          agent.state !== 'phone_call' &&
          agent.state !== 'summoned'
        ) {
          for (const other of agents) {
            if (
              other.id === agent.id ||
              other.id === 'cho' ||
              other.state === 'working_inside' ||
              other.state === 'phone_call' ||
              other.state === 'town_hall_seated' ||
              other.state === 'summoned' ||
              other.state === 'chatting'
            ) {
              continue;
            }
            if (other.id === 'matt' && cho?.isMoving) {
              continue;
            }

            const pairKey = [agent.id, other.id].sort().join(':');
            const lastPairTalk = crossTalkCooldownRef.current.get(pairKey) ?? 0;
            if (nowMs - lastPairTalk < 65_000) continue;

            if (Math.hypot(agent.x - other.x, agent.y - other.y) < TILE_SIZE * 2.15) {
              if (
                callbacksRef.current.canAgentsCrossTalk &&
                !callbacksRef.current.canAgentsCrossTalk(agent, other)
              ) {
                crossTalkCooldownRef.current.set(pairKey, nowMs - 52_000);
                continue;
              }

              crossTalkCooldownRef.current.set(pairKey, nowMs - 48_000);
              crossTalkInFlightRef.current = true;

              // Immediately stop both villagers face-to-face so they don't walk past each other
              positionPairForChat(agent, other);
              const shortOtherInit = other.name.replace(' (Worker)', '');
              const shortAgentInit = agent.name.replace(' (Worker)', '');
              const encounterId = `chat_${nowMs}_${Math.random().toString(36).slice(2, 6)}`;

              const location = describeVillageLocation(
                (agent.x + other.x) / 2,
                (agent.y + other.y) / 2
              );

              agent.state = 'chatting';
              agent.isMoving = false;
              agent.path = [];
              agent.busyUntil = nowMs + 11_000;
              agent.speechBubble = '···';
              agent.speechTimer = 180;
              agent.currentActivity = `Talking with ${shortOtherInit} · ${location}`;

              other.state = 'chatting';
              other.isMoving = false;
              other.path = [];
              other.busyUntil = nowMs + 11_000;
              other.speechBubble = null;
              other.speechTimer = 0;
              other.currentActivity = `Talking with ${shortAgentInit} · ${location}`;

              activeChatsRef.current.push({
                id: encounterId,
                agentAId: agent.id,
                agentBId: other.id,
                phase: 'warming_up',
                turnSwitchAtMs: nowMs + 5_500,
                endAtMs: nowMs + 10_000,
                lineA: '',
                lineB: '',
              });

              const aSnapshot = { ...agent };
              const bSnapshot = { ...other };

              void callbacksRef.current
                .onRequestGroundedCrossTalk(aSnapshot, bSnapshot, location)
                .then((grounded) => {
                  const liveA = agentsRef.current.find((x) => x.id === aSnapshot.id);
                  const liveB = agentsRef.current.find((x) => x.id === bSnapshot.id);
                  const activeEntry = activeChatsRef.current.find((c) => c.id === encounterId);

                  if (!grounded || !grounded.shouldSpeak || !liveA || !liveB || !activeEntry) {
                    activeChatsRef.current = activeChatsRef.current.filter(
                      (c) => c.id !== encounterId
                    );
                    releaseChatVillager(liveA);
                    releaseChatVillager(liveB);
                    return;
                  }

                  const busyStates = new Set([
                    'working_inside',
                    'phone_call',
                    'town_hall_seated',
                    'summoned',
                  ]);
                  if (busyStates.has(liveA.state) || busyStates.has(liveB.state)) {
                    activeChatsRef.current = activeChatsRef.current.filter(
                      (c) => c.id !== encounterId
                    );
                    if (!busyStates.has(liveA.state)) releaseChatVillager(liveA);
                    if (!busyStates.has(liveB.state)) releaseChatVillager(liveB);
                    return;
                  }

                  const doneMs = Date.now();
                  crossTalkCooldownRef.current.set(pairKey, doneMs);
                  lastGlobalCrossTalkRef.current = doneMs;

                  if (!liveA.talkedTodayWith.includes(liveB.id)) {
                    liveA.talkedTodayWith.push(liveB.id);
                  }
                  if (!liveB.talkedTodayWith.includes(liveA.id)) {
                    liveB.talkedTodayWith.push(liveA.id);
                  }

                  faceEachOther(liveA, liveB);

                  const shortOther = liveB.name.replace(' (Worker)', '');
                  const shortAgent = liveA.name.replace(' (Worker)', '');
                  const syncLocation = describeVillageLocation(
                    (liveA.x + liveB.x) / 2,
                    (liveA.y + liveB.y) / 2
                  );

                  const turnDurationMs = 4300;
                  activeEntry.phase = 'turn_a';
                  activeEntry.lineA = grounded.lineA;
                  activeEntry.lineB = grounded.lineB;
                  activeEntry.turnSwitchAtMs = doneMs + turnDurationMs;
                  activeEntry.endAtMs = doneMs + turnDurationMs * 2;

                  liveA.state = 'chatting';
                  liveA.isMoving = false;
                  liveA.path = [];
                  liveA.busyUntil = doneMs + turnDurationMs * 2 + 200;
                  liveA.speechBubble = grounded.lineA;
                  liveA.speechTimer = 265;
                  liveA.currentActivity = `Talking with ${shortOther} · ${grounded.contextRef}`;

                  liveB.state = 'chatting';
                  liveB.isMoving = false;
                  liveB.path = [];
                  liveB.busyUntil = doneMs + turnDurationMs * 2 + 200;
                  liveB.speechBubble = null;
                  liveB.speechTimer = 0;
                  liveB.currentActivity = `Talking with ${shortAgent} · ${grounded.contextRef}`;

                  const event: VillageActivityEvent = {
                    id: `act_${doneMs}_${Math.random().toString(36).slice(2, 6)}`,
                    kind: 'cross_talk',
                    timestamp: new Date(doneMs).toISOString(),
                    location: syncLocation,
                    headline: grounded.headline,
                    contextRef: grounded.contextRef,
                    participants: [
                      { id: liveA.id, name: shortAgent, department: liveA.department },
                      { id: liveB.id, name: shortOther, department: liveB.department },
                    ],
                    lines: [
                      { speakerName: shortAgent, text: grounded.lineA },
                      { speakerName: shortOther, text: grounded.lineB },
                    ],
                  };

                  callbacksRef.current.onAgentsCrossTalk(
                    liveA.id,
                    liveB.id,
                    grounded.noteA,
                    grounded.noteB,
                    event
                  );
                })
                .catch(() => {
                  const liveA = agentsRef.current.find((x) => x.id === aSnapshot.id);
                  const liveB = agentsRef.current.find((x) => x.id === bSnapshot.id);
                  activeChatsRef.current = activeChatsRef.current.filter(
                    (c) => c.id !== encounterId
                  );
                  releaseChatVillager(liveA);
                  releaseChatVillager(liveB);
                })
                .finally(() => {
                  crossTalkInFlightRef.current = false;
                });

              break;
            }
          }
        }
      }

      if (cho) {
        const choTile = worldToTile(cho.x, cho.y);
        const nearDoor =
          VILLAGE_BUILDINGS.find(
            (b) => Math.abs(b.doorTileX - choTile.x) <= 1 && Math.abs(b.doorTileY - choTile.y) <= 1
          ) ?? null;
        nearDoorIdRef.current = nearDoor?.id ?? null;
        if ((nearDoor?.id ?? null) !== lastDoorRef.current) {
          lastDoorRef.current = nearDoor?.id ?? null;
          callbacksRef.current.onNearDoorChange(nearDoor);
        }

        let closest: Agent | null = null;
        let closestDist = TALK_PROXIMITY_RADIUS;
        for (const a of agents) {
          if (a.id === 'cho') continue;
          const d = Math.hypot(a.x - cho.x, a.y - cho.y);
          if (d < closestDist) {
            closestDist = d;
            closest = a;
          }
        }
        nearAgentIdRef.current = closest?.id ?? null;
        if ((closest?.id ?? null) !== lastNearAgentRef.current) {
          lastNearAgentRef.current = closest?.id ?? null;
          callbacksRef.current.onNearAgentChange(closest);
        }
      }

      // Continuous gentle chimney plumes from all 5 cottage chimneys
      smokeAccumulator += dtScale;
      if (smokeAccumulator >= 10) {
        smokeAccumulator = 0;
        for (const [cx, cy] of CHIMNEY_POSITIONS) {
          if (Math.random() < 0.45) {
            smokeRef.current.push({
              x: WORLD_WIDTH * cx + (Math.random() - 0.5) * 3,
              y: WORLD_HEIGHT * cy,
              vx: 0.14 + Math.random() * 0.18,
              vy: -0.34 - Math.random() * 0.18,
              radius: 4.5 + Math.random() * 2.5,
              alpha: 0.34,
              phase: Math.random() * Math.PI * 2,
            });
          }
        }
      }
      smokeRef.current = smokeRef.current
        .map((s) => ({
          ...s,
          x: s.x + (s.vx + Math.sin(tick * 0.04 + s.phase) * 0.16) * dtScale,
          y: s.y + s.vy * dtScale,
          radius: s.radius + 0.1 * dtScale,
          alpha: s.alpha - 0.0036 * dtScale,
        }))
        .filter((s) => s.alpha > 0.015);

      // Update footstep dust puffs
      dustRef.current = dustRef.current
        .map((d) => ({
          ...d,
          x: d.x + d.vx * dtScale,
          y: d.y + d.vy * dtScale,
          radius: d.radius + 0.09 * dtScale,
          alpha: d.alpha - 0.014 * dtScale,
        }))
        .filter((d) => d.alpha > 0.02);

      // Physical ballistic fountain water streams & splash impact rings
      const fOriginX = WORLD_WIDTH * 0.503;
      const fPeakY = WORLD_HEIGHT * 0.424;
      const fUpperBowlY = WORLD_HEIGHT * 0.467;
      const fLowerBasinY = WORLD_HEIGHT * 0.493;

      for (const drop of fountainDropsRef.current) {
        drop.prevX = drop.x;
        drop.prevY = drop.y;
        drop.x += drop.vx * dtScale;
        drop.vy += 0.068 * dtScale;
        drop.y += drop.vy * dtScale;
        drop.life += dtScale;

        const targetBaseY =
          drop.tier === 'upper'
            ? fUpperBowlY + drop.zDepth * 5.5
            : fLowerBasinY + drop.zDepth * 13.5;

        if (drop.y >= targetBaseY && drop.vy > 0) {
          if (fountainSplashesRef.current.length < 30 && Math.random() < 0.72) {
            fountainSplashesRef.current.push({
              x: drop.x,
              y: targetBaseY,
              radius: 1.5,
              alpha: 0.65,
            });
          }
          const angle = Math.random() * Math.PI * 2;
          const radialSpeed =
            drop.tier === 'upper' ? 0.34 + Math.random() * 0.2 : 0.58 + Math.random() * 0.28;
          drop.x = fOriginX + (Math.random() - 0.5) * 3.2;
          drop.y = fPeakY + (Math.random() - 0.5) * 3.5;
          drop.prevX = drop.x;
          drop.prevY = drop.y;
          drop.vx = Math.cos(angle) * radialSpeed;
          drop.zDepth = Math.sin(angle);
          drop.vy = -0.6 - Math.random() * 0.35 + drop.zDepth * radialSpeed * 0.44;
          drop.life = 0;
        }
      }

      fountainSplashesRef.current = fountainSplashesRef.current
        .map((sp) => ({
          ...sp,
          radius: sp.radius + 0.28 * dtScale,
          alpha: sp.alpha - 0.024 * dtScale,
        }))
        .filter((sp) => sp.alpha > 0.03);

      // Smooth soaring birds across valley
      for (const b of birdsRef.current) {
        b.x += b.vx * dtScale;
        b.y += b.vy * dtScale;
        b.phase += 0.14 * dtScale;
        if (b.x > WORLD_WIDTH + 80) b.x = -80;
        if (b.x < -80) b.x = WORLD_WIDTH + 80;
        if (b.y > WORLD_HEIGHT - 80 || b.y < 60) b.vy *= -1;
      }
    };

    const render = (now: number) => {
      const rawDt = now - lastTime;
      lastTime = now;
      const dtScale = Math.max(0.25, Math.min(2.5, rawDt / (1000 / 60)));
      tick += dtScale;

      stepSimulation(dtScale);

      const viewW = canvas.clientWidth;
      const viewH = canvas.clientHeight;
      const cho = agentsRef.current.find((a) => a.id === 'cho');

      const activeSpotlight =
        spotlightRef.current && now < spotlightRef.current.untilMs
          ? spotlightRef.current
          : null;
      const camFocusX = activeSpotlight ? activeSpotlight.x : cho?.x;
      const camFocusY = activeSpotlight ? activeSpotlight.y : cho?.y;

      if (typeof camFocusX === 'number' && typeof camFocusY === 'number') {
        const targetCamX = Math.max(0, Math.min(WORLD_WIDTH - viewW, camFocusX - viewW / 2));
        const targetCamY = Math.max(0, Math.min(WORLD_HEIGHT - viewH, camFocusY - viewH / 2));
        if (!hasCenteredCamRef.current) {
          cameraRef.current.x = targetCamX;
          cameraRef.current.y = targetCamY;
          hasCenteredCamRef.current = true;
        } else {
          const camLerp = 1 - Math.pow(activeSpotlight ? 0.88 : 0.86, dtScale);
          cameraRef.current.x += (targetCamX - cameraRef.current.x) * camLerp;
          cameraRef.current.y += (targetCamY - cameraRef.current.y) * camLerp;
        }
      }

      ctx.clearRect(0, 0, viewW, viewH);
      ctx.save();
      const offsetX = viewW > WORLD_WIDTH ? (viewW - WORLD_WIDTH) / 2 : -cameraRef.current.x;
      const offsetY = viewH > WORLD_HEIGHT ? (viewH - WORLD_HEIGHT) / 2 : -cameraRef.current.y;
      ctx.translate(offsetX, offsetY);

      // 1. Unified Generated 3D Miniature Full-Village Diorama Map (4K when available)
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      if (worldMapImgRef.current) {
        ctx.drawImage(worldMapImgRef.current, 0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      } else {
        ctx.fillStyle = '#536222';
        ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      }

      // 2. Clipped Multi-Layered Flowing Brook Animation (flows cleanly under both wooden bridges)
      ctx.save();
      clipRiverSegments(ctx);

      // 2a. Continuous sunlit current ribbons undulating downstream along spline tangent
      for (let lane = -1; lane <= 1; lane++) {
        const laneFrac = lane * 0.42;
        ctx.strokeStyle = lane === 0 ? 'rgba(224, 242, 254, 0.22)' : 'rgba(186, 230, 253, 0.16)';
        ctx.lineWidth = lane === 0 ? 2.4 : 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const totalSteps = 56;
        for (let s = 0; s <= totalSteps; s++) {
          const yNorm = 0.065 + (0.935 * s) / totalSteps;
          const pt = sampleRiver(yNorm);
          const sway = Math.sin(yNorm * 28 - tick * 0.095 + lane * 2.1) * (pt.halfWidth * 0.16);
          const offset = laneFrac * pt.halfWidth + sway;
          const rx = pt.x + pt.ty * offset;
          const ry = pt.y - pt.tx * offset;
          if (s === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
        ctx.stroke();
      }

      // 2b. Directional water ripples, current streaks & sunlit glints moving downstream
      for (let i = 0; i < 26; i++) {
        const speed = 0.0014 + (i % 3) * 0.00035;
        const yNorm = 0.06 + ((i / 26 + tick * speed) % 0.94);
        const pt = sampleRiver(yNorm);

        // Spread ripples naturally across inner 72% of stream width
        const baseLane = (((i * 37) % 100) / 100 - 0.5) * 1.35;
        const drift = Math.sin(tick * 0.035 + i * 1.9) * 0.14;
        const latOffset = (baseLane + drift) * pt.halfWidth;

        // Position offset perpendicular to downstream tangent (tx, ty)
        const cx = pt.x + pt.ty * latOffset;
        const cy = pt.y - pt.tx * latOffset;

        const halfLen = 7 + (i % 4) * 3.5;
        const shimmer = 0.24 + 0.22 * (0.5 + 0.5 * Math.sin(tick * 0.08 + i * 2.3));

        // Gentle curved V/S ripple aligned to river tangent
        const curveBulge = Math.sin(tick * 0.06 + i) * 2.2;
        ctx.strokeStyle = `rgba(240, 249, 255, ${shimmer})`;
        ctx.lineWidth = i % 3 === 0 ? 1.8 : 1.25;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - pt.tx * halfLen, cy - pt.ty * halfLen);
        ctx.quadraticCurveTo(
          cx + pt.ty * curveBulge,
          cy - pt.tx * curveBulge,
          cx + pt.tx * halfLen,
          cy + pt.ty * halfLen
        );
        ctx.stroke();

        // Crisp sunlit water glint on select center-channel ripples
        if (i % 4 === 0 && shimmer > 0.34) {
          ctx.fillStyle = `rgba(255, 255, 255, ${(shimmer - 0.2) * 1.15})`;
          ctx.beginPath();
          ctx.arc(cx, cy, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 2c. Soft whitewater wake eddies emerging beneath each wooden bridge
      for (const bridgeExitY of [0.381, 0.664]) {
        for (let f = 0; f < 4; f++) {
          const prog = (tick * 0.022 + f * 0.25) % 1;
          const yNorm = bridgeExitY + prog * 0.028;
          const pt = sampleRiver(yNorm);
          const laneShift = ((f % 2 === 0 ? -1 : 1) * 0.28 + Math.sin(f * 3 + tick * 0.05) * 0.12) * pt.halfWidth;
          const fxPos = pt.x + pt.ty * laneShift;
          const fyPos = pt.y - pt.tx * laneShift;
          const foamAlpha = (1 - prog) * 0.42;

          ctx.strokeStyle = `rgba(240, 249, 255, ${foamAlpha})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(fxPos, fyPos, 3 + prog * 6, 0.15, Math.PI - 0.15);
          ctx.stroke();
        }
      }

      ctx.restore();

      // 3. Realistic Tiered Fountain Flow: Clipped Basin Ripples, Cascading Curtains, Plume & Splash Rings
      const fx = WORLD_WIDTH * 0.503;
      const basinY = WORLD_HEIGHT * 0.493;
      const upperBowlY = WORLD_HEIGHT * 0.467;
      const nozzleY = WORLD_HEIGHT * 0.449;
      const peakY = WORLD_HEIGHT * 0.422 + Math.sin(tick * 0.21) * 2.2;

      // 3a. Clipped Lower Pool Surface Caustics, Ripples & Splash Impact Foam Rings
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(fx, basinY, 37, 21, 0, 0, Math.PI * 2);
      ctx.clip();

      // Gentle sunlit water sheen drifting across pool surface
      const causticGrad = ctx.createRadialGradient(
        fx - 8 + Math.sin(tick * 0.03) * 6,
        basinY - 3,
        4,
        fx,
        basinY,
        36
      );
      causticGrad.addColorStop(0, 'rgba(224, 242, 254, 0.22)');
      causticGrad.addColorStop(0.55, 'rgba(125, 211, 252, 0.12)');
      causticGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = causticGrad;
      ctx.fillRect(fx - 40, basinY - 24, 80, 48);

      // Concentric ripples radiating outward from pedestal base inside stone rim
      for (let r = 0; r < 3; r++) {
        const prog = (tick * 0.014 + r / 3) % 1;
        const rx = 13 + prog * 24;
        const ry = rx * 0.57;
        ctx.strokeStyle = `rgba(224, 242, 254, ${(1 - prog) * 0.46})`;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.ellipse(fx, basinY, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Splash impact foam micro-rings where water droplets break the surface
      for (const sp of fountainSplashesRef.current) {
        ctx.strokeStyle = `rgba(248, 250, 252, ${sp.alpha})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, sp.radius * 1.35, sp.radius * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // 3b. Upper Bowl Rim Waterfall Curtains spilling into lower pool
      for (let c = -4; c <= 4; c++) {
        const angle = (c / 5) * 1.15;
        const cxTop = fx + Math.sin(angle) * 12.5;
        const cyTop = upperBowlY + Math.cos(angle) * 4.5;
        const cxBot = fx + Math.sin(angle) * 16.5;
        const cyBot = basinY + Math.cos(angle) * 9.5;
        const flowPhase = (tick * 0.048 + Math.abs(c) * 0.23) % 1;

        ctx.strokeStyle = 'rgba(224, 242, 254, 0.34)';
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cxTop, cyTop);
        ctx.quadraticCurveTo((cxTop + cxBot) / 2 + Math.sin(angle) * 2, cyTop + 7, cxBot, cyBot);
        ctx.stroke();

        // Bright glistening water bead sliding down each curtain thread
        const beadX = cxTop + (cxBot - cxTop) * flowPhase;
        const beadY = cyTop + (cyBot - cyTop) * (flowPhase * flowPhase * 0.7 + flowPhase * 0.3);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.72 - flowPhase * 0.35})`;
        ctx.beginPath();
        ctx.arc(beadX, beadY, 1.35, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3c. Central Aerated Plume Column & Fine Mist Halo
      for (let j = -2; j <= 2; j++) {
        const sway = Math.sin(tick * 0.24 + j * 1.3) * 1.4;
        ctx.strokeStyle = j === 0 ? 'rgba(255, 255, 255, 0.75)' : 'rgba(224, 242, 254, 0.45)';
        ctx.lineWidth = j === 0 ? 2.2 : 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(fx + j * 1.3, nozzleY);
        ctx.quadraticCurveTo(fx + j * 1.6 + sway * 0.5, (nozzleY + peakY) / 2, fx + j * 2.1 + sway, peakY);
        ctx.stroke();
      }

      const crownMist = ctx.createRadialGradient(fx, peakY + 2, 1, fx, peakY + 2, 15);
      crownMist.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
      crownMist.addColorStop(0.55, 'rgba(224, 242, 254, 0.16)');
      crownMist.addColorStop(1, 'rgba(224, 242, 254, 0)');
      ctx.fillStyle = crownMist;
      ctx.beginPath();
      ctx.arc(fx, peakY + 2, 15, 0, Math.PI * 2);
      ctx.fill();

      // 3d. Parabolic Motion-Blurred Water Arcs radiating 360° from Crown
      for (const drop of fountainDropsRef.current) {
        const frontBrightness = drop.zDepth >= 0 ? 0.78 : 0.42;
        const fade = Math.max(0.15, 1 - drop.life / 42);
        ctx.strokeStyle = `rgba(240, 249, 255, ${frontBrightness * fade})`;
        ctx.lineWidth = drop.zDepth >= 0 ? 1.55 : 1.15;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(drop.prevX - (drop.x - drop.prevX) * 1.35, drop.prevY - (drop.y - drop.prevY) * 1.35);
        ctx.lineTo(drop.x, drop.y);
        ctx.stroke();
      }

      // 4. YouTube Ring-Light, Cinema Lens Glint & Observatory Optical Glint
      const ytPulse = 0.24 + Math.sin(tick * 0.08) * 0.1;
      const ytX = WORLD_WIDTH * 0.728;
      const ytY = WORLD_HEIGHT * 0.355;
      const ytHalo = ctx.createRadialGradient(ytX, ytY, 4, ytX, ytY, 32);
      ytHalo.addColorStop(0, `rgba(253, 224, 71, ${ytPulse})`);
      ytHalo.addColorStop(1, 'rgba(253, 224, 71, 0)');
      ctx.fillStyle = ytHalo;
      ctx.beginPath();
      ctx.arc(ytX, ytY, 32, 0, Math.PI * 2);
      ctx.fill();

      const lensX = WORLD_WIDTH * 0.772;
      const lensY = WORLD_HEIGHT * 0.355;
      const lensShimmer = 0.18 + 0.14 * Math.sin(tick * 0.05);
      ctx.fillStyle = `rgba(186, 230, 253, ${lensShimmer})`;
      ctx.beginPath();
      ctx.ellipse(lensX - 4, lensY - 3, 5, 2.5, -0.5, 0, Math.PI * 2);
      ctx.fill();

      const scopeX = WORLD_WIDTH * 0.752;
      const scopeY = WORLD_HEIGHT * 0.105;
      const scopeShimmer = 0.22 + 0.16 * Math.sin(tick * 0.06);
      ctx.fillStyle = `rgba(224, 242, 254, ${scopeShimmer})`;
      ctx.beginPath();
      ctx.arc(scopeX, scopeY, 3.2, 0, Math.PI * 2);
      ctx.fill();

      // Systems & Dev rooftop uplink dish & courtyard dual-monitor subtle warm amber glow
      const dishX = WORLD_WIDTH * 0.086;
      const dishY = WORLD_HEIGHT * 0.045;
      const dishPulse = 0.2 + 0.18 * Math.sin(tick * 0.07);
      ctx.fillStyle = `rgba(125, 211, 252, ${dishPulse})`;
      ctx.beginPath();
      ctx.arc(dishX, dishY, 2.8, 0, Math.PI * 2);
      ctx.fill();

      const termX = WORLD_WIDTH * 0.088;
      const termY = WORLD_HEIGHT * 0.244;
      const termGlow = ctx.createRadialGradient(termX, termY, 2, termX, termY, 18);
      termGlow.addColorStop(0, `rgba(251, 191, 36, ${0.18 + Math.sin(tick * 0.09) * 0.06})`);
      termGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = termGlow;
      ctx.beginPath();
      ctx.arc(termX, termY, 18, 0, Math.PI * 2);
      ctx.fill();

      // 5. Warm Candle-Flicker Street Lantern Halos
      LANTERN_POSITIONS.forEach(([nx, ny], idx) => {
        const lx = WORLD_WIDTH * nx;
        const ly = WORLD_HEIGHT * ny;
        const flicker = Math.sin(tick * 0.11 + idx * 1.9) * 3.5 + Math.cos(tick * 0.23 + idx) * 1.5;
        const haloR = 32 + flicker;
        const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, haloR);
        glow.addColorStop(0, 'rgba(254, 240, 138, 0.44)');
        glow.addColorStop(0.5, 'rgba(251, 191, 36, 0.16)');
        glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(lx, ly, haloR, 0, Math.PI * 2);
        ctx.fill();
      });

      // 6. Warm Threshold Welcome Glow when near or hovering a building entrance
      for (const b of VILLAGE_BUILDINGS) {
        const isHighlighted = nearDoorIdRef.current === b.id || hoveredBuildingIdRef.current === b.id;
        if (!isHighlighted) continue;
        const doorCenter = tileToWorldCenter(b.doorTileX, b.doorTileY);
        const pulse = 0.28 + Math.sin(tick * 0.12) * 0.1;
        const doorGlow = ctx.createRadialGradient(
          doorCenter.x,
          doorCenter.y,
          4,
          doorCenter.x,
          doorCenter.y,
          36
        );
        doorGlow.addColorStop(0, `rgba(251, 191, 36, ${pulse})`);
        doorGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = doorGlow;
        ctx.beginPath();
        ctx.arc(doorCenter.x, doorCenter.y, 36, 0, Math.PI * 2);
        ctx.fill();
      }

      // 7. Walkability Overlay (G key)
      if (showWalkability) {
        for (let ty = 0; ty < MAP_ROWS; ty++) {
          for (let tx = 0; tx < MAP_COLS; tx++) {
            const ok = VILLAGE_MAP.walkable[ty][tx];
            ctx.fillStyle = ok ? 'rgba(34, 197, 94, 0.28)' : 'rgba(239, 68, 68, 0.34)';
            ctx.fillRect(tx * TILE_SIZE + 1, ty * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
          }
        }
      }

      // 8. Click-to-Walk Destination Ring & Camera Spotlight Beacon
      if (clickTargetRef.current) {
        const ct = clickTargetRef.current;
        const ringPulse = 8 + Math.sin(tick * 0.16) * 3;
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(ct.x, ct.y, ringPulse * 1.2, ringPulse * 0.72, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (activeSpotlight) {
        const spPulse = 16 + Math.sin(tick * 0.15) * 4;
        ctx.save();
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.78)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = -tick * 0.45;
        ctx.beginPath();
        ctx.ellipse(
          activeSpotlight.x,
          activeSpotlight.y + 8,
          spPulse * 1.45,
          spPulse * 0.88,
          0,
          0,
          Math.PI * 2
        );
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // 9. Footstep Dust Puffs
      for (const d of dustRef.current) {
        ctx.fillStyle = `rgba(231, 212, 175, ${d.alpha})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 9b. Active Handoff Trace Pre-Computation (House Roles, Villager Rings & Town Arcs)
      const liveTrace = activeTraceRef.current;
      const traceHouseRoleByBuildingId = new Map<
        string,
        { label: string; isCrossHouse: boolean; isErrored: boolean }
      >();
      const traceAgentRingById = new Map<
        string,
        { color: string; isCoordinator?: boolean }
      >();
      const traceLinks: TownTraceLink[] = [];

      if (liveTrace) {
        const agentMap = new Map<string, Agent>();
        for (const a of agentsRef.current) agentMap.set(a.id, a);

        const traceErrored =
          liveTrace.status === 'failed' || liveTrace.status === 'aborted_cap_reached';
        const coordAg = agentMap.get(liveTrace.coordinating_director);
        const coordBld = resolveBuildingForTrace(coordAg);
        if (coordBld) {
          traceHouseRoleByBuildingId.set(coordBld.id, {
            label: 'Lead',
            isCrossHouse: false,
            isErrored: traceErrored,
          });
        }
        traceAgentRingById.set(liveTrace.coordinating_director, {
          color: traceErrored ? '#FB7185' : '#FBBF24',
          isCoordinator: true,
        });

        const pairCounts = new Map<string, number>();
        const resolveAnchor = (
          agId: string,
          houseFallback?: string
        ): { x: number; y: number; bld: Building | null } => {
          const ag = agentMap.get(agId);
          const bld = resolveBuildingForTrace(ag, houseFallback);
          if (ag) {
            return { x: ag.x, y: ag.y - 16, bld };
          }
          if (bld) {
            const yard = tileToWorldCenter(bld.yardTileX, bld.yardTileY);
            return { x: yard.x, y: yard.y - 14, bld };
          }
          return { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.45, bld: null };
        };

        // Optional Triage Link (e.g. Matt -> Coordinating House Director)
        if (
          liveTrace.root_agent &&
          liveTrace.root_agent !== liveTrace.coordinating_director
        ) {
          const rootAg = agentMap.get(liveTrace.root_agent);
          const rootBld = resolveBuildingForTrace(rootAg);
          if (rootBld && !traceHouseRoleByBuildingId.has(rootBld.id)) {
            traceHouseRoleByBuildingId.set(rootBld.id, {
              label: liveTrace.root_agent === 'matt' ? 'Triage' : 'Origin',
              isCrossHouse: true,
              isErrored: false,
            });
          }
          traceAgentRingById.set(liveTrace.root_agent, { color: '#38BDF8' });

          const p0 = resolveAnchor(liveTrace.root_agent);
          const p1 = resolveAnchor(liveTrace.coordinating_director);
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const lift = Math.max(40, Math.min(95, dist * 0.22));
          const rootName =
            rootAg?.name ?? (liveTrace.root_agent === 'matt' ? 'Matt' : liveTrace.root_agent);
          traceLinks.push({
            key: `triage_${liveTrace.task_id}`,
            focusAgentId: liveTrace.coordinating_director,
            fromX: p0.x,
            fromY: p0.y,
            toX: p1.x,
            toY: p1.y,
            ctrlX: (p0.x + p1.x) / 2,
            ctrlY: Math.min(p0.y, p1.y) - lift,
            isCrossHouse: true,
            status: 'completed',
            primaryLabel: `Triage · ${rootName} → ${liveTrace.coordinating_director_name}`,
            secondaryLabel: `Hub Dispatch · ${shortTownHouse(coordBld?.name)}`,
          });
        }

        for (const pkt of liveTrace.packets) {
          const fromP = resolveAnchor(pkt.from_agent, pkt.from_house);
          const toP = resolveAnchor(pkt.to_agent, pkt.to_house);
          const cross =
            (fromP.bld && toP.bld && fromP.bld.id !== toP.bld.id) ||
            normalizeTownHouse(pkt.from_house) !== normalizeTownHouse(pkt.to_house);
          const pktErr =
            pkt.status === 'failed' || pkt.status === 'aborted_cap_reached';

          if (fromP.bld && cross) {
            const prev = traceHouseRoleByBuildingId.get(fromP.bld.id);
            traceHouseRoleByBuildingId.set(fromP.bld.id, {
              label: prev?.label ?? 'Dispatch',
              isCrossHouse: true,
              isErrored: Boolean(prev?.isErrored || pktErr),
            });
          }
          if (toP.bld) {
            const prev = traceHouseRoleByBuildingId.get(toP.bld.id);
            traceHouseRoleByBuildingId.set(toP.bld.id, {
              label:
                prev?.label === 'Lead'
                  ? `Lead · #${pkt.sequence}`
                  : `Hop #${pkt.sequence}`,
              isCrossHouse: Boolean(prev?.isCrossHouse || cross),
              isErrored: Boolean(prev?.isErrored || pktErr),
            });
          }

          traceAgentRingById.set(pkt.to_agent, {
            color: pktErr ? '#FB7185' : cross ? '#FBBF24' : '#34D399',
          });
          if (!traceAgentRingById.has(pkt.from_agent)) {
            traceAgentRingById.set(pkt.from_agent, {
              color: cross ? '#FBBF24' : '#38BDF8',
            });
          }

          let fxPos = fromP.x;
          let fyPos = fromP.y;
          let txPos = toP.x;
          let tyPos = toP.y;

          // Ensure co-located intra-house specialists/directors still render a clean courtyard arc
          if (Math.hypot(txPos - fxPos, tyPos - fyPos) < 30 && toP.bld) {
            const door = tileToWorldCenter(toP.bld.doorTileX, toP.bld.doorTileY);
            const yard = tileToWorldCenter(toP.bld.yardTileX, toP.bld.yardTileY);
            fxPos = yard.x - 22;
            fyPos = yard.y - 14;
            txPos = door.x + 22;
            tyPos = door.y - 20;
          }

          const pairId = [pkt.from_agent, pkt.to_agent].sort().join(':');
          const pairIdx = pairCounts.get(pairId) ?? 0;
          pairCounts.set(pairId, pairIdx + 1);

          const dist = Math.hypot(txPos - fxPos, tyPos - fyPos);
          const baseLift = cross
            ? Math.max(54, Math.min(126, dist * 0.25))
            : Math.max(36, Math.min(72, dist * 0.24));
          const lift = baseLift + pairIdx * 24;

          traceLinks.push({
            key: pkt.handoff_id,
            focusAgentId: pkt.to_agent,
            fromX: fxPos,
            fromY: fyPos,
            toX: txPos,
            toY: tyPos,
            ctrlX: (fxPos + txPos) / 2,
            ctrlY: Math.min(fyPos, tyPos) - lift,
            isCrossHouse: cross,
            status: pkt.status,
            primaryLabel: `#${pkt.sequence} ${cross ? '⇄' : '→'} ${pkt.from_agent_name} → ${pkt.to_agent_name} · ${shortStatusTag(pkt.status)}`,
            secondaryLabel: cross
              ? `Cross-House · ${shortTownHouse(pkt.from_house)} → ${shortTownHouse(pkt.to_house)}`
              : `Intra-House · ${shortTownHouse(pkt.to_house)}`,
          });
        }

        // Participating House Courtyard Ground Auras
        for (const [bldId, meta] of traceHouseRoleByBuildingId.entries()) {
          const bld = VILLAGE_BUILDINGS.find((b) => b.id === bldId);
          if (!bld) continue;
          const yardPt = tileToWorldCenter(bld.yardTileX, bld.yardTileY);
          const auraPulse = 0.24 + 0.08 * Math.sin(tick * 0.09);
          const auraGrad = ctx.createRadialGradient(
            yardPt.x,
            yardPt.y,
            6,
            yardPt.x,
            yardPt.y,
            52
          );
          if (meta.isErrored) {
            auraGrad.addColorStop(0, `rgba(251, 113, 133, ${auraPulse})`);
            auraGrad.addColorStop(1, 'rgba(251, 113, 133, 0)');
          } else if (meta.isCrossHouse) {
            auraGrad.addColorStop(0, `rgba(251, 191, 36, ${auraPulse})`);
            auraGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
          } else {
            auraGrad.addColorStop(0, `rgba(52, 211, 153, ${auraPulse * 0.9})`);
            auraGrad.addColorStop(1, 'rgba(52, 211, 153, 0)');
          }
          ctx.fillStyle = auraGrad;
          ctx.beginPath();
          ctx.arc(yardPt.x, yardPt.y, 52, 0, Math.PI * 2);
          ctx.fill();
        }

        // Participating Villager Ground Rings (drawn cleanly beneath shoes)
        for (const [agId, ringMeta] of traceAgentRingById.entries()) {
          const ag = agentMap.get(agId);
          if (!ag) continue;
          ctx.save();
          ctx.strokeStyle = ringMeta.color;
          ctx.lineWidth = ringMeta.isCoordinator ? 2.2 : 1.7;
          ctx.beginPath();
          ctx.ellipse(ag.x, ag.y + 10, 14, 8.5, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }

      // 10. Clean Wooden Nameplates & Live Activity Indicators on Each Building
      const liveTasksNow = liveContextRef.current.tasks;
      const liveApprovalsNow = liveContextRef.current.approvals;
      const nextBuildingBadges: BuildingBadgeHitBox[] = [];
      const activeBuildingIds = new Set<string>();

      for (const b of VILLAGE_BUILDINGS) {
        const bx = b.tileX * TILE_SIZE;
        const by = b.tileY * TILE_SIZE;
        const bw = b.widthTiles * TILE_SIZE;
        const bh = b.heightTiles * TILE_SIZE;
        const plateY = Math.min(WORLD_HEIGHT - 22, by + bh + 4);
        const traceHouseMeta = traceHouseRoleByBuildingId.get(b.id);

        const insideAgents = agentsRef.current.filter(
          (ag) =>
            ag.id !== 'cho' &&
            ag.buildingId === b.id &&
            (ag.state === 'working_inside' ||
              (b.id === 'town_hall' && ag.state === 'town_hall_seated'))
        );
        const runningHouseTasks = liveTasksNow.filter(
          (t) =>
            isTaskActivelyRunning(t) &&
            ((b.directorId && t.assignedDirectorId === b.directorId) ||
              (b.id === 'town_hall' && t.status === 'matt_routing'))
        );
        const pendingHouseApprovals = liveApprovalsNow.filter(
          (ap) =>
            ap.status === 'pending' &&
            ((b.directorId && ap.directorId === b.directorId) ||
              ap.payload?.buildingId === b.id)
        );

        const workingCount = Math.max(insideAgents.length, runningHouseTasks.length);
        const approvalCount = pendingHouseApprovals.length;
        if (workingCount > 0 || approvalCount > 0) {
          activeBuildingIds.add(b.id);
        }

        const isHot =
          hoveredBuildingIdRef.current === b.id ||
          nearDoorIdRef.current === b.id ||
          Boolean(traceHouseMeta) ||
          workingCount > 0 ||
          approvalCount > 0;

        // Warm doorway/window activity aura when villagers are working inside or awaiting approval
        if ((workingCount > 0 || approvalCount > 0) && !traceHouseMeta) {
          const doorPt = tileToWorldCenter(b.doorTileX, b.doorTileY);
          const auraAlpha = 0.2 + 0.08 * Math.sin(tick * 0.1);
          const houseAura = ctx.createRadialGradient(
            doorPt.x,
            doorPt.y - 8,
            4,
            doorPt.x,
            doorPt.y - 8,
            44
          );
          if (approvalCount > 0) {
            houseAura.addColorStop(0, `rgba(251, 191, 36, ${auraAlpha + 0.06})`);
            houseAura.addColorStop(1, 'rgba(251, 191, 36, 0)');
          } else {
            houseAura.addColorStop(0, `rgba(251, 146, 60, ${auraAlpha})`);
            houseAura.addColorStop(1, 'rgba(251, 146, 60, 0)');
          }
          ctx.fillStyle = houseAura;
          ctx.beginPath();
          ctx.arc(doorPt.x, doorPt.y - 8, 44, 0, Math.PI * 2);
          ctx.fill();
        }

        const statusSuffix = traceHouseMeta
          ? traceHouseMeta.label
          : approvalCount > 0
            ? `${approvalCount} approval${approvalCount === 1 ? '' : 's'}`
            : workingCount > 0
              ? `${workingCount} working`
              : null;

        const displayTitle = statusSuffix ? `${b.name} · ${statusSuffix}` : b.name;

        ctx.font = '600 10.5px "Plus Jakarta Sans", sans-serif';
        const dotOffset = !traceHouseMeta && (workingCount > 0 || approvalCount > 0) ? 11 : 0;
        const tw = ctx.measureText(displayTitle).width + 16 + dotOffset;
        const plateX = bx + bw / 2 - tw / 2;

        ctx.fillStyle = isHot ? 'rgba(41, 30, 16, 0.94)' : 'rgba(24, 22, 18, 0.84)';
        ctx.beginPath();
        ctx.roundRect(plateX, plateY, tw, 18, 4);
        ctx.fill();
        ctx.strokeStyle = traceHouseMeta?.isErrored
          ? 'rgba(251, 113, 133, 0.9)'
          : traceHouseMeta?.isCrossHouse
            ? 'rgba(251, 191, 36, 0.92)'
            : traceHouseMeta
              ? 'rgba(52, 211, 153, 0.85)'
              : approvalCount > 0
                ? 'rgba(251, 191, 36, 0.95)'
                : workingCount > 0
                  ? 'rgba(251, 146, 60, 0.92)'
                  : isHot
                    ? 'rgba(251, 191, 36, 0.85)'
                    : 'rgba(251, 191, 36, 0.35)';
        ctx.lineWidth = isHot ? 1.4 : 1;
        ctx.stroke();

        if (dotOffset > 0) {
          ctx.fillStyle = approvalCount > 0 ? '#FBBF24' : '#FB923C';
          ctx.beginPath();
          ctx.arc(plateX + 8.5, plateY + 9, 2.8, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = traceHouseMeta?.isErrored
          ? '#FECDD3'
          : approvalCount > 0
            ? '#FDE68A'
            : workingCount > 0
              ? '#FED7AA'
              : isHot
                ? '#FDE68A'
                : '#FEF3C7';
        ctx.textAlign = 'center';
        ctx.fillText(displayTitle, plateX + dotOffset / 2 + tw / 2, plateY + 12.5);

        // Clickable roof-eave callout chip when a task is running inside or approval is waiting
        if (!liveTrace && (runningHouseTasks.length > 0 || approvalCount > 0)) {
          const topTask = runningHouseTasks[0];
          const rawSnippet =
            approvalCount > 0
              ? `Review ${approvalCount} pending approval${approvalCount === 1 ? '' : 's'}`
              : topTask
                ? topTask.prompt.length > 28
                  ? `${topTask.prompt.slice(0, 27)}…`
                  : topTask.prompt
                : '';
          if (rawSnippet) {
            ctx.font = '600 9.5px "Plus Jakarta Sans", sans-serif';
            const chipW = Math.ceil(ctx.measureText(rawSnippet).width + 18);
            const chipH = 17;
            const chipX = Math.max(8, Math.min(WORLD_WIDTH - chipW - 8, bx + bw / 2 - chipW / 2));
            const chipY = Math.max(8, by + 8);

            ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
            ctx.beginPath();
            ctx.roundRect(chipX, chipY, chipW, chipH, 4);
            ctx.fill();
            ctx.strokeStyle =
              approvalCount > 0 ? 'rgba(251, 191, 36, 0.9)' : 'rgba(56, 189, 248, 0.85)';
            ctx.lineWidth = 1.1;
            ctx.stroke();

            ctx.fillStyle = approvalCount > 0 ? '#FDE68A' : '#BAE6FD';
            ctx.textAlign = 'center';
            ctx.fillText(rawSnippet, chipX + chipW / 2, chipY + 11.5);

            nextBuildingBadges.push({
              buildingId: b.id,
              x: chipX,
              y: chipY,
              w: chipW,
              h: chipH,
              kind: approvalCount > 0 ? 'approval' : 'task',
              task: topTask,
            });
          }
        }
      }
      buildingBadgeHitBoxesRef.current = nextBuildingBadges;

      // 10b. Shared Conversational Ground Rings Beneath Chatting Villager Pairs
      for (const chat of activeChatsRef.current) {
        const liveA = agentsRef.current.find((x) => x.id === chat.agentAId);
        const liveB = agentsRef.current.find((x) => x.id === chat.agentBId);
        if (!liveA || !liveB) continue;
        const midX = (liveA.x + liveB.x) / 2;
        const midY = (liveA.y + liveB.y) / 2 + 12;
        const rx = Math.max(30, Math.hypot(liveB.x - liveA.x, liveB.y - liveA.y) * 0.68 + 15);
        const ry = 13.5;
        const chatPulse = 0.5 + 0.5 * Math.sin(tick * 0.1);

        ctx.save();
        const pairGlow = ctx.createRadialGradient(midX, midY, 4, midX, midY, rx);
        pairGlow.addColorStop(0, `rgba(251, 191, 36, ${0.18 + chatPulse * 0.08})`);
        pairGlow.addColorStop(0.65, `rgba(56, 189, 248, ${0.1 + chatPulse * 0.05})`);
        pairGlow.addColorStop(1, 'rgba(56, 189, 248, 0)');
        ctx.fillStyle = pairGlow;
        ctx.beginPath();
        ctx.ellipse(midX, midY, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `rgba(251, 191, 36, ${0.42 + chatPulse * 0.22})`;
        ctx.lineWidth = 1.25;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -tick * 0.35;
        ctx.beginPath();
        ctx.ellipse(midX, midY, rx - 3, ry - 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // 11. Y-Sorted Live Interactive Characters
      const sortedAgents = [...agentsRef.current].sort((a, b) => a.y - b.y);
      for (const agent of sortedAgents) {
        let proximityStrength = 0;
        if (cho && agent.id !== 'cho' && !isModalOpen) {
          const distToCho = Math.hypot(agent.x - cho.x, agent.y - cho.y);
          if (distToCho < TALK_PROXIMITY_RADIUS) {
            const normalized = 1 - distToCho / TALK_PROXIMITY_RADIUS;
            proximityStrength = Math.min(1, normalized * 1.85);
          }
        }
        drawStorybookCharacter(ctx, agent, agent.x, agent.y, tick, {
          selected: agent.id === selectedAgentId,
          proximityStrength,
          isPrimaryNear: !isModalOpen && agent.id === nearAgentIdRef.current,
        });
      }

      // 11a. Floating Mini Conversation Badge Between Active Chatting Pairs
      for (const chat of activeChatsRef.current) {
        const liveA = agentsRef.current.find((x) => x.id === chat.agentAId);
        const liveB = agentsRef.current.find((x) => x.id === chat.agentBId);
        if (!liveA || !liveB) continue;
        const midX = (liveA.x + liveB.x) / 2;
        const midY =
          Math.min(liveA.y, liveB.y) - 12 + Math.sin(tick * 0.14 + liveA.x * 0.05) * 1.4;

        ctx.save();
        // Back bubble (sky)
        ctx.fillStyle = 'rgba(14, 165, 233, 0.92)';
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(midX - 1.5, midY - 6.5, 9.5, 7, 2.5);
        ctx.fill();
        ctx.stroke();

        // Front bubble (warm amber)
        ctx.fillStyle = 'rgba(251, 191, 36, 0.96)';
        ctx.beginPath();
        ctx.roundRect(midX - 8, midY - 3.5, 10, 7.5, 2.5);
        ctx.fill();
        ctx.stroke();

        // Three tiny dots on front bubble
        ctx.fillStyle = '#1E293B';
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(midX - 5.3 + i * 2.3, midY + 0.25, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 11b. Elevated Cross-House Handoff Arcs, Sequential Courier Orbs & Clickable Outcome Plates
      if (liveTrace && traceLinks.length > 0) {
        const nextHitBoxes: HopHitBox[] = [];
        const placedBoxes: Array<{ x: number; y: number; w: number; h: number }> = [];

        const stepDurationMs = 2300;
        const holdEndMs = 1100;
        const totalCycleMs = traceLinks.length * stepDurationMs + holdEndMs;
        const elapsedCycleMs =
          (Math.max(0, now - replayStartMsRef.current)) % totalCycleMs;
        const activeLinkIdx = Math.min(
          traceLinks.length,
          Math.floor(elapsedCycleMs / stepDurationMs)
        );
        const activeLinkProgress =
          activeLinkIdx < traceLinks.length
            ? (elapsedCycleMs - activeLinkIdx * stepDurationMs) / stepDurationMs
            : 1;

        const evalQuad = (link: TownTraceLink, t: number) => {
          const inv = 1 - t;
          return {
            x: inv * inv * link.fromX + 2 * inv * t * link.ctrlX + t * t * link.toX,
            y: inv * inv * link.fromY + 2 * inv * t * link.ctrlY + t * t * link.toY,
          };
        };

        // Pass 1: Draw Bezier arcs, directional arrowheads, and animated courier packet orbs
        traceLinks.forEach((link, idx) => {
          const isFailed =
            link.status === 'failed' || link.status === 'aborted_cap_reached';
          const isHovered = hoveredHopKeyRef.current === link.key;
          const isCurrentStep = idx === activeLinkIdx;
          const strokeColor = isFailed
            ? '#FB7185'
            : link.isCrossHouse
              ? '#FBBF24'
              : '#38BDF8';

          ctx.save();
          // High-contrast dark slate casing so arcs read cleanly over roofs & sunlit grass
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
          ctx.lineWidth = isCurrentStep || isHovered ? 4.8 : 3.8;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(link.fromX, link.fromY);
          ctx.quadraticCurveTo(link.ctrlX, link.ctrlY, link.toX, link.toY);
          ctx.stroke();

          // Semantic directional stroke (marching dash for cross-house handoffs)
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = isCurrentStep || isHovered ? 2.6 : 2.0;
          if (link.isCrossHouse) {
            ctx.setLineDash([7, 5]);
            ctx.lineDashOffset = -tick * 0.75;
          }
          ctx.beginPath();
          ctx.moveTo(link.fromX, link.fromY);
          ctx.quadraticCurveTo(link.ctrlX, link.ctrlY, link.toX, link.toY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Endpoint anchor pins
          ctx.fillStyle = '#0F172A';
          ctx.beginPath();
          ctx.arc(link.fromX, link.fromY, 3.6, 0, Math.PI * 2);
          ctx.arc(link.toX, link.toY, 4.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = strokeColor;
          ctx.beginPath();
          ctx.arc(link.fromX, link.fromY, 2.2, 0, Math.PI * 2);
          ctx.arc(link.toX, link.toY, 2.7, 0, Math.PI * 2);
          ctx.fill();

          // Directional arrowhead near destination (t = 0.88)
          const tip = evalQuad(link, 0.89);
          const prev = evalQuad(link, 0.83);
          const ang = Math.atan2(tip.y - prev.y, tip.x - prev.x);
          const headLen = 7.5;
          ctx.fillStyle = strokeColor;
          ctx.beginPath();
          ctx.moveTo(tip.x, tip.y);
          ctx.lineTo(
            tip.x - headLen * Math.cos(ang - 0.45),
            tip.y - headLen * Math.sin(ang - 0.45)
          );
          ctx.lineTo(
            tip.x - headLen * Math.cos(ang + 0.45),
            tip.y - headLen * Math.sin(ang + 0.45)
          );
          ctx.closePath();
          ctx.fill();

          // Animated Courier Packet Orb along the currently active sequence hop
          if (isCurrentStep) {
            for (let trail = 4; trail >= 1; trail--) {
              const tt = Math.max(0, activeLinkProgress - trail * 0.032);
              const tp = evalQuad(link, tt);
              ctx.fillStyle = isFailed
                ? `rgba(251, 113, 133, ${0.5 - trail * 0.1})`
                : link.isCrossHouse
                  ? `rgba(253, 224, 71, ${0.55 - trail * 0.11})`
                  : `rgba(125, 211, 252, ${0.55 - trail * 0.11})`;
              ctx.beginPath();
              ctx.arc(tp.x, tp.y, Math.max(1.6, 4.4 - trail * 0.65), 0, Math.PI * 2);
              ctx.fill();
            }

            const orb = evalQuad(link, activeLinkProgress);
            const orbGlow = ctx.createRadialGradient(orb.x, orb.y, 1, orb.x, orb.y, 13);
            orbGlow.addColorStop(
              0,
              isFailed
                ? 'rgba(254, 205, 211, 0.95)'
                : link.isCrossHouse
                  ? 'rgba(254, 249, 195, 0.95)'
                  : 'rgba(224, 242, 254, 0.95)'
            );
            orbGlow.addColorStop(1, 'rgba(251, 191, 36, 0)');
            ctx.fillStyle = orbGlow;
            ctx.beginPath();
            ctx.arc(orb.x, orb.y, 13, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(orb.x, orb.y, 3.6, 0, Math.PI * 2);
            ctx.fill();

            // Arrival ripple ring at destination when packet lands
            if (activeLinkProgress > 0.78) {
              const landFrac = (activeLinkProgress - 0.78) / 0.22;
              ctx.strokeStyle = isFailed
                ? `rgba(251, 113, 133, ${1 - landFrac})`
                : `rgba(52, 211, 153, ${1 - landFrac})`;
              ctx.lineWidth = 1.8;
              ctx.beginPath();
              ctx.arc(link.toX, link.toY, 5 + landFrac * 18, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
          ctx.restore();
        });

        // Pass 2: Draw crisp clickable Hop Outcome Callout Plates at Bezier midpoints
        traceLinks.forEach((link, idx) => {
          const isFailed =
            link.status === 'failed' || link.status === 'aborted_cap_reached';
          const isHovered = hoveredHopKeyRef.current === link.key;
          const isCurrentStep = idx === activeLinkIdx;
          const showSubLine = isHovered || isCurrentStep;

          const mid = evalQuad(link, 0.5);
          ctx.save();
          ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
          const w1 = ctx.measureText(link.primaryLabel).width;
          let w2 = 0;
          if (showSubLine) {
            ctx.font = '500 9.5px "Plus Jakarta Sans", sans-serif';
            w2 = ctx.measureText(link.secondaryLabel).width;
          }
          const plateW = Math.ceil(Math.max(w1, w2) + 16);
          const plateH = showSubLine ? 31 : 19;

          let px = Math.max(
            10,
            Math.min(WORLD_WIDTH - plateW - 10, mid.x - plateW / 2)
          );
          let py = Math.max(
            10,
            Math.min(WORLD_HEIGHT - plateH - 12, mid.y - plateH / 2 - 4)
          );

          // Prevent overlapping callout plates
          for (let attempt = 0; attempt < 4; attempt++) {
            const collides = placedBoxes.some(
              (b) =>
                px < b.x + b.w + 4 &&
                px + plateW + 4 > b.x &&
                py < b.y + b.h + 3 &&
                py + plateH + 3 > b.y
            );
            if (!collides) break;
            py = Math.max(8, py - (plateH + 5));
          }
          placedBoxes.push({ x: px, y: py, w: plateW, h: plateH });
          nextHitBoxes.push({
            key: link.key,
            x: px,
            y: py,
            w: plateW,
            h: plateH,
            agentId: link.focusAgentId,
            trace: liveTrace,
          });

          ctx.fillStyle =
            isHovered || isCurrentStep
              ? 'rgba(15, 23, 42, 0.96)'
              : 'rgba(15, 23, 42, 0.88)';
          ctx.beginPath();
          ctx.roundRect(px, py, plateW, plateH, 5);
          ctx.fill();

          ctx.strokeStyle = isFailed
            ? 'rgba(251, 113, 133, 0.9)'
            : link.isCrossHouse
              ? isHovered || isCurrentStep
                ? 'rgba(251, 191, 36, 0.98)'
                : 'rgba(251, 191, 36, 0.68)'
              : isHovered || isCurrentStep
                ? 'rgba(56, 189, 248, 0.95)'
                : 'rgba(52, 211, 153, 0.62)';
          ctx.lineWidth = isHovered || isCurrentStep ? 1.5 : 1.05;
          ctx.stroke();

          ctx.textAlign = 'center';
          ctx.font = '600 10px "Plus Jakarta Sans", sans-serif';
          ctx.fillStyle = isFailed
            ? '#FECDD3'
            : link.isCrossHouse
              ? '#FDE68A'
              : '#E2E8F0';
          ctx.fillText(link.primaryLabel, px + plateW / 2, py + 12.5);

          if (showSubLine) {
            ctx.font = '500 9.5px "Plus Jakarta Sans", sans-serif';
            ctx.fillStyle = link.isCrossHouse ? '#FBBF24' : '#94A3B8';
            ctx.fillText(link.secondaryLabel, px + plateW / 2, py + 24.5);
          }
          ctx.restore();
        });

        hopHitBoxesRef.current = nextHitBoxes;
      } else {
        hopHitBoxesRef.current = [];
      }

      // 12. Soft Radial Chimney Smoke Wisps
      for (const s of smokeRef.current) {
        const sg = ctx.createRadialGradient(s.x, s.y, 0.5, s.x, s.y, s.radius);
        sg.addColorStop(0, `rgba(254, 252, 240, ${s.alpha})`);
        sg.addColorStop(1, 'rgba(254, 252, 240, 0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 13. Sunlit Golden Fireflies / Pollen Motes
      for (const m of firefliesRef.current) {
        const mx = m.baseX + Math.sin(tick * m.speed + m.phase) * 18;
        const my = m.baseY + Math.cos(tick * m.speed * 1.2 + m.phase) * 12;
        const glowAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(tick * 0.06 + m.phase * 2));
        ctx.fillStyle = `rgba(254, 240, 138, ${glowAlpha})`;
        ctx.beginPath();
        ctx.arc(mx, my, m.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 14. Shadow-Cast Soaring Village Birds
      for (const b of birdsRef.current) {
        const wing = Math.sin(b.phase) * 5.2 * b.scale;
        const dirSign = b.vx >= 0 ? 1 : -1;

        // Soft cast shadow far below on turf
        ctx.strokeStyle = 'rgba(20, 24, 15, 0.22)';
        ctx.lineWidth = 2 * b.scale;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(b.x + 26 - 6 * b.scale, b.y + 42 - wing * 0.6);
        ctx.quadraticCurveTo(b.x + 26, b.y + 42, b.x + 26 + 6 * b.scale, b.y + 42 - wing * 0.6);
        ctx.stroke();

        // Warm sculpted bird silhouette
        ctx.strokeStyle = 'rgba(68, 52, 36, 0.85)';
        ctx.lineWidth = 1.9 * b.scale;
        ctx.beginPath();
        ctx.moveTo(b.x - 7 * b.scale, b.y - wing);
        ctx.quadraticCurveTo(b.x - 3 * b.scale, b.y - 3 * b.scale, b.x, b.y);
        ctx.quadraticCurveTo(b.x + 3 * b.scale, b.y - 3 * b.scale, b.x + 7 * b.scale, b.y - wing);
        ctx.stroke();

        ctx.fillStyle = 'rgba(245, 232, 210, 0.9)';
        ctx.beginPath();
        ctx.ellipse(b.x + dirSign * 1.5, b.y, 2.2 * b.scale, 1.3 * b.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // 15. Lightweight Corner Mini-Map Render (every 3rd frame)
      const miniCanvas = miniMapCanvasRef.current;
      if (miniCanvas && Math.floor(tick) % 3 === 0) {
        const mCtx = miniCanvas.getContext('2d');
        if (mCtx) {
          const sx = MINIMAP_W / WORLD_WIDTH;
          const sy = MINIMAP_H / WORLD_HEIGHT;
          const tileW = MINIMAP_W / MAP_COLS;
          const tileH = MINIMAP_H / MAP_ROWS;

          mCtx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
          mCtx.fillStyle = '#0f1f18';
          mCtx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

          // Paths, plaza, bridges & eastern brook
          for (let ty = 0; ty < MAP_ROWS; ty++) {
            for (let tx = 0; tx < MAP_COLS; tx++) {
              const kind = VILLAGE_MAP.tiles[ty][tx];
              if (kind === 'path' || kind === 'plaza' || kind === 'bridge') {
                mCtx.fillStyle =
                  kind === 'plaza'
                    ? 'rgba(214, 199, 169, 0.34)'
                    : 'rgba(214, 199, 169, 0.22)';
                mCtx.fillRect(tx * tileW, ty * tileH, tileW + 0.4, tileH + 0.4);
              } else if (kind === 'water') {
                mCtx.fillStyle = 'rgba(56, 189, 248, 0.42)';
                mCtx.fillRect(tx * tileW, ty * tileH, tileW + 0.4, tileH + 0.4);
              }
            }
          }

          // Buildings
          for (const b of VILLAGE_BUILDINGS) {
            const bx = b.tileX * tileW;
            const by = b.tileY * tileH;
            const bw = b.widthTiles * tileW;
            const bh = b.heightTiles * tileH;
            const isBusyBld = activeBuildingIds.has(b.id);
            mCtx.fillStyle = b.roofColor;
            mCtx.fillRect(bx, by, bw, bh);
            mCtx.strokeStyle = isBusyBld ? '#fbbf24' : 'rgba(15, 23, 42, 0.85)';
            mCtx.lineWidth = isBusyBld ? 1.5 : 0.8;
            mCtx.strokeRect(bx, by, bw, bh);
          }

          // Active villager conversation rings on radar
          for (const chat of activeChatsRef.current) {
            const a = agentsRef.current.find((x) => x.id === chat.agentAId);
            const b = agentsRef.current.find((x) => x.id === chat.agentBId);
            if (!a || !b) continue;
            const cxPos = ((a.x + b.x) / 2) * sx;
            const cyPos = ((a.y + b.y) / 2) * sy;
            mCtx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
            mCtx.lineWidth = 1;
            mCtx.beginPath();
            mCtx.arc(cxPos, cyPos, 5.2, 0, Math.PI * 2);
            mCtx.stroke();
          }

          // Villager availability dots
          const ctxState = liveContextRef.current;
          for (const ag of agentsRef.current) {
            if (ag.id === 'cho') continue;
            const avail = resolveAgentAvailability(ag, ctxState);
            mCtx.fillStyle =
              avail.level === 'busy'
                ? '#f43f5e'
                : avail.level === 'working'
                  ? '#fb923c'
                  : '#34d399';
            mCtx.beginPath();
            mCtx.arc(ag.x * sx, ag.y * sy, 2.2, 0, Math.PI * 2);
            mCtx.fill();
          }

          // CHO player beacon
          if (cho) {
            mCtx.fillStyle = '#ffffff';
            mCtx.strokeStyle = '#f59e0b';
            mCtx.lineWidth = 1.6;
            mCtx.beginPath();
            mCtx.arc(cho.x * sx, cho.y * sy, 3.3, 0, Math.PI * 2);
            mCtx.fill();
            mCtx.stroke();
          }

          // Camera viewport rectangle
          const vx = viewW > WORLD_WIDTH ? 0 : cameraRef.current.x * sx;
          const vy = viewH > WORLD_HEIGHT ? 0 : cameraRef.current.y * sy;
          const vw = Math.min(MINIMAP_W, viewW * sx);
          const vh = Math.min(MINIMAP_H, viewH * sy);
          mCtx.strokeStyle = 'rgba(248, 250, 252, 0.85)';
          mCtx.lineWidth = 1.1;
          mCtx.strokeRect(vx + 0.5, vy + 0.5, Math.max(8, vw - 1), Math.max(8, vh - 1));
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      resizeObserver?.disconnect();
    };
  }, [agentsRef, isModalOpen, selectedAgentId, showWalkability]);

  const getWorldPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const offsetX = viewW > WORLD_WIDTH ? (viewW - WORLD_WIDTH) / 2 : -cameraRef.current.x;
    const offsetY = viewH > WORLD_HEIGHT ? (viewH - WORLD_HEIGHT) / 2 : -cameraRef.current.y;
    return {
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
      viewW,
      viewH,
      worldX: e.clientX - rect.left - offsetX,
      worldY: e.clientY - rect.top - offsetY,
    };
  };

  const updateHoverInspect = (next: HoverInspectTarget | null) => {
    const prev = hoverInspectRef.current;
    if (!next && !prev) return;
    if (!next && prev) {
      hoverInspectRef.current = null;
      setHoverInspect(null);
      return;
    }
    if (
      next &&
      prev &&
      next.kind === prev.kind &&
      next.id === prev.id &&
      Math.hypot(next.screenX - prev.screenX, next.screenY - prev.screenY) < 12
    ) {
      return;
    }
    hoverInspectRef.current = next;
    setHoverInspect(next);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getWorldPos(e);
    if (!pos || isModalOpen) {
      updateHoverInspect(null);
      return;
    }

    const hoveredHop = hopHitBoxesRef.current.find(
      (hb) =>
        pos.worldX >= hb.x &&
        pos.worldX <= hb.x + hb.w &&
        pos.worldY >= hb.y &&
        pos.worldY <= hb.y + hb.h
    );
    hoveredHopKeyRef.current = hoveredHop?.key ?? null;

    const hoveredAgent = agentsRef.current.find(
      (a) => a.id !== 'cho' && Math.hypot(a.x - pos.worldX, a.y - 10 - pos.worldY) < 24
    );
    hoveredAgentIdRef.current = hoveredAgent?.id ?? null;

    const hovered = VILLAGE_BUILDINGS.find((b) => {
      const bx = b.tileX * TILE_SIZE;
      const by = b.tileY * TILE_SIZE;
      return (
        pos.worldX >= bx &&
        pos.worldX <= bx + b.widthTiles * TILE_SIZE &&
        pos.worldY >= by &&
        pos.worldY <= by + b.heightTiles * TILE_SIZE
      );
    });
    hoveredBuildingIdRef.current = hovered?.id ?? null;

    if (hoveredHop) {
      updateHoverInspect(null);
    } else if (hoveredAgent) {
      updateHoverInspect({
        kind: 'agent',
        id: hoveredAgent.id,
        screenX: pos.screenX,
        screenY: pos.screenY,
        containerW: pos.viewW,
        containerH: pos.viewH,
      });
    } else if (hovered) {
      updateHoverInspect({
        kind: 'building',
        id: hovered.id,
        screenX: pos.screenX,
        screenY: pos.screenY,
        containerW: pos.viewW,
        containerH: pos.viewH,
      });
    } else {
      updateHoverInspect(null);
    }
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getWorldPos(e);
    if (!pos) return;
    const { worldX, worldY } = pos;

    // 1. Clicking any town handoff callout plate opens that agent's Handoff Trace panel
    const clickedHop = hopHitBoxesRef.current.find(
      (hb) =>
        worldX >= hb.x &&
        worldX <= hb.x + hb.w &&
        worldY >= hb.y &&
        worldY <= hb.y + hb.h
    );
    if (clickedHop && callbacksRef.current.onClickHandoffHop) {
      callbacksRef.current.onClickHandoffHop(clickedHop.trace, clickedHop.agentId);
      return;
    }

    // 2. Clicking a live house task/approval status chip opens that task report or approval directly
    const clickedHouseBadge = buildingBadgeHitBoxesRef.current.find(
      (hb) =>
        worldX >= hb.x &&
        worldX <= hb.x + hb.w &&
        worldY >= hb.y &&
        worldY <= hb.y + hb.h
    );
    if (clickedHouseBadge) {
      if (clickedHouseBadge.kind === 'approval' && callbacksRef.current.onOpenApprovals) {
        callbacksRef.current.onOpenApprovals();
        return;
      }
      if (
        clickedHouseBadge.kind === 'task' &&
        clickedHouseBadge.task &&
        callbacksRef.current.onInspectBuildingTask
      ) {
        callbacksRef.current.onInspectBuildingTask(clickedHouseBadge.task);
        return;
      }
    }

    const clickedAgent = agentsRef.current.find(
      (a) => a.id !== 'cho' && Math.hypot(a.x - worldX, a.y - 10 - worldY) < 24
    );
    if (clickedAgent) {
      onSelectAgent(clickedAgent);
      return;
    }

    const clickedBuilding = VILLAGE_BUILDINGS.find((b) => {
      const bx = b.tileX * TILE_SIZE;
      const by = b.tileY * TILE_SIZE;
      return (
        worldX >= bx &&
        worldX <= bx + b.widthTiles * TILE_SIZE &&
        worldY >= by &&
        worldY <= by + b.heightTiles * TILE_SIZE
      );
    });
    if (clickedBuilding) {
      onEnterBuilding(clickedBuilding);
      return;
    }

    const cho = agentsRef.current.find((a) => a.id === 'cho');
    if (cho) {
      spotlightRef.current = null;
      const start = worldToTile(cho.x, cho.y);
      const goal = worldToTile(worldX, worldY);
      const path = findGridPath(start, goal, VILLAGE_MAP.walkable);
      cho.path = path;
      if (path.length > 0) {
        const finalTile = path[path.length - 1];
        const pt = tileToWorldCenter(finalTile.x, finalTile.y);
        clickTargetRef.current = { x: pt.x, y: pt.y, alpha: 1 };
      }
    }
  };

  const panFromMiniMapEvent = (
    e: React.MouseEvent<HTMLCanvasElement>,
    walkCho = false
  ) => {
    const mini = miniMapCanvasRef.current;
    if (!mini) return;
    const rect = mini.getBoundingClientRect();
    const fracX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const fracY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const wx = fracX * WORLD_WIDTH;
    const wy = fracY * WORLD_HEIGHT;

    if (walkCho || e.shiftKey) {
      const cho = agentsRef.current.find((a) => a.id === 'cho');
      if (cho) {
        spotlightRef.current = null;
        const start = worldToTile(cho.x, cho.y);
        const goal = worldToTile(wx, wy);
        const path = findGridPath(start, goal, VILLAGE_MAP.walkable);
        cho.path = path;
        if (path.length > 0) {
          const finalTile = path[path.length - 1];
          const pt = tileToWorldCenter(finalTile.x, finalTile.y);
          clickTargetRef.current = { x: pt.x, y: pt.y, alpha: 1 };
        }
      }
      return;
    }

    spotlightRef.current = {
      x: wx,
      y: wy,
      untilMs: performance.now() + 9000,
    };
  };

  const renderHoverCard = () => {
    if (!hoverInspect || isModalOpen) return null;
    const cardW = 264;
    const placeLeft = hoverInspect.screenX + cardW + 24 > hoverInspect.containerW;
    const left = Math.max(
      12,
      Math.min(
        hoverInspect.containerW - cardW - 12,
        placeLeft ? hoverInspect.screenX - cardW - 16 : hoverInspect.screenX + 16
      )
    );
    const top = Math.max(
      52,
      Math.min(hoverInspect.containerH - 148, hoverInspect.screenY - 24)
    );

    if (hoverInspect.kind === 'agent') {
      const ag = agentsRef.current.find((a) => a.id === hoverInspect.id);
      if (!ag) return null;
      const availability = resolveAgentAvailability(ag, {
        tasks,
        approvals,
        busyChatAgentId,
      });
      const liveState = formatLiveStateLabel(ag);
      const activeTask = ag.activeTaskId
        ? tasks.find((t) => t.id === ag.activeTaskId)
        : tasks.find(
            (t) =>
              isTaskActivelyRunning(t) &&
              (t.assignedDirectorId === ag.id || t.assignedWorkerId === ag.id)
          );
      const dotColor =
        availability.level === 'busy'
          ? 'bg-rose-500'
          : availability.level === 'working'
            ? 'bg-orange-400'
            : 'bg-emerald-400';
      const availText =
        availability.level === 'busy'
          ? 'text-rose-300'
          : availability.level === 'working'
            ? 'text-orange-300'
            : 'text-emerald-300';

      return (
        <div
          style={{ left, top, width: cardW }}
          className="pointer-events-none absolute z-20 rounded-lg border border-slate-700/90 bg-slate-950/95 p-3 shadow-xl backdrop-blur-md space-y-1.5"
        >
          <div className="flex items-center gap-2.5">
            <div className="relative shrink-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
                <CharacterSpriteBadge agent={ag} size={30} />
              </div>
              <span
                aria-hidden="true"
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950 ${dotColor}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="font-semibold text-white truncate">{ag.name}</span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className="text-slate-400 truncate">{ag.department}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className={`font-semibold ${availText}`}>{availability.label}</span>
                <span className="text-slate-600" aria-hidden="true">·</span>
                <span className="text-slate-300 truncate">{liveState.label}</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
            {ag.currentActivity || defaultStandbyActivity(ag)}
          </p>

          {activeTask && (
            <p className="text-[11px] text-amber-300/95 truncate">
              Task: {activeTask.prompt}
            </p>
          )}

          {ag.speechBubble && ag.speechTimer > 0 && ag.speechBubble !== '···' && (
            <p className="text-[11px] text-sky-200 italic line-clamp-2">
              “{ag.speechBubble}”
            </p>
          )}

          <p className="text-[10px] text-slate-500 pt-0.5">
            Click to chat
          </p>
        </div>
      );
    }

    const bld = VILLAGE_BUILDINGS.find((b) => b.id === hoverInspect.id);
    if (!bld) return null;
    const lead = bld.directorId
      ? agentsRef.current.find((a) => a.id === bld.directorId)
      : undefined;
    const houseTasks = tasks.filter(
      (t) =>
        isTaskActivelyRunning(t) &&
        ((bld.directorId && t.assignedDirectorId === bld.directorId) ||
          (bld.id === 'town_hall' && t.status === 'matt_routing'))
    );
    const houseApprovals = approvals.filter(
      (ap) =>
        ap.status === 'pending' &&
        ((bld.directorId && ap.directorId === bld.directorId) ||
          ap.payload?.buildingId === bld.id)
    );
    const staffCount = agentsRef.current.filter(
      (a) => a.id !== 'cho' && a.buildingId === bld.id
    ).length;

    return (
      <div
        style={{ left, top, width: cardW }}
        className="pointer-events-none absolute z-20 rounded-lg border border-slate-700/90 bg-slate-950/95 p-3 shadow-xl backdrop-blur-md space-y-1.5"
      >
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-white truncate">{bld.name}</span>
            <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
              {staffCount} staff
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {lead ? `Led by ${lead.name}` : bld.subtitle} ·{' '}
            {houseApprovals.length > 0 ? (
              <span className="text-amber-300 font-medium">
                {houseApprovals.length} pending approval
                {houseApprovals.length === 1 ? '' : 's'}
              </span>
            ) : houseTasks.length > 0 ? (
              <span className="text-orange-300 font-medium">
                {houseTasks.length} active task{houseTasks.length === 1 ? '' : 's'}
              </span>
            ) : (
              <span className="text-emerald-300">Available</span>
            )}
          </p>
        </div>

        {houseTasks[0] ? (
          <p className="text-[11px] text-slate-200 line-clamp-2">
            Working on: {houseTasks[0].prompt}
          </p>
        ) : (
          <p className="text-[11px] text-slate-400 line-clamp-2">
            {bld.interiorSubtitle}
          </p>
        )}

        <p className="text-[10px] text-slate-500 pt-0.5">
          Click building to enter
        </p>
      </div>
    );
  };

  const miniMapRightClass = isRightDrawerOpen
    ? 'right-3 xl:right-[576px]'
    : 'right-3';
  const miniMapBottomClass =
    isCommandBarCollapsed && !isRightDrawerOpen ? 'bottom-14' : 'bottom-3';

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => {
          hoveredBuildingIdRef.current = null;
          hoveredAgentIdRef.current = null;
          hoveredHopKeyRef.current = null;
          updateHoverInspect(null);
        }}
        className="h-full w-full cursor-pointer block bg-stone-950"
      />

      {/* Hover Quick-Inspect Card */}
      {renderHoverCard()}

      {/* Interactive Corner Mini-Map & Camera Jump */}
      {!isModalOpen && (
        <div
          className={`absolute z-10 ${miniMapRightClass} ${miniMapBottomClass} transition-opacity duration-150`}
        >
          {miniMapExpanded ? (
            <div className="rounded-lg border border-slate-700/85 bg-slate-950/92 p-1.5 shadow-xl backdrop-blur-md">
              <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[10px] text-slate-300">
                <span className="font-semibold text-slate-200 whitespace-nowrap">
                  Village Radar
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      spotlightRef.current = null;
                    }}
                    title="Center camera on you"
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-slate-800 hover:text-amber-300 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Crosshair className="h-2.5 w-2.5" />
                    <span>Me</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMiniMapExpanded(false)}
                    title="Minimize radar (N)"
                    aria-label="Minimize radar"
                    className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer shrink-0"
                  >
                    <Minimize2 className="h-3 w-3" />
                  </button>
                </div>
              </div>

              <canvas
                ref={miniMapCanvasRef}
                width={MINIMAP_W}
                height={MINIMAP_H}
                onMouseDown={(e) => {
                  isDraggingMiniMapRef.current = true;
                  panFromMiniMapEvent(e, false);
                }}
                onMouseMove={(e) => {
                  if (!isDraggingMiniMapRef.current) return;
                  panFromMiniMapEvent(e, false);
                }}
                onDoubleClick={(e) => panFromMiniMapEvent(e, true)}
                title="Click or drag to pan camera · Double-click or Shift+click to walk there"
                className="block rounded border border-slate-800 cursor-crosshair"
              />

              <div className="mt-1 flex items-center justify-between px-1 text-[9.5px] text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full bg-white ring-1 ring-amber-400" />
                    <span>You</span>
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>Free</span>
                  </span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                    <span>Busy</span>
                  </span>
                </div>
                <span className="text-slate-500 whitespace-nowrap">Click to pan</span>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setMiniMapExpanded(true)}
              title="Open Village Radar (N)"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/85 bg-slate-950/90 px-2.5 py-1.5 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md hover:border-amber-500/60 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
            >
              <MapIcon className="h-3.5 w-3.5 text-amber-400" />
              <span>Radar (N)</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
