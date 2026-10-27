# RoomGenie AI — Evaluation Dataset & Export Methodology Guide

**Document Status:** Production Export Reference  
**Applies To:** `backend/apps/evaluation/management/commands/export_evaluation_dataset.py`  
**Related Documents:** [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_PROTOCOL_AND_TASKS.md), [`backend/apps/evaluation/exports.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/exports.py)

---

## 1. Overview

The RoomGenie AI evaluation subsystem provides deterministic, reproducible data export capabilities for empirical research. The management command `export_evaluation_dataset` extracts all persisted `EvaluationSession` records from the PostgreSQL database into standardized CSV and JSON formats, designed for direct ingestion into statistical software (R, Python `pandas`/`statsmodels`, SPSS, JASP, Jamovi).

---

## 2. Command Usage & Syntax

```powershell
# From the backend directory with active virtual environment:
cd backend

# 1. Export all records to standard output in JSON format (default)
python manage.py export_evaluation_dataset

# 2. Export all records to a JSON file
python manage.py export_evaluation_dataset --format json --output ../data/evaluation_export.json

# 3. Export all records to a CSV file
python manage.py export_evaluation_dataset --format csv --output ../data/evaluation_export.csv

# 4. Filter exports by experimental condition ('manual' or 'ai_assisted')
python manage.py export_evaluation_dataset --format csv --condition ai_assisted --output ../data/ai_assisted_only.csv

# 5. Filter exports by task ('living_room' or 'home_study')
python manage.py export_evaluation_dataset --format csv --task living_room --output ../data/living_room_only.csv

# 6. Filter exports by session status ('completed', 'aborted', 'in_progress')
python manage.py export_evaluation_dataset --format csv --status completed --output ../data/completed_sessions.csv
```

### Supported CLI Flags

| Flag | Type | Allowed Values | Default | Description |
| :--- | :---: | :--- | :---: | :--- |
| `--format` | string | `json`, `csv` | `json` | Primary serialization format. |
| `--output` | string | File path | `None` (stdout) | Destination file path. Automatically creates parent directories if they do not exist. |
| `--condition` | string | `manual`, `ai_assisted` | `None` (all) | Restricts export to a specific study condition. |
| `--task` | string | `living_room`, `home_study` | `None` (all) | Restricts export to a specific experimental task. |
| `--status` | string | `in_progress`, `completed`, `aborted` | `None` (all) | Restricts export to sessions with the specified terminal or in-flight state. |

---

## 3. Dataset Schemas & Authoritative Field Mapping

### 3.1 CSV Export Schema (Flat Analysis Matrix)

The CSV format serializes tabular records containing 33 columns. It is designed for linear mixed-effects modeling and contingency analysis:

| Column Header | Data Type | Nullable? | Source Model Field | Description |
| :--- | :---: | :---: | :--- | :--- |
| `sessionId` | UUID string | No | `id` | Unique UUIDv4 identifier for the trial session. |
| `participantId` | string | No | `participant_id` | Pseudonymized participant code (e.g., `P01`, `P04`). |
| `condition` | string | No | `condition` | Experimental condition (`manual` or `ai_assisted`). |
| `sequenceOrder` | string | No | `sequence_order` | Counterbalancing sequence group (`G1`, `G2`, `G3`, `G4`). |
| `trialPeriod` | integer | No | `trial_period` | Crossover period index (`1` or `2`). |
| `taskName` | string | No | `task_name` | Assigned experimental task (`living_room` or `home_study`). |
| `sessionStatus` | string | No | `session_status` | Status: `completed`, `aborted`, or `in_progress`. |
| `checkpointSequence` | integer | No | `checkpoint_sequence` | Highest checkpoint sequence received (`0` if none). |
| `startTime` | ISO-8601 | No | `start_time` | Session start timestamp. |
| `endTime` | ISO-8601 | Yes | `end_time` | Session submission timestamp (`null` if aborted/in_progress). |
| `durationSeconds` | float | Yes | `duration_seconds` | Total elapsed wall-clock seconds (`null` if in_progress). |
| `activeDurationSeconds` | float | No | `active_duration_seconds` | Elapsed duration minus idle pauses. |
| `abortedAt` | ISO-8601 | Yes | `aborted_at` | Timestamp when abort occurred (`null` if completed). |
| `abortReason` | string | Yes | `abort_reason` | Reason: `user_cancelled`, `inactivity_timeout`, `browser_closed`. |
| `totalIdleDurationSeconds`| float | No | `total_idle_duration_seconds`| Cumulative duration of all detected pauses $\ge 15\text{s}$. |
| `maxSingleIdleGapSeconds` | float | No | `max_single_idle_gap_seconds`| Duration in seconds of the single longest pause. |
| `hasProlongedInterruption`| boolean | No | `has_prolonged_interruption` | `True` if any pause $\ge 900\text{s}$ (15 minutes). |
| `budgetTotalPaise` | integer | Yes | `budget_total_paise` | Authoritative deterministic price sum in integer paise. |
| `budgetCeilingPaise` | integer | No | `budget_ceiling_paise` | Task budget ceiling in paise (e.g., `6000000`). |
| `isBudgetCompliant` | boolean | Yes | `is_budget_compliant` | `True` if `budgetTotalPaise <= budgetCeilingPaise`. |
| `attemptedOutOfBoundsCount`| integer | No | `attempted_out_of_bounds_count`| Total boundary clashes or invalid AI proposals attempted. |
| `finalSceneOutOfBoundsCount`| integer | Yes | `final_scene_out_of_bounds_count`| Out-of-bounds items in final scene (expected `0`). |
| `aabbOverlapPairsCount` | integer | Yes | `aabb_overlap_pairs_count` | Count of furniture pairs with intersecting AABB extents. |
| `doorwayIntrusionsCount`| integer | Yes | `doorway_intrusions_count` | Count of furniture bounding boxes intruding keep-out box. |
| `isTaskSuccessful` | boolean | Yes | `is_task_successful` | Conjunction: 4 items present, budget compliant, 0 doorway clashes. |
| `totalEdits` | integer | No | `total_edits` | Count of manual additions, deletions, moves, and duplicates. |
| `undoRedoCount` | integer | No | `undo_redo_count` | Count of undo/redo dispatches during trial. |
| `agentProposalsCount` | integer | No | `agent_proposals_count` | Candidate layouts generated by AI agent (Condition B only). |
| `agentAcceptedCount` | integer | No | `agent_accepted_count` | AI proposals approved via `/apply/` (Condition B only). |
| `agentTier1SuccessCount`| integer | No | `agent_tier1_success_count`| HTTP 200 responses from AI agent endpoint. |
| `agentTier2SchemaValidCount`| integer | No | `agent_tier2_schema_valid_count`| Syntactically valid tool call proposals. |
| `agentTier3DomainValidCount`| integer | No | `agent_tier3_domain_valid_count`| Proposas meeting 3D room containment. |
| `susScore` | float | Yes | `sus_score` | Brooke (1996) System Usability Scale score ($0.0–100.0$). |

---

### 3.2 JSON Export Schema (Full Hierarchical Records)

The JSON export format encapsulates the complete hierarchical `ExperimentSessionRecord` object. In addition to the 33 scalar fields above, JSON exports include:
1. `schemaVersion`: Number indicating the telemetry format version (`1`).
2. `idleIntervals`: Array of granular pause events, e.g.:
   ```json
   [
     {
       "startOffsetSeconds": 45.2,
       "endOffsetSeconds": 68.0,
       "durationSeconds": 22.8
     }
   ]
   ```
3. `susResponses`: Normalized 10-item Likert survey answers mapping questions `1..10` to whole integer ratings `1..5`, e.g.:
   ```json
   {
     "1": 5, "2": 1, "3": 4, "4": 2, "5": 5,
     "6": 1, "7": 5, "8": 2, "9": 4, "10": 1
   }
   ```
4. `checkpointSceneSnapshot`: Canonical 3D scene snapshot recorded at the most recent periodic checkpoint. Preserved upon session abort to facilitate dropout and in-flight spatial analysis.
5. `finalSceneSnapshot`: Immutable final submitted 3D scene snapshot (validated and sanitized upon completion; `null` for aborted sessions).

---

## 4. Handling Incomplete & Aborted Sessions

The export pipeline explicitly models and differentiates three session states:
1. **Completed Sessions (`sessionStatus = 'completed'`):**
   - All server-authoritative spatial and financial metrics are computed and non-null.
   - `susScore` and `susResponses` are populated.
   - `abortedAt` and `abortReason` are strictly `null`.
   - Included in primary confirmatory LMM/GLMM analyses.
2. **Aborted Sessions (`sessionStatus = 'aborted'`):**
   - Occurs when a participant cancels (`user_cancelled`), encounters an inactivity timeout (`inactivity_timeout`), or closes the browser window (`browser_closed`).
   - `abortedAt` records the timestamp; `durationSeconds` records elapsed time up to the abort event.
   - `finalSceneSnapshot`, `isTaskSuccessful`, and `susScore` remain `null`.
   - `checkpointSceneSnapshot` is retained, allowing researchers to inspect partial work completed before abandonment.
   - Excluded from primary confirmatory effectiveness models; analyzed in dropout / sensitivity analyses.
3. **In-Progress Sessions (`sessionStatus = 'in_progress'`):**
   - Active or interrupted sessions that have not received a terminal `/complete/` or `/abort/` payload.
   - Filterable via `--status completed` to prevent contaminating final research matrices.

---

## 5. Verification Evidence & Automated Tests

The dataset export pipeline is covered by automated regression tests in [`backend/apps/evaluation/tests.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/tests.py#L1605-L1645):
- `test_export_evaluation_dataset_includes_sus_score`:
  - Seeds completed and aborted evaluation sessions.
  - Executes `call_command('export_evaluation_dataset', format='csv', stdout=out_csv)`.
  - Asserts CSV headers include `susScore`, verifies exact numerical values, and checks participant ID presence.
  - Executes `call_command('export_evaluation_dataset', format='json', stdout=out_json)`.
  - Parses JSON output and verifies `susScore`, `susResponses`, and nested structures.
