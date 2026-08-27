# Personal Hermy HQ Rebuild Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace the inherited/demo Hermy HQ configuration with Turbo’s real Hermes team, repair Garden, and make the dashboard a truthful personal operating cockpit for trading, AI/OFM, product, content, music, and system health.

**Architecture:** Make PostgreSQL/DataStore the server-side read model for personal dashboard configuration while the local bridge remains the source for live Hermes profiles, tasks, health, and memory. Remove fictional/demo fallbacks and render explicit unavailable/empty states when evidence is absent. Preserve the current dark visual system but reshape hierarchy and copy around Turbo’s actual workflows.

**Tech Stack:** Next.js 16, React 19, TypeScript, Prisma/PostgreSQL (Supabase), Hermes bridge, launchd, Vercel Preview.

---

## Confirmed findings

- `/api/agents` hardcodes fictional agents `Max`, `Sage`, `Knox`, `Nova`, and `Pixel`.
- Turbo’s real Hermes roster is already discoverable through `hermes profile list` (default plus trading, research, builder, content, OFM, canon and QA profiles).
- `/garden` expects `{ version, lastUpdated, plants }` from an external JsonBlob tied to “Marwa”; malformed/error JSON becomes `Unexpected data format`.
- `/api/home` contains demo Kanban tasks, fictional agent names, `yourhandle`, generic goals, and hardcoded P&L values (`67.22`). These must not appear as real operational data.
- The current dashboard is visually competent but generic and oriented around someone else’s workflows.

## Personal product direction

### Information architecture

1. **Today / Command:** approvals, active tasks, blocked items, bridge/agent health.
2. **Trading Systems:** paper/live separation, strategy qualification, Donchian, Polymarket research, risk gates; never show fake balances/P&L.
3. **Builds & AI Lab:** active repos, deployment health, recent verified milestones.
4. **Content & OFM:** editorial pipeline, QA/compliance status, scripts and production queue.
5. **Music / AÜGMENT:** active identity/workstream card without face-cam assumptions.
6. **Memory & Decisions:** latest durable entries, pending approvals, conflicts.

### Visual direction

- Keep the existing dark shell, but replace “generic SaaS tiles” with a **personal command-table** hierarchy.
- Palette: Dungeon Black `#090A0C`, Graphite `#14171C`, Signal Blue `#68A7FF`, Risk Amber `#F0B35A`, Verified Mint `#59D6A2`, Critical Coral `#FF7272`.
- Typography: retain the current production-safe fonts; strengthen utility/data hierarchy instead of adding decorative webfonts.
- Signature element: a compact **Turbo Operating Strip** showing current mode (Iko morning / Builds afternoon / Music), approvals, agent health, and latest verified event.
- No fake sparklines, placeholder handles, demo tasks, fabricated P&L, or “24/7” claims unsupported by health evidence.

---

## Task 1 — Add contract tests for truthful personal read models

**Files:**
- Create: `src/lib/personal-dashboard.test.ts`
- Modify: `src/lib/personal-dashboard.ts` (new)
- Test: `src/lib/personal-dashboard.test.ts`

**Steps:**
1. Write failing tests for agent profile mapping, grouping, status normalization, and unavailable-value handling.
2. Write failing tests proving demo/fake financial data cannot enter the dashboard response.
3. Implement typed schemas/parsers for personal agents, Garden data, dashboard sections, freshness and source labels.
4. Run focused tests and confirm all new cases pass.

## Task 2 — Replace fictional Agents with Turbo’s real Hermes roster

**Files:**
- Modify: `hermes-bridge/bridge.mjs`
- Modify: `src/app/api/agents/route.ts`
- Modify: `src/app/agents/page.tsx`
- Modify: `src/components/OfficeView.tsx`
- Modify: `src/app/api/agent-chat/route.ts`
- Test: `src/lib/personal-dashboard.test.ts`

**Approach:**
- Extend the bridge to mirror sanitized `hermes profile list` output into `DataStore` under a namespaced key.
- Map actual profiles into pods:
  - Command: `default`
  - Trading: `tradingmanager`, `tradingrisk`, `quantresearch`, `backtestvalidator`, `polymarketstructure`
  - Build/AI: `builder`, `ailab`, `opsbrain`
  - Content: `contentmanager`, `contentqa`, `editorialstrategy`, `scriptcopy`
  - OFM: `ofmmanager`, `ofmeditorial`, `ofmcompliance`
  - Canon: `brandcanon`, `personacanon`
- Use profile IDs as immutable IDs; human-readable labels/roles live in one typed roster config.
- Remove Max/Sage/Knox/Nova/Pixel assumptions from chat, org chart, colors and copy.
- Show `offline/unknown` honestly when no heartbeat exists; do not turn “configured” into “online.”
- Keep chat disabled or clearly unavailable for profiles that lack a routed runtime instead of pretending.

## Task 3 — Repair Garden and make it Turbo-owned

**Files:**
- Modify: `src/app/api/garden/route.ts`
- Modify: `src/app/garden/page.tsx`
- Test: `src/lib/personal-dashboard.test.ts`

**Approach:**
- Remove the hardcoded Marwa JsonBlob dependency and copy.
- Store Garden state in PostgreSQL `DataStore` under a Turbo-specific key.
- Validate reads and writes with the Garden schema.
- Bootstrap an empty valid `{ version, lastUpdated, plants: [] }` state.
- Return explicit structured API errors; add retry UI and actionable empty state.
- Keep add/remove plant behavior, but make writes authenticated and fail visibly if persistence fails.

## Task 4 — Build the personal dashboard read model

**Files:**
- Create: `src/lib/personal-dashboard.ts`
- Modify: `src/app/api/home/route.ts`
- Modify: `src/app/page.tsx`
- Possibly modify: `src/app/api/score/route.ts`

**Approach:**
- Remove `HERMES_KANBAN_DEMO_TASKS`, fictional board names and hardcoded trading values.
- Return `{ value, status, source, updatedAt }` for operational metrics.
- Build sections around approvals, real Hermes board, real agent/profile health, memory activity, trading-system status, builds, content/OFM and AÜGMENT.
- Render `Unavailable`, `Not configured`, `No evidence yet`, or `Stale` rather than zero/fake values.
- Personalize greeting, labels, goals and time context for Turbo/Europe-Paris.
- Preserve privacy: no secrets, emails, wallet secrets or private prompts in the browser payload.

## Task 5 — Implement the visual redesign

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/agents/page.tsx`
- Modify: `src/app/garden/page.tsx`
- Modify: shared components under `src/components/`
- Modify only if necessary: `src/app/globals.css`

**Steps:**
1. Implement the Turbo Operating Strip.
2. Recompose the dashboard into Command, Trading, Builds/AI, Content/OFM, Music/AÜGMENT and Memory zones.
3. Make Agents pod-based rather than a fictional office hierarchy.
4. Add responsive mobile/tablet layouts, keyboard focus and reduced-motion support.
5. Capture desktop and mobile screenshots and critique against the brief; remove one unnecessary decorative element.

## Task 6 — Runtime QA and regression tests

**Validation:**
- `npm run test:memory`
- new personal dashboard tests
- `npx tsc --noEmit`
- `npm run build`
- local browser checks for `/`, `/agents`, `/garden`, `/hermes`, `/memory-wiki`
- console-error sweep after each route
- API validation for `/api/home`, `/api/agents`, `/api/garden`
- verify no demo names/values remain in rendered production routes
- verify Garden persists an add/remove round trip without external JsonBlob
- verify vault Git remains clean and bridge launchd remains healthy

## Task 7 — Independent review and deployment

1. Dispatch independent spec-compliance review.
2. Dispatch independent security/code-quality review.
3. Fix all blocking findings and rerun the full validation matrix.
4. Commit verified changes.
5. Deploy a new Vercel Preview explicitly.
6. Verify the Preview in a real browser after authentication.
7. Do **not** update/promote Production without Turbo’s separate approval.

---

## Things that cannot be honestly completed without external data

These are not blockers for the redesign; they will render truthful setup/empty states:

- Real X metrics require the correct X handle/token or existing ingested data.
- Real YouTube metrics require the correct channel ID/API key or ingested data.
- Trading balances/P&L require approved read-only sources; no wallet/execution secrets will be requested or inferred.
- AÜGMENT content needs future project data if none exists in Hermy HQ yet.
- Agent “online” status requires an actual heartbeat/runtime signal; configured profiles alone are not proof.

No other user intervention is required for code, tests, local deployment, Supabase schema/read-model work, bridge changes, QA, Git commit, or a new Vercel Preview. Production remains approval-gated.

## Acceptance criteria

- Agents page contains Turbo’s real profile roster and no fictional inherited roster.
- Garden loads a valid Turbo-owned state and never shows the current format error.
- Dashboard content and hierarchy are specific to Turbo’s actual workflows.
- No fake operational or financial data is rendered.
- All routes pass local and Preview browser QA with no blocking console errors.
- Tests, typecheck and production build pass.
- Existing memory, bridge and launchd behavior remain healthy.
