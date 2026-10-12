# RoomGenie AI — Browser Verification Screenshots

This document contains live browser verification screenshots captured during Phase 1 testing of RoomGenie AI.

---

## 1. Interactive 3D Room Editor
Interactive Three.js canvas featuring ambient and directional lighting, shadow casting, 1m floor grid, room boundary perimeter posts, furniture catalogue, and transform properties panel.

![Interactive 3D Room Editor](./screenshots/01_3d_room_editor.png)

---

## 2. System Status & PostgreSQL 17 Connectivity
Dynamic dashboard verifying live connectivity to the Django REST API (`/api/v1/health/`) and PostgreSQL 17 database (`Connected`).

![System Status & PostgreSQL Connectivity](./screenshots/02_system_status_and_db.png)

---

## 3. Keyboard & Mouse Navigation Guide Modal
User navigation guide modal detailing mouse controls (left-click orbit, right-click pan, scroll zoom), keyboard shortcuts (<kbd>Delete</kbd>, <kbd>Backspace</kbd>, <kbd>Escape</kbd>), and touch gestures.

![Navigation Controls Guide](./screenshots/03_navigation_controls_modal.png)

---

## 4. Multi-Item Placement & Dynamic Budgeting
Multiple furniture items placed within the room boundaries. The counter dynamically tracks placed items and calculates the total catalogue budget in INR (`2 items placed • ₹38,498`).

![Multi-Item Placement and Real-Time Budgeting](./screenshots/04_multi_item_and_budget.png)

---

## 5. Three GLB Binary Models Loaded (CC0)
Real binary glTF 2.0 assets (`sofa.glb`, `coffee_table.glb`, `desk.glb`) loaded via React Three Fiber / Drei (`useGLTF`) with material overrides and selection indicators.

![Three GLB Architectural Models Loaded](./screenshots/05_glb_models_verified.png)

---

## 6. Phase 2 Room Design Persistence (PostgreSQL 17 & DRF)
Cloud persistence modal integrating the Django REST Framework `/api/v1/designs/` API with PostgreSQL 17. Users can save active 3D scenes, update snapshots, duplicate plans, and load previously saved designs with full object transform recovery.

![Phase 2 Room Design Persistence Modal](./screenshots/06_phase2_persistence_modal.png)

---

## 7. Phase 2 Transformed 3D Room Containment & Rotation Clamping
Validation of rotated furniture within room boundaries. When furniture is rotated (e.g. +90° around Y), its complete transformed bounding box (accounting for scale, dimensions, and Euler angles) is calculated and strictly contained within the floor, ceiling, and perimeter walls.

![Phase 2 Transformed 3D Room Containment & Rotation Clamping](./screenshots/07_phase2_containment_and_rotation.png)

