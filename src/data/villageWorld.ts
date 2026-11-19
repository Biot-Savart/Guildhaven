import type { Building, GridPoint } from '../types/village.ts';

export const TILE_SIZE = 36;
export const MAP_COLS = 45;
export const MAP_ROWS = 30;
export const WORLD_WIDTH = MAP_COLS * TILE_SIZE;
export const WORLD_HEIGHT = MAP_ROWS * TILE_SIZE;

export const VILLAGE_BUILDINGS: Building[] = [
  {
    id: 'town_hall',
    name: 'Town Hall',
    subtitle: 'Executive & Briefings',
    directorId: 'matt',
    tileX: 19,
    tileY: 1,
    widthTiles: 7,
    heightTiles: 7,
    doorTileX: 22,
    doorTileY: 9,
    yardTileX: 22,
    yardTileY: 10,
    roofColor: '#D96B27',
    roofAccent: '#FBBF24',
    wallColor: '#E7E5E4',
    style: 'town_hall',
    interiorSubtitle: 'Central Council & Chief of Staff Chambers',
  },
  {
    id: 'inbox',
    name: 'Inbox & Calendar',
    subtitle: 'Daniel · Gmail, Chat, Docs & Drive',
    directorId: 'daniel',
    tileX: 10,
    tileY: 3,
    widthTiles: 7,
    heightTiles: 6,
    doorTileX: 13,
    doorTileY: 9,
    yardTileX: 14,
    yardTileY: 10,
    roofColor: '#EA580C',
    roofAccent: '#38BDF8',
    wallColor: '#F5F5F4',
    style: 'inbox',
    interiorSubtitle: 'Gmail, Calendar, Google Chat, Google Docs & Google Drive Workspace Hub',
  },
  {
    id: 'research',
    name: 'Research & Intel',
    subtitle: 'Aria · Google Search',
    directorId: 'aria',
    tileX: 28,
    tileY: 2,
    widthTiles: 8,
    heightTiles: 7,
    doorTileX: 32,
    doorTileY: 9,
    yardTileX: 31,
    yardTileY: 10,
    roofColor: '#3730A3',
    roofAccent: '#C7D2FE',
    wallColor: '#EDE9FE',
    style: 'research',
    interiorSubtitle: 'Deep Grounding & Intelligence Tower',
  },
  {
    id: 'finance',
    name: 'Finance & Money',
    subtitle: 'Marcus · Treasury',
    directorId: 'marcus',
    tileX: 5,
    tileY: 10,
    widthTiles: 8,
    heightTiles: 8,
    doorTileX: 13,
    doorTileY: 15,
    yardTileX: 14,
    yardTileY: 15,
    roofColor: '#0F766E',
    roofAccent: '#FBBF24',
    wallColor: '#F1F5F9',
    style: 'finance',
    interiorSubtitle: 'Treasury, Budgets & Expense Review Office',
  },
  {
    id: 'youtube',
    name: 'YouTube Studio',
    subtitle: 'Elena · Video & Media',
    directorId: 'elena',
    tileX: 32,
    tileY: 11,
    widthTiles: 7,
    heightTiles: 7,
    doorTileX: 35,
    doorTileY: 19,
    yardTileX: 34,
    yardTileY: 19,
    roofColor: '#EA580C',
    roofAccent: '#FEF08A',
    wallColor: '#FEF2F2',
    style: 'youtube',
    interiorSubtitle: 'Creator Production Studio & Script Room',
  },
  {
    id: 'operations',
    name: 'Operations House',
    subtitle: 'Devon · Workflows',
    directorId: 'devon',
    tileX: 7,
    tileY: 19,
    widthTiles: 9,
    heightTiles: 8,
    doorTileX: 11,
    doorTileY: 28,
    yardTileX: 12,
    yardTileY: 28,
    roofColor: '#E06D2B',
    roofAccent: '#FDBA74',
    wallColor: '#FFF7ED',
    style: 'operations',
    interiorSubtitle: 'Systems Automation & SOP Workshop',
  },
  {
    id: 'health',
    name: 'Health & Home',
    subtitle: 'Noah · Life Logistics',
    directorId: 'noah',
    tileX: 19,
    tileY: 20,
    widthTiles: 8,
    heightTiles: 7,
    doorTileX: 22,
    doorTileY: 28,
    yardTileX: 22,
    yardTileY: 28,
    roofColor: '#EA580C',
    roofAccent: '#BBF7D0',
    wallColor: '#F0FDF4',
    style: 'health',
    interiorSubtitle: 'Wellness, Meals & Personal Logistics Lodge',
  },
  {
    id: 'creative',
    name: 'Creative & Comms',
    subtitle: 'Layla · Brand & Copy',
    directorId: 'layla',
    tileX: 30,
    tileY: 20,
    widthTiles: 8,
    heightTiles: 7,
    doorTileX: 34,
    doorTileY: 28,
    yardTileX: 33,
    yardTileY: 28,
    roofColor: '#BE4B7B',
    roofAccent: '#DDD6FE',
    wallColor: '#FAF5FF',
    style: 'creative',
    interiorSubtitle: 'Editorial, Copywriting & Campaign Atelier',
  },
  {
    id: 'engineering',
    name: 'Systems & Dev',
    subtitle: 'Kieran · Integrations & Code',
    directorId: 'kieran',
    tileX: 1,
    tileY: 1,
    widthTiles: 8,
    heightTiles: 7,
    doorTileX: 7,
    doorTileY: 8,
    yardTileX: 8,
    yardTileY: 9,
    roofColor: '#3B5998',
    roofAccent: '#38BDF8',
    wallColor: '#E2E8F0',
    style: 'engineering',
    interiorSubtitle: 'Software Architecture, APIs & Systems Integration Lab',
  },
];

export type TileKind = 'grass' | 'path' | 'plaza' | 'water' | 'bridge' | 'tree' | 'fountain' | 'building';

export interface VillageMapData {
  walkable: boolean[][];
  tiles: TileKind[][];
  trees: GridPoint[];
  lanterns: GridPoint[];
}

export function buildVillageMap(): VillageMapData {
  const tiles: TileKind[][] = Array.from({ length: MAP_ROWS }, () =>
    Array.from({ length: MAP_COLS }, () => 'grass' as TileKind)
  );
  // Start non-walkable around dense forest perimeter & yards, then carve exact plaza/roads/gates
  const walkable: boolean[][] = Array.from({ length: MAP_ROWS }, () =>
    Array.from({ length: MAP_COLS }, () => false)
  );

  const setTile = (x: number, y: number, kind: TileKind, isWalkable: boolean) => {
    if (x < 0 || x >= MAP_COLS || y < 0 || y >= MAP_ROWS) return;
    tiles[y][x] = kind;
    walkable[y][x] = isWalkable;
  };

  const carveRect = (x0: number, y0: number, x1: number, y1: number, kind: TileKind = 'path') => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        setTile(x, y, kind, true);
      }
    }
  };

  // 1. Central Cobblestone Town Square Plaza (center x≈22.5, y≈15)
  for (let y = 10; y <= 19; y++) {
    for (let x = 17; x <= 28; x++) {
      const dist = Math.hypot(x - 22.5, y - 14.8);
      if (dist <= 5.6) {
        setTile(x, y, 'plaza', true);
      }
    }
  }

  // 2. Spokes from Plaza to Every Building Gate & Loop Road
  // North -> Town Hall gate (22, 9)
  carveRect(21, 9, 23, 11);

  // NW -> Inbox gate (13, 9) & Systems & Dev gate (7, 8)
  carveRect(6, 8, 9, 9);
  carveRect(8, 9, 14, 9);
  carveRect(13, 9, 15, 11);
  carveRect(15, 11, 18, 13);

  // NE -> Research gate (32, 9) & Upper Bridge (x=37..43, y=10..11)
  carveRect(30, 9, 32, 11);
  carveRect(27, 11, 31, 13);
  carveRect(32, 10, 40, 11);
  carveRect(40, 10, 42, 11, 'bridge');

  // West -> Finance gate (13, 15) & path up to Inbox / down toward Operations
  carveRect(13, 14, 18, 16);
  carveRect(14, 11, 15, 16);

  // East -> Research/YouTube junction & Lower Bridge (x=40..43, y=19..20)
  carveRect(28, 13, 30, 17);
  carveRect(27, 18, 36, 20);
  carveRect(34, 19, 40, 20);
  carveRect(40, 19, 42, 20, 'bridge');

  // SW corridor between Finance/Operations & Health
  carveRect(15, 16, 18, 20);
  carveRect(16, 20, 18, 28);

  // SE corridor between Health & Creative
  carveRect(27, 18, 29, 28);

  // East loop around Creative back up to YouTube & Lower Bridge
  carveRect(36, 20, 38, 28);

  // Southern Promenade connecting Operations (11,28) <-> Health (22,28) <-> Creative (34,28)
  carveRect(10, 27, 37, 28);

  // 3. Eastern Brook Water (outside the 2 wooden footbridges)
  for (let y = 0; y < MAP_ROWS; y++) {
    for (let x = 40; x <= 42; x++) {
      if ((y >= 10 && y <= 11) || (y >= 19 && y <= 20)) continue;
      setTile(x, y, 'water', false);
    }
  }

  // 4. Central Fountain Stone Basin (non-walkable center of plaza)
  for (let y = 14; y <= 15; y++) {
    for (let x = 21; x <= 23; x++) {
      setTile(x, y, 'fountain', false);
    }
  }

  // 5. Mark Building Compounds Non-Walkable & Ensure Doors + Yards Walkable
  for (const b of VILLAGE_BUILDINGS) {
    for (let y = b.tileY; y < b.tileY + b.heightTiles; y++) {
      for (let x = b.tileX; x < b.tileX + b.widthTiles; x++) {
        setTile(x, y, 'building', false);
      }
    }
  }
  for (const b of VILLAGE_BUILDINGS) {
    setTile(b.doorTileX, b.doorTileY, 'path', true);
    setTile(b.yardTileX, b.yardTileY, 'path', true);
  }

  // Decorative lantern coordinates matching warm lampposts in the generated diorama
  const lanterns: GridPoint[] = [
    { x: 18, y: 10 },
    { x: 27, y: 10 },
    { x: 16, y: 13 },
    { x: 29, y: 13 },
    { x: 16, y: 18 },
    { x: 29, y: 18 },
  ];

  return { walkable, tiles, trees: [], lanterns };
}

export const VILLAGE_MAP = buildVillageMap();

export function findGridPath(
  start: GridPoint,
  goal: GridPoint,
  walkable: boolean[][]
): GridPoint[] {
  const clamp = (p: GridPoint): GridPoint => ({
    x: Math.max(0, Math.min(MAP_COLS - 1, p.x)),
    y: Math.max(0, Math.min(MAP_ROWS - 1, p.y)),
  });

  const s = clamp(start);
  let g = clamp(goal);

  if (!walkable[g.y]?.[g.x]) {
    let best: GridPoint | null = null;
    let bestDist = Infinity;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const nx = g.x + dx;
        const ny = g.y + dy;
        if (nx >= 0 && nx < MAP_COLS && ny >= 0 && ny < MAP_ROWS && walkable[ny][nx]) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bestDist) {
            bestDist = d;
            best = { x: nx, y: ny };
          }
        }
      }
    }
    if (!best) return [];
    g = best;
  }

  if (s.x === g.x && s.y === g.y) return [];

  const key = (x: number, y: number) => `${x},${y}`;
  const open: { x: number, y: number, g: number, f: number }[] = [
    { x: s.x, y: s.y, g: 0, f: Math.abs(g.x - s.x) + Math.abs(g.y - s.y) },
  ];
  const cameFrom = new Map<string, GridPoint>();
  const gScore = new Map<string, number>([[key(s.x, s.y), 0]]);
  const closed = new Set<string>();

  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ];

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    const ck = key(current.x, current.y);

    if (current.x === g.x && current.y === g.y) {
      const path: GridPoint[] = [];
      let curr: GridPoint | undefined = { x: g.x, y: g.y };
      while (curr && !(curr.x === s.x && curr.y === s.y)) {
        path.unshift(curr);
        curr = cameFrom.get(key(curr.x, curr.y));
      }
      return path;
    }

    closed.add(ck);

    for (const { dx, dy } of dirs) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
      if (!walkable[ny][nx]) continue;
      const nk = key(nx, ny);
      if (closed.has(nk)) continue;

      const tentativeG = current.g + 1;
      const prevG = gScore.get(nk);
      if (prevG === undefined || tentativeG < prevG) {
        cameFrom.set(nk, { x: current.x, y: current.y });
        gScore.set(nk, tentativeG);
        open.push({
          x: nx,
          y: ny,
          g: tentativeG,
          f: tentativeG + Math.abs(g.x - nx) + Math.abs(g.y - ny),
        });
      }
    }
  }

  return [];
}

export function tileToWorldCenter(tx: number, ty: number): { x: number; y: number } {
  return {
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function worldToTile(px: number, py: number): GridPoint {
  return {
    x: Math.max(0, Math.min(MAP_COLS - 1, Math.floor(px / TILE_SIZE))),
    y: Math.max(0, Math.min(MAP_ROWS - 1, Math.floor(py / TILE_SIZE))),
  };
}
