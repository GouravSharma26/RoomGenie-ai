# RoomGenie AI — Research Data Quality & Integrity Checklist

**Document Status:** Operational Pre-/Post-Collection Audit Guide  
**Project:** RoomGenie AI (Solo B.Tech CSE Project — Gourav Sharma)  
**Related Documents:** [`docs/EVALUATION_DATASET_AND_EXPORT_GUIDE.md`](EVALUATION_DATASET_AND_EXPORT_GUIDE.md), [`docs/STATISTICAL_ANALYSIS_PLAN.md`](STATISTICAL_ANALYSIS_PLAN.md), [`backend/apps/evaluation/exports.py`](../backend/apps/evaluation/exports.py)  
**Last Updated:** October 2026  

---

> [!IMPORTANT]
> **Data Integrity Protocol:**  
> This checklist defines the mandatory data verification procedure to be executed **after authorized data collection and prior to statistical modeling**. It establishes quality gates to detect data corruption, timestamp anomalies, missing values, duplicate participant IDs, or protocol violations.
>
> **Methodological Distinction:** Model-level field types and API endpoint guards validate single-session submissions at runtime. They do **not** automatically guarantee dataset-level invariants across an aggregated multi-participant cohort. Therefore, checks are strictly classified by their actual operational verification mechanism.

---

## 1. Quality Check Classification

Every quality check is explicitly categorized by execution mechanism:

| Category | Definition | Operational Level |
| :--- | :--- | :---: |
| **`AUTOMATED (MODEL/API VERIFIED)`** | Enforced at runtime by Django model fields, DRF serializers, endpoint validators, or the export command, with verification by unit tests. | Individual Session / API Level |
| **`MANUAL AUDIT`** | Requires cross-record visual or tabular inspection by the researcher using exported CSV/JSON in Python, R, or spreadsheet software. | Dataset / Cohort Level |
| **`FUTURE SCRIPT`** | Planned post-collection dataset validation script (e.g. Python/pandas or R pre-flight script) to be executed prior to unblinding and modeling. | Automated Dataset Level |

---

## 2. 11-Dimensional Data Quality Checklist

### Dimension 1: Schema & Column Consistency
- [ ] **1.1 Column Count & Header Order:** Exported CSV matches the exact 33 headers in exact order defined in `backend/apps/evaluation/exports.py:CSV_EXPORT_FIELDS`.
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `export_evaluation_dataset.py` and `test_export_evaluation_dataset_includes_sus_score`.
- [ ] **1.2 Data Types & Field Formatting:** Numeric metrics (duration, paise, counts) serialize as valid numeric values; timestamps format as ISO-8601 UTC.
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via DRF `ExperimentSessionRecordSerializer`.
- [ ] **1.3 JSON Schema Version:** Exported JSON contains root `schemaVersion = 1`.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `get_schemaVersion()` method field in `serializers.py`.

### Dimension 2: Duplicate Records & Identifier Uniqueness
- [ ] **2.1 Session ID Uniqueness:** Every `sessionId` is a unique UUIDv4; zero duplicate session IDs across the exported dataset.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via PostgreSQL primary key constraint on `EvaluationSession.id`.
- [ ] **2.2 Participant Observation Balance:** Exactly 2 completed session records exist per participant ID (one for Period 1, one for Period 2), or an explicit abort record is present.  
  *Classification:* `MANUAL AUDIT` (Cross-tabulate `participantId` by `trialPeriod`; verify `count == 2` per participant).

### Dimension 3: Missingness by Condition & Outcome
- [ ] **3.1 Completed Session Completeness:** For all records with `sessionStatus = 'completed'`, zero missing (`null` / empty string) values exist in primary metrics: `durationSeconds`, `activeDurationSeconds`, `budgetTotalPaise`, `isBudgetCompliant`, `susScore`, and `isTaskSuccessful`.  
  *Classification:* `MANUAL AUDIT` (The `/complete/` endpoint validates individual payloads at submission, but database model fields allow nulls; whole-dataset completeness must be verified post-export in R/Python).
- [ ] **3.2 Aborted Session Expected Nulls:** For records with `sessionStatus = 'aborted'`, `susScore`, `susResponses`, and `finalSceneSnapshot` are strictly `null`, while `checkpointSceneSnapshot`, `abortedAt`, and `abortReason` are populated.  
  *Classification:* `MANUAL AUDIT` (Verify expected missingness structure across aborted rows post-export).

### Dimension 4: Timestamp & Duration Validity
- [ ] **4.1 Chronological Monotonicity:** `startTime < endTime` for all completed sessions; `startTime < abortedAt` for all aborted sessions.  
  *Classification:* `FUTURE SCRIPT` (Planned assertion: `(end_time - start_time).total_seconds() > 0`).
- [ ] **4.2 Active Duration Invariant:** `activeDurationSeconds <= durationSeconds` for all records.  
  *Classification:* `FUTURE SCRIPT` / `MANUAL AUDIT` (Active duration is calculated at runtime in `metrics.py`, but database schema lacks a multi-column check constraint; verify invariant across exported table).
- [ ] **4.3 Idle Interval Consistency:** Sum of granular `idleIntervals` durations matches `totalIdleDurationSeconds` within $\pm 0.1\text{ s}$ numerical tolerance.  
  *Classification:* `FUTURE SCRIPT` (Runtime serializer verifies structure and non-negativity; total sum equality requires dataset verification).

### Dimension 5: Session Lifecycle Consistency
- [ ] **5.1 Valid Terminal State:** Every session in the dataset has a valid status: `completed`, `aborted`, or `in_progress`.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via Django `STATUS_CHOICES` on `EvaluationSession.session_status`.
- [ ] **5.2 In-Progress Exclusion:** Zero `in_progress` records contaminate the confirmatory analysis export.
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `export_evaluation_dataset --status completed` queryset filtering.

### Dimension 6: Counterbalanced Condition & Sequence Assignment
- [ ] **6.1 Latin Square Assignment Conformance:** Every participant's `condition`, `taskName`, and `trialPeriod` strictly matches their counterbalanced sequence group (`G1`, `G2`, `G3`, or `G4`):
  - **G1:** Period 1 = Manual Living Room; Period 2 = AI Home Study.
  - **G2:** Period 1 = AI Living Room; Period 2 = Manual Home Study.
  - **G3:** Period 1 = Manual Home Study; Period 2 = AI Living Room.
  - **G4:** Period 1 = AI Home Study; Period 2 = Manual Living Room.  
  *Classification:* `MANUAL AUDIT` (Single-session assignments are validated at start by `validate_study_assignment()` in `metrics.py`, but dataset-wide adherence across both periods for every participant requires post-export cross-tabulation).
- [ ] **6.2 Cohort Balance:** Total participants assigned across G1, G2, G3, G4 is balanced within $\pm 1$ participant.
  *Classification:* `MANUAL AUDIT`.

### Dimension 7: SUS Response Completeness & Valid Scoring
- [ ] **7.1 Survey Completeness:** Exactly 10 questions ($Q_1 \dots Q_{10}$) are present in `susResponses` for every completed session.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `validate_sus_responses()` in `metrics.py` and `SusResponsesField`.
- [ ] **7.2 Integer Rating Domain:** All 10 responses are strictly integer values in $\{1, 2, 3, 4, 5\}$; booleans and fractional values rejected.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `validate_sus_responses()` in `metrics.py` (tested by 42 evaluation unit tests).
- [ ] **7.3 Brooke Scoring Correctness:** `susScore` exactly matches Brooke's (1996) formula:
  $$\text{Score} = 2.5 \times \left[ \sum_{i \in \{1,3,5,7,9\}} (Q_i - 1) + \sum_{j \in \{2,4,6,8,10\}} (5 - Q_j) \right]$$
  Range is strictly bounded within $[0.0, 100.0]$.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `calculate_sus_score()` in `metrics.py` (verified by unit test `test_calculate_sus_score_standard_profiles`).

### Dimension 8: Telemetry Field Validity
- [ ] **8.1 Non-Negative Interaction Counters:** `totalEdits >= 0`, `undoRedoCount >= 0`, `attemptedOutOfBoundsCount >= 0`.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via Django model `PositiveIntegerField`.
- [ ] **8.2 Spatial Collision & Intrusions Bounds:** `aabbOverlapPairsCount >= 0`, `doorwayIntrusionsCount >= 0`.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via Django model `PositiveIntegerField`.
- [ ] **8.3 AI Validity Tiers Monotonicity (Condition B):**
  - $\text{agentAcceptedCount} \le \text{agentProposalsCount}$.
  - $\text{agentTier3DomainValidCount} \le \text{agentTier2SchemaValidCount} \le \text{agentTier1SuccessCount}$.  
  *Classification:* `FUTURE SCRIPT` (Pre-flight sanity assertion on AI telemetry relationships).
- [ ] **8.4 Condition A Zero-Activity Invariant:** For `condition = 'manual'`, AI agent counters (`agentProposalsCount`, `agentAcceptedCount`, etc.) are strictly `0`.  
  *Classification:* `MANUAL AUDIT` / `FUTURE SCRIPT` (Agent endpoints are gated to prevent manual-session proposals, but verifying zero-activity across all Condition A dataset rows requires post-export auditing).

### Dimension 9: Status Distribution & Anomaly Detection
- [ ] **9.1 Duration Outliers:** Active duration is inspected for extreme outliers ($> 3 \times \text{IQR}$ or $< 60\text{ s}$).  
  *Classification:* `MANUAL AUDIT` (Boxplot and distribution visualization in R/Python).
- [ ] **9.2 Prolonged Interruption Flagging:** Any session with `hasProlongedInterruption = True` ($\ge 15\text{ min}$ pause) is flagged for exclusion under pre-registered criteria.  
  *Classification:* `MANUAL AUDIT` (The boolean flag is computed automatically by `metrics.py`, but the exclusion decision and table documentation is performed manually).
- [ ] **9.3 Abort Reason Distribution:** Aborted trials are cross-tabulated by condition and task to detect potential UX blockers.  
  *Classification:* `MANUAL AUDIT`.

### Dimension 10: Linkage Integrity & Anonymization
- [ ] **10.1 Coded Pseudonym Adherence:** `participantId` strictly follows pseudonym convention (e.g. `P01`–`P30`); zero real names, emails, or IP addresses persisted in evaluation tables.  
  *Classification:* `MANUAL AUDIT` / `FUTURE SCRIPT` (The model stores a generic `CharField(max_length=64)` without regex constraint; verifying that zero PII or irregular codes were entered requires post-collection audit).
- [ ] **10.2 Capability Hash One-Way Security:** `session_secret_hash` stores irreversible SHA-256 digests; bearer tokens are never stored in plaintext.  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `hashlib.sha256()` in `views.py`.

### Dimension 11: Export Reproducibility & Record Counts
- [ ] **11.1 Export Command Determinism:** Re-running `python manage.py export_evaluation_dataset --format csv --status completed` produces an identical row order (ordered by `startTime`).  
  *Classification:* `AUTOMATED (MODEL/API VERIFIED)` via `.order_by('start_time')` in `export_evaluation_dataset.py`.
- [ ] **11.2 Record Count Verification:** Number of exported CSV rows equals the count of completed database records ($N_{\text{exported}} = N_{\text{DB}}$).  
  *Classification:* `MANUAL AUDIT` (Confirm exported row count against independent session tracking log).

---

## 3. Data Integrity Sign-Off Template (Post-Collection)

```text
================================================================================
ROOMGENIE AI — RESEARCH DATA INTEGRITY VERIFICATION SIGN-OFF
================================================================================
Audit Date:             [YYYY-MM-DD]
Auditor / Researcher:   Gourav Sharma
Dataset Export File:    [data/evaluation_completed_YYYYMMDD.csv]
Total Records Exported: [NN] completed trials across [NN] unique participants
SHA-256 Checksum:       [hash]

Audit Results:
  [ ] Dimension 1: Schema & Column Consistency (33 columns verified)
  [ ] Dimension 2: Duplicate Records & Identifier Uniqueness
  [ ] Dimension 3: Missingness by Condition & Outcome
  [ ] Dimension 4: Timestamp & Duration Validity
  [ ] Dimension 5: Session Lifecycle Consistency
  [ ] Dimension 6: Counterbalanced Condition & Sequence Assignment
  [ ] Dimension 7: SUS Response Completeness & Valid Scoring
  [ ] Dimension 8: Telemetry Field Validity
  [ ] Dimension 9: Status Distribution & Anomaly Detection
  [ ] Dimension 10: Linkage Integrity & Anonymization
  [ ] Dimension 11: Export Reproducibility & Record Counts

Exclusions Documented:  [N sessions excluded under pre-registered criteria]
Supervisor Sign-Off:    ___________________________   Date: _______________
================================================================================
```
