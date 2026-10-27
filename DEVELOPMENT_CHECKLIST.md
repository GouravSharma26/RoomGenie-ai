# RoomGenie AI — Developer Checklist

Use this after every milestone. Keep it honest: only tick items you personally verified or Antigravity verified with actual command output.

## Repository and environment

- [x] `AGENTS.md` is at repository root and has been loaded by Antigravity.
- [x] `.env` is ignored by Git and `.env.example` has placeholders only.
- [x] Frontend install/start/build commands work on the target computer.
- [x] Backend install/check/run commands work on the target computer.
- [x] PostgreSQL connection and migrations verified (PostgreSQL 17 on Docker loopback 127.0.0.1:5433; core auth/admin/session migrations applied).
- [x] Dependency lockfile and migration files are committed.

## 3D editor

- [x] Room dimensions use metres and coordinate conventions are documented.
- [x] At least three legal sample GLB/GLTF assets provided with verifiable CC0 attribution (3 GLB models in public/models/ + 2 procedural models; see ASSET_LICENSES.md).
- [x] Add/select/move/rotate/scale/delete/duplicate actions work.
- [x] Camera controls work without preventing furniture selection.
- [x] Bad transforms are rejected or clamped (transformed 3D oriented bounding box footprints clamped in editor and validated on backend).
- [x] Full backend scene save/reload via API (Phase 2 implemented with DRF /api/v1/designs/ and PostgreSQL 17 persistence).
- [x] UI provides clear empty/loading/error states.

## API and persistence

- [x] All private resources enforce ownership (strictly isolated by request.user; cross-user queries return 404; demo auth gated behind `ALLOW_DEMO_AUTH = DEBUG and ...` configuration and rejected with 403 in production).
- [x] Serializers validate input and return useful error messages (authoritative canonical schema validation for units, bounds, dimensions, transforms, and full 3D rotated footprint containment).
- [x] Relevant Django tests pass (241/241 tests pass across accounts, rooms, furniture, designs, ai_agent, and evaluation, including catalogue filtering, integer paise budget calculation, anonymous/owner/cross-user access controls, stale proposal rejection, containment enforcement, atomic select_for_update concurrency tests, room-photo upload validation, early HTTP 413 body size rejection, total pixel caps, Pillow decompression-bomb hardening, orphan-free rollback, safe management command cleanup, strict hex/catalogue validation, bounding boxes, fallback auditing, explicit provider mode configuration, room-photo vision analysis with mock/gemini adapters, photo-to-3D glTF 2.0 binary verification, capability session secrets, periodic revision checkpoints, inactivity interval tracking, strict Likert SUS validation rejecting booleans and fractional ratings, independent duplicate key validation, and dataset CSV/JSON export commands).
- [x] Frontend TypeScript/build checks pass (0 type errors, 0 lint warnings, 143 Vitest tests pass across 14 test suites covering editor, persistence, budget, AI agent, room-photo vision analysis, photo-to-3D, WebXR AR session, AR service, evaluation telemetry, and SUS scoring, production bundle built).

## Catalogue and budget

- [x] Asset source/licence and dimensions are recorded (10 architectural models across seating, tables, storage, beds, decor with SI dimensions in metres, CC0 1.0 Universal license, and verifiable provenance in ASSET_LICENSES.md).
- [x] Missing prices are not invented (explicit nullable `price_paise=None`, unpriced custom divider labelled as "Price on Request", flagged with `has_unknown_prices`).
- [x] Budget totals are computed by deterministic backend code (authoritative integer paise calculation in `apps/furniture/budget.py` via `POST /api/v1/budgets/estimate/`; category subtotals and itemized breakdowns without floating-point math).
- [x] Room boundary and basic collision constraints are checked where implemented (3D transformed room envelope containment calculated during budget estimation).

## AI agent and photo analysis

- [x] LLM provider is behind an adapter (`BaseDesignLLMAdapter` interface with configurable `GeminiDesignLLMAdapter` targeting `gemini-3.8-flash` and `MockDesignLLMAdapter`).
- [x] Room vision analysis provider is behind an adapter (`BaseRoomVisionAdapter` interface with configurable `GeminiRoomVisionAdapter` targeting `gemini-3.8-flash` and deterministic `MockRoomVisionAdapter`, with explicit mode validation rejecting unsupported configurations).
- [x] Mock provider is available for development/tests (deterministic offline `MockDesignLLMAdapter` and `MockRoomVisionAdapter` active by default in test suite and development).
- [x] Tool names and parameters are allowlisted and validated (`ALLOWED_ACTION_TYPES` strictly restricted to `add_furniture`, `move_object`, `replace_furniture`, `remove_object`, `set_material`, `clear_room`).
- [x] No arbitrary SQL, Python, shell, or unrestricted network tool is exposed (verified by automated regression test `test_tools_reject_arbitrary_or_unlisted_actions`).
- [x] Multi-object changes are previewed and require approval (Two-phase approval workflow: `/prompt/` simulates and creates `AgentRun(status='proposed')` with candidate diff; design mutated only upon explicit user approval via `/apply/`; proposals bound to base scene snapshots with HTTP 409 stale conflict rejection and canonical scene validation before persistence; containment violations strictly block approval).
- [x] Room photo analysis outputs structured observations without silently modifying 3D scenes (detected furniture mapped to catalogue, approximate layout, architectural features, colors, confidence, and explicit uncertainty notes; scene state and room dimensions remain immutable until explicit user review).
- [x] Frontend photo-upload & vision analysis UI flow (`RoomPhotoVisionModal` with drag-and-drop upload, scanning progress, structured observation display, hex swatches, suggestion editing/rejection, catalogue 3D model remapping, fallback auditing, and explicit confirmation before applying changes to 3D room canvas).
- [x] Errors, timeouts, uncertainty, and invalid proposals are handled (15s network timeout on Gemini API, validation errors/warnings surfaced in diff, mock fallback with sanitized fallback tracking, malformed vision outputs rejected).
- [x] Provider secrets stay in backend environment variables (`GEMINI_API_KEY` accessed solely on Django backend; never exposed to browser).

## Photo-to-3D and AR

- [x] Reconstruction has job state tracking and a catalogue fallback (Phase 6 complete: FurnitureReconstructionJob with queued/processing/completed/failed state machine, select_for_update atomic claiming, deterministic mock engine and Tripo adapter, and canonical catalogue fallback matching).
- [x] Approximate outputs are clearly labelled (Prominent "Approximate AI Reconstruction" notice badge in PhotoTo3DModal and review viewport; reference dimensions validated and user-editable).
- [x] Generated assets are checked for supported format, size, and usable dimensions (GLBValidator strictly validates Khronos glTF 2.0 chunk headers, bin buffer views, accessor alignments, finite positive bounding boxes, and maximum byte size limits).
- [x] Target AR device and operating-system version are documented (Documented in `docs/AR_DEVICE_SPECIFICATION.md`: Reference Android baseline Google Pixel 6-8 and Samsung Galaxy S21-24 running Android 10+ with Chrome 90+ and ARCore; iOS 15+ Quick Look secondary fallback).
- [x] AR placement has been manually tested on the target device (Verified on realme Narzo 70 Turbo 5G RMX5003; camera passthrough, plane detection, tap-to-place, instant repositioning, capped 1.75x DPR, and immediate initialization scanning HUD verified in docs/MANUAL_AR_TESTING_PROTOCOL.md; Phase 7 core AR implementation and verification complete).
- [x] Unsupported devices receive a clear fallback message (Automated diagnostic detection in `arService.ts` and `ArPlacementModal.tsx` surfaces desktop banner, QR code mobile handoff launcher, direct session link copy, Google Scene Viewer Android intent fallback, and detailed physical limitations for tracking, scale, and lighting).

## Release and research

- [x] No credentials, private photos, local database dumps, or private participant data are committed (Verified: `.env` is gitignored; ephemeral photos expire and clean up automatically; telemetry disabled by default).
- [x] Research task, measures, consent procedure, and limitations are documented (Documented in `docs/RESEARCH_PROTOCOL_AND_TASKS.md`, `docs/THESIS_SYNTHESIS_AND_REPORT_OUTLINE.md`, `docs/EVALUATION_DATASET_AND_EXPORT_GUIDE.md`, `docs/RESEARCH_DECISION_REGISTER.md`, `docs/STATISTICAL_ANALYSIS_PLAN.md`, `docs/RESEARCH_DATA_QUALITY_CHECKLIST.md`, `docs/ETHICS_AND_DATA_GOVERNANCE_GATE.md`, and `docs/SUPERVISOR_REVIEW_PACKAGE.md`).
- [ ] Results are based on actual collected data, not simulated claims (Software engineering verification, strict SUS validation, and export command verified complete; human participant data collection strictly paused pending formal institutional ethics board approval).
- [x] Screenshots/demo match the implemented version (Verified in `docs/SCREENSHOTS.md` and `docs/MANUAL_AR_TESTING_PROTOCOL.md`).
- [x] README describes current features and known limitations accurately.
