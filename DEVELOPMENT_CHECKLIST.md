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
- [x] Bad transforms are rejected or clamped (non-positive dimensions rejected in canonical schema).
- [ ] Full backend scene save/reload via API (deferred to Phase 2; canonical JSON schema serialization and validation tested in frontend).
- [x] UI provides clear empty/loading/error states.

## API and persistence

- [ ] All private resources enforce ownership.
- [ ] Serializers validate input and return useful error messages.
- [ ] Migrations apply cleanly from an empty development database.
- [ ] Relevant Django tests pass.
- [ ] Frontend TypeScript/build checks pass.

## Catalogue and budget

- [ ] Asset source/licence and dimensions are recorded.
- [ ] Missing prices are not invented.
- [ ] Budget totals are computed by deterministic backend code.
- [ ] Room boundary and basic collision constraints are checked where implemented.

## AI agent and photo analysis

- [ ] LLM provider is behind an adapter.
- [ ] Mock provider is available for development/tests.
- [ ] Tool names and parameters are allowlisted and validated.
- [ ] No arbitrary SQL, Python, shell, or unrestricted network tool is exposed.
- [ ] Multi-object changes are previewed and require approval.
- [ ] Errors, timeouts, uncertainty, and invalid proposals are handled.
- [ ] Provider secrets stay in backend environment variables.

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
