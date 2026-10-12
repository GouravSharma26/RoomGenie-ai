# RoomGenie AI — 3D Asset Licenses and Attribution

This document provides verifiable licensing, author attribution, and source documentation for all 3D furniture models and architectural assets included in RoomGenie AI, in full accordance with Phase 1 acceptance criteria and academic integrity requirements.

---

## 1. License Overview

All sample 3D furniture assets provided in this repository are licensed under the **Creative Commons CC0 1.0 Universal Public Domain Dedication (CC0 1.0)**.

- **License Deed:** [Creative Commons CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)
- **Summary:** The authors have dedicated the work to the public domain by waiving all copyright and related rights worldwide under copyright law. Anyone may copy, modify, distribute, and perform the work, even for commercial purposes, without asking permission.

---

## 2. Asset Catalogue & Provenance

| Asset Name | Asset ID | Model File | Geometry Type | Dimensions (W × H × D) | License | Provenance / Authorship |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Modern 3-Seater Sofa** | `sofa-3seat-modern` | `frontend/public/models/sofa.glb` | Binary glTF 2.0 (`.glb`) + procedural fallback | 2.10m × 0.85m × 0.90m | CC0 1.0 Universal | Authored for RoomGenie AI via `frontend/scripts/generateModels.js` using Three.js BufferGeometries. |
| **Minimalist Coffee Table** | `coffee-table-minimal` | `frontend/public/models/coffee_table.glb` | Binary glTF 2.0 (`.glb`) + procedural fallback | 1.20m × 0.45m × 0.60m | CC0 1.0 Universal | Authored for RoomGenie AI via `frontend/scripts/generateModels.js` using Three.js BufferGeometries. |
| **Ergonomic Study Desk** | `study-desk-ergo` | `frontend/public/models/desk.glb` | Binary glTF 2.0 (`.glb`) + procedural fallback | 1.40m × 0.75m × 0.70m | CC0 1.0 Universal | Authored for RoomGenie AI via `frontend/scripts/generateModels.js` using Three.js BufferGeometries. |
| **Lounge Accent Armchair** | `armchair-accent-nordic` | *Procedural buffer geometry* | Procedural Three.js React component | 0.85m × 0.88m × 0.85m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **4-Tier Bookshelf** | `bookshelf-4tier-metal` | *Procedural buffer geometry* | Procedural Three.js React component | 1.00m × 1.80m × 0.35m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **Round Oak Dining Table** | `dining-table-round-oak` | *Procedural buffer geometry* | Procedural Three.js React component | 1.20m × 0.76m × 1.20m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **Nordic Queen Platform Bed** | `bed-queen-nordic-wood` | *Procedural buffer geometry* | Procedural Three.js React component | 1.65m × 0.95m × 2.10m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **Single Drawer Bedside Nightstand** | `nightstand-1drawer-oak` | *Procedural buffer geometry* | Procedural Three.js React component | 0.50m × 0.55m × 0.45m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **Botanical Ceramic Floor Planter** | `decor-plant-monstera-terracotta` | *Procedural buffer geometry* | Procedural Three.js React component | 0.40m × 1.10m × 0.40m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. |
| **Custom Slatted Partition Screen** | `decor-divider-architectural` | *Procedural buffer geometry* | Procedural Three.js React component | 1.20m × 1.75m × 0.30m | CC0 1.0 Universal | Authored for RoomGenie AI in `FurnitureItem.tsx`. Bespoke unpriced custom asset. |

---

## 3. Technical Verification & Architecture

1. **Self-Contained glTF Binary Format:**
   The `.glb` files are self-contained binary glTF containers adhering to the [Khronos glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). They package standard materials, normal attributes, and vertex positions in SI metres.

2. **Dual-Rendering Pipeline:**
   The 3D editor component ([`FurnitureItem.tsx`](file:///frontend/src/editor3d/components/FurnitureItem.tsx)) supports both:
   - GLTF Model loading via React Three Fiber / Drei (`useGLTF`) when `modelUrl` is provided.
   - Deterministic procedural fallback geometry if GLB loading is deferred, offline, or running in headless testing environments (e.g. jsdom / Vitest).

3. **Reproducibility:**
   The GLB asset generation script is version-controlled and reproducible at [`frontend/scripts/generateModels.js`](file:///frontend/scripts/generateModels.js). To regenerate or modify the models, run:
   ```bash
   cd frontend
   node scripts/generateModels.js
   ```

---

## 4. Academic Integrity & Third-Party Asset Statement

No proprietary, copyrighted, or uncredited third-party meshes from external marketplaces (Sketchfab, TurboSquid, CGTrader) are embedded in this repository. All models are original, cleanly budgeted, and freely usable for demonstration, academic examination, and evaluation.
