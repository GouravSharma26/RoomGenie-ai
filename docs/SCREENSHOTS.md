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
