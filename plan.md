# RoomGenie AI — Implementation Plan

**Project type:** Solo B.Tech CSE project / research-oriented prototype  
**Working title:** *RoomGenie AI: An AI-Agent-Assisted Interior Design System with Interactive 3D Furniture Placement, Photo-to-3D Reconstruction, and Augmented Reality Visualization*  
**Core stack:** React + TypeScript + Vite, Three.js / React Three Fiber, Django REST Framework, PostgreSQL  
**Primary currency:** INR (₹)

**Selected stack and model baseline:** See [`MODEL_AND_TECH_DECISIONS.md`](MODEL_AND_TECH_DECISIONS.md). The coding agent should use those decisions and verify current compatibility rather than asking the developer to reselect the stack. Use mock providers until the developer explicitly enables live APIs.

## 1. Product vision

RoomGenie AI helps a user explore interior-design options by combining room-photo analysis, an AI design assistant, a movable 3D furniture catalogue, budget-aware suggestions, optional photo-to-3D furniture approximation, and a later AR preview.

The user remains in control. The AI proposes structured, reviewable operations; the application validates them; the user approves them; only then are changes applied to the design.

## 2. Scope rules

### Must-have core

1. Create a room using explicit dimensions.
2. Load furniture assets in GLB/GLTF format.
3. Select, move, rotate, resize, replace, and remove furniture.
4. Save and reload a design without losing object transforms.
5. Search a curated furniture catalogue by type, style, dimensions, and price.
6. Calculate the total price in backend/application code.
7. Provide an AI chat interface that calls restricted design tools and previews proposed changes.
8. Analyze a room image and show understandable, editable observations.

### Advanced features

9. Photo-to-3D reconstruction through a replaceable provider/service, with catalogue fallback.
10. Real-world AR placement on a compatible mobile device. Start with placing one asset on a detected floor; do not promise automatic reconstruction/alignment of an entire room.

### Explicitly out of scope for the first release

- Training a foundation model from scratch.
- Guaranteed exact 3D replicas from one photo.
- Professional-grade floor-plan reconstruction from a single image.
- Automatic detection of load-bearing walls or certified safety checks.
- Payments, shopping checkout, real supplier inventory, or price guarantees.
- Multi-agent orchestration, microservices, Kubernetes, and premature cloud complexity.

## 3. Build phases and acceptance criteria

### Phase 0 — Setup and scaffold

Tasks:
- Confirm local tools and device availability using `HUMAN_SETUP.md`.
- Create `frontend/` (React, TypeScript, Vite) and `backend/` (Django, Django REST Framework).
- Add PostgreSQL settings through environment variables and provide `.env.example` only.
- Add health/status endpoints and a minimal frontend shell.
- Add README commands for setup and run.

Acceptance criteria:
- Frontend starts using documented commands.
- Backend starts using documented commands.
- Backend health endpoint returns JSON.
- No real credentials are committed.
- Dependency versions are verified and pinned/locked according to the package manager used.

### Phase 1 — Interactive 3D room editor (highest priority)

Tasks:
- Create room dimensions, floor, walls, grid, camera controls, lighting, and a reset-camera action.
- Load a small set of legally usable local sample GLB/GLTF furniture assets.
- Add object selection, move, rotate, scale, delete, duplicate, and basic colour/material changes.
- Add a properties panel displaying selected asset dimensions and transforms.
- Store editor state in a clearly typed scene model.

Acceptance criteria:
- A user can create a room and manipulate at least three furniture objects.
- Invalid transforms (NaN, infinity, negative dimensions, extreme values) are rejected or clamped.
- The editor remains usable after adding/removing objects.
- Document keyboard and mouse/touch controls.

### Phase 2 — Django API and persistence

Tasks:
- Add models and migrations for Room, FurnitureAsset, Design, and furniture placements/scene state.
- Add authentication only to the level needed for private user projects; ownership checks are mandatory.
- Add CRUD endpoints for rooms, catalogue items, and designs.
- Add frontend API client and save/load state.

Acceptance criteria:
- Saved scene reloads with the same object IDs, asset IDs, positions, rotations, scales, and material selections.
- Users cannot read or edit another user's private designs.
- API errors are structured and understandable.
- Django tests cover ownership checks and design serialization.

### Phase 3 — Furniture catalogue and budget

Tasks:
- Create seed/sample catalogue data and asset metadata: category, style tags, dimensions in metres, price in INR, model URL, thumbnail, licence/source notes.
- Implement search/filtering and dimensions compatibility.
- Add budget estimate endpoint and client-side total display, with server-side authoritative calculations.
- Add simple rules for obvious constraint violations such as furniture exceeding room boundaries.

Acceptance criteria:
- Search works by category, style, and maximum price.
- Budget total is calculated by deterministic application code.
- Unknown prices are labelled unknown, not invented.
- Sample asset sources/licences are recorded.

### Phase 4 — AI interior-design agent

Tasks:
- Build an adapter interface for the LLM provider; API credentials remain backend-only.
- Define typed tool functions: `analyze_room`, `search_furniture`, `propose_layout`, `move_object`, `replace_furniture`, `estimate_budget`.
- Ask the model for a structured proposal; validate it with Django and application rules.
- Present a preview/diff and require explicit user approval before applying multi-object changes.
- Log request IDs, tool names, validation results, and status; avoid logging secrets or unnecessary private image content.
- Implement undo/revert for design changes if feasible.

Acceptance criteria:
- The model cannot run arbitrary code, SQL, or arbitrary HTTP requests.
- Invalid or unknown object IDs are rejected.
- Agent-proposed actions are previewed before application.
- Budget calculations come from backend code, not LLM arithmetic.
- A deterministic mock provider is available for development/tests when API access is unavailable.

### Phase 5 — Room photo analysis

Tasks:
- Implement private image upload and file validation (file type, size, and storage rules).
- Use a vision provider to return structured observations: likely room type, visible objects, broad style/colour descriptions, uncertainty, and recommendations.
- Show results as editable suggestions; ask the user to enter/confirm room dimensions.
- Never infer exact dimensions from a normal photo unless a justified measurement/reference method is available.

Acceptance criteria:
- Analysis failures and provider timeouts are visible and recoverable.
- The UI distinguishes observations from uncertain AI guesses.
- User can correct object categories and preferences.
- Test using a small, permission-cleared set of images.

### Phase 6 — Photo-to-3D furniture approximation

Tasks:
- Create a provider interface for image-to-3D, keeping service/model choice replaceable.
- Add a reconstruction job model with `queued`, `processing`, `completed`, and `failed` states.
- Support multi-view image input where possible; collect reference dimensions if known.
- Convert/validate supported results to GLB/GLTF, generate a preview, and let the user adjust dimensions/material.
- Add a catalogue fallback when generation fails or the result is poor.

Acceptance criteria:
- At least one example workflow succeeds end-to-end or the provider integration is clearly stubbed with a working fallback.
- Failed jobs do not break the main editor.
- Generated output is labelled “approximate” until validated.
- Record provider, processing status, file size, and error category without exposing secrets.

### Phase 7 — Real-world AR placement

Tasks:
- Confirm target mobile device and AR capability before implementation.
- First test browser-based AR/asset handoff on the chosen target device.
- If browser support is inadequate, build a small Unity + AR Foundation Android companion as a separate module.
- Place one furniture asset on a detected horizontal surface; enable manual move, rotate, and scale.
- Reuse GLB/GLTF assets where supported and document any required format conversion.

Acceptance criteria:
- Demonstrate placement and manual adjustment on one documented compatible device.
- Explain limitations of tracking, scale estimation, and lighting.
- AR work does not break the web editor or become a dependency for core tests.

### Phase 8 — Research, testing, and delivery

Tasks:
- Follow `RESEARCH_PLAN.md`.
- Collect consented, minimal experimental data.
- Evaluate baseline manual design vs AI-assisted design and evaluate reconstruction separately.
- Report negative and inconclusive findings honestly.
- Prepare screenshots, architecture diagram, demo, README, and report.

Acceptance criteria:
- Research question, measures, method, sample description, results, limitations, and ethics/privacy notes are documented.
- Results are reproducible from a documented dataset/export where privacy permits.
- No result or accuracy claim is fabricated.

## 4. Agent execution workflow

Antigravity should perform safe local setup, dependency installation, migrations, automated tests, linting, type checks, builds, and documentation updates itself wherever permissions and installed tools allow. It should continue independent work if an external provider key or a system dependency is unavailable. Human-only blockers include privileged OS installs, credentials/account creation, approval for paid API use, physical device testing, and research participant consent. After each milestone, the agent must report exact commands and outcomes, list only required human actions, and wait for the developer to review before beginning a materially new feature phase.

## 5. Suggested 14-week calendar

| Week | Goal |
|---|---|
| 1 | Environment, scaffold, architecture decisions |
| 2–4 | 3D editor and sample assets |
| 5 | Django persistence and save/load |
| 6 | Catalogue, filters, budget validation |
| 7–8 | AI agent with restricted tools and approval flow |
| 9 | Room-photo analysis |
| 10–11 | Photo-to-3D integration/fallback |
| 12 | AR prototype on one target device |
| 13 | User study and analysis |
| 14 | Bug fixes, report, demo, repository cleanup |

This is an ambitious plan. If behind schedule, finish Phases 1–5 and the research evaluation; treat Phases 6–7 as optional extensions.

## 6. Definition of Done for every phase

A phase is not complete merely because code was generated. It is complete only when:

- The changed feature starts and works locally.
- Relevant automated tests pass, or missing tests are explicitly explained.
- Lint/type checks pass where configured.
- No secrets or private data are committed.
- Setup/API docs are updated.
- Acceptance criteria have been checked manually.
- The agent summarizes changed files, commands run, results, known issues, and the next recommended task.

## 7. Progress tracker

- [x] Phase 0 — Setup and scaffold (scaffold, health endpoint, tests, environment checks verified)
- [x] Phase 1 — Interactive 3D room editor (Three.js/R3F room canvas, lighting, orbit controls, catalogue, CRUD, transforms, bounds clamping, properties panel)
- [x] Phase 2 — Django API and persistence (PostgreSQL models, token auth, canonical scene JSON schema, design CRUD endpoints)
- [x] Phase 3 — Furniture catalogue and budget (authoritative integer paise math, 10 CC0 architectural models, boundary containment, REST endpoints)
- [x] Phase 4 — AI design agent (2-phase proposal/approval workflow, Gemini flash adapter & mock, strict tool validation, collision checks)
- [x] Phase 5 — Room photo analysis (Gemini flash vision adapter & mock, structured observations, catalogue remapping, frontend modal)
- [x] Phase 6 — Photo-to-3D approximation (Tripo adapter & mock, asynchronous job lifecycle, atomic claiming, strict GLB validation, authenticated streaming, lifecycle E2E verified)
- [ ] Phase 7 — AR placement (Physical device test verified on realme Narzo 70 Turbo 5G; reticle tracking and instant repositioning optimized in commit 874bb98; pending final code review)
- [ ] Phase 8 — Research and delivery
