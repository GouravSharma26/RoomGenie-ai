# RoomGenie AI — Ethics & Data Governance Gate

**Document Status:** Institutional Pre-Clearance Audit & Governance Lock  
**Project:** RoomGenie AI (Solo B.Tech CSE Project — Gourav Sharma)  
**Related Documents:** [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](RESEARCH_PROTOCOL_AND_TASKS.md), [`docs/STATISTICAL_ANALYSIS_PLAN.md`](STATISTICAL_ANALYSIS_PLAN.md), [`docs/RESEARCH_DECISION_REGISTER.md`](RESEARCH_DECISION_REGISTER.md)  
**Last Updated:** October 2026  

---

> [!CAUTION]
> **GOVERNANCE GATE STATUS: CLOSED — RECRUITMENT PAUSED**  
> - **Human-subject participant recruitment and empirical data collection are strictly PAUSED.**
> - `ENABLE_EVALUATION_TELEMETRY=False` remains the default across all development, test, and production environments.
> - Software engineering verification (241 Django backend tests and 143 frontend Vitest tests) establishes technical correctness, but does **not** constitute ethical approval, IRB clearance, or empirical research findings.
> - No real human-subject participant trials may be scheduled or conducted until formal written clearance is granted by the Institutional Ethics Review Committee / Institutional Review Board and countersigned by the academic supervisor.

---

## 1. Governance Precondition Checklist

The following 10 institutional, ethical, and technical preconditions must be satisfied and countersigned prior to unlocking participant trials:

| Gate Item | Precondition Domain | Required Artifact / Evidence | Current Status | Approving Authority |
| :---: | :--- | :--- | :---: | :---: |
| **GATE-01** | **Institutional Ethics Approval** | Formal application submitted to and cleared by the Institutional Ethics Committee / IRB with written protocol reference number. | `PENDING ETHICS` | Institutional Ethics Board |
| **GATE-02** | **Academic Supervisor Clearance** | Written approval of study protocol, task rubrics, and Statistical Analysis Plan by project supervisor. | `PENDING SUPERVISOR` | Academic Supervisor |
| **GATE-03** | **Participant Information Sheet** | Standardized plain-language document detailing study purpose, 30–40 min duration, voluntary nature, and risks. | `DRAFTED (PENDING REVIEW)` | Ethics Committee & Supervisor |
| **GATE-04** | **Informed Consent Procedure** | Explicit written consent declaration signed prior to trial commencement, including 14-day data withdrawal right. | `DRAFTED (PENDING REVIEW)` | Ethics Committee |
| **GATE-05** | **Data Minimization Safeguards** | Telemetry restricted to CAD interactions, 3D coordinates, and SUS responses; zero collection of audio, video, webcams, or biometrics. | `LOCKED & VERIFIED` | Software Architecture |
| **GATE-06** | **Privacy & Access Controls** | Coded pseudonyms (`P01`–`P30`); bearer capability hashes stored as SHA-256 digests; strict user ownership isolation. | `LOCKED & VERIFIED` | Software Architecture |
| **GATE-07** | **Retention & Deletion Policy** | Data stored in access-controlled storage; 14-day withdrawal window; irreversible anonymization aggregation lock on study conclusion. | `LOCKED IN PROTOCOL` | Researcher & Supervisor |
| **GATE-08** | **Incident & Breach Protocol** | Protocol defining immediate pause of trials, logging, and notification in case of data spill, crash, or participant distress. | `SPECIFIED` | Researcher & Supervisor |
| **GATE-09** | **Target Hardware Dry Run** | Non-participant end-to-end dry run conducted on target mobile hardware (`realme Narzo 70 Turbo 5G`) using synthetic test fixtures. | `PENDING ETHICS CLEARANCE` | Researcher (Post-Approval) |
| **GATE-10** | **Telemetry Activation Guard** | Telemetry flag `ENABLE_EVALUATION_TELEMETRY=True` restricted strictly to approved testing sessions; default remains `False`. | `LOCKED & VERIFIED` | Configuration (`settings.py`) |

---

## 2. Institutional Ethics & Supervisor Approvals

### 2.1 Institutional Ethics Committee / IRB Clearance
- **Approval Status:** **`PENDING`**
- **Protocol Reference Number:** *Not yet issued (Application pending formal submission)*
- **Committee Name:** Departmental / Institutional Ethics Review Board
- **Review Date:** *Pending review schedule*
- **Action Required:** Submit the compiled research readiness package:
  - [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](RESEARCH_PROTOCOL_AND_TASKS.md) (Protocol, tasks, counterbalancing)
  - [`docs/STATISTICAL_ANALYSIS_PLAN.md`](STATISTICAL_ANALYSIS_PLAN.md) (Pre-registered models and hypotheses)
  - [`docs/ETHICS_AND_DATA_GOVERNANCE_GATE.md`](ETHICS_AND_DATA_GOVERNANCE_GATE.md) (This governance document)
  - Participant Information Sheet and Informed Consent Form

### 2.2 Academic Supervisor Written Endorsement
- **Approval Status:** **`PENDING`**
- **Supervisor Name:** [Academic Project Supervisor]
- **Institutional Affiliation:** Department of Computer Science & Engineering
- **Endorsement Scope:** Approval of crossover study design, sample size ($N=30$), Statistical Analysis Plan, and resolution of open statistical choices (Kenward–Roger vs. Satterthwaite; exploratory ordinal SUS analysis; random slope structure).

---

## 3. Participant Rights, Consent, & Recruitment Policy

### 3.1 Informed Consent Procedure
In accordance with ethical principles for research involving human participants (Declaration of Helsinki):
1. **Voluntary Participation:** Participants are informed that taking part is entirely voluntary and that declining or withdrawing will not impact their academic standing or relationship with the university.
2. **Right to Withdraw:** Participants may withdraw at any time during the trial without explanation. Furthermore, participants may request the deletion of their recorded data within **14 days** of participation by citing their assigned Participant Code (`P01`–`P30`).
3. **Irreversible Anonymization Lock:** Upon completion of the 14-day window and dataset aggregation lock, the key linking participant identities to codes is permanently destroyed, rendering all data irreversibly anonymized.

### 3.2 Participant Information Sheet (Summary of Disclosures)
- **Study Purpose:** Evaluating user experience and spatial design accuracy in manual vs. AI-assisted 3D interior design.
- **Activities Involved:** Designing two room layouts in an interactive 3D web tool and completing a 10-item usability questionnaire after each session.
- **Estimated Duration:** Approximately 30 to 40 minutes in a single session.
- **Risks & Discomforts:** Negligible risk beyond ordinary computer use and screen viewing.
- **Benefits:** Opportunity to interact with next-generation spatial computing and generative AI interfaces.
- **Compensation:** Voluntary student participation; academic extra credit or token compensation as approved by the ethics committee.

---

## 4. Technical Safeguards & Data Minimization

### 4.1 Data Minimization Principles
The RoomGenie AI telemetry subsystem is architected to collect the **minimum necessary data** to evaluate the four research hypotheses:
- **Captured Data:**
  - Wall-clock timestamps and active interaction durations.
  - Aggregated counts of discrete UI interactions (object additions, deletions, moves, undo/redo).
  - High-level transformed bounding box coordinates of placed furniture objects.
  - Evaluated budget sums in paise (derived from standard CC0 catalog pricing).
  - 10 numeric Likert responses to Brooke's System Usability Scale.
- **Explicitly Excluded / Forbidden Data:**
  - Zero collection of facial video, webcam streams, or audio recordings.
  - Zero eye-tracking or biometric sensor feeds.
  - Zero keystroke logging outside of explicit natural-language prompt submissions to the AI agent drawer.
  - Zero collection of personally identifiable information (PII) such as full names, student enrollment IDs, email addresses, phone numbers, or IP addresses in evaluation tables.

### 4.2 Privacy & Storage Controls
- **Pseudonymization:** All session records are indexed strictly by random UUIDv4 (`id`) and pseudonymized identifier (`participant_id`).
- **Authorization:** Sessions utilize capability-based authorization; bearer secrets are hashed using SHA-256 before database storage (`session_secret_hash`). Endpoints reject requests lacking the matching bearer token with HTTP 403 Forbidden.
- **Data at Rest:** Evaluation database is hosted on private, access-controlled PostgreSQL storage with network isolation.

### 4.3 Production Telemetry Guard
In `backend/config/settings.py`:
```python
ENABLE_EVALUATION_TELEMETRY = os.getenv('ENABLE_EVALUATION_TELEMETRY', 'False').lower() in ('true', '1', 'yes')
```
- **Default State:** Strictly `False`.
- **Enforcement:** If a client attempts to initialize an evaluation trial while telemetry is disabled, the backend immediately responds with:
  ```json
  {"detail": "Evaluation telemetry is disabled on this server."}
  ```
  (HTTP 403 Forbidden).
- **Activation Policy:** Telemetry is enabled **only** on an isolated, local or private research instance during officially scheduled, ethics-approved trial sessions.

---

## 5. Protocol for Target-Hardware Dry Run (Post-Ethics, Pre-Collection)

Once institutional ethics clearance is granted and before the first participant is tested, the researcher will execute a formal, single-session **Target-Hardware Non-Participant Dry Run**:
1. **Target Device:** `realme Narzo 70 Turbo 5G` (Android 14, ARCore 1.52.x, Chrome 145.x).
2. **Synthetic Participant ID:** `DRYRUN_TEST_01`.
3. **Execution Steps:**
   - Launch trial under Latin square sequence G1.
   - Complete Period 1 (Manual) using synthetic furniture placement.
   - Verify periodic checkpoint dispatch and idle-time detection.
   - Complete SUS questionnaire; assert HTTP 200 and database persistence.
   - Complete Period 2 (AI-Assisted) using agent prompt, preview, and apply.
   - Complete second SUS questionnaire; assert completion.
   - Run `python manage.py export_evaluation_dataset --format csv --status completed` and verify data row.
   - Purge synthetic dry-run session from database prior to participant recruitment.
4. **Purpose:** Re-confirm that mobile networking, database write latency, and WebXR tracking behave properly in the physical testing facility without consuming participant trial time.

---

## 6. Formal Sign-Off Record

```text
================================================================================
ROOMGENIE AI — RESEARCH ETHICS & DATA GOVERNANCE GATE SIGN-OFF
================================================================================
Institutional Ethics Committee Reference: [PENDING FORMAL APPROVAL]
Approval Date:                            [PENDING]
Academic Project Supervisor:              [PENDING FORMAL SIGN-OFF]
Supervisor Endorsement Date:              [PENDING]

Author / Lead Researcher Declaration:
"I confirm that no human participants have been recruited, contacted, or tested 
for empirical research purposes, and that evaluation telemetry remains disabled 
by default. Empirical data collection will commence strictly upon receiving 
written institutional ethics approval and supervisor clearance."

Lead Researcher: Gourav Sharma                        Date: October 27, 2026
================================================================================
```
