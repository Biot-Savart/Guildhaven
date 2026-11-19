# AGENTS.md — Guildhaven Engineering & Navigation Guide

Guildhaven is a full-stack React 19 + Vite + Express + TypeScript multi-agent workspace ("2.5D village + Executive Desk") integrated with Gemini (`@google/genai`) and 1P Google Workspace APIs (Gmail, Calendar, Chat, Docs, Drive).

Use this guide first on every task to locate exact files/lines immediately and avoid architectural regressions.

---

## 1. Fast Navigation & Golden Commands

Several core files exceed 3,000–5,800 lines (`src/App.tsx`, `src/components/WorkspaceHubDrawer.tsx`, `server/villageEngine.ts`, `server.ts`, `src/components/VillageCanvas.tsx`, `server/orchestrator.ts`). **Do not page blindly through large files.**

### Live Symbol & Line-Number Indexer (`npm run map`)
Run `npm run map` via `run_command` to get **live, never-stale line numbers** in `<150ms`:

- `npm run map` — High-level overview: largest files, all Express/WS routes in `server.ts`, `src/App.tsx` hook boundary & drawer mounts, orchestrator tools, and drawer tab anchors.
- `npm run map -- routes` — All HTTP & WebSocket endpoints in `server.ts` with exact line numbers.
- `npm run map -- hooks` (or `handlers`) — Every `handle*` / `open*` / `refresh*` callback and the `TITLE_MENU` early-return hook boundary in `src/App.tsx`.
- `npm run map -- <keyword>` (e.g. `npm run map -- gmail`, `npm run map -- calendar`, `npm run map -- kb`, `npm run map -- WorkspaceHubDrawer`) — Filters routes, types, engine exports, orchestrator tools, `App.tsx` handlers, and component tab blocks matching `<keyword>`.

### Targeted Search + Generous Window Reads
1. Locate exact lines with `npm run map -- <topic>` or a single combined `grep`:
   ```bash
   grep -rnE 'symbolOne|symbolTwo' server.ts server src --exclude-dir=node_modules --exclude-dir=dist
   ```
2. Call `view_file` with a generous `150–250` line `StartLine`..`EndLine` window around matches on files >1,600 lines, or omit `StartLine`/`EndLine` on smaller files (<1,600 lines) to read them in one shot.

### Verification & Dev Server Lifecycle
- **Typecheck / Lint**: `npm run lint` (`tsc --noEmit`) — catches undefined symbols, mismatched props, and union narrowing issues across client, `server.ts`, `server/*.ts`, and `scripts/*.ts`.
- **Production Build**: `npm run build` (`vite build`).
- **Final Turn Check**: Always co-execute `compile_applet` and `lint_applet` together in the same turn after finishing edits.
- **Backend Edits Require Server Restart**: `dev` runs `tsx server.ts` on port `3000` with HMR disabled. Whenever you modify `server.ts`, `server/villageEngine.ts`, or `server/orchestrator.ts`, call `restart_dev_server` so live API routes pick up the new backend code.

---

## 2. Repository Map & File Ownership

| Path | Responsibility |
| :--- | :--- |
| **`server.ts`** | Express server (port `3000`), Vite middleware mount, `data/village-memory.json` persistence, KB idempotency ledger & approval state machine, all `/api/village/*`, `/api/kb/*`, `/api/workspace/*`, `/api/cron/*`, `/api/webhooks/*`, and `/api/automation/*` REST routes, plus `/ws/live-voice` Gemini Live API WebSocket bridge. |
| **`server/villageEngine.ts`** | Core Gemini calls & Google Workspace REST clients (`gmail.googleapis.com`, `calendar`, `chat`, `docs`, `drive`), `fetchWorkspaceBriefing`, `formatWorkspaceContextForPrompts`, Matt routing, Town Hall roundtable, grounded villager cross-talk, 4K map generation, Morning Briefing, and single/multi-speaker TTS. |
| **`server/orchestrator.ts`** | Multi-agent handoff engine (`runOrchestratedVillageTask`, `runOrchestratedAgentChat`, `runKbProposalRevisionTurn`), function-calling tool declarations & executors (`dispatch_handoff`, `propose_kb_entry`, `stage_decision_packet`, `read_google_chat`, `read_gmail_messages`, `read_calendar_events`, `read_drive_files`, `summon_director_to_desk`), `AUTONOMOUS_SAFE_TOOL_WHITELIST` (`mode: 'autonomous'`), depth/timeout caps, and `enforceGovernanceTruthfulness`. |
| **`server/autonomyEngine.ts`** | 3-Layer Supervised Autonomy runner: Cron bearer & raw-body HMAC/OIDC webhook verification (5m replay window), SAST/UTC cron matcher, deterministic idempotency buckets, context hydration, fail-closed `executeAutonomousRuleRun`, TTL packet expiry sweeper, and token scrubber. |
| **`src/types/village.ts`** | Canonical shared TypeScript types imported by **both** client (`src/*`) and server (`server.ts`, `server/*`). **Never import `.jpg`/CSS/DOM modules here.** |
| **`src/lib/villagePersistence.ts`** | Shared `DEFAULT_VILLAGE_SETTINGS`, `normalizeVillageSettings`, `mergePersistedAgents`, `hasMeaningfulState`, and `localStorage` read/write helpers. Imported by both client and `server.ts`. |
| **`src/lib/googleAuth.ts`** | Firebase Auth + Google Identity Services (GIS) OAuth popup/silent renewal. Manages `WORKSPACE_SCOPES` and caches OAuth access tokens **strictly in memory**. |
| **`src/lib/villageActivity.ts`** | Villager availability badges (`available` / `working` / `busy`), grounded work anchors, and proximity/location descriptions. |
| **`src/lib/characterRenderer.ts`** | 2.5D canvas sprite, direction, speech bubble, and courier animation rendering helpers. |
| **`src/lib/voicePlayer.ts` & `agentVoices.ts`** | Client-side TTS queue playback, speech-bubble callbacks, and per-agent Gemini voice persona mappings (`Puck`, `Charon`, `Kore`, `Fenrir`, `Zephyr`). |
| **`src/data/initialAgents.ts`** | Default village roster: CHO (`cho`), Matt (`matt`, Chief of Staff), 7 Directors (`daniel`, `aria`, `marcus`, `layla`, `kieran`, `devon`, `nora`), and House Specialists (`zoe`, `eli`, etc.). |
| **`src/data/villageWorld.ts`** | Tile grid, walkability matrix, pathfinding (`findGridPath`), and `VILLAGE_BUILDINGS` coordinates/doors. |
| **`src/data/knowledgeBase.ts`** | Starter Knowledge Base seed entries and `mergeKnowledgeBase` normalizer. |
| **`src/data/automationDefaults.ts`** | Default `TownAutopilotSettings`, seeded `TownAutomationRule` schedules/webhooks, rule normalizers, and shared Decision Packet source/TTL formatters. |
| **`src/App.tsx`** | Root application state, hydration/persistence loop, Workspace & Autonomy API client wrappers, task/chat dispatchers, keyboard shortcuts, 3-zone `<header>`, Map/Desk switcher, bottom `@Director` command bar, and right-side drawer orchestration. |
| **`src/components/VillageCanvas.tsx`** | Interactive 2.5D town canvas, WASD/click navigation, villager movement, face-to-face courtyard cross-talk, and live multi-agent handoff packet arcs. |
| **`src/components/DeskDashboardView.tsx`** | Executive Desk mode (`workspaceViewMode === 'desk'`): KPI summary, Autopilot status toggle, active tasks, approvals queue, Town Digest feed, Director roster, and recent Gmail/Calendar cards. |
| **`src/components/WorkspaceHubDrawer.tsx`** | Right drawer for Google Workspace (`overview`, `calendar`, `chat`, `docs`, `drive` tabs): Gmail Inbox & Labels configurator/filter/preview, Calendar CRUD, Google Chat reader/search/pinner/sender, Docs import/export, and Drive Working Folder browser. |
| **`src/components/SettingsDrawer.tsx`** | Settings & Workspace Guardrails (`guardrails`, `autopilot`, `audio`, `village` tabs): Drive Working Folder fence, Calendar write-access toggle, Gmail Inbox & Monitored Labels selector, Supervised Autonomy kill-switch & rule editor, TTS audio settings, and 4K map / walkability controls. |
| **`src/components/DirectoryDrawer.tsx`** | Village Directory (`team`, `network`, `buildings`, `feed`, `digest` tabs): live availability badges, `CollaborationNetworkGraph`, grounded courtyard sync feed, and background Town Digest runs. |
| **`src/components/CollaborationNetworkGraph.tsx`** | Interactive SVG collaboration graph linking agents based on shared tasks and `HandoffTrace` packets. |
| **`src/components/AgentDrawer.tsx`** | 1-on-1 villager chat, Live Voice call (`LiveVoiceCallPanel`), `HandoffTracePanel` (with active breathing animation when running), and editable agent instructions/voice dossier. |
| **`src/components/ReportsAndApprovalsDrawer.tsx`** | Unified drawer for `reports`, `approvals` (staged Gmail drafts, Calendar actions, Drive writes, `KbDecisionPacketCard`), `history`, and `analytics` (`TaskAnalyticsView`). |
| **`src/components/KnowledgeBaseDrawer.tsx`** | Searchable House Knowledge Base viewer/editor and AI consolidation trigger. |
| **`src/components/BuildingInteriorModal.tsx`** | Interior view for Town Hall (Roundtable & Hiring) and Department Houses. |

---

## 3. Critical Codebase Invariants & Gotchas

### A. React Rules of Hooks Boundary in `src/App.tsx`
- `src/App.tsx` has an early return for the title screen (`if (screen === 'TITLE_MENU') { return <TitleMenuOverlay ... />; }`, check exact line with `npm run map -- hooks`).
- **Every** React hook (`useState`, `useRef`, `useMemo`, `useCallback`, `useEffect`) in `src/App.tsx` **MUST** be declared **above** `if (screen === 'TITLE_MENU')`. Placing any hook below that line crashes React when transitioning from `TITLE_MENU` to `PLAYING`.
- If a child drawer puts a callback prop in a `useEffect` dependency array (e.g., `onListGmailLabels`), wrap that handler in `useCallback` above the `TITLE_MENU` return so failed/empty fetches never cause infinite re-render loops.

### B. State Persistence & Server-Authoritative Ledger
- State persists to both `localStorage` and `data/village-memory.json` (`GET/POST /api/village/state`), including a 2-second live coordinate snapshot loop in `src/App.tsx`.
- **`knowledgeBase`, `kbProposals`, `townAutomationRules`, `townAutopilotSettings`, and `automationRuns` are strictly server-authoritative**: `POST /api/village/state` intentionally preserves server-side autonomy/KB state (and server-staged/expired `approvals`) so periodic client coordinate flushes never overwrite committed KB versions, background runs, or TTL transitions. Mutate KB via `/api/village/knowledge*` and `/api/kb/proposals*`, and mutate autonomy settings/rules via `/api/automation/*`.
- **Hydration before query-param overrides**: In `src/App.tsx`, `refreshWorkspaceBriefing` only attaches `?includeInbox=...&selectedLabels=...` once `hasHydratedRef.current` is `true` (or when `gmailOverride` is explicitly passed from user interaction) so initial mount calls never overwrite persisted server settings before `/api/village/state` finishes loading.

### C. Google Workspace OAuth, Scopes & Governance Guardrails
1. **Client-Side In-Memory Tokens Only**:
   - OAuth tokens are acquired in `src/lib/googleAuth.ts` and cached **strictly in memory** (`cachedAccessToken`). Never write access tokens to `localStorage`, `sessionStorage`, or `data/village-memory.json`.
   - Pass tokens from client to `/api/workspace/*`, `/api/village/task`, and `/api/village/chat` via `Authorization: Bearer <token>`. Never implement server-side OAuth redirect flows.
2. **Scope Discipline**:
   - Check `WORKSPACE_SCOPES` in `src/lib/googleAuth.ts` before changing Workspace features. If adding/removing scopes, follow the `workspace-integration` skill (`set_up_oauth` / `remove_oauth`) before modifying code.
   - `gmail.readonly` already covers `messages.list`, `messages.get`, `labels.list`, and `labels.get`; `gmail.compose` covers saving Gmail Drafts.
3. **Human-in-the-Loop & Folder Guardrails**:
   - **Gmail**: Agents NEVER send emails directly. Outbound replies are staged via `stage_decision_packet` (`ApprovalItem`) and only saved as a real Gmail Draft via `POST /api/workspace/create-draft` when the CHO clicks Approve.
   - **Calendar**: Mutating Calendar endpoints (`POST/PATCH/DELETE /api/workspace/calendar/events*`) require `settings.calendarWriteAccess === true` AND user confirmation in UI / staged approval.
   - **Google Drive Working Folder Fence**: Mutating Drive operations are restricted to items verified inside `settings.driveWorkingFolder` via `isItemInsideWorkingFolder` (`server/villageEngine.ts`). External Drive files are strictly read-only.
   - **Gmail Multi-Label Union (`OR`) Rule**: Passing multiple `labelIds` to a single Gmail `users.messages.list` request performs an **`AND`** filter. To monitor `INBOX` + custom labels together, query each source in parallel and round-robin deduplicate message IDs (`readGmailMessages` & `fetchWorkspaceBriefing` in `server/villageEngine.ts`).

### D. Node / `tsx` Shared Module Constraint
- `server.ts` imports `./src/types/village.ts`, `./src/lib/villagePersistence.ts`, `./src/lib/agentVoices.ts`, `./src/data/initialAgents.ts`, and `./src/data/knowledgeBase.ts` directly under Node/`tsx`.
- Keep `.ts` extensions on relative server imports where used, and **never** import Vite-only assets (`.jpg`, `.png`, `.css`) or `window`/`document`-at-module-top-level inside any shared module imported by `server.ts`.

### E. UI & Design System Rules
- **3-Zone Top Bar Contract (`src/App.tsx`)**: Zone 1 = single-line Guildhaven wordmark; Zone 2 = 5 concise single-line text nav buttons (`Directory`, `Workspace`, `Knowledge`, `Reports`, `Approvals`); Zone 3 = `Settings` + Google Auth button. Do not add extra buttons, mode switches, or subtitles to `<header>`.
- **Zero Static Pill Chips**: Render informational metadata (timestamps, email labels, departments, read states) as clean inline text separated by `·` rather than rounded pill badges or `border-l-4` accent stripes. Interactive filters/segmented tabs must be real `<button>` elements with `whitespace-nowrap shrink-0`.
- **Tabular Figures**: Apply `tabular-nums` (and `font-mono` where appropriate) on all counters, unread counts, timestamps, and analytics metrics.

---

## 4. Playbooks for Common Changes

### Playbook 1: Adding a New Persisted Setting (`VillageSettings`)
1. Add the field to `interface VillageSettings` in `src/types/village.ts`.
2. Add the default value to `DEFAULT_VILLAGE_SETTINGS`, normalize it inside `normalizeVillageSettings()`, and update `hasMeaningfulState()` in `src/lib/villagePersistence.ts`.
3. Read via `settings.<field>` (or `settingsRef.current.<field>` inside async callbacks) and update via `updateVillageSettings((prev) => ({ ...prev, <field>: nextValue }))` in `src/App.tsx` / `SettingsDrawer.tsx`.

### Playbook 2: Adding a Google Workspace Endpoint & UI Action
1. Implement the Google REST helper in `server/villageEngine.ts` accepting `bearerHeader: string`.
2. Expose the Express route under `/api/workspace/...` in `server.ts` validating `req.headers.authorization?.startsWith('Bearer ')` (and enforcing guardrails if mutating).
3. Add a `useCallback` client wrapper in `src/App.tsx` (above `if (screen === 'TITLE_MENU')`) using `resolveFreshWorkspaceToken()` + automatic `401/403` `requestWorkspaceConsent()` retry, then pass it as a prop to `WorkspaceHubDrawer` / `SettingsDrawer`.
4. Run `compile_applet` + `lint_applet`, then `restart_dev_server`.

### Playbook 3: Adding an Agent Tool to the Orchestrator
1. In `server/orchestrator.ts`, add `build<ToolName>Declaration(): FunctionDeclaration` and `execute<ToolName>Tool(...)`.
2. Register the declaration in the `functionDeclarations` array for the relevant turns (`runCollaboratorTurn`, coordinating Director turn in `runOrchestratedVillageTask`, and `runOrchestratedAgentChat`) and wire its `call.name === '...'` branch in the tool-call loop.
3. Ensure read-only tools stay side-effect-free and any external mutation routes through `stage_decision_packet` + `enforceGovernanceTruthfulness`.
