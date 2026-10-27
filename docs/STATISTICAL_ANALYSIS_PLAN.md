# RoomGenie AI — Statistical Analysis Plan (SAP)

**Document Status:** Formal Pre-Registered Statistical Specification  
**Project:** RoomGenie AI (Solo B.Tech CSE Project — Gourav Sharma)  
**Related Documents:** [`docs/RESEARCH_PROTOCOL_AND_TASKS.md`](RESEARCH_PROTOCOL_AND_TASKS.md), [`docs/RESEARCH_DECISION_REGISTER.md`](RESEARCH_DECISION_REGISTER.md), [`docs/EVALUATION_DATASET_AND_EXPORT_GUIDE.md`](EVALUATION_DATASET_AND_EXPORT_GUIDE.md)  
**Author:** Gourav Sharma  
**Version:** 1.0 (Pre-Study Lock)  
**Date:** October 2026  

---

> [!IMPORTANT]
> **Pre-Registration Lock:**  
> This Statistical Analysis Plan (SAP) specifies the confirmatory mathematical models, decision rules, diagnostics, and handling of missing observations for the RoomGenie AI evaluation study. To maintain scientific integrity, all confirmatory hypotheses and multiplicity corrections are locked prior to participant data collection. Unresolved supervisor decisions are explicitly documented and isolated from confirmatory models.

---

## 1. Study Overview & Experimental Framework

### 1.1 Research Objective
The empirical evaluation compares the efficiency, usability, and design quality of two interior-design workflows:
- **Condition A (Manual CAD Workflow):** Traditional catalog search, 3D object manipulation, manual boundary checking, and manual mental budget calculation.
- **Condition B (AI-Agent-Assisted Workflow):** Natural-language multimodal agent with 2-phase proposal simulation, automated boundary/clearance verification, and deterministic budget accounting.

### 1.2 Crossover Study Design
- **Structure:** $2 \times 2$ Within-Subjects (repeated measures) Crossover comparative trial.
- **Sample Target:** $N = 30$ participants completing 2 trials each, yielding $M = 60$ total session observations.
- **Counterbalancing:** 4-sequence Latin square allocation (G1–G4) balancing condition order ($A \to B$ vs. $B \to A$) and task pairing (Task 1 Living Room vs. Task 2 Home Study):

$$\begin{array}{c|c|c|c}
\textbf{Sequence Group} & \textbf{Period 1 Trial} & \textbf{Period 2 Trial} & \textbf{Target } n \\
\hline
\textbf{G1} & \text{Manual (Task 1: Living Room)} & \text{AI-Assisted (Task 2: Study)} & 7–8 \\
\textbf{G2} & \text{AI-Assisted (Task 1: Living Room)} & \text{Manual (Task 2: Study)} & 7–8 \\
\textbf{G3} & \text{Manual (Task 2: Study)} & \text{AI-Assisted (Task 1: Living Room)} & 7–8 \\
\textbf{G4} & \text{AI-Assisted (Task 2: Study)} & \text{Manual (Task 1: Living Room)} & 7–8 \\
\end{array}$$

---

## 2. Estimands & Outcome Measures

### 2.1 Primary Confirmatory Estimands

| Hypothesis | Construct | Dependent Variable ($Y$) | Scale & Domain | Theoretical Direction |
| :---: | :--- | :--- | :---: | :--- |
| **$H_{01}$** | **Task Completion Time** | `activeDurationSeconds` | Continuous ($> 0\text{ s}$) | Condition B will achieve lower duration ($\beta_{\text{Cond}} < 0$). |
| **$H_{02}$** | **Perceived Usability** | `susScore` | Continuous ($0.0–100.0$) | Condition B will achieve higher Brooke SUS score ($\beta_{\text{Cond}} > 0$). |
| **$H_{03}$** | **Budget Compliance** | `isBudgetCompliant` | Binary ($1 = \text{Yes}, 0 = \text{No}$) | Condition B will achieve higher compliance odds ($\text{OR} > 1.0$). |
| **$H_{04}$** | **Composite Task Success** | `isTaskSuccessful` | Binary ($1 = \text{Yes}, 0 = \text{No}$) | Condition B will achieve higher success odds ($\text{OR} > 1.0$). |

*Note: `isTaskSuccessful` is the strict server-evaluated conjunction requiring: (1) all 4 mandatory task items present, (2) final price within budget ceiling, and (3) zero doorway keep-out intrusions (`doorwayIntrusionsCount = 0`).*

### 2.2 Secondary & Exploratory Estimands
- **Spatial Collision Proxy:** `aabbOverlapPairsCount` (Poisson / Negative Binomial count).
- **Silent Keep-Out Intrusions:** `doorwayIntrusionsCount` (Poisson / Zero-Inflated Poisson count).
- **Physical Boundary Clashes Attempted:** `attemptedOutOfBoundsCount` (count).
- **Manual Adjustment Effort:** `totalEdits` and `undoRedoCount` (continuous/count).
- **AI Agent Multi-Tier Validity (Condition B only):** Tier 1 request success rate, Tier 2 schema validity rate, Tier 3 3D room containment validity rate, and Tier 4 user proposal approval rate (`agentAcceptedCount / agentProposalsCount`).

---

## 3. Confirmatory Mathematical Models

All primary hypotheses will be tested using mixed-effects regression frameworks in R (`lme4`, `lmerTest`) or Python (`statsmodels`), accounting for repeated measures per participant.

### 3.1 Model 1: Task Completion Time ($H_{01}$)

#### Step 1: Primary Untransformed LMM
The primary confirmatory model fits a Gaussian Linear Mixed-Effects Model:
$$Y_{it} = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i + \epsilon_{it}$$
where:
- $Y_{it}$ is the active task completion duration in seconds for participant $i \in \{1 \dots N\}$ in period $t \in \{1, 2\}$.
- $\text{Condition}_{it} \in \{0 = \text{Manual}, 1 = \text{AI-Assisted}\}$.
- $\text{Task}_{it} \in \{0 = \text{Living Room}, 1 = \text{Home Study}\}$.
- $\text{Period}_{it} \in \{0 = \text{Period 1}, 1 = \text{Period 2}\}$.
- $u_i \sim \mathcal{N}(0, \sigma_u^2)$ is the participant random intercept.
- $\epsilon_{it} \sim \mathcal{N}(0, \sigma_\epsilon^2)$ is the independent residual error.

#### Step 2: Model Diagnostics & Assumption Verification
Before drawing inferences, model residuals $\hat{\epsilon}_{it}$ are subjected to:
1. **Normality Assessment:** Shapiro-Wilk test on residuals ($\alpha = 0.05$) and visual inspection of normal Q-Q plot.
2. **Homoscedasticity Assessment:** Fitted vs. residual plot inspection and Breusch-Pagan / Levene test.
3. **Outlier Assessment:** Identification of standardized Pearson residuals $|r_{it}| > 3.0$.

#### Step 3: Transformation Contingency (Log-Normal LMM)
If residuals violate normality ($p < 0.05$) or exhibit positive skewness ($\text{skewness} > 1.0$), common in timing data, the natural log-transformed duration is modeled:
$$\ln(Y_{it}) = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i + \epsilon_{it}$$
The estimated treatment effect is reported as a percentage reduction in median completion time: $100 \times (1 - \exp(\hat{\beta}_1))\%$, with 95% confidence intervals $[\exp(\hat{\beta}_1 - 1.96 \times \text{SE}), \exp(\hat{\beta}_1 + 1.96 \times \text{SE})]$.

#### Step 4: Generalized Mixed Model Contingency ($\text{GLMM}_{\text{Gamma}}$)
If log transformation fails to resolve heteroscedasticity, a GLMM with Gamma error distribution and log link function is fitted:
$$\mathbb{E}[Y_{it}] = \mu_{it}, \quad \ln(\mu_{it}) = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i, \quad Y_{it} \sim \text{Gamma}(\mu_{it}, \nu)$$

#### Step 5: Non-Parametric Fallback
If parametric convergence fails, the pre-registered non-parametric test is **Koch's crossover rank analysis (1972)** or **Aligned Rank Transform (ART-ANOVA)**.

---

### 3.2 Model 2: Perceived Usability / SUS Composite Score ($H_{02}$)

The Brooke (1996) System Usability Scale score ($0.0 \le \text{SUS}_{it} \le 100.0$) is analyzed via a Gaussian Linear Mixed Model:
$$\text{SUS}_{it} = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i + \epsilon_{it}$$
- **Assumptions:** Normality and homoscedasticity of residuals.
- **Hypothesis Test:** Two-sided test of $H_0: \beta_1 = 0$ versus $H_1: \beta_1 \ne 0$.
- **Effect Size:** Cohen's $d = \hat{\beta}_1 / \sigma_{\text{pooled}}$, alongside Bangor et al. (2008) adjective ratings.
- **Fallback:** Aligned Rank Transform (ART-ANOVA) if bounded ceiling/floor effects violate normality.

---

### 3.3 Model 3: Budget Compliance Rate ($H_{03}$)

Because budget compliance $C_{it} \in \{0, 1\}$ is a binary indicator, it is modeled via Generalized Linear Mixed Models (Mixed Logistic Regression) with Bernoulli distribution and logit link:
$$\text{logit}(P(C_{it} = 1)) = \ln\left(\frac{P(C_{it} = 1)}{1 - P(C_{it} = 1)}\right) = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i$$
where $u_i \sim \mathcal{N}(0, \sigma_u^2)$ is the participant random intercept.
- **Hypothesis Test:** Wald $z$-test or likelihood ratio test on $\beta_1 = 0$.
- **Effect Size:** Adjusted Odds Ratio $\text{AOR} = \exp(\hat{\beta}_1)$ with 95% profile-likelihood confidence intervals.
- **Separation Contingency:** If zero budget violations occur in Condition B (causing quasi-complete separation and non-finite estimates), **Firth's penalized likelihood logistic regression** or **Stratified Cochran-Mantel-Haenszel (CMH) test** stratified by sequence group will be applied.

---

### 3.4 Model 4: Composite Task Success Rate ($H_{04}$)

Modeled analogously to $H_{03}$ using Mixed Logistic Regression:
$$\text{logit}(P(S_{it} = 1)) = \beta_0 + \beta_1 \text{Condition}_{it} + \beta_2 \text{Task}_{it} + \beta_3 \text{Period}_{it} + u_i$$
- **Separation Contingency:** Exact conditional logistic regression or Stratified CMH test.

---

## 4. Crossover-Specific Tests: Carryover & Moderation

In accordance with standard crossover methodology (Senn, 2002), each primary model will undergo formal interaction checking prior to finalizing main effects:

1. **Asymmetric Carryover Test ($\text{Condition} \times \text{Period}$):**  
   Evaluates whether the condition effect differs between Period 1 and Period 2 (testing for differential fatigue, practice carryover, or cognitive anchor effects).  
   - If interaction $p \ge 0.05$: Asymmetric carryover is rejected; the parsimonious main-effects model is reported.  
   - If interaction $p < 0.05$: Asymmetric carryover is present; condition effects must be reported stratified by period, and Period 1 between-subject comparison ($A_1$ vs. $B_1$) is reported as an unconfounded estimate.
2. **Task Moderation Test ($\text{Condition} \times \text{Task}$):**  
   Evaluates whether the AI benefit depends on room geometry or budget headroom (11.66% vs. 3.99% budget trap).  
   - If $p < 0.05$, interaction is reported and simple main effects by task are provided.

---

## 5. Multiple Comparisons & Error Rate Control

To prevent inflation of Family-Wise Error Rate (FWER) across the four primary confirmatory tests ($H_{01}, H_{02}, H_{03}, H_{04}$), the **Holm–Bonferroni step-down procedure** will be applied at overall $\alpha = 0.05$:

1. Sort raw two-sided $p$-values in ascending order: $p_{(1)} \le p_{(2)} \le p_{(3)} \le p_{(4)}$.
2. Step 1: If $p_{(1)} \le \frac{0.05}{4} = 0.0125$, reject $H_{(1)}$ and proceed; otherwise stop.
3. Step 2: If $p_{(2)} \le \frac{0.05}{3} \approx 0.0167$, reject $H_{(2)}$ and proceed; otherwise stop.
4. Step 3: If $p_{(3)} \le \frac{0.05}{2} = 0.0250$, reject $H_{(3)}$ and proceed; otherwise stop.
5. Step 4: If $p_{(4)} \le \frac{0.05}{1} = 0.0500$, reject $H_{(4)}$; otherwise fail to reject.

All secondary and exploratory analyses (AABB overlap, edits, AI approval tiers) are designated as **exploratory**; their $p$-values and confidence intervals will be reported without FWER adjustment and explicitly flagged as hypothesis-generating.

---

## 6. Missing Data, Dropouts, & Exclusion Criteria

### 6.1 Complete vs. Aborted Sessions
- **Confirmatory Analysis Matrix:** Primary models will include all completed sessions (`sessionStatus = 'completed'`).
- **Dropout / Attrition Analysis:** Sessions marked `sessionStatus = 'aborted'` will be summarized in a CONSORT-style participant flow diagram. Intermediate spatial checkpoints (`checkpointSceneSnapshot`) and `durationSeconds` up to abort will be analyzed to test whether dropouts were systematically associated with condition or task difficulty.

### 6.2 Pre-Registered Session Exclusion Criteria
A trial session will be excluded from confirmatory analysis **only** under the following objective, pre-registered conditions:
1. **Prolonged Disruption:** `hasProlongedInterruption = True` (any single inactivity gap $\ge 900\text{ s}$ / 15 minutes, indicating participant left the testing environment).
2. **Technical Failure:** Unrecoverable browser crash, hardware failure, or server disconnection documented during the trial.
3. **Protocol Non-Compliance:** Documented refusal to follow instructions (e.g. submitting empty scene without attempting task).

All excluded sessions will be documented with exact participant ID, condition, and reason in a dedicated exclusion table in the thesis.

---

## 7. Open Decisions for Supervisor Sign-Off

The following three technical decisions are isolated from the confirmatory protocol and recorded for supervisor selection:

| Decision | Candidate Options | Pre-Registered Default | Supervisor Action |
| :--- | :--- | :--- | :--- |
| **LMM Degrees of Freedom** | 1. Satterthwaite approximation<br>2. Kenward–Roger adjustment | Kenward–Roger adjustment recommended for conservative small-sample ($N=30$) inference. | Confirm preference before unblinding data. |
| **Individual SUS Items** | 1. Omit item analysis<br>2. Exploratory CLMM in Appendix | Exploratory Cumulative Link Mixed Models (CLMM) in Appendix C. Confirmatory FWER unaffected. | Approve exploratory scope. |
| **Random Slope Structure** | 1. Random intercept only ($u_i$)<br>2. Random slope $(\text{Cond} \mid \text{Participant})$ | Random intercept only as primary. Random slope evaluated strictly as sensitivity check if non-singular. | Confirm parsimonious starting model. |

---

## 8. Unbiased Reporting of Null & Inconclusive Findings

In adherence to IEEE/ACM and APA reporting standards, all primary hypotheses will be reported with:
- Exact test statistics ($t$, $z$, or $F$).
- Unadjusted and Holm-adjusted $p$-values (to 3 decimal places; e.g. $p = 0.042$, or $p < 0.001$).
- Point estimates and 95% Confidence Intervals.
- Standardized effect sizes (Cohen's $d$ or Odds Ratios).

**Zero-Suppression Commitment:** If AI assistance fails to yield statistically significant improvements in completion time, usability, budget compliance, or task success (or if manual design outperforms AI in specific dimensions), all null, negative, or inconclusive findings will be reported transparently and discussed in Chapter 10 of the thesis.
