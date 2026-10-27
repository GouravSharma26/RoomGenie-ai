# RoomGenie AI — Thesis Synthesis & Research Report Outline

**Degree:** Bachelor of Technology in Computer Science & Engineering (B.Tech CSE Capstone Project)  
**Author:** Gourav Sharma  
**Working Title:** *RoomGenie AI: An AI-Agent-Assisted Interior Design System with Interactive 3D Furniture Placement, Photo-to-3D Reconstruction, and Augmented Reality Visualization*  
**Repository:** [https://github.com/GouravSharma26/RoomGenie-ai](https://github.com/GouravSharma26/RoomGenie-ai)  
**Document Status:** Complete Academic Thesis & Report Specification (Pre-Pilot / Pre-Recruitment Baseline)  
**Safety & Governance Invariant:** `ENABLE_EVALUATION_TELEMETRY=False` by default; participant recruitment strictly paused pending institutional ethics board approval. Software tests and CI runs do not constitute empirical human participant data or ethical clearance.

---

## Abstract (Structure & Placeholders)

> *Notice: In accordance with academic integrity standards, the Abstract contains structural headings and methodology summaries only. Empirical findings and statistical effect sizes remain unpopulated placeholders until formal ethics approval is granted and participant data is collected.*

- **Context & Problem:** Traditional computer-aided interior design tools require extensive manual spatial manipulation, while unconstrained generative AI tools frequently hallucinate non-existent furniture dimensions, ignore physical boundary collisions, and lack deterministic budget adherence.
- **Proposed Solution:** RoomGenie AI, a modular web-based interior design platform integrating an interactive Three.js 3D room editor, a deterministic integer-minor-unit budget engine, a two-phase approval AI design agent (`/prompt/` $\rightarrow$ `/apply/`), an ephemeral room-photo vision analyzer, a Khronos glTF 2.0 validated photo-to-3D pipeline, and mobile WebXR augmented reality (AR) placement.
- **Evaluation Methodology:** A 4-sequence, 2-period counterbalanced crossover experiment ($N = 20–30$ feasibility cohort) comparing manual design (Condition A) against AI-assisted design (Condition B) across two standardized, constraint-equivalent tasks (Contemporary Living Room and Modern Executive Study).
- **Statistical Framework:** Linear Mixed-Effects Models (LMM) for continuous metrics (active completion time, System Usability Scale) and Generalized Linear Mixed Models (GLMM) with logit link for binary rates (budget compliance, composite task success), controlling for task and period order, with Holm-Bonferroni family-wise error control.
- **Empirical Findings:** *[Placeholder: Empirical results pending formal institutional ethics review, participant recruitment, and study execution.]*
- **Significance:** Demonstrates how deterministic constraints, strict Likert survey validation, and a human-in-the-loop approval architecture enable reliable spatial generative assistance without surrendering user agency or budget control.

---

## Chapter 1: Introduction and Problem Statement

### 1.1 Purpose
Establishes the research motivation, industry context, technological challenges, core research questions, and scientific contributions of RoomGenie AI.

### 1.2 Proposed Subsections
- **1.1 Background & Motivation:** The evolution of computer-aided interior design; democratization of 3D visualization; consumer pain points in spatial planning and budget estimation.
- **1.2 The Triad Problem in Spatial Generative AI:**
  1. *Geometric Hallucination:* Large multimodal models lack grounded physical understanding, proposing items that intersect walls or exceed room boundaries.
  2. *Financial Non-Determinism:* LLMs performing floating-point price arithmetic produce non-reproducible, inaccurate totals.
  3. *Agency Loss & Premature Application:* Direct mutation of 3D scene graphs by generative models deprives users of review and oversight.
- **1.3 Research Objectives:**
  1. Design and build a web-first 3D room editor with real-time boundary enforcement and integer paise budget computation.
  2. Implement an AI design assistant operating strictly via an allowlisted tool-calling interface with two-phase diff preview and user approval.
  3. Implement ephemeral vision-based room photo analysis and GLB-validated photo-to-3D furniture approximation with catalogue fallback.
  4. Implement cross-platform mobile WebXR AR floor placement.
  5. Conduct an empirical crossover evaluation measuring task completion time, budget compliance, spatial collisions, and perceived usability (SUS).
- **1.4 Research Questions & Hypotheses:** Primary question (RQ1) and four pre-registered confirmatory hypotheses ($H_{01}$ completion time, $H_{02}$ SUS score, $H_{03}$ budget compliance, $H_{04}$ composite task success).
- **1.5 Summary of Contributions:** System architecture, deterministic constraint validation, strict Likert survey validation, and crossover experimental framework.

### 1.3 Supporting Evidence & Artifacts
- Plan & Roadmap: [`plan.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/plan.md)
- Architectural Contracts: [`ARCHITECTURE.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ARCHITECTURE.md)
- Technology Decisions: [`MODEL_AND_TECH_DECISIONS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/MODEL_AND_TECH_DECISIONS.md)

### 1.4 Status & Open Decisions
- **Status:** Complete draft specification.
- **Supervisor Decisions Requiring Confirmation:** Final thesis submission formatting guidelines (IEEE vs. departmental template).

---

## Chapter 2: Literature Review and Related Work

### 2.1 Purpose
Critically analyzes existing academic literature, commercial systems, and foundation model capabilities across interactive 3D layout synthesis, generative AI in spatial design, and augmented reality.

### 2.2 Proposed Subsections
- **2.1 Interactive 3D Spatial Layout Systems:** Survey of procedural rule-based room generation (Merrell et al., 2011; Yu et al., 2011); constraints in spatial optimization (gradient descent, simulated annealing, OBB bounding volumes).
- **2.2 Large Language Models & Tool-Calling Agents:** Function calling in generative models; safety mechanisms in LLM-driven software; mitigation of prompt injection and arbitrary command execution.
- **2.3 Vision-Language Models in Architectural Understanding:** Multimodal scene recognition; zero-shot object classification; limitations of single-image metric depth and dimensional inference.
- **2.4 Image-to-3D Reconstruction Technologies:** NeRF (Neural Radiance Fields), 3D Gaussian Splatting, feed-forward diffusion/transformer reconstruction (Tripo, Shap-E, InstantMesh); validation of manifold meshes and binary glTF structures.
- **2.5 Mobile Augmented Reality in Retail & Design:** WebXR Device API vs. native ARCore/ARKit; markerless horizontal plane detection; scale accuracy, drifting, and mobile thermal/rendering limits.
- **2.6 HCI Evaluation Methodologies for Mixed-Initiative Systems:** Mixed-initiative interaction (Horvitz, 1999); Brooke's System Usability Scale (SUS, 1996); Bangor et al. empirical grading (2008, 2009); crossover design counterbalancing.

### 2.3 Supporting Evidence & Artifacts
- Survey Standards: Brooke (1996); Bangor, Kortum & Miller (2008, 2009).
- Research Protocol: [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_PROTOCOL_AND_TASKS.md)

### 2.4 Status & Open Decisions
- **Status:** Structure established; citation bibliography compiled in references.

---

## Chapter 3: Requirements and System Architecture

### 3.1 Purpose
Specifies functional and non-functional requirements, architectural design patterns, component responsibilities, data flow, and canonical scene representations.

### 3.2 Proposed Subsections
- **3.1 Requirements Analysis:**
  - *Functional Requirements (FR1–FR8):* Explicit metric room creation, 3D furniture manipulation, persistent scene serialization, deterministic budget estimation, allowlisted tool-calling AI agent, room photo observation, photo-to-3D reconstruction with catalogue fallback, mobile WebXR AR.
  - *Non-Functional Requirements (NFR1–NFR6):* Frame rate ($\ge 60$ fps on desktop, $\ge 30$ fps on mobile WebXR), sub-second budget computation, zero floating-point money math, strict ownership isolation, ephemeral photo privacy, reproducible evaluation dataset export.
- **3.2 Modular Monolith Architecture:** Justification against microservices/Kubernetes; separation of concerns across Django apps (`accounts`, `rooms`, `furniture`, `designs`, `ai_agent`, `evaluation`).
- **3.3 Three.js Coordinate Conventions & Mathematical Invariants:**
  - Right-handed coordinate system: $Y = \text{Up}$ (metres), floor at $Y = 0.00\text{ m}$.
  - Width along $X \in [-W/2, +W/2]$; Length along $Z \in [-L/2, +L/2]$.
  - Oriented Bounding Box (OBB) transformed extents algorithm:
    $$e_i = \sum_{j=1}^3 |R_{ij}| \cdot \frac{d_j \cdot s_j}{2}, \quad i \in \{x, y, z\}$$
    where $R = R_x(\theta_x) R_y(\theta_y) R_z(\theta_z)$ is the Euler XYZ rotation matrix, $d$ is native asset dimensions, and $s$ is scale.
- **3.4 Canonical Scene Schema (`CanonicalSceneSnapshotJson`):** Schema versioning, units (`'m'`), room dimensions, serialized object entities (UUID, assetId, position, dimensions, scale, rotationEuler, materialOverrides).

### 3.3 Supporting Evidence & Artifacts
- Architecture Specification: [`ARCHITECTURE.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ARCHITECTURE.md)
- Backend Validators: [`backend/apps/designs/validators.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/designs/validators.py)

### 3.4 Status & Open Decisions
- **Status:** Fully implemented and verified.

---

## Chapter 4: Research Methodology and Experimental Design

### 4.1 Purpose
Details the empirical study design, four-sequence crossover counterbalancing, participant inclusion/exclusion criteria, experimental tasks, and governance procedures.

### 4.2 Proposed Subsections
- **4.1 Methodological Paradigm:** Within-subjects (repeated measures) comparative crossover design.
- **4.2 Experimental Conditions:**
  - *Condition A (Manual Baseline):* Interactive 3D editor and catalogue palette; AI Assistant drawer disabled.
  - *Condition B (AI-Assisted Workflow):* Interactive 3D editor supplemented by natural-language AI design assistant with 2-phase diff preview.
- **4.3 Four-Sequence Crossover Design ($G_1, G_2, G_3, G_4$):**
  - Sequence matrix resolving condition order ($A \rightarrow B$ vs. $B \rightarrow A$) and task pairing (Task 1 Living Room vs. Task 2 Study).
  - Mathematical justification for crossover over 4-trial designs (avoiding 90-minute participant fatigue and asymmetric memory carryover).
- **4.4 Standardized Experimental Tasks:**
  - *Task 1 (Contemporary Living Room):* $5.0\text{m} \times 4.0\text{m} \times 2.8\text{m}$; ₹60,000 budget; 4 mandatory items; South doorway clearance ($1.2\text{m}$ depth).
  - *Task 2 (Modern Executive Study):* $4.5\text{m} \times 3.5\text{m} \times 2.8\text{m}$; ₹50,000 budget; 4 mandatory items; East doorway clearance ($1.2\text{m}$ depth).
  - *Task Equivalence Matrix:* Balanced functional item count, proportional budget headroom, and identical clearance depths; calibration of budget-trap severity difference (11.66% vs 3.99%).
- **4.5 Ethics, Consent & Participant Protection:**
  - Coded/pseudonymized participant records (`P01`, `P02`).
  - No personal names, IP addresses, or private room photos collected.
  - 14-day unconditional withdrawal window prior to dataset aggregation lock.
  - Mandatory ethics approval gate before participant recruitment.

### 4.3 Supporting Evidence & Artifacts
- Protocol Document: [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_PROTOCOL_AND_TASKS.md)
- Task Packets: [`docs/RESEARCH_TASK_PACKETS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_TASK_PACKETS.md)

### 4.4 Status & Open Decisions
- **Status:** Protocol documented and frozen. Human testing paused pending departmental ethics review.

---

## Chapter 5: System Implementation and Technical Decisions

### 5.1 Purpose
Documents the concrete software engineering implementation across frontend, backend, AI adapters, photo analysis, reconstruction, and augmented reality.

### 5.2 Proposed Subsections
- **5.1 Frontend Architecture (React 19 + TypeScript + Three.js):**
  - State management via Zustand (`editorStore.ts`).
  - React Three Fiber canvas, OrbitControls, transform gizmos, boundary clamping.
  - Catalogue palette (`FurniturePalette.tsx`) with category tabs, style pills, dimension/budget sliders.
- **5.2 Backend Architecture (Django 5.2 LTS + Django REST Framework):**
  - Relational database schema on PostgreSQL 17 (`Room`, `FurnitureAsset`, `Design`, `AgentSession`, `AgentRun`, `FurnitureReconstructionJob`, `EvaluationSession`).
  - Authentication: Token & session auth with strict user-level ownership isolation (`owner=request.user`, 404 for cross-user queries).
  - Deterministic Budget Engine (`backend/apps/furniture/budget.py`): Integer paise calculation (minor units); category subtotals; unpriced asset handling without floating-point math.
- **5.3 AI Interior-Design Agent Architecture:**
  - Adapter interface (`BaseDesignLLMAdapter`) with `GeminiDesignLLMAdapter` (`gemini-3.8-flash`) and offline `MockDesignLLMAdapter`.
  - Strictly allowlisted tool functions (`add_furniture`, `move_object`, `replace_furniture`, `remove_object`, `set_material`, `clear_room`).
  - Two-phase approval workflow: `/prompt/` simulates candidate layout; user inspects diff card and budget impact; design mutates only upon explicit `/apply/`.
  - Stale proposal protection: SHA-256 base scene snapshot hashing returning HTTP 409 Conflict upon divergent state.
- **5.4 Room-Photo Analysis Pipeline:**
  - Multi-tier upload security: 10 MB file cap, 25 MP pixel cap, 100px minimum dimension, Pillow decompression-bomb defense.
  - Structured observation extraction (`GeminiRoomVisionAdapter`): detected furniture mapped to CC0 catalogue, architectural features, palette, uncertainty notes.
  - Ephemeral retention: automatic background cleanup via `cleanup_expired_room_photos`.
- **5.5 Photo-to-3D Reconstruction Pipeline:**
  - Asynchronous state machine: `queued` $\rightarrow$ `processing` $\rightarrow$ `completed` / `failed` with atomic claiming (`select_for_update`).
  - Tripo API adapter (`v3.1-20260211`) and offline mock engine.
  - Binary glTF 2.0 validator (`glb_validator.py`): Khronos magic bytes (`0x46546c67`), chunk header validation, finite positive bounds, 15 MB cap.
  - Authenticated streaming endpoint (`GET .../download/`) with path traversal prevention.
- **5.6 Mobile WebXR Augmented Reality:**
  - Three.js WebXR session manager (`webXrArSession.ts`) utilizing `immersive-ar`, viewer space `XRHitTestSource`, real-time reticle tracking, and tap-to-place.
  - Mobile handoff flow: authenticated token handoff via query parameters; automatic scene reconstruction.
  - Physical hardware verification on realme Narzo 70 Turbo 5G (Android 14, ARCore 1.48).

### 5.3 Supporting Evidence & Artifacts
- Technical Decisions: [`MODEL_AND_TECH_DECISIONS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/MODEL_AND_TECH_DECISIONS.md)
- AR Protocol: [`docs/MANUAL_AR_TESTING_PROTOCOL.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/MANUAL_AR_TESTING_PROTOCOL.md)
- Verified Test Suite: 241 backend tests, 143 frontend tests.

### 5.4 Status & Open Decisions
- **Status:** Complete, verified, and passing continuous integration.

---

## Chapter 6: Evaluation Metrics and Telemetry Infrastructure

### 6.1 Purpose
Specifies the mathematical formulation, collection mechanics, and validation safeguards for all primary confirmatory metrics and secondary exploratory telemetry.

### 6.2 Proposed Subsections
- **6.1 Server-Authoritative Metric Architecture:**
  - Security model: Session capability tokens (high-entropy SHA-256 secret hashes); client reports raw interaction events, but metrics are computed authoritatively on the backend upon submission.
- **6.2 Primary Confirmatory Metrics:**
  - *Active Duration Seconds (`activeDurationSeconds`):* Total elapsed wall-clock duration minus validated idle intervals; enforced invariant: $\text{active} + \text{idle} \le \text{elapsed} + 10.0\text{s}$.
  - *Perceived Usability (SUS Score):* Brooke (1996) 10-item Likert scale ($1–5$), Bangor et al. (2008, 2009) empirical grading:
    $$\text{Score} = 2.5 \times \left[ \sum_{i \in \{1,3,5,7,9\}} (Q_i - 1) + \sum_{j \in \{2,4,6,8,10\}} (5 - Q_j) \right]$$
  - *Budget Compliance Rate (`isBudgetCompliant`):* Boolean flag indicating whether $\text{budgetTotalPaise} \le \text{budgetCeilingPaise}$.
  - *Composite Task Success Rate (`isTaskSuccessful`):* Boolean conjunction requiring:
    1. All 4 mandatory items present and active.
    2. Total budget compliant ($\le$ ceiling).
    3. Zero doorway clearance intrusions ($\text{doorwayIntrusionsCount} = 0$).
- **6.3 Strict SUS Response Validation Engine:**
  - Rejection of booleans (`True`/`False`), non-numeric types, non-finite floats (`NaN`, `inf`), and fractional numbers (`1.5`, `2.5`, `4.9`).
  - Explicit rejection of boolean question keys (`{True: 5}`).
  - Independent validation of duplicate integer and string keys (`{1: 1, "1": True}` rejected without masking).
  - Deferred normalization: integer conversion occurs strictly after all 10 responses pass validation.
- **6.4 Secondary & Exploratory Metrics:**
  - *AABB Overlap Pairs Count (`aabbOverlapPairsCount`):* Geometric collision proxy evaluated across all object pairs with 2 cm tolerance.
  - *Doorway Clearance Intrusions (`doorwayIntrusionsCount`):* Intersection with silent $1.2\text{m}$ keep-out volume.
  - *Manual Adjustment Effort (`totalEdits`, `undoRedoCount`):* Debounced interaction tracking; slider drag gestures grouped to prevent metric inflation.
  - *Inactivity Tracking (`idleIntervals`):* Pauses $\ge 15\text{s}$ recorded; prolonged interruption flag for gaps $\ge 15\text{ min}$.
  - *AI Agent Multi-Tier Validity:* Tier 1 (Technical 200 OK), Tier 2 (Allowlisted Tool Schema), Semantic Reference Resolution, Tier 3 (3D Room Containment Domain Validity), Tier 4 (User Proposal Approval Rate).

### 6.3 Supporting Evidence & Artifacts
- Evaluation Metrics Engine: [`backend/apps/evaluation/metrics.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/metrics.py)
- Serializers & Fields: [`backend/apps/evaluation/serializers.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/serializers.py)
- Unit & Integration Tests: [`backend/apps/evaluation/tests.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/tests.py)

### 6.4 Status & Open Decisions
- **Status:** Complete and verified across 39 evaluation tests.

---

## Chapter 7: Statistical Analysis Plan

### 7.1 Purpose
Defines the pre-registered statistical decision models, distributional assumptions, model diagnostics, contingency procedures, and multiple comparison corrections for the experimental evaluation.

### 7.2 Proposed Subsections
- **7.1 Statistical Framework Overview:**
  - Objective: Evaluate condition effect ($\text{Manual}$ vs. $\text{AI-Assisted}$) while mathematically controlling for task intrinsic differences ($\text{Living Room}$ vs. $\text{Study}$) and trial period order ($\text{Period 1}$ vs. $\text{Period 2}$).
  - Significance threshold: Two-sided $\alpha = 0.05$ with family-wise error rate control.
- **7.2 Primary Model 1: Active Completion Time ($H_{01}$):**
  - *Dependent Variable:* Continuous active duration in seconds ($Y_{it} > 0$).
  - *Model Specification (LMM):*
    $$Y_{it} = \beta_0 + \beta_{\text{Condition}} \text{Condition}_{it} + \beta_{\text{Task}} \text{Task}_{it} + \beta_{\text{Period}} \text{Period}_{it} + u_i + \epsilon_{it}$$
    where $u_i \sim \mathcal{N}(0, \sigma_u^2)$ is the participant random intercept, and $\epsilon_{it} \sim \mathcal{N}(0, \sigma_\epsilon^2)$ is residual error.
  - *Decision Rule:* Two-sided $t$-test on $\beta_{\text{Condition}} = 0$ using Satterthwaite degrees of freedom.
  - *Diagnostics:* Shapiro-Wilk test on residuals ($\alpha = 0.05$). If violated, model log-transformed $\log(Y)$ or use Koch's non-parametric crossover rank analysis / Aligned Rank Transform ART-ANOVA.
- **7.3 Primary Model 2: Perceived Usability / SUS Score ($H_{02}$):**
  - *Dependent Variable:* SUS composite score ($0 \le \text{SUS}_{it} \le 100$).
  - *Model Specification (LMM):*
    $$\text{SUS}_{it} = \beta_0 + \beta_{\text{Condition}} \text{Condition}_{it} + \beta_{\text{Task}} \text{Task}_{it} + \beta_{\text{Period}} \text{Period}_{it} + u_i + \epsilon_{it}$$
  - *Decision Rule:* Two-sided $t$-test with Satterthwaite approximation. Fallback: Koch's rank analysis / ART-ANOVA.
- **7.4 Primary Model 3: Budget Compliance Rate ($H_{03}$):**
  - *Dependent Variable:* Binary compliance indicator ($C_{it} \in \{0, 1\}$).
  - *Model Specification (GLMM / Mixed Logistic Regression):*
    $$\text{logit}(P(C_{it} = 1)) = \beta_0 + \beta_{\text{Condition}} \text{Condition}_{it} + \beta_{\text{Task}} \text{Task}_{it} + \beta_{\text{Period}} \text{Period}_{it} + u_i$$
  - *Decision Rule:* Two-sided Wald / score test on $\beta_{\text{Condition}} = 0$. Effect size: Adjusted Odds Ratio $\text{OR} = \exp(\beta_{\text{Condition}})$.
  - *Small-Sample Separation Contingency:* If numerical optimization fails to converge due to high compliance or small sample size, contingency is Stratified Cochran-Mantel-Haenszel (CMH) test or Exact Conditional Logistic Regression stratified by sequence group.
- **7.5 Primary Model 4: Composite Task Success Rate ($H_{04}$):**
  - *Dependent Variable:* Binary task success indicator ($S_{it} \in \{0, 1\}$).
  - *Model Specification (GLMM):* Mixed logistic regression controlling for `Task` and `Period`. Contingency: Stratified CMH test.
- **7.6 Multiple Comparisons Correction:**
  - Family-wise error control using the **Holm-Bonferroni step-down procedure** across the four confirmatory hypotheses ($H_{01}..H_{04}$).
  - Adjusted thresholds: $\alpha / (5 - k)$ for ordered $p$-values. Both raw and adjusted $p$-values ($p_{\text{Holm}}$) reported.
- **7.7 Secondary & Exploratory Analysis Plan:**
  - Descriptive statistics (means, medians, IQR, 95% CIs) for $E_1$ through $E_7$.
  - Evaluation of interaction terms ($\text{Condition} \times \text{Period}$ for carryover; $\text{Condition} \times \text{Task}$ for task moderation).

### 7.3 Supporting Evidence & Artifacts
- Pre-Registration Details: [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_PROTOCOL_AND_TASKS.md) Section 1.2
- Export Dataset Schema: [`backend/apps/evaluation/exports.py`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/backend/apps/evaluation/exports.py)

### 7.4 Status & Open Decisions
- **Status:** Complete model specification.
- **Supervisor Decisions Requiring Confirmation:** Selection of statistical execution environment (R with `lme4`/`lmerTest` vs. Python with `statsmodels`).

---

## Chapter 8: Empirical Results

### 8.1 Purpose
Presents empirical results, model parameter estimates, hypothesis test outcomes, and exploratory findings.

### 8.2 Proposed Subsections
- **8.1 Participant Demographics & Cohort Characteristics:** *[Placeholder: Sample size $N$, 3D CAD experience breakdown, AI usage distribution; pending data collection.]*
- **8.2 Confirmatory Hypothesis Results:**
  - *Task Completion Time ($H_{01}$):* *[Placeholder: Adjusted mean difference $\beta$, 95% CI, Satterthwaite $t$, raw $p$, $p_{\text{Holm}}$.]*
  - *Perceived Usability — SUS Score ($H_{02}$):* *[Placeholder: Adjusted difference, empirical grade distribution, Bangor et al. band shifts.]*
  - *Budget Compliance Rate ($H_{03}$):* *[Placeholder: Adjusted Odds Ratio, Wald statistic, compliance percentages.]*
  - *Composite Task Success Rate ($H_{04}$):* *[Placeholder: Adjusted Odds Ratio, success counts across conditions.]*
- **8.3 Model Diagnostics & Sensitivity Analyses:**
  - Residual normality evaluations (Shapiro-Wilk); log-transform comparisons.
  - Sensitivity analysis excluding sessions with prolonged interruptions (`hasProlongedInterruption = True`).
  - Testing of carryover interaction terms ($\text{Condition} \times \text{Period}$).
- **8.4 Exploratory Outcomes ($E_1–E_7$):**
  - AABB overlap count comparisons; doorway keep-out intrusion rates.
  - Manual interaction effort (`totalEdits`, `undoRedoCount`).
  - AI Agent proposal acceptance rates across tiers (Tier 1 technical, Tier 2 schema, Tier 3 containment, Tier 4 approval).
  - Photo-to-3D dimensional accuracy (MAPE against tape measurements, where applicable).

### 8.3 Supporting Evidence & Artifacts
- Export Dataset Command: `python manage.py export_evaluation_dataset`

### 8.4 Status & Open Decisions
- **Status:** Strictly designated as **Pending Human Participant Data Collection**. All numerical tables and effect sizes are unpopulated.

---

## Chapter 9: Discussion and Interpretation

### 9.1 Purpose
Interprets findings in relation to research questions, prior literature, cognitive workload, and architectural design choices.

### 9.2 Proposed Subsections
- **9.1 Synthesizing the AI-Assisted Workflow Impact:** Comparative discussion of time savings vs. fine-tuning interaction effort.
- **9.2 Spatial Reasoning & The Mixed-Initiative Trade-off:** How two-phase approval prevents unintended spatial mutations while maintaining user ownership.
- **9.3 Deterministic Budgeting vs. LLM Hallucination:** Why integer-minor-unit computation is necessary for consumer trust.
- **9.4 Cognitive Load & Usability Shifts:** Interpretation of SUS grade outcomes in the context of user experience.
- **9.5 Practical Implications for 3D Interior Design Tools:** Recommendations for commercial design software integration.

### 9.3 Supporting Evidence & Artifacts
- Architecture Rationale: [`ARCHITECTURE.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ARCHITECTURE.md)

### 9.4 Status & Open Decisions
- **Status:** Outline established; narrative to be completed upon data availability.

---

## Chapter 10: Limitations, Threats to Validity, Privacy, and Research Ethics

### 10.1 Purpose
Transparently documents engineering limitations, threats to internal/external validity, data protection measures, and ethical governance standards.

### 10.2 Proposed Subsections
- **10.1 Technical & Engineering Limitations:**
  - Bounding Volume Approximation: Transformed AABB extents serve as collision proxies, not fine-grained polygon mesh physics.
  - Single-Photo Dimensional Uncertainty: Perspective vision analysis outputs approximate layouts; metric scale cannot be inferred from a single standard image without references.
  - Mobile WebXR AR Dependencies: Variable performance across device chipsets; surface detection dependence on environmental illumination and surface texture.
  - LLM Non-Determinism: Temperature settings and upstream model version updates (`gemini-3.8-flash`).
- **10.2 Threats to Validity:**
  - *Internal Validity:* Order effects (mitigated via 4-sequence counterbalancing); budget-trap asymmetry (calibrated via task factor modeling).
  - *External Validity:* Convenience sampling of university students; catalogue size limited to 10 curated architectural models.
  - *Construct Validity:* SUS as a subjective measure; AABB overlap as a collision proxy.
- **10.3 Privacy & Research Ethics Safeguards:**
  - Telemetry disabled by default (`ENABLE_EVALUATION_TELEMETRY=False`).
  - Strict pause on participant recruitment until formal ethics clearance.
  - Complete absence of personal identifying information in telemetry tables.
  - Ephemeral room photo storage with 1-hour lifecycle and automatic deletion.

### 10.3 Supporting Evidence & Artifacts
- Research Protocol: [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/RESEARCH_PROTOCOL_AND_TASKS.md) Section 2
- Ephemeral Media Policy: [`docs/ROOM_PHOTO_UPLOAD_AND_CLEANUP.md`](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/docs/ROOM_PHOTO_UPLOAD_AND_CLEANUP.md)

### 10.4 Status & Open Decisions
- **Status:** Complete specification.

---

## Chapter 11: Conclusion and Future Work

### 11.1 Purpose
Summarizes capstone engineering achievements, research conclusions, open research horizons, and engineering trajectory.

### 11.2 Proposed Subsections
- **11.1 Summary of Contributions:** Successful realization of an end-to-end, constraint-enforced 3D interior design platform with AI tool calling, photo analysis, reconstruction, and WebXR AR.
- **11.2 Research Conclusions:** Final takeaway regarding mixed-initiative spatial generative design.
- **11.3 Future Work & Extensibility:**
  - Multi-room floor plan optimization.
  - In-browser physics engines (Rapier / Cannon-es) for exact mesh contact.
  - On-device local SLAM mapping and multi-object AR anchor persistence.
  - Open-source local vision models (LLaVA) for fully offline room-photo parsing.

### 11.3 Status & Open Decisions
- **Status:** Outline established.

---

## Chapter 12: References

Compiled academic references conforming to IEEE style:
1. Bangor, A., Kortum, P. T., & Miller, J. T. (2008). An empirical evaluation of the system usability scale. *International Journal of Human-Computer Interaction*, 24(6), 574–594.
2. Bangor, A., Kortum, P., & Miller, J. (2009). Determining what individual SUS scores mean: Adding an adjective rating scale. *Journal of Usability Studies*, 4(3), 114–123.
3. Bates, D., Mächler, M., Bolker, B., & Walker, S. (2015). Fitting linear mixed-effects models using lme4. *Journal of Statistical Software*, 67(1), 1–48.
4. Brooke, J. (1996). SUS: A quick and dirty usability scale. In P. W. Jordan, B. Thomas, I. L. McClelland, & B. Weerdmeester (Eds.), *Usability Evaluation in Industry* (pp. 189–194). Taylor & Francis.
5. Holm, S. (1979). A simple sequentially rejective multiple test procedure. *Scandinavian Journal of Statistics*, 6(2), 65–70.
6. Horvitz, E. (1999). Principles of mixed-initiative user interfaces. In *Proceedings of the SIGCHI Conference on Human Factors in Computing Systems* (pp. 159–166). ACM.
7. Merrell, P., Schkufza, E., Li, Z., Agrawala, M., & Koltun, V. (2011). Interactive furniture layout using interior design guidelines. *ACM Transactions on Graphics (TOG)*, 30(4), 1–10.
8. Yu, L. F., Yeung, S. K., Tang, C. K., Terzopoulos, D., Chan, T. F., & Osher, S. J. (2011). Make it home: Automatic optimization of furniture arrangement. *ACM Transactions on Graphics (TOG)*, 30(4), 1–12.

---

## Appendices

### Appendix A: Reproducibility Guide & Local Environment Setup
Step-by-step reproduction instructions for setting up PostgreSQL 17 on Docker port 5433, initializing Python 3.12 virtual environment, installing dependencies, executing migrations, seeding the 10 CC0 furniture models, and executing the automated test suite (241 Django tests, 143 Vitest tests).

### Appendix B: Evaluation Dataset Schema & Export Methodology
Detailed schema specifications for the CSV and JSON exports generated via `python manage.py export_evaluation_dataset`. Maps all 33 standardized fields to their model origin, serializer transformation, and handling of incomplete/aborted sessions.

### Appendix C: Experimental Task Packets & Informed Consent Forms
Full participant briefing sheets, informed consent declarations, demographic questionnaires, and task instruction cards for Task 1 (Living Room) and Task 2 (Home Study).

### Appendix D: Hardware Verification & Mobile WebXR AR Protocol
Technical documentation of the mobile WebXR AR testing protocol executed and verified on the realme Narzo 70 Turbo 5G (Android 14, ARCore 1.48, Chrome 130+).
