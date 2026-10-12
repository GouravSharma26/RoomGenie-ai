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
- [x] Relevant Django tests pass (70/70 tests pass across accounts, rooms, furniture, designs, and ai_agent, including catalogue filtering, integer paise budget calculation, anonymous/owner/cross-user access controls, stale proposal rejection, and containment enforcement).
- [x] Frontend TypeScript/build checks pass (0 type errors, 0 lint warnings, 28 Vitest tests pass, production bundle built).

## Catalogue and budget

- [x] Asset source/licence and dimensions are recorded (10 architectural models across seating, tables, storage, beds, decor with SI dimensions in metres, CC0 1.0 Universal license, and verifiable provenance in ASSET_LICENSES.md).
- [x] Missing prices are not invented (explicit nullable `price_paise=None`, unpriced custom divider labelled as "Price on Request", flagged with `has_unknown_prices`).
- [x] Budget totals are computed by deterministic backend code (authoritative integer paise calculation in `apps/furniture/budget.py` via `POST /api/v1/budgets/estimate/`; category subtotals and itemized breakdowns without floating-point math).
- [x] Room boundary and basic collision constraints are checked where implemented (3D transformed room envelope containment calculated during budget estimation).

## AI agent and photo analysis

- [x] LLM provider is behind an adapter (`BaseDesignLLMAdapter` interface with configurable `GeminiDesignLLMAdapter` targeting `gemini-3.8-flash` and `MockDesignLLMAdapter`).
- [x] Mock provider is available for development/tests (deterministic offline `MockDesignLLMAdapter` active by default in test suite and development).
- [x] Tool names and parameters are allowlisted and validated (`ALLOWED_ACTION_TYPES` strictly restricted to `add_furniture`, `move_object`, `replace_furniture`, `remove_object`, `set_material`, `clear_room`).
- [x] No arbitrary SQL, Python, shell, or unrestricted network tool is exposed (verified by automated regression test `test_tools_reject_arbitrary_or_unlisted_actions`).
- [x] Multi-object changes are previewed and require approval (Two-phase approval workflow: `/prompt/` simulates and creates `AgentRun(status='proposed')` with candidate diff; design mutated only upon explicit user approval via `/apply/`; proposals bound to base scene snapshots with HTTP 409 stale conflict rejection and canonical scene validation before persistence; containment violations strictly block approval).
- [x] Errors, timeouts, uncertainty, and invalid proposals are handled (15s network timeout on Gemini API, validation errors/warnings surfaced in diff, mock fallback).
- [x] Provider secrets stay in backend environment variables (`GEMINI_API_KEY` accessed solely on Django backend; never exposed to browser).

## Photo-to-3D and AR

- [ ] Reconstruction has job state tracking and a catalogue fallback.
- [ ] Approximate outputs are clearly labelled.
- [ ] Generated assets are checked for supported format, size, and usable dimensions.
- [ ] Target AR device and operating-system version are documented.
- [ ] AR placement has been manually tested on the target device.
- [ ] Unsupported devices receive a clear fallback message.

## Release and research

- [ ] No credentials, private photos, local database dumps, or private participant data are committed.
- [ ] Research task, measures, consent procedure, and limitations are documented.
- [ ] Results are based on actual collected data, not simulated claims.
- [ ] Screenshots/demo match the implemented version.
- [ ] README describes current features and known limitations accurately.
