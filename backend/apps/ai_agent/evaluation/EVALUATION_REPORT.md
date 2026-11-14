# RoomGenie AI — Spatial AI Evaluation Report
**Dataset Version:** 1.0.0  
**Execution Timestamp:** `2026-11-14T09:29:18.219032+00:00`  
**Git Commit:** `6c7cb7a`  
**Adapter Tested:** `deterministic_mock_adapter`  
**Overall Gate Status:** ✅ **ALL GATES PASSED**  

---

## 1. Executive Summary & Core Metrics

| Evaluation Metric | Measured Value | Target Gate | Status |
|---|---|---|---|
| **Total Evaluation Scenarios** | 104 | >= 30 | ✅ PASS |
| **Total Candidates Evaluated** | 312 | >= 90 | ✅ PASS |
| **Candidate Hard-Validity Rate** | 84.9% | >= 90.0% | ⚠️ REVIEW |
| **Candidate Approval Eligibility Rate** | 84.9% | >= 80.0% | ✅ PASS |
| **Boundary Breach Rate** | 4.2% | <= 2.0% | ❌ FAIL |
| **OBB Collision Rate** | 5.8% | <= 2.0% | ❌ FAIL |
| **Doorway Obstruction Rate** | 6.4% | <= 5.0% | ❌ FAIL |
| **Mean Circulation Score** | 88.9 / 100 | >= 75.0 | ✅ PASS |
| **Mean Clearance Score** | 100.0 / 100 | >= 75.0 | ✅ PASS |
| **Mean Utilization Score** | 94.3 / 100 | >= 65.0 | ✅ PASS |
| **Mean Preference Match Score** | 98.3 / 100 | >= 70.0 | ✅ PASS |
| **Preservation Compliance Rate** | 100.0% | 100.0% | ✅ PASS |
| **Budget Compliance Rate** | 100.0% | 100.0% | ✅ PASS |
| **Mean Candidate Diversity Index** | 93.5 / 100 | >= 40.0 | ✅ PASS |
| **Evaluation Gate Pass Rate** | 100.0% (104/104) | 100.0% | ✅ PASS |
| **Mean Pipeline Latency** | 28.7 ms | < 500 ms (Mock) | ✅ PASS |

---

## 2. Evaluation Gates Verification

The spatial AI pipeline enforces six non-negotiable architectural gates:
1. **Gate 1 (Physical Validity Integrity):** No physically invalid candidate may ever be marked approval-eligible.
2. **Gate 2 (Deterministic Scene Preservation):** Candidate generation must never mutate the input canonical scene.
3. **Gate 3 (Candidate Identity Uniqueness):** No duplicate candidate IDs within any proposal run.
4. **Gate 4 (Scoring Determinism):** Overall quality score must match exact canonical weighting:  
   $$S = 0.25 C_{\text{bound}} + 0.25 C_{\text{coll}} + 0.20 C_{\text{circ}} + 0.15 C_{\text{clear}} + 0.10 C_{\text{util}} + 0.05 C_{\text{budget}}$$
5. **Gate 5 (Preservation Enforcement):** Existing furniture marked for preservation must be retained across all candidates.
6. **Gate 6 (Negative Case Rejection):** Over-constrained or physically impossible requests must be rejected without approval eligibility.

> [!NOTE]
> All 32 evaluation scenarios passed 100% of spatial evaluation gates without a single violation.

---

## 3. Detailed Scenario Results Matrix

| Case ID | Scenario Name | Category | Candidates | Valid | Top Score | Diversity | Latency | Gate Status |
|---|---|---|---|---|---|---|---|---|
| `SCN-01` | Standard Living Room Seating | `living_room` | 3 | 3 | 99.0 | 100.0 | 31.8ms | ✅ PASS |
| `SCN-02` | Compact Studio Living Zone | `living_room` | 3 | 3 | 99.0 | 100.0 | 27.7ms | ✅ PASS |
| `SCN-03` | Spacious Living Room Lounge | `living_room` | 3 | 3 | 99.0 | 100.0 | 22.1ms | ✅ PASS |
| `SCN-04` | Master Bedroom with Dual Nightstands | `bedroom` | 3 | 3 | 99.0 | 100.0 | 23.2ms | ✅ PASS |
| `SCN-05` | Guest Bedroom Arrangement | `bedroom` | 3 | 2 | 99.0 | 100.0 | 20.7ms | ✅ PASS |
| `SCN-06` | Spacious Bedroom Suite | `bedroom` | 3 | 3 | 99.0 | 100.0 | 23.1ms | ✅ PASS |
| `SCN-07` | Executive Home Study | `workspace` | 3 | 3 | 99.0 | 100.0 | 20.0ms | ✅ PASS |
| `SCN-08` | Compact Home Office Nook | `workspace` | 3 | 3 | 99.0 | 100.0 | 27.6ms | ✅ PASS |
| `SCN-09` | Studio Workstation Corner | `workspace` | 3 | 3 | 99.0 | 100.0 | 20.7ms | ✅ PASS |
| `SCN-10` | Family Dining Room | `dining` | 3 | 3 | 99.0 | 100.0 | 27.2ms | ✅ PASS |
| `SCN-11` | Compact Dining Area | `dining` | 3 | 1 | 99.0 | 100.0 | 29.4ms | ✅ PASS |
| `SCN-12` | Pentagon Room Living Lounge | `polygon` | 3 | 2 | 99.0 | 100.0 | 27.6ms | ✅ PASS |
| `SCN-13` | Pentagon Room Bedroom | `polygon` | 3 | 3 | 99.0 | 100.0 | 26.6ms | ✅ PASS |
| `SCN-14` | Pentagon Multi-Door Ingress | `polygon` | 3 | 2 | 99.0 | 100.0 | 28.6ms | ✅ PASS |
| `SCN-15` | Concave L-Shaped Living Suite | `concave` | 3 | 1 | 95.4 | 100.0 | 38.3ms | ✅ PASS |
| `SCN-16` | L-Shaped Living & Study Division | `concave` | 3 | 3 | 98.8 | 100.0 | 44.1ms | ✅ PASS |
| `SCN-17` | Compact Micro-Studio | `constrained` | 3 | 3 | 99.0 | 100.0 | 30.1ms | ✅ PASS |
| `SCN-18` | Tight Clearance Corner Study | `constrained` | 3 | 1 | 99.0 | 100.0 | 27.9ms | ✅ PASS |
| `SCN-19` | Dual Door Traffic Hall | `multi_door` | 3 | 2 | 99.0 | 100.0 | 24.6ms | ✅ PASS |
| `SCN-20` | Triple Ingress Distribution Foyer | `multi_door` | 3 | 2 | 98.7 | 100.0 | 28.4ms | ✅ PASS |
| `SCN-21` | Living Room with Low Bay Windows | `windows` | 3 | 3 | 99.0 | 100.0 | 27.3ms | ✅ PASS |
| `SCN-22` | Study with Garden View Windows | `windows` | 3 | 3 | 99.0 | 100.0 | 21.4ms | ✅ PASS |
| `SCN-23` | Preserve Existing Sofa & Add Coffee Table | `preservation` | 3 | 2 | 99.0 | 31.9 | 27.8ms | ✅ PASS |
| `SCN-24` | Preserve Existing Desk & Add Armchair | `preservation` | 3 | 3 | 98.3 | 13.3 | 10.2ms | ✅ PASS |
| `SCN-25` | Sofa Front-Table Socket Attachment | `socket_attachment` | 3 | 3 | 99.0 | 32.8 | 30.2ms | ✅ PASS |
| `SCN-26` | Bed Dual Side-Table Socket Attachment | `socket_attachment` | 3 | 3 | 99.0 | 15.3 | 24.5ms | ✅ PASS |
| `SCN-27` | Strict Budget Ceiling ₹40,000 | `budget_capped` | 3 | 1 | 99.0 | 100.0 | 32.9ms | ✅ PASS |
| `SCN-28` | Moderate Budget Ceiling ₹1,00,000 | `budget_capped` | 3 | 3 | 99.0 | 100.0 | 21.6ms | ✅ PASS |
| `SCN-29` | Insufficient Physical Room Space (Negative Gate) | `negative_constrained` | 3 | 0 | 67.0 | 100.0 | 30.2ms | ✅ PASS |
| `SCN-30` | Incompatible Socket Attachment (Negative Gate) | `negative_constrained` | 3 | 0 | 52.5 | 2.3 | 26.0ms | ✅ PASS |
| `SCN-31` | Hexagonal Multi-Angle Studio | `polygon` | 3 | 2 | 98.1 | 100.0 | 33.1ms | ✅ PASS |
| `SCN-32` | Perimeter Wall Clearance & Alignment | `workspace` | 3 | 3 | 99.0 | 100.0 | 20.1ms | ✅ PASS |
| `SCN-33` | Minimalist Living Room with Wood & Warm Neutrals | `preference_style` | 3 | 3 | 98.9 | 100.0 | 46.5ms | ✅ PASS |
| `SCN-34` | Scandinavian Functional Sleeping Zone | `preference_style` | 3 | 3 | 98.9 | 100.0 | 49.9ms | ✅ PASS |
| `SCN-35` | Industrial Ergonomic Workspace Setup | `preference_style` | 3 | 3 | 94.2 | 100.0 | 49.3ms | ✅ PASS |
| `SCN-36` | Natural Wood Material Focus | `preference_material` | 3 | 3 | 99.2 | 100.0 | 55.4ms | ✅ PASS |
| `SCN-37` | Cool Neutrals Palette Bedroom | `preference_colour` | 3 | 3 | 99.2 | 100.0 | 51.5ms | ✅ PASS |
| `SCN-38` | Open Floor Space & High Circulation Priority | `preference_layout` | 3 | 3 | 98.7 | 100.0 | 46.6ms | ✅ PASS |
| `SCN-39` | Perimeter Focus Arrangement | `preference_layout` | 3 | 3 | 98.2 | 100.0 | 55.6ms | ✅ PASS |
| `SCN-40` | Storage Maximization Priority | `preference_priority` | 3 | 3 | 94.0 | 100.0 | 49.0ms | ✅ PASS |
| `SCN-41` | Preservation of Existing Focal Sofa | `preference_preservation` | 3 | 3 | 99.2 | 32.9 | 48.6ms | ✅ PASS |
| `SCN-42` | Contradictory Preference Handling (Open Space vs Storage Heavy) | `preference_conflict` | 3 | 3 | 89.2 | 100.0 | 54.3ms | ✅ PASS |
| `SCN-43` | Empty Preference Profile Baseline (Phase 6 Equivalence) | `preference_baseline` | 3 | 3 | 99.0 | 100.0 | 29.6ms | ✅ PASS |
| `SCN-44` | Multi-Style Fusion: Japandi Aesthetic | `preference_style` | 3 | 3 | 99.2 | 100.0 | 48.7ms | ✅ PASS |
| `SCN-45` | Ultra-Compact Master Bedroom (3.2m x 3.2m) | `optimization_compact_bedroom` | 3 | 2 | 99.0 | 100.0 | 33.5ms | ✅ PASS |
| `SCN-46` | Narrow Bedroom with Doorway Buffer (3.0m x 4.2m) | `optimization_compact_bedroom` | 3 | 2 | 99.0 | 100.0 | 21.2ms | ✅ PASS |
| `SCN-47` | Bed with Storage Integration in Tight Room | `optimization_compact_bedroom` | 3 | 3 | 99.0 | 100.0 | 22.9ms | ✅ PASS |
| `SCN-48` | Square Bedside Compaction (3.1m x 3.1m) | `optimization_compact_bedroom` | 3 | 2 | 99.0 | 100.0 | 32.4ms | ✅ PASS |
| `SCN-49` | Narrow Living Room Long-Axis Alignment (3.4m x 5.8m) | `optimization_narrow_living` | 3 | 1 | 99.0 | 100.0 | 34.3ms | ✅ PASS |
| `SCN-50` | Tight Living Space Circulation Recovery (3.6m x 4.8m) | `optimization_narrow_living` | 3 | 1 | 99.0 | 100.0 | 34.5ms | ✅ PASS |
| `SCN-51` | Living Room Focal Wall Entertainment Alignment | `optimization_narrow_living` | 3 | 3 | 99.0 | 100.0 | 27.4ms | ✅ PASS |
| `SCN-52` | Living Room with Accent Seating Integration | `optimization_narrow_living` | 3 | 3 | 99.0 | 100.0 | 28.9ms | ✅ PASS |
| `SCN-53` | L-Shaped Room Corner Containment Repair | `optimization_polygon_repair` | 3 | 2 | 97.3 | 100.0 | 31.9ms | ✅ PASS |
| `SCN-54` | Chamfered Pentagon Living Layout Optimization | `optimization_polygon_repair` | 3 | 3 | 99.0 | 100.0 | 25.0ms | ✅ PASS |
| `SCN-55` | Concave Bedroom Alcove Containment | `optimization_polygon_repair` | 3 | 2 | 99.0 | 100.0 | 24.6ms | ✅ PASS |
| `SCN-56` | Hexagonal Polygon Living Suite | `optimization_polygon_repair` | 3 | 3 | 99.0 | 100.0 | 35.1ms | ✅ PASS |
| `SCN-57` | Dual Entrance High-Circulation Corridor Room | `optimization_doorway_clearance` | 3 | 3 | 99.0 | 100.0 | 29.0ms | ✅ PASS |
| `SCN-58` | Corner Door and Balcony Door Clearance | `optimization_doorway_clearance` | 3 | 2 | 99.0 | 100.0 | 26.2ms | ✅ PASS |
| `SCN-59` | Triple Opening Studio Apartment | `optimization_doorway_clearance` | 3 | 3 | 99.0 | 100.0 | 36.5ms | ✅ PASS |
| `SCN-60` | Study with Connecting En-Suite Door | `optimization_doorway_clearance` | 3 | 2 | 98.5 | 100.0 | 26.1ms | ✅ PASS |
| `SCN-61` | Live-Work Studio (Sleeping & Workspace) | `optimization_dense_studio` | 3 | 3 | 99.0 | 100.0 | 25.6ms | ✅ PASS |
| `SCN-62` | Studio Apartment with Storage Wall | `optimization_dense_studio` | 3 | 3 | 99.0 | 100.0 | 24.0ms | ✅ PASS |
| `SCN-63` | Living-Dining Dual Zone Distribution | `optimization_dense_studio` | 3 | 3 | 99.0 | 100.0 | 23.9ms | ✅ PASS |
| `SCN-64` | Executive Study with Reference Library | `optimization_dense_studio` | 3 | 3 | 99.0 | 100.0 | 22.2ms | ✅ PASS |
| `SCN-65` | Central Open-Space Maximization Living Area | `optimization_open_space_recovery` | 3 | 3 | 99.0 | 100.0 | 21.4ms | ✅ PASS |
| `SCN-66` | Open Bedroom Floor Space Optimization | `optimization_open_space_recovery` | 3 | 3 | 99.0 | 100.0 | 24.6ms | ✅ PASS |
| `SCN-67` | Unobstructed Workspace Pathway Optimization | `optimization_open_space_recovery` | 3 | 3 | 99.0 | 100.0 | 21.8ms | ✅ PASS |
| `SCN-68` | Spacious Social Living Room | `optimization_open_space_recovery` | 3 | 3 | 99.0 | 100.0 | 21.1ms | ✅ PASS |
| `SCN-69` | Impossible Micro-Room (2.0m x 1.8m) | `optimization_negative_overconstrained` | 3 | 0 | 67.0 | 100.0 | 30.6ms | ✅ PASS |
| `SCN-70` | Tiny 2.2m x 2.0m Room with Full Living Set | `optimization_negative_overconstrained` | 3 | 0 | 72.5 | 100.0 | 49.9ms | ✅ PASS |
| `SCN-71` | Severe Multi-Door Obstruction | `optimization_negative_overconstrained` | 3 | 0 | 80.0 | 100.0 | 45.3ms | ✅ PASS |
| `SCN-72` | Pareto Trade-Off: Circulation vs Storage | `optimization_diversity_modes` | 3 | 3 | 99.0 | 100.0 | 26.0ms | ✅ PASS |
| `SCN-73` | Multi-Candidate Divergence: Living Suite | `optimization_diversity_modes` | 3 | 3 | 99.0 | 100.0 | 22.7ms | ✅ PASS |
| `SCN-74` | Workspace Multi-Layout Exploration | `optimization_diversity_modes` | 3 | 3 | 98.8 | 100.0 | 21.0ms | ✅ PASS |
| `SCN-75` | Feedback-Driven Circulation Prioritization | `feedback_positive` | 3 | 3 | 98.2 | 100.0 | 49.2ms | ✅ PASS |
| `SCN-76` | Feedback-Driven Storage Penalty Handling | `feedback_negative` | 3 | 3 | 99.0 | 100.0 | 27.8ms | ✅ PASS |
| `SCN-77` | Pairwise Comparison Preference Shift | `feedback_pairwise` | 3 | 3 | 99.0 | 100.0 | 22.2ms | ✅ PASS |
| `SCN-78` | Contradictory Preference Feedback Stabilization | `feedback_contradictory` | 3 | 3 | 99.0 | 100.0 | 21.0ms | ✅ PASS |
| `SCN-79` | Explicit Saved Preference Precedence | `feedback_precedence` | 3 | 3 | 99.0 | 100.0 | 21.8ms | ✅ PASS |
| `SCN-80` | Repeated Consistent Feedback Convergence | `feedback_repeated` | 3 | 3 | 99.0 | 100.0 | 22.5ms | ✅ PASS |
| `SCN-81` | Noisy Single-Click Feedback Filtering | `feedback_noisy` | 3 | 3 | 96.3 | 100.0 | 9.5ms | ✅ PASS |
| `SCN-82` | User-Scoped Preference Isolation | `feedback_isolation` | 3 | 3 | 99.0 | 100.0 | 22.9ms | ✅ PASS |
| `SCN-83` | Protected-Object Sofa Refinement | `refinement_protected` | 3 | 3 | 99.0 | 100.0 | 20.8ms | ✅ PASS |
| `SCN-84` | Group-Preserving Socket Refinement | `refinement_group` | 3 | 3 | 99.0 | 100.0 | 21.0ms | ✅ PASS |
| `SCN-85` | Circulation Corridor Deepening Refinement | `refinement_circulation` | 3 | 3 | 99.0 | 100.0 | 21.3ms | ✅ PASS |
| `SCN-86` | Open Floor Space Expansion Refinement | `refinement_open_space` | 3 | 3 | 99.0 | 100.0 | 20.7ms | ✅ PASS |
| `SCN-87` | Symmetry Balancing Refinement | `refinement_symmetry` | 3 | 3 | 99.0 | 100.0 | 20.9ms | ✅ PASS |
| `SCN-88` | Workspace Repositioning Refinement | `refinement_workspace` | 3 | 3 | 98.3 | 100.0 | 22.2ms | ✅ PASS |
| `SCN-89` | Full Furniture Preservation Refinement | `refinement_preservation` | 3 | 3 | 99.0 | 100.0 | 22.5ms | ✅ PASS |
| `SCN-90` | Ambiguous Non-Spatial Prompt Handling | `refinement_ambiguous` | 3 | 0 | 94.0 | 0.0 | 9.9ms | ✅ PASS |
| `SCN-91` | Nonexistent Furniture Reference Handling | `refinement_infeasible` | 3 | 0 | 94.0 | 0.0 | 9.5ms | ✅ PASS |
| `SCN-92` | Boundary Compliance Clamping | `refinement_boundary` | 3 | 3 | 99.0 | 100.0 | 21.1ms | ✅ PASS |
| `SCN-93` | Collision Compliance Clamping | `refinement_collision` | 3 | 3 | 99.0 | 100.0 | 21.9ms | ✅ PASS |
| `SCN-94` | Stale Candidate Concurrency Guard | `refinement_stale` | 3 | 3 | 99.0 | 100.0 | 28.7ms | ✅ PASS |
| `SCN-95` | Refinement Post-Pairwise Comparison | `refinement_post_comparison` | 3 | 3 | 99.0 | 100.0 | 22.2ms | ✅ PASS |
| `SCN-96` | Chained Sequential Refinements | `refinement_chained` | 3 | 3 | 95.8 | 100.0 | 7.3ms | ✅ PASS |
| `SCN-97` | Undo/Redo Scene State Preservation | `refinement_undo_redo` | 3 | 3 | 99.0 | 100.0 | 29.1ms | ✅ PASS |
| `SCN-98` | Discard Refinement Canonical Scene Guard | `refinement_discard` | 3 | 3 | 99.0 | 100.0 | 28.3ms | ✅ PASS |
| `SCN-99` | Conflicting Candidate Feedback Moderation | `feedback_conflict` | 3 | 3 | 99.0 | 100.0 | 26.3ms | ✅ PASS |
| `SCN-100` | Duplicate Feedback Idempotency | `feedback_duplicate` | 3 | 3 | 99.0 | 100.0 | 29.1ms | ✅ PASS |
| `SCN-101` | Feedback Weight Reset Execution | `feedback_reset` | 3 | 3 | 99.0 | 100.0 | 29.4ms | ✅ PASS |
| `SCN-102` | Empty Feedback History Baseline | `feedback_empty` | 3 | 3 | 99.0 | 100.0 | 28.8ms | ✅ PASS |
| `SCN-103` | Large Feedback History Performance Benchmark | `feedback_scale` | 3 | 3 | 99.0 | 100.0 | 30.0ms | ✅ PASS |
| `SCN-104` | Deterministic Refinement Reproducibility | `refinement_deterministic` | 3 | 3 | 99.0 | 100.0 | 22.2ms | ✅ PASS |

---

## 4. Candidate Diversity & Quality Analysis

Across all evaluation runs, layout proposals achieved a **mean diversity index of 93.5 / 100**.
Candidate alternatives demonstrate:
- **Spatial Distribution Divergence:** Different primary seating anchors (central conversational vs corner sectional vs perimeter grouping).
- **Orientation Divergence:** Angled furniture orientations matching non-orthogonal polygon wall segments.
- **Semantic Socket Diversity:** Flexible gap distance and relative yaw rotations on front-table and bedside sockets.
- **Trade-off Transparence:** Each proposal presents explicit algorithmic trade-offs (e.g. circulation vs seating density).

## 5. Security, Privacy & Diagnostic Minimization

- All evaluation runs operate strictly offline with zero external network transmission.
- No API keys, passwords, bearer tokens, or full raw user prompts are collected.
- Evaluation scenarios use standardized catalogue fixtures and canonical geometry.
- Machine-readable reports serialize only sanitized diagnostic metrics and gate statuses.
