# RoomGenie AI — Research Decision Register

**Document Status:** Pre-Study Governance & Decision Baseline  
**Project:** RoomGenie AI (Solo B.Tech CSE Project — Gourav Sharma)  
**Related Documents:** [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](RESEARCH_PROTOCOL_AND_TASKS.md), [`docs/THESIS_SYNTHESIS_AND_REPORT_OUTLINE.md`](THESIS_SYNTHESIS_AND_REPORT_OUTLINE.md), [`docs/STATISTICAL_ANALYSIS_PLAN.md`](STATISTICAL_ANALYSIS_PLAN.md)  
**Last Updated:** October 2026  

---

> [!IMPORTANT]
> **Governance Notice:**  
> This register catalogs all architectural, methodological, statistical, and ethical decisions governing the RoomGenie AI evaluation study. Decisions marked **`LOCKED`** reflect established parameters in the research protocol. Decisions marked **`PENDING SUPERVISOR`** or **`PENDING ETHICS`** require formal written sign-off before participant recruitment or empirical data collection can commence.

---

## 1. Decision Status Taxonomy

Every methodological choice in RoomGenie AI is classified under one of five authoritative statuses:

| Status | Definition | Authority Required |
| :--- | :--- | :--- |
| **`LOCKED`** | Firmly specified in the core protocol, implemented in code, and verified by tests. May not be altered without formal protocol amendment. | Researcher / Pre-registered Protocol |
| **`PROPOSED`** | A well-reasoned candidate approach documented for review, but subject to revision. | Researcher & Supervisor |
| **`PENDING SUPERVISOR`** | A technical or statistical decision requiring explicit review and selection by the academic project supervisor. | Academic Supervisor |
| **`PENDING ETHICS`** | A procedural, recruitment, or consent item requiring formal approval from the Institutional Ethics Review Committee / Institutional Review Board (IRB). | Institutional Ethics Board |
| **`NOT APPLICABLE`** | Formally considered and excluded as unnecessary or unsuited to the research design. | Researcher & Supervisor |

---

## 2. Research Decision Matrix

| ID | Decision Domain | Protocol Position | Status | Authority | Impact / Prerequisite |
| :---: | :--- | :--- | :---: | :---: | :--- |
| **DEC-01** | **Research Questions & Hypotheses** | 4 confirmatory hypotheses: $H_{01}$ (Task Completion Time), $H_{02}$ (SUS Usability), $H_{03}$ (Budget Compliance), $H_{04}$ (Task Success). 4 secondary exploratory metrics. | `LOCKED` | Protocol | Defines primary estimands and statistical testing family. |
| **DEC-02** | **Experimental Design** | $2 \times 2$ Within-Subjects (repeated measures) Crossover comparative design. Condition A (Manual) vs. Condition B (AI-Assisted). | `LOCKED` | Protocol | Governs participant assignment and variance partitioning. |
| **DEC-03** | **Sample Size & Target Cohort** | Target $N = 30$ participants ($M = 60$ session observations). Pilot cohort of $N = 5–8$ for telemetry and instruction calibration. | `LOCKED` | Protocol | Feasibility target suited for solo capstone; reported with exact CIs. |
| **DEC-04** | **Task Definitions & Severity** | Task 1 (Living Room, $5\text{m}\times 4\text{m}$, ₹60,000 ceiling, 11.66% budget trap); Task 2 (Home Study, $4.5\text{m}\times 3.5\text{m}$, ₹50,000 ceiling, 3.99% budget trap). | `LOCKED` | Protocol | Standardized across all participants; budget asymmetry modeled as factor. |
| **DEC-05** | **Counterbalancing & Sequence** | 4-sequence Latin square counterbalancing (G1: $A_1 \to B_2$, G2: $B_1 \to A_2$, G3: $A_2 \to B_1$, G4: $B_2 \to A_1$). Balanced across order and task. | `LOCKED` | Protocol | Eliminates confounding between condition, task, and trial period. |
| **DEC-06** | **Primary Outcome Measures** | Active task duration ($Y_{it}$ seconds), Brooke (1996) SUS composite score ($0–100$), budget compliance ($1/0$), task success conjunction ($1/0$). | `LOCKED` | Protocol | Direct inputs to confirmatory hypotheses $H_{01}..H_{04}$. |
| **DEC-07** | **Secondary Telemetry Metrics** | AABB overlap pairs count, silent doorway keep-out intrusions, attempted out-of-bounds clashes, debounced manual edits, undo/redo count. | `LOCKED` | Protocol | Server-authoritative automated telemetry; no visual bias in editor. |
| **DEC-08** | **AI Agent Validity Tiers** | Tier 1 (Technical 200 OK), Tier 2 (Allowlisted Tool Schema), Reference Resolution, Tier 3 (3D Room Containment Domain Validity), Tier 4 (User Approval Rate). | `LOCKED` | Protocol | Distinguishes LLM syntax compliance from spatial validity & user intent. |
| **DEC-09** | **SUS Instrument & Scoring** | Standard 10-item System Usability Scale (Brooke 1996), 5-point Likert scale ($1–5$), Bangor et al. (2008, 2009) grading scale ($0–100$). | `LOCKED` | Protocol | Standardized psychometric instrument with verified backend validation. |
| **DEC-10** | **SUS Response Validation Engine** | Strict rejection of booleans, non-integers, non-finite floats, duplicate keys across string/int, and shadowed invalid ratings. Deferred normalization. | `LOCKED` | Protocol / Code | Hardened in Phase 8.3; verified by 42 evaluation unit tests. |
| **DEC-11** | **Primary Statistical Models** | Linear Mixed-Effects Models (LMM) for continuous outcomes ($H_{01}, H_{02}$); Generalized Linear Mixed Models (GLMM, logit link) for binary outcomes ($H_{03}, H_{04}$). | `LOCKED` | Protocol | Models participant random intercept $u_i \sim \mathcal{N}(0, \sigma_u^2)$ for repeated measures. |
| **DEC-12** | **LMM Task-Time Diagnostic Pipeline** | Primary: Untransformed seconds $Y_{it}$. If Shapiro-Wilk $p < 0.05$ or skewness $> 1.0$: log-transformed $\ln(Y_{it})$. Fallback: $\text{GLMM}_{\text{Gamma}}$ or Koch rank analysis. | `LOCKED` | Protocol | Pre-registered assumption-checking and transformation procedure. |
| **DEC-13** | **LMM Degrees-of-Freedom Method** | Choice between Satterthwaite approximation vs. Kenward–Roger adjustment for denominator degrees of freedom with $N=30$. | `PENDING SUPERVISOR` | Supervisor | Determines small-sample $t$-statistic critical thresholds. |
| **DEC-14** | **Individual SUS-Item Analysis** | Retaining Likert items $Q_1..Q_{10}$ as exploratory ordinal analysis via Cumulative Link Mixed Models (CLMM) in thesis appendix. | `PENDING SUPERVISOR` | Supervisor | Protects confirmatory family-wise error rate; provides granular UX insight. |
| **DEC-15** | **Random Slope vs. Intercept Only** | Starting model retains random intercept $u_i$. Evaluating condition random slope ($\text{Cond} \mid \text{Participant}$) only if convergence permits without singular fit. | `PENDING SUPERVISOR` | Supervisor | Balances model complexity against risk of overparameterization with $N=30$. |
| **DEC-16** | **Multiple-Comparison Correction** | Holm–Bonferroni step-down procedure across the four confirmatory tests ($H_{01}..H_{04}$), strictly maintaining Family-Wise Error Rate $\alpha_{\text{FWER}} \le 0.05$. | `LOCKED` | Protocol | Controls Type I error inflation across correlated crossover outcomes. |
| **DEC-17** | **Missing Data & Session Attrition** | Completed sessions used for confirmatory models. Aborted sessions retained with partial checkpoints and analyzed for dropout/attrition patterns. | `LOCKED` | Protocol | Excludes incomplete trials without introducing survivorship bias. |
| **DEC-18** | **Session Invalidation & Exclusion** | Pre-registered exclusion criteria: prolonged disruption $\ge 15\text{ min}$ (`hasProlongedInterruption`), technical software crash, or explicit non-compliance. | `LOCKED` | Protocol | Prevents contaminated timing/engagement data from biasing models. |
| **DEC-19** | **Privacy, Retention, & Anonymization** | Coded participant IDs (`P01`), 14-day data withdrawal window, irreversible anonymization aggregation lock on study conclusion, no biometrics/webcam. | `PENDING ETHICS` | Ethics Committee | Governs human-subject data protection, consent, and storage. |
| **DEC-20** | **Institutional Ethics Approval** | Formal application to Institutional Ethics Review Committee / Institutional Review Board. Recruitment strictly paused until clearance is granted. | `PENDING ETHICS` | Ethics Committee | Mandatory legal and ethical precondition for human participation. |
| **DEC-21** | **Dataset Export & Reproducibility** | Standardized 33-column CSV and hierarchical JSON exports via `python manage.py export_evaluation_dataset`. Telemetry disabled by default. | `LOCKED` | Protocol / Code | Verified by management command tests and schema specification. |

---

## 3. Detailed Unresolved Decisions (Pending Supervisor & Ethics)

### Decision A: LMM Denominator Degrees-of-Freedom Approximation
- **Decision ID:** `DEC-13`
- **Current Protocol Position:** Satterthwaite approximation is specified in the thesis synthesis outline (`docs/THESIS_SYNTHESIS_AND_REPORT_OUTLINE.md` Section 7.2).
- **The Unresolved Question:** Should the analysis retain Satterthwaite degrees of freedom or adopt the Kenward–Roger adjustment?
- **Why It Matters:** In repeated-measures crossover models with moderate sample sizes ($N=30$), standard Wald tests inflate Type I error rates. The Satterthwaite approximation computes effective degrees of freedom based on variance components. The Kenward–Roger method additionally applies an adjusted covariance matrix that accounts for small-sample bias in estimated standard errors.
- **Recommendation:** **Adopt Kenward–Roger adjustment** as the preferred approach for LMM models $H_{01}$ and $H_{02}$ (implemented via `lmerTest` in R or `statsmodels` in Python). It is slightly more conservative and better protects Type I error in $2 \times 2$ crossover designs.
- **Approval Required:** Academic Project Supervisor.
- **Resolution Timing:** Must be locked prior to unblinding and analyzing collected data.

---

### Decision B: Exploratory Individual SUS-Item Analysis
- **Decision ID:** `DEC-14`
- **Current Protocol Position:** The 10-item SUS composite score ($0–100$, continuous) is the sole confirmatory usability outcome ($H_{02}$).
- **The Unresolved Question:** Should individual 5-point Likert survey items ($Q_1 \dots Q_{10}$) be analyzed in an exploratory appendix using Cumulative Link Mixed Models (CLMM)?
- **Why It Matters:** Treating individual 5-point Likert questions as continuous Gaussian variables in an ANOVA or LMM violates bounded ordinal assumptions. However, running 10 separate ordinal models in the main body would induce severe multiple-testing penalties.
- **Recommendation:** **Keep individual item analysis strictly exploratory** in Thesis Appendix C using an ordinal mixed model (`clmm` with logit link in R `ordinal` package), while maintaining Brooke's continuous composite score as the sole confirmatory hypothesis in Chapter 9.
- **Approval Required:** Academic Project Supervisor.
- **Resolution Timing:** Can be confirmed during thesis outline approval.

---

### Decision C: Random Intercept vs. Random Slope Model Complexity
- **Decision ID:** `DEC-15`
- **Current Protocol Position:** The protocol pre-registers a participant random intercept model: $u_i \sim \mathcal{N}(0, \sigma_u^2)$.
- **The Unresolved Question:** Should a condition random slope ($(\text{Condition} \mid \text{Participant})$) be added to the model to allow individual-specific treatment effects?
- **Why It Matters:** With $N=30$ participants completing only 2 trials each, each participant provides exactly one observation per condition. Estimating a random slope variance $\sigma_{\text{slope}}^2$ and correlation $\rho$ consumes additional degrees of freedom and frequently leads to singular fit warnings (`boundary (singular) fit: see ?isSingular`) or non-convergence in R `lme4`.
- **Recommendation:** **Retain the random intercept model as primary**. Evaluate the random slope model strictly as a sensitivity check; if singular fit occurs, report the singular diagnostic and retain the parsimonious random intercept specification.
- **Approval Required:** Academic Project Supervisor.
- **Resolution Timing:** Must be documented before confirmatory model execution.

---

### Decision D: Institutional Ethics Clearance & Informed Consent Lock
- **Decision ID:** `DEC-19` and `DEC-20`
- **Current Protocol Position:** Formal participant information sheet and consent form are drafted in `docs/RESEARCH_PROTOCOL_AND_TASKS.md` Section 3. Participant recruitment is strictly paused.
- **The Unresolved Question:** Has the institutional ethics review committee granted written approval with an official protocol clearance number?
- **Why It Matters:** Conducting human-subject trials or collecting participant telemetry without formal institutional clearance violates academic ethics standards and invalidates research findings for degree submission or publication.
- **Recommendation:** **Maintain strict pause on recruitment**. Submit the compiled research readiness package (`docs/RESEARCH_PROTOCOL_AND_TASKS.md`, `docs/STATISTICAL_ANALYSIS_PLAN.md`, `docs/ETHICS_AND_DATA_GOVERNANCE_GATE.md`) to the department/institutional ethics committee. No participant sessions may be scheduled until written approval is issued.
- **Approval Required:** Institutional Ethics Review Board / Departmental Ethics Committee.
- **Resolution Timing:** **Mandatory prerequisite before participant recruitment.**
