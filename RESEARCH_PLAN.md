# RoomGenie AI — Research and Evaluation Plan

## 1. Proposed research title

**Evaluating an AI-Agent-Assisted 3D Interior Design Workflow with Budget Constraints and Furniture Placement**

A separate exploratory experiment can evaluate the fidelity and usability of photo-to-3D furniture approximation.

## 2. Main research question

Does an AI-assisted interactive 3D interior design workflow change the time, task success, budget compliance, and perceived usability of room-layout design compared with manual use of the same 3D editor?

Do not write the hypothesis as an established fact. The experiment should test it.

## 3. Research objectives

1. Build a reproducible room-design task using a controlled furniture catalogue.
2. Compare manual design with AI-assisted initial layout/recommendation.
3. Measure completion time, constraint violations, final budget compliance, user satisfaction, and accepted/rejected agent actions.
4. Separately evaluate reconstruction error for a small group of photographed furniture items if the reconstruction feature is available.
5. Document failure cases and technical limitations, not just successful demos.

## 4. Study design

Use a within-subject comparison where participants complete comparable design tasks under two conditions:

- **A — Manual:** participants use the 3D editor and catalogue without AI layout suggestions.
- **B — AI-assisted:** participants use the AI agent for initial proposals and can manually correct the result.

Use equivalent but not identical tasks, and counterbalance the order (some participants A then B, others B then A) to reduce learning/order effects. Give equal instructions and the same furniture options and budget in both conditions. Record if participants have prior 3D/CAD experience.

A pilot with 5–8 participants can discover procedure problems. If feasible, a final exploratory sample around 20–30 participants can provide preliminary evidence; determine final sample size based on feasibility and an expected effect size/power calculation, not this rule of thumb alone.

## 5. Example task

“Design a 5 m × 4 m living room with a sofa, coffee table, TV console, and one side table. Keep a clear route from the door and remain under a specified catalogue budget. Use a modern style and do not block the door.”

Create at least two comparable tasks if time permits. Keep the catalogue and constraints identical across conditions.

## 6. Measures

| Measure | Operational definition |
|---|---|
| Completion time | Time from task start to participant-submitted design |
| Task success | Checklist of required items/style/constraints satisfied |
| Budget compliance | Final deterministic catalogue total is at or below assigned limit |
| Layout violations | Overlaps, out-of-room placements, or defined doorway-clearance violations |
| Manual adjustments | Number of furniture manipulation operations |
| Agent validity | Valid proposed actions divided by all proposed actions |
| Agent acceptance | Accepted proposals divided by proposals shown |
| Usability | SUS questionnaire or clearly documented alternative |
| User preference | Participant preference and short written reasons |

For photo-to-3D, if enabled, capture reference width/height/depth with a tape measure. Report absolute error and percentage error per dimension, reconstruction success rate, processing duration, and qualitative visual ratings. Do not describe a model as dimensionally accurate without measurements.

## 7. Analysis plan

- Clean data using documented rules before looking at group differences.
- Report sample size, participant experience, means/medians, spread, missing values, and failures.
- For paired continuous outcomes, inspect distributions and use a paired t-test when its assumptions are reasonable or a Wilcoxon signed-rank test otherwise.
- Report effect sizes and confidence intervals, not only p-values.
- For success/violation counts, select analysis appropriate to the sample and data structure; state limitations in small samples.
- Include representative failure examples and qualitative feedback.
- Keep charts reproducible with scripts and a documented analysis dataset.

## 8. Ethics and privacy

- Get informed consent before collecting participant data and obtain institutional approval if required by your course/supervisor.
- Participation should be voluntary; do not collect names if participant codes suffice.
- Do not upload participant room photos to third-party AI services without explicit permission and a review of provider data terms.
- Collect only information required for the study and define deletion/retention plans.
- Do not claim the system is suitable for professional architectural, structural, accessibility, or life-safety decisions.

## 9. Threats to validity and limitations

Document at least:

- Convenience sampling and small sample size.
- Participants' differing familiarity with 3D editing and AI tools.
- Learning/order effects despite counterbalancing.
- Subjective quality of generated interior designs.
- Catalogue coverage and potentially stale/estimated prices.
- Approximate room geometry and model dimensions.
- AR tracking variations across devices, lighting, and surfaces.
- Image-to-3D reconstruction variability and occluded geometry.
- LLM non-determinism and provider/model changes.

## 10. Deliverables

- Protocol and task instructions.
- Consent wording approved as required by your institution.
- Anonymized experiment dataset.
- Analysis script and figures.
- Results and limitations section.
- Architecture diagram and system screenshots.
- Reproducible setup instructions.
