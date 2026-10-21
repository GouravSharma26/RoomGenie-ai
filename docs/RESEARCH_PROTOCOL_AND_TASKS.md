# RoomGenie AI — Research Protocol, Experimental Tasks & Evaluation Instruments

**Milestone:** Phase 8 — Research, Evaluation, and Delivery  
**Document Status:** Complete Experimental Protocol (Pre-Pilot Baseline)  
**Related Documents:** [RESEARCH_PLAN.md](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/RESEARCH_PLAN.md), [ARCHITECTURE.md](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ARCHITECTURE.md), [ASSET_LICENSES.md](file:///c:/Gourav%20Sharma/VR%20Project/roomgenie-ai/ASSET_LICENSES.md)

---

## 1. Study Overview & Research Questions

### 1.1 Context
RoomGenie AI combines interactive 3D WebGL room editing, deterministic budget tracking, multi-tier AI tool calling with a two-phase proposal/approval workflow, and optional photo-to-3D asset approximation. This protocol defines the experimental methodology to evaluate whether AI-assisted 3D room design meaningfully changes task completion time, constraint compliance, perceived usability, and user agency compared to manual design.

### 1.2 Research Questions & Hypotheses
- **Primary Research Question (RQ1):**  
  *Does an AI-assisted interactive 3D interior design workflow change completion time, task success, budget compliance, and perceived usability compared with manual use of the same 3D editor?*
  - **Null Hypothesis ($H_{01}$):** Completion time does not differ between manual and AI-assisted design conditions.
  - **Null Hypothesis ($H_{02}$):** Perceived usability (SUS score) does not differ between manual and AI-assisted conditions.
  - **Null Hypothesis ($H_{03}$):** Layout constraint compliance does not differ between manual and AI-assisted conditions.
  - *Reporting invariant:* Hypotheses are tested objectively. If the AI assistant reduces initial placement time but increases post-generation fine-tuning or fails to prevent subtle layout errors, this outcome will be reported transparently as a research finding.

- **Secondary / Exploratory Question (RQ2 — Photo-to-3D):**  
  *What is the dimensional reconstruction accuracy (absolute and percentage error in width, height, and depth) of single/multi-view photo-to-3D furniture approximation compared against physical ground-truth tape measurements?*

---

## 2. Ethics, Privacy & Governance Requirements

> [!IMPORTANT]
> **Institutional Governance Note:**  
> This protocol specifies the research procedure, consent wording, and data handling safeguards. In accordance with university research standards, **formal supervisor or institutional ethics approval must be recorded before recruiting human participants**. This protocol document alone does not replace formal ethics clearance.

### 2.1 Privacy & Data Protection Safeguards
1. **No Personally Identifiable Information (PII):** Participants are assigned an anonymous alphanumeric identifier (e.g., `P01`, `P02`). No real names, emails, IP addresses, or phone numbers are logged in research datasets.
2. **Local Storage & No Private Media Ingestion:** Experimental trials use the pre-configured local 3D catalogue and standardized synthetic rooms. Participants are **never** asked to upload personal home photography to external cloud APIs during the study trials.
3. **Voluntary Participation & Unconditional Withdrawal:** Participation is entirely voluntary. Participants may halt a trial or withdraw their data at any point without explanation or penalty.
4. **Data Retention & Disposal:** Raw anonymized JSON interaction logs and survey responses will be stored in an access-restricted project directory and destroyed upon project examination completion.

---

## 3. Participant Information & Informed Consent

### Participant Information Sheet

**Study Title:** Evaluating an AI-Assisted 3D Interior Design Workflow with Budget and Spatial Constraints  
**Investigator:** Gourav Sharma (Solo Developer / B.Tech CSE Researcher)  
**Institution:** Department of Computer Science & Engineering  

**Purpose of the Study:**  
You are invited to participate in a research evaluation comparing two workflows for designing a 3D room layout: (1) manual placement using a 3D web editor, and (2) AI-assisted placement using natural language prompts with interactive approval. The goal is to evaluate usability, task efficiency, and constraint adherence.

**What Will You Be Asked to Do?**  
1. Complete a brief pre-questionnaire regarding your background with 3D/CAD tools and generative AI.
2. Perform two short interior design tasks on a desktop computer using a 3D web application. In one task, you will place furniture manually; in the other, an AI assistant will propose initial layouts which you can review, approve, and adjust.
3. Complete a 10-item usability questionnaire (System Usability Scale) after each condition.
4. Answer three brief concluding questions about your experience. Total estimated duration is 30–40 minutes.

**Risks and Discomforts:**  
There are no physical or psychological risks beyond normal desktop computer usage.

**Confidentiality:**  
All responses and design interactions are logged under an anonymous pseudonym (e.g., `P04`). No names or private data will be collected, stored, or published.

---

### Informed Consent Declaration Form

```markdown
[ ] I confirm that I have read and understood the Participant Information Sheet for this study.
[ ] I have had the opportunity to ask questions, and any questions have been answered satisfactorily.
[ ] I understand that my participation is voluntary and that I am free to withdraw at any time without penalty.
[ ] I understand that all data collected will be strictly anonymized under a participant code and used solely for academic research.
[ ] I agree to take part in the study.

Participant Code: ______________          Date: ____________________
```

---

## 4. Experimental Design & Counterbalancing

### 4.1 Study Design
- **Type:** Within-subjects (repeated measures) comparative study.
- **Independent Variable:** Design Workflow Condition:
  - **Condition A (Manual):** Participant searches the catalogue and manually places, translates, rotates, and scales furniture in the 3D room editor. The AI Assistant drawer is locked/disabled.
  - **Condition B (AI-Assisted):** Participant uses the natural-language AI Assistant to request initial room layouts. The assistant generates structured multi-object proposals that the user inspects in a 2-phase diff preview before approving (`/apply/`) or rejecting. The participant can then make manual adjustments in the 3D canvas.

### 4.2 Four-Sequence Counterbalanced Design
To balance the order of conditions (Manual vs. AI-Assisted) and task-condition assignments without confounding, participants are allocated across four counterbalanced sequences:

| Group | Sequence Order | Condition 1 (Task) | Condition 2 (Task) |
| :---: | :---: | :---: | :---: |
| **G1** | $A \rightarrow B$ | Manual (Task 1: Living Room) | AI-Assisted (Task 2: Study) |
| **G2** | $B \rightarrow A$ | AI-Assisted (Task 1: Living Room) | Manual (Task 2: Study) |
| **G3** | $A \rightarrow B$ | Manual (Task 2: Study) | AI-Assisted (Task 1: Living Room) |
| **G4** | $B \rightarrow A$ | AI-Assisted (Task 2: Study) | Manual (Task 1: Living Room) |

### 4.3 Sample Size & Cohort Planning
- **Phase 8.4 Pilot Cohort ($N = 5–8$ participants):** Focuses strictly on discovering protocol friction, clarifying ambiguous instructions, validating telemetry logging accuracy, and verifying task difficulty equivalence. Pilot data will be inspected as preliminary and discarded from the final confirmatory sample if protocol changes occur.
- **Main Study Cohort ($N = 20–30$ participants):** Feasibility target suited for a solo capstone project. Statistical analyses will report exact sample sizes, confidence intervals, and effect sizes, acknowledging sample size constraints rather than asserting unverified high statistical power.

### 4.4 Covariate Logging (Participant Demographics)
Recorded prior to Task 1:
1. **3D / CAD Experience:**  
   - [ ] None (0 years)  
   - [ ] Casual / Gaming (e.g. The Sims, Minecraft, level editors)  
   - [ ] Intermediate (e.g. SketchUp, basic CAD, college coursework)  
   - [ ] Advanced / Professional (e.g. Blender, AutoCAD, 3ds Max, Rhino)  
2. **Generative AI Tool Usage:**  
   - [ ] Never used  
   - [ ] Rarely (once or twice a month)  
   - [ ] Weekly (regular conversational prompting)  
   - [ ] Daily (integrated into daily workflow/studies)  

---

## 5. Standardized Experimental Tasks

Both tasks are strictly balanced across:
1. Number of mandatory functional items (4 items).
2. Tight budget ceiling with a deliberate budget-trap alternative.
3. Defined doorway keep-out clearance box.
4. Available floor circulation requirements.

```
Coordinate System Invariant (Three.js standard):
- Y = Up (metres)
- X = Room Width (metres), centered at X = 0 (span [-W/2, +W/2])
- Z = Room Length (metres), centered at Z = 0 (span [-L/2, +L/2])
- Floor sits at Y = 0.00 m
```

---

### Task 1: Contemporary Living Room

- **Room Dimensions:** Width $W = 5.0\text{ m}$, Length $L = 4.0\text{ m}$, Height $H = 2.8\text{ m}$ (Area: $20.0\text{ m}^2$)
- **Budget Ceiling:** **₹60,000** (6,000,000 paise)
- **Mandatory Functional Furniture (Must place exactly 4 items):**
  1. *Primary Seating:* Modern 3-Seater Sofa (`sofa-modern-3seater`, ₹29,999; $2.1\text{m} \times 0.85\text{m} \times 0.9\text{m}$)
  2. *Central Surface:* Minimalist Coffee Table (`table-oak-coffee`, ₹8,499; $1.2\text{m} \times 0.45\text{m} \times 0.6\text{m}$)
  3. *Secondary Seating:* Lounge Accent Armchair (`chair-accent-armchair`, ₹11,999; $0.85\text{m} \times 0.88\text{m} \times 0.85\text{m}$)
  4. *Fourth Item (Participant Choice):*  
     - Option A: Botanical Ceramic Floor Planter (`decor-plant-floor-vase`, ₹2,499) $\rightarrow$ **Total: ₹52,996** *(Compliant, Headroom ₹7,004)*  
     - Option B (Budget Trap): 4-Tier Architectural Bookshelf (`storage-bookshelf-tall`, ₹16,499) $\rightarrow$ **Total: ₹66,996** *(Exceeds budget by ₹6,996)*  
- **Doorway Specification & Keep-Out Clearance Box:**
  - **Wall Location:** South Wall ($Z = +2.00\text{ m}$)
  - **Door Opening:** Centered at $X = 0.00\text{ m}$, opening width $0.90\text{ m}$ ($X \in [-0.45\text{ m}, +0.45\text{ m}]$)
  - **Inward Clearance Depth:** $1.20\text{ m}$ inward along negative Z ($Z \in [+0.80\text{ m}, +2.00\text{ m}]$)
  - **Mathematical Keep-Out Box Extents:**  
    $$X \in [-0.60\text{ m}, +0.60\text{ m}], \quad Z \in [+0.80\text{ m}, +2.00\text{ m}], \quad Y \in [0.00\text{ m}, 2.10\text{ m}]$$
  - *Rule:* Any furniture bounding box overlapping this zone constitutes a **Doorway Clearance Intrusion**.

---

### Task 2: Modern Executive Study / Home Office

- **Room Dimensions:** Width $W = 4.5\text{ m}$, Length $L = 3.5\text{ m}$, Height $H = 2.8\text{ m}$ (Area: $15.75\text{ m}^2$)
- **Budget Ceiling:** **₹50,000** (5,000,000 paise)
- **Mandatory Functional Furniture (Must place exactly 4 items):**
  1. *Primary Worksurface:* Ergonomic Study Desk (`desk-workspace-study`, ₹14,999; $1.4\text{m} \times 0.75\text{m} \times 0.7\text{m}$)
  2. *Desk Seating:* Lounge Accent Armchair (`chair-accent-armchair`, ₹11,999; $0.85\text{m} \times 0.88\text{m} \times 0.85\text{m}$)
  3. *Reference Storage:* 4-Tier Architectural Bookshelf (`storage-bookshelf-tall`, ₹16,499; $1.0\text{m} \times 1.8\text{m} \times 0.35\text{m}$)
  4. *Fourth Item (Participant Choice):*  
     - Option A: Botanical Ceramic Floor Planter (`decor-plant-floor-vase`, ₹2,499) $\rightarrow$ **Total: ₹45,996** *(Compliant, Headroom ₹4,004)*  
     - Option B (Budget Trap): Minimalist Coffee/Side Table (`table-oak-coffee`, ₹8,499) $\rightarrow$ **Total: ₹51,996** *(Exceeds budget by ₹1,996)*  
- **Doorway Specification & Keep-Out Clearance Box:**
  - **Wall Location:** East Wall ($X = +2.25\text{ m}$)
  - **Door Opening:** Centered at $Z = 0.00\text{ m}$, opening width $0.90\text{ m}$ ($Z \in [-0.45\text{ m}, +0.45\text{ m}]$)
  - **Inward Clearance Depth:** $1.20\text{ m}$ inward along negative X ($X \in [+1.05\text{ m}, +2.25\text{ m}]$)
  - **Mathematical Keep-Out Box Extents:**  
    $$X \in [+1.05\text{ m}, +2.25\text{ m}], \quad Z \in [-0.60\text{ m}, +0.60\text{ m}], \quad Y \in [0.00\text{ m}, 2.10\text{ m}]$$
  - *Rule:* Any furniture bounding box overlapping this zone constitutes a **Doorway Clearance Intrusion**.

---

### 5.3 Task Equivalence Matrix

| Task Parameter | Task 1 (Living Room) | Task 2 (Home Study) | Equivalence Assessment |
| :--- | :---: | :---: | :--- |
| **Target Function** | Residential Social Living | Residential Productive Study | Equivalent domestic context |
| **Mandatory Item Count** | 4 items | 4 items | Identical ($N = 4$) |
| **Budget Ceiling** | ₹60,000 | ₹50,000 | Proportional to room volume |
| **Compliant Headroom** | ₹7,004 (11.67% margin) | ₹4,004 (8.01% margin) | Feasible compliance headroom |
| **Budget Trap Overrun** | +₹6,996 (+11.66% overrun) | +₹1,996 (+3.99% overrun) | Documented severity difference (see note below) |
| **Keep-Out Clearance Depth** | $1.20\text{ m}$ inward ($0.9\text{m}$ door) | $1.20\text{ m}$ inward ($0.9\text{m}$ door) | Identical clearance depth |
| **Wall Boundary Constraints** | 4 walls ($5.0\text{m} \times 4.0\text{m}$) | 4 walls ($4.5\text{m} \times 3.5\text{m}$) | Identical boundary topology |

> [!NOTE]
> **Budget-Trap Severity Asymmetry & Pilot Investigation:**  
> Discrete pricing across the curated 10-item architectural catalogue creates an asymmetry in trap severity: Task 1's alternative exceeds the ceiling by 11.66% (+₹6,996), whereas Task 2's alternative exceeds the ceiling by 3.99% (+₹1,996). Rather than assuming identical trade-off tension, this disparity (prominent 11.66% vs subtle 3.99% overrun) is explicitly treated as a task factor to be calibrated during the Phase 8.4 pilot study. Sensitivity analyses in the statistical evaluation will test whether participant detection of overruns differs by task or condition.

---

## 6. Operational Definitions: Implemented Capabilities vs. Proposed Instrumentation

To maintain scientific integrity, the research metrics are split between **features currently operating in code** and **telemetry instrumentation to be implemented in Step 8.2**:

```mermaid
graph TD
    subgraph Currently Implemented
        A[3D Room Boundary Containment] -->|Evaluates extents vs room limits| Val[validators.py / budget.py]
        B[Authoritative Budget Total] -->|Integer paise deterministic calculation| Bud[estimate_budget_summary]
        C[Multi-Tier Agent Validity] -->|Request, Schema, Bounds, Approval| Agent[tools.py / AgentRun]
        D[Boundary Clamping & Rejection] -->|Blocks out-of-bounds save in UI & API| Clamp[editorStore.ts / serializers.py]
    end
    subgraph Proposed in Step 8.2 Telemetry
        E[AABB Overlap Detector] -.->|AABB pair intersection proxy| Overlap[aabbOverlapPairsCount Metric]
        F[Doorway Clearance Detector] -.->|Silent keep-out box intersection| Door[doorwayIntrusionsCount Metric]
        G[Interaction Event Aggregator] -.->|Debounced pointerUp & undo log| Edits[totalEdits Metric]
        H[Attempted Violation Tracker] -.->|Logs boundary clashes during editing| Attempt[attemptedOutOfBoundsCount]
    end
```

### 6.1 Currently Implemented in Codebase
1. **Room Boundary Containment & Enforcement:**  
   - Implemented in `backend/apps/designs/validators.py`, `backend/apps/furniture/budget.py`, and `frontend/src/editor3d/store/editorStore.ts`.  
   - Calculates transformed Axis-Aligned Bounding Box (AABB) half-extents $(e_x, e_y, e_z)$ for each placed object considering dimensions, scale, and Euler rotation.  
   - **Enforcement Mechanics:**  
     - In the 3D editor (`editorStore.ts`), drag movements are actively clamped to room boundaries.
     - In backend serialization (`validators.py`), scenes with items extending beyond $[-W/2, +W/2]$ (X), $[-L/2, +L/2]$ (Z), or $[0, H]$ (Y) by more than 1 cm trigger a `ValidationError` (HTTP 400), strictly blocking the design save.
     - In the AI agent runner (`tools.py`), proposed layouts with boundary breaches have `room_containment_valid = False`, blocking user approval (`/apply/`).
   - *Measurement Implication:* Because invalid scenes cannot be successfully saved under standard application rules, a submitted final scene is expected to exhibit `finalSceneOutOfBoundsCount = 0`.
2. **Authoritative Integer Paise Budget (`budgetTotalPaise`, `isBudgetCompliant`):**  
   - Implemented in `backend/apps/furniture/budget.py`.  
   - Computes deterministic price sum in integer minor units (paise). Returns category subtotals, itemized pricing, unpriced asset flag, and compliance against target budget.
3. **Multi-Tier Agent Proposal Validity:**  
   - Implemented in `backend/apps/ai_agent/tools.py` and `views.py`.  
   - Evaluated across four distinct tiers:
     - **Tier 1 (Technical Request Success):** HTTP status code 200 vs 5xx/network timeout.
     - **Tier 2 (Schema Validity):** LLM tool call adheres to allowlisted action signatures and valid parameter types.
     - **Tier 3 (Domain Constraint Validity):** Proposed furniture layout passes 3D room boundary containment checks (`room_containment_valid = True`).
     - **Tier 4 (User Approval Rate):** Number of proposed agent runs transitioned from `status='proposed'` to `status='applied'` via explicit `/apply/` user confirmation.

### 6.2 Proposed Research Instrumentation (Step 8.2 Specifications)
1. **AABB Overlap Pairs Count (`aabbOverlapPairsCount`):**  
   - *Definition:* Axis-Aligned Bounding Box (AABB) overlap serves as a geometric proxy for object collision, not direct proof that furniture polygon meshes intersect. For every distinct pair of placed objects $(i, j)$ with $i < j$, the evaluation engine calculates the transformed AABB extents along all three axes $(X, Y, Z)$ using a $0.02\text{ m}$ (2 cm) numerical tolerance threshold. Pairs whose AABBs intersect across all three axes increment `aabbOverlapPairsCount`.
   - *Unit:* Integer count of overlapping AABB pairs in the final submitted scene.
2. **Doorway Keep-Out Violation Count (`doorwayIntrusionsCount`):**  
   - *Definition:* Evaluates whether any furniture 3D bounding box overlaps with the task's defined doorway keep-out box. Evaluated **silently** on the final submitted scene without rendering an in-editor visual hint during participant trials.  
   - *Unit:* Integer count of intruding objects in the final submitted scene.
3. **Attempted vs. Final Boundary Violations:**  
   - `attemptedOutOfBoundsCount`: Runtime count of instances where a participant dragged furniture against boundary clamps or where an AI proposal contained out-of-bounds placements.
   - `finalSceneOutOfBoundsCount`: Post-submission verification of the final scene snapshot against canonical room bounds (expected to be 0 for validly saved designs).
4. **Manual Adjustments Count (`totalEdits`):**  
   - *Definition:* Total discrete manual interactions performed in the editor:
     - Furniture added from palette: $+1$
     - Furniture removed/deleted: $+1$
     - Furniture duplicated: $+1$
     - Material override / color change: $+1$
     - Translation / Rotation / Scale: Recorded strictly on pointer release (`onPointerUp` / drag termination). Continuous intermediate mousemove events are **grouped/debounced** and do not increment the counter.
     - Undo / Redo: Logged separately under `undoRedoCount` to allow analyzing gross vs. net adjustments.
5. **Task Duration (`durationSeconds`):**  
   - *Definition:* High-resolution wall-clock duration from participant opening the task view to clicking the final "Submit Design" button.

---

## 7. Standardized Questionnaires & Scoring

### 7.1 System Usability Scale (SUS)
The standard 10-item System Usability Scale (Brooke, 1996) is administered immediately following the completion of each condition (Condition A SUS, Condition B SUS).

**Response Scale:** 5-point Likert scale (1 = Strongly Disagree, 2 = Disagree, 3 = Neutral, 4 = Agree, 5 = Strongly Agree).

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

#### Correct SUS Scoring Formula
Each response $Q_i$ is mapped to an integer score from 1 to 5.
- For odd-numbered items ($i \in \{1, 3, 5, 7, 9\}$), contribution $X_i = Q_i - 1$.
- For even-numbered items ($i \in \{2, 4, 6, 8, 10\}$), contribution $X_i = 5 - Q_i$.
- Sum all ten transformed contributions and multiply by $2.5$:

$$SUS = 2.5 \times \left[ \sum_{i \in \{1, 3, 5, 7, 9\}} (Q_i - 1) + \sum_{i \in \{2, 4, 6, 8, 10\}} (5 - Q_i) \right]$$

> [!NOTE]
> **Interpretation Rules (Bangor, Kortum & Miller, 2008, 2009; Brooke, 1996):**  
> The resulting score ranges from $0$ to $100$. It is a standardized composite usability score, **not** a percentage of users who found the system usable. Standard empirical grading bands:
> - $< 50.0$: Not Acceptable / Poor (Grade F)
> - $50.0 - 64.9$: Marginal / Below Average (Grade D)
> - $65.0 - 70.9$: Acceptable / Average (Grade C; $68.0$ represents the empirical cross-industry mean)
> - $71.0 - 84.9$: Good Usability (Grade B)
> - $\ge 85.0$: Excellent Usability (Grade A)

---

### 7.2 Post-Experiment Exit Survey (Administered after both conditions)

1. **Overall Preference:**  
   - *Question:* Which design workflow did you prefer overall?  
   - *Options:* [ ] Strongly prefer Manual Editor | [ ] Slightly prefer Manual Editor | [ ] Neutral / No preference | [ ] Slightly prefer AI-Assisted | [ ] Strongly prefer AI-Assisted
2. **Subjective Workload (Mental Demand):**  
   - *Question:* Which workflow felt more mentally demanding? (Manual / AI-Assisted / Equal)
3. **Agency & Control:**  
   - *Question:* Did you feel in control of the final design when using the AI assistant? (1 = Lost Control, 5 = Complete Control)
4. **Qualitative Feedback:**  
   - *Prompt:* What was the most frustrating aspect of each workflow?  
   - *Prompt:* In what scenarios would you choose the manual editor over the AI assistant, or vice-versa?

---

## 8. Photo-to-3D Reconstruction Measurement Protocol

For the exploratory evaluation of single/multi-view furniture reconstruction (using the Tripo integration and mock baseline):

### 8.1 Ground Truth Physical Measurement Procedure
1. Select $K = 5$ physical domestic furniture items available in the test environment (e.g., small stool, bedside table, dining chair, table lamp, side cabinet).
2. Use a certified metric steel tape measure to record ground-truth dimensions with $\pm 0.5\text{ cm}$ ($\pm 0.005\text{ m}$) measurement uncertainty:
   - Width ($W_{\text{phys}}$): Maximum bounding horizontal span perpendicular to depth axis.
   - Depth ($D_{\text{phys}}$): Maximum bounding horizontal span perpendicular to width axis.
   - Height ($H_{\text{phys}}$): Maximum vertical height from floor contact to topmost point.
3. Validate that every ground-truth dimension satisfies $M_{\text{phys}} \ge 0.05\text{ m}$ ($5\text{ cm}$) to ensure relative percentage error calculations are well-defined and avoid division-by-zero.

### 8.2 Reconstructed Bounding Extents Extraction
1. Load the generated `.glb` asset into Three.js or run backend `GLBValidator` bounding extraction.
2. Compute the object's Axis-Aligned Bounding Box: `box = new THREE.Box3().setFromObject(mesh)`.
3. Extract bounding dimensions:
   $$W_{\text{recon}} = \text{box.max.x} - \text{box.min.x}, \quad H_{\text{recon}} = \text{box.max.y} - \text{box.min.y}, \quad D_{\text{recon}} = \text{box.max.z} - \text{box.min.z}$$

### 8.3 Error Formulas
For each axis $A \in \{W, H, D\}$:
- **Absolute Error ($\Delta A$):**  
  $$\Delta A = |A_{\text{recon}} - A_{\text{phys}}| \quad (\text{metres})$$
- **Relative Error ($\% A$):**  
  $$\% A = \left( \frac{|A_{\text{recon}} - A_{\text{phys}}|}{A_{\text{phys}}} \right) \times 100\%$$
- **Mean Absolute Error (MAE):**  
  $$\text{MAE} = \frac{1}{K} \sum_{k=1}^K \Delta A_k$$
- **Mean Absolute Percentage Error (MAPE):**  
  $$\text{MAPE} = \frac{1}{K} \sum_{k=1}^K (\% A_k)$$

### 8.4 Data Logging Table Template

> [!NOTE]
> **Synthetic Formatting Illustration Only — No Observed Data:**  
> The first row below is purely a synthetic mathematical example to illustrate column calculation formatting. No physical trials or participant experiments have yet taken place.

| Item ID | Physical Dimensions ($W \times D \times H$, m) | Reconstructed ($W \times D \times H$, m) | Absolute Error ($\Delta W, \Delta D, \Delta H$, cm) | Relative Error ($\%W, \%D, \%H$) | Processing Duration (s) | Visual Rating (1–5) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| *Example (Synthetic)* | *$0.850 \times 0.850 \times 0.880$* | *$0.820 \times 0.890 \times 0.840$* | *$3.0, 4.0, 4.0$* | *$3.5\%, 4.7\%, 4.5\%$* | *$24.2\text{ s}$* | *4 / 5* |
| `P3D-01` | — | — | — | — | — | — |
| `P3D-02` | — | — | — | — | — | — |
| `P3D-03` | — | — | — | — | — | — |
| `P3D-04` | — | — | — | — | — | — |
| `P3D-05` | — | — | — | — | — | — |

---

## 9. Data Hygiene, Exclusion Rules & Step 8.2 Architectural Decisions

### 9.1 Data Exclusion & Hygiene Rules
1. **Incomplete Trials:** If a participant experiences a hardware failure, browser crash, or withdraws mid-session, their session is marked with `sessionStatus = 'aborted'` in the database. Incomplete trials will be recorded rather than silently lost, but excluded from paired confirmatory hypothesis tests.
2. **Inactivity Logging & Sensitivity Rules:** Telemetry will track idle intervals (periods $> 60\text{ s}$ without pointer, key, or tool input). An inactivity gap exceeding 15 minutes will **not** be automatically discarded as an invalid outlier, as prolonged reflection or task distraction may occur. Instead, researchers will explicitly note interruptions during observed trials. In the analysis phase, pre-registered sensitivity analyses will evaluate completion time both with and without prolonged pauses ($> 15\text{ min}$), reporting both distributions transparently.
3. **Zero-Division Protection:** All percentage error calculations must assert non-zero ground-truth baselines ($M_{\text{phys}} \ge 0.05\text{ m}$).

---

### 9.2 Step 8.2 Architectural Decisions

#### Decision 1: Local Backend Persistence + Controlled JSON/CSV Export Utility
- **Architecture:** Evaluation sessions will be persisted through a dedicated Django endpoint (`POST /api/v1/evaluation/sessions/`) rather than relying on browser-triggered client downloads.
- **Session Lifecycle & Recovery:** Each session record includes a schema version (`schemaVersion: 1`) and lifecycle status (`in_progress`, `completed`, `aborted`), storing enough state to recover from accidental browser refreshes and prevent loss of incomplete trials.
- **Client Aggregation:** The frontend editor aggregates discrete manual actions (pointer up debouncing) and submits the finalized telemetry payload upon clicking "Submit Design", avoiding per-pointer-movement network chatter.
- **Server-Authoritative Metrics:** The backend recalculates final budget totals (`budgetTotalPaise`, `isBudgetCompliant`), room boundary containment (`finalSceneOutOfBoundsCount`), AABB proxy overlaps (`aabbOverlapPairsCount`), and doorway keep-out intrusions (`doorwayIntrusionsCount`) from the authoritative submitted scene JSON.
- **Evaluator Export:** An evaluator-only management command (or authorized endpoint) will export the anonymized research dataset as versioned CSV and JSON files (`evaluation_dataset_v1.csv`).
- **Privacy & Isolation:** Evaluation logging is disabled by default (`ENABLE_EVALUATION_LOGGING = False`) and activated solely in the experimental environment. No participant names, emails, authentication tokens, or personal room photographs enter the research dataset.

#### Decision 2: Silent Evaluation of Doorway Keep-Out Box
- **No In-Editor Visual Hint:** The doorway keep-out clearance box is a scoring metric, not an in-editor visual aid. Rendering a visible overlay on the floor during trials could artificially alter spatial behavior and introduce an extraneous UI confound unrelated to the AI-assisted workflow.
- **Identical Instructions:** Both conditions receive identical text instructions stating the doorway location and the requirement to maintain a clear circulation corridor.
- **Silent Evaluation:** The evaluator engine applies the coordinate-based keep-out rule uniformly to both final layouts post-submission. A visual debugging overlay may exist in development mode (`DEBUG=True`), but must be strictly disabled during study trials.

#### Telemetry Schema (`ExperimentSessionRecord`)
```typescript
interface ExperimentSessionRecord {
  schemaVersion: number;              // e.g. 1
  participantId: string;              // e.g. "P04"
  condition: 'manual' | 'ai_assisted';
  sequenceOrder: 'G1' | 'G2' | 'G3' | 'G4';
  taskName: 'living_room' | 'home_study';
  sessionStatus: 'in_progress' | 'completed' | 'aborted';
  startTime: string;                  // ISO 8601
  endTime: string;                    // ISO 8601
  durationSeconds: number;
  idleGapSeconds: number;             // Cumulative inactivity intervals > 60s
  budgetTotalPaise: number;
  budgetCeilingPaise: number;
  isBudgetCompliant: boolean;
  attemptedOutOfBoundsCount: number;  // Clamps / collision warnings during editing
  finalSceneOutOfBoundsCount: number; // Post-submission verification (expected 0)
  aabbOverlapPairsCount: number;      // Bounding box overlap proxy count
  doorwayIntrusionsCount: number;     // Intrusion into silent keep-out box
  totalEdits: number;                 // Discrete manual changes (debounced)
  undoRedoCount: number;              // Separate undo/redo count
  agentProposalsCount: number;        // Total AI proposals generated
  agentAcceptedCount: number;         // Total proposals approved via /apply/
}
```
