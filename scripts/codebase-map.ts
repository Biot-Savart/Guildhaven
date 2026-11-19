import fs from 'node:fs';
import path from 'node:path';

interface IndexedSymbol {
  category:
    | 'route'
    | 'engine'
    | 'orchestrator'
    | 'type'
    | 'app-landmark'
    | 'app-handler'
    | 'ui-section'
    | 'lib';
  file: string;
  line: number;
  signature: string;
}

const ROOT = process.cwd();

function readLines(relPath: string): string[] {
  const full = path.join(ROOT, relPath);
  if (!fs.existsSync(full)) return [];
  return fs.readFileSync(full, 'utf8').split('\n');
}

function listFilesInDir(relDir: string, extFilter: RegExp): string[] {
  const full = path.join(ROOT, relDir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => extFilter.test(name))
    .sort()
    .map((name) => path.posix.join(relDir, name));
}

function collectFileStats(): Array<{ file: string; lines: number }> {
  const files = [
    'server.ts',
    ...listFilesInDir('server', /\.ts$/),
    'src/App.tsx',
    ...listFilesInDir('src/types', /\.ts$/),
    ...listFilesInDir('src/data', /\.ts$/),
    ...listFilesInDir('src/lib', /\.ts$/),
    ...listFilesInDir('src/components', /\.tsx$/),
  ];
  return files
    .map((file) => ({ file, lines: readLines(file).length }))
    .filter((entry) => entry.lines > 0)
    .sort((a, b) => b.lines - a.lines);
}

function indexCodebase(): IndexedSymbol[] {
  const out: IndexedSymbol[] = [];

  // 1. Express HTTP & WebSocket routes in server.ts
  const serverLines = readLines('server.ts');
  serverLines.forEach((raw, idx) => {
    const routeMatch = /^app\.(get|post|patch|put|delete)\(\s*['"`]([^'"`]+)['"`]/.exec(raw.trim());
    if (routeMatch) {
      out.push({
        category: 'route',
        file: 'server.ts',
        line: idx + 1,
        signature: `${routeMatch[1].toUpperCase()} ${routeMatch[2]}`,
      });
      return;
    }
    if (raw.includes("reqUrl.pathname === '/ws/")) {
      const wsMatch = /['"`](\/ws\/[^'"`]+)['"`]/.exec(raw);
      if (wsMatch) {
        out.push({
          category: 'route',
          file: 'server.ts',
          line: idx + 1,
          signature: `WS ${wsMatch[1]}`,
        });
      }
    }
  });

  // 2. server/villageEngine.ts exports
  readLines('server/villageEngine.ts').forEach((raw, idx) => {
    const m = /^export\s+(?:async\s+)?(function|const|interface|type)\s+([A-Za-z0-9_]+)/.exec(
      raw.trim()
    );
    if (m) {
      out.push({
        category: 'engine',
        file: 'server/villageEngine.ts',
        line: idx + 1,
        signature: `${m[1]} ${m[2]}`,
      });
    }
  });

  // 3. server/orchestrator.ts exports & tool builders/executors
  readLines('server/orchestrator.ts').forEach((raw, idx) => {
    const exp = /^export\s+(?:async\s+)?(function|const|interface|type)\s+([A-Za-z0-9_]+)/.exec(
      raw.trim()
    );
    if (exp) {
      out.push({
        category: 'orchestrator',
        file: 'server/orchestrator.ts',
        line: idx + 1,
        signature: `export ${exp[1]} ${exp[2]}`,
      });
      return;
    }
    const toolFn = /^(?:async\s+)?function\s+((?:build|execute)[A-Za-z0-9_]+)\s*\(/.exec(
      raw.trim()
    );
    if (toolFn) {
      out.push({
        category: 'orchestrator',
        file: 'server/orchestrator.ts',
        line: idx + 1,
        signature: `tool ${toolFn[1]}()`,
      });
    }
  });

  // 4. src/types/village.ts domain types
  readLines('src/types/village.ts').forEach((raw, idx) => {
    const m = /^export\s+(interface|type)\s+([A-Za-z0-9_]+)/.exec(raw.trim());
    if (m) {
      out.push({
        category: 'type',
        file: 'src/types/village.ts',
        line: idx + 1,
        signature: `${m[1]} ${m[2]}`,
      });
    }
  });

  // 5. src/lib/*.ts & src/data/*.ts exports
  for (const libFile of [
    ...listFilesInDir('src/lib', /\.ts$/),
    ...listFilesInDir('src/data', /\.ts$/),
  ]) {
    readLines(libFile).forEach((raw, idx) => {
      const m = /^export\s+(?:async\s+)?(function|const|class|interface|type)\s+([A-Za-z0-9_]+)/.exec(
        raw.trim()
      );
      if (m) {
        out.push({
          category: 'lib',
          file: libFile,
          line: idx + 1,
          signature: `${m[1]} ${m[2]}`,
        });
      }
    });
  }

  // 6. src/App.tsx structural landmarks, hook boundary, handlers & modal/drawer mounts
  readLines('src/App.tsx').forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (/^\s*if\s*\(\s*screen\s*===\s*['"]TITLE_MENU['"]\s*\)/.test(raw)) {
      out.push({
        category: 'app-landmark',
        file: 'src/App.tsx',
        line: lineNo,
        signature:
          "EARLY RETURN: if (screen === 'TITLE_MENU') — ALL React hooks MUST be placed ABOVE this line",
      });
      return;
    }
    if (/^\s*<header\b/.test(raw)) {
      out.push({
        category: 'app-landmark',
        file: 'src/App.tsx',
        line: lineNo,
        signature: '<header> 3-Zone Top Bar Contract',
      });
      return;
    }
    if (/^\s*\{workspaceViewMode\s*===\s*['"]desk['"]\s*\?/.test(raw)) {
      out.push({
        category: 'app-landmark',
        file: 'src/App.tsx',
        line: lineNo,
        signature: 'Main Viewport Switch: <DeskDashboardView /> vs <VillageCanvas />',
      });
      return;
    }
    const drawerMount = /^\s*\{\(?rightDrawerMode\s*===\s*['"]([a-z_]+)['"]/.exec(raw);
    if (drawerMount) {
      out.push({
        category: 'app-landmark',
        file: 'src/App.tsx',
        line: lineNo,
        signature: `Right Drawer Mount: rightDrawerMode === '${drawerMount[1]}'`,
      });
      return;
    }
    const modalMount =
      /^\s*<(BuildingInteriorModal|MorningBriefingModal|CommandPaletteModal|LiveTaskTrackerBar)\b/.exec(
        raw
      );
    if (modalMount) {
      out.push({
        category: 'app-landmark',
        file: 'src/App.tsx',
        line: lineNo,
        signature: `Overlay/Modal Mount: <${modalMount[1]} />`,
      });
      return;
    }
    const handlerMatch =
      /^  const ((?:handle|open|refresh|persist|updateVillageSettings|resolveFreshWorkspaceToken|summon|enter|exit|visualize)[A-Za-z0-9_]*)\s*=/.exec(
        raw
      );
    if (handlerMatch) {
      out.push({
        category: 'app-handler',
        file: 'src/App.tsx',
        line: lineNo,
        signature: `${handlerMatch[1]}()`,
      });
    }
  });

  // 7. Drawer tab render anchors & JSX section comments across src/components/*.tsx
  for (const compFile of listFilesInDir('src/components', /\.tsx$/)) {
    readLines(compFile).forEach((raw, idx) => {
      const tabRender = /^\s*\{\(?(?:activeTab|tab)\s*===\s*['"]([a-zA-Z0-9_-]+)['"]/.exec(raw);
      if (tabRender) {
        out.push({
          category: 'ui-section',
          file: compFile,
          line: idx + 1,
          signature: `Tab render: '${tabRender[1]}'`,
        });
        return;
      }
      const jsxSection = /^\s*\{\/\*\s*([A-Z0-9][^*/]{3,90}?)\s*\*\/\}\s*$/.exec(raw);
      if (jsxSection) {
        out.push({
          category: 'ui-section',
          file: compFile,
          line: idx + 1,
          signature: `JSX section: ${jsxSection[1]}`,
        });
      }
    });
  }

  return out;
}

function printSummary(stats: Array<{ file: string; lines: number }>, symbols: IndexedSymbol[]) {
  console.log('# Guildhaven Live Codebase Map\n');
  console.log(
    'Tip: Filter by keyword, category, or filename — e.g. `npm run map -- gmail`, `npm run map -- routes`, `npm run map -- hooks`, `npm run map -- WorkspaceHubDrawer`\n'
  );

  console.log('## 1. Largest Files (Line Counts)');
  for (const entry of stats.slice(0, 14)) {
    console.log(`  ${String(entry.lines).padStart(5, ' ')} lines  ${entry.file}`);
  }

  console.log('\n## 2. Express & WebSocket Routes (server.ts)');
  for (const s of symbols.filter((x) => x.category === 'route')) {
    console.log(`  server.ts:${String(s.line).padEnd(5, ' ')} ${s.signature}`);
  }

  console.log('\n## 3. src/App.tsx Structural Landmarks & Hook Boundary');
  for (const s of symbols.filter((x) => x.category === 'app-landmark')) {
    console.log(`  src/App.tsx:${String(s.line).padEnd(5, ' ')} ${s.signature}`);
  }

  console.log('\n## 4. Orchestrator Entrypoints & Agent Tools (server/orchestrator.ts)');
  for (const s of symbols.filter((x) => x.category === 'orchestrator')) {
    console.log(`  server/orchestrator.ts:${String(s.line).padEnd(5, ' ')} ${s.signature}`);
  }

  console.log('\n## 5. Component Tab Render Anchors (src/components/*.tsx)');
  for (const s of symbols.filter(
    (x) => x.category === 'ui-section' && x.signature.startsWith('Tab render:')
  )) {
    console.log(`  ${s.file}:${String(s.line).padEnd(5, ' ')} ${s.signature}`);
  }
}

function printFiltered(
  queryRaw: string,
  stats: Array<{ file: string; lines: number }>,
  symbols: IndexedSymbol[]
) {
  const q = queryRaw.trim().toLowerCase();
  const categoryAliases: Record<string, IndexedSymbol['category'][]> = {
    routes: ['route'],
    route: ['route'],
    api: ['route'],
    hooks: ['app-landmark', 'app-handler'],
    handlers: ['app-handler'],
    app: ['app-landmark', 'app-handler'],
    engine: ['engine'],
    orchestrator: ['orchestrator'],
    tools: ['orchestrator'],
    types: ['type'],
    tabs: ['ui-section'],
    ui: ['ui-section'],
    lib: ['lib'],
  };

  const aliasCategories = categoryAliases[q];
  const matchedFiles = stats.filter((f) => f.file.toLowerCase().includes(q));
  const matchedSymbols = symbols.filter((s) => {
    if (aliasCategories && aliasCategories.includes(s.category)) return true;
    return (
      s.file.toLowerCase().includes(q) ||
      s.signature.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q)
    );
  });

  console.log(`# Codebase Map Filter: "${queryRaw}"\n`);
  if (matchedFiles.length > 0) {
    console.log('Matching Files:');
    for (const f of matchedFiles) {
      console.log(`  ${String(f.lines).padStart(5, ' ')} lines  ${f.file}`);
    }
    console.log('');
  }

  if (matchedSymbols.length === 0) {
    console.log('No indexed symbols matched. Try `grep -rnE` across `src server server.ts`.');
    return;
  }

  console.log(`Matching Symbols (${matchedSymbols.length}):`);
  for (const s of matchedSymbols) {
    console.log(`  [${s.category}] ${s.file}:${s.line} — ${s.signature}`);
  }
}

const stats = collectFileStats();
const symbols = indexCodebase();
const args = process.argv.slice(2);

if (args.length === 0) {
  printSummary(stats, symbols);
} else {
  printFiltered(args.join(' '), stats, symbols);
}
