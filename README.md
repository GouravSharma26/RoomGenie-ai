# RoomGenie AI

An AI-Agent-Assisted Interior Design System combining interactive 3D furniture placement, room-photo analysis, budget-aware recommendations, optional photo-to-3D reconstruction, and AR visualization.

> **Project Type:** Solo B.Tech CSE Project (Gourav Sharma)  
> **Status:** Phase 1 (Interactive 3D Room Editor) Verified & Corrected; Phase 2 Review Pending  
> **Visual Verification:** See [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) for live browser screenshots.

---

## Technical Stack & Locked Decisions

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **3D Engine:** Three.js + React Three Fiber + Drei (Phase 1)
- **Backend:** Python 3.12 + Django 5.2 LTS + Django REST Framework + CORS Headers
- **Database:** PostgreSQL 17 (authoritative relational & scene persistence)
- **AI Baselines:** 
  - LLM & Vision: Google Gemini API (`gemini-3.8-flash`), default mock adapter in dev/tests
  - Photo-to-3D: Tripo API (`v3.1-20260211`), default mock adapter with catalogue fallback
  - Currency: INR (₹) with deterministic backend arithmetic

---

## Project Structure

```text
roomgenie-ai/
├── .agents/                    # Agent instructions and domain rules
│   └── rules/                  # Frontend, backend, and AI/media rules
├── .env.example                # Template for local environment variables
├── .gitignore                  # Git ignore rules (secrets, virtualenv, node_modules, media)
├── docker-compose.yml          # Containerized PostgreSQL service (optional alternative)
├── AGENTS.md                   # Autonomous agent behavior guidelines
├── plan.md                     # Comprehensive 14-week implementation plan
├── ARCHITECTURE.md             # Canonical scene schema & architectural contracts
├── ASSET_LICENSES.md           # Verifiable CC0 1.0 Universal asset licensing
├── MODEL_AND_TECH_DECISIONS.md # Locked tech stack & provider decisions
├── HUMAN_SETUP.md              # Human-owned actions & approval boundaries
├── RESEARCH_PLAN.md            # Empirical research study protocol & metrics
├── DEVELOPMENT_CHECKLIST.md    # Milestone definition of done & verification checklist
├── docs/                       # Verification screenshots and visual documentation
│   ├── SCREENSHOTS.md          # Screenshot gallery with test descriptions
│   └── screenshots/            # Verified browser screenshots
├── frontend/                   # React + TypeScript + Vite client
│   ├── src/
│   │   ├── services/           # Typed API clients (health check, etc.)
│   │   ├── App.tsx             # System dashboard & milestone preview
│   │   └── App.test.tsx        # Vitest & React Testing Library test suite
│   ├── package.json
│   └── vite.config.ts
└── backend/                    # Django REST Framework backend
    ├── config/                 # Project configuration (settings, urls, views, tests)
    │   ├── settings.py         # Environment-based PostgreSQL settings
    │   ├── urls.py             # API routing (/api/v1/health/)
    │   ├── views.py            # Health check endpoint
    │   └── tests.py            # DRF APIClient health tests
    ├── manage.py
    └── requirements.txt        # Pinned Python dependencies
```

---

## Local Setup & Run Instructions (Windows / PowerShell)

### Prerequisites Check

Ensure you have installed:
- Git 2.46+
- Node.js v20+ (v24 tested) & npm
- Python 3.12+
- PostgreSQL 17 (or Docker Desktop)

### 1. Environment Configuration

Copy the example environment template into `.env`:
```powershell
Copy-Item .env.example .env
```
Update `.env` with your local PostgreSQL password:
```ini
DB_PASSWORD=your_local_postgres_password
```

### 2. Frontend (React + Vite)

From the project root:
```powershell
cd frontend
npm install
npm run dev
```
- Frontend dev server starts at: `http://localhost:5173/`

Run tests, type check, lint, and build:
```powershell
npm run test       # Run Vitest test suite
npm run typecheck  # Run TypeScript compiler check
npm run lint       # Run Oxlint
npm run build      # Build production bundle
```

### 3. Backend (Django REST Framework)

From the project root:
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Run checks and tests:
```powershell
python manage.py check               # Django system checks
python manage.py test config.tests  # Run health endpoint tests
```

Run database migrations (requires configured PostgreSQL):
```powershell
python manage.py migrate
```

Start the development server:
```powershell
python manage.py runserver 127.0.0.1:8000
```
- Health endpoint: `http://127.0.0.1:8000/api/v1/health/`

### 4. Running Database with Docker Compose (Recommended Alternative)

To run containerized PostgreSQL 17 without port collisions on machines with native PostgreSQL on port 5432, Docker Compose exposes port `5433` on loopback `127.0.0.1`:
```powershell
docker compose up -d postgres
```
Ensure `.env` matches with `DB_PORT=5433` (configured as default in `.env.example`).

---

## Progress Tracker

- [x] **Phase 0 — Setup and scaffold**
  - OS and environment inspection (Git, Node, Python, PostgreSQL, Docker)
  - React + TypeScript + Vite + Tailwind CSS frontend scaffold
  - Vitest + Testing Library tests passing
  - Django + DRF backend with environment-based PostgreSQL settings
  - Health check endpoint `/api/v1/health/` and unit test suite
  - Locked tech stack verification & mock provider configurations
- [x] **Phase 1 — Interactive 3D room editor**
  - Three.js + React Three Fiber + Drei interactive canvas with architectural lighting
  - Editable room boundary envelope in metres with real-time floor grid
  - OrbitControls with reset camera and 2D floor-plan / 3D perspective switcher
  - 5 legally cleared architectural furniture assets with verifiable CC0 attribution ([`ASSET_LICENSES.md`](file:///ASSET_LICENSES.md))
  - Real binary glTF models (`sofa.glb`, `coffee_table.glb`, `desk.glb`) with procedural Three.js geometry fallbacks
  - Interactive selection, translation, rotation (+45/-45/90/180/slider), and scale clamping
  - Real-time room boundary clamping preventing out-of-bounds clipping and non-positive dimension rejection
  - Material swatch color customization with preserved roughness and metalness overrides
  - Keyboard shortcuts (Delete, Backspace, Esc) and comprehensive navigation guide modal
- [ ] **Phase 2 — Django API and persistence**
- [ ] **Phase 3 — Furniture catalogue and budget**
- [ ] **Phase 4 — AI interior-design agent**
- [ ] **Phase 5 — Room photo analysis**
- [ ] **Phase 6 — Photo-to-3D furniture approximation**
- [ ] **Phase 7 — Real-world AR placement**
- [ ] **Phase 8 — Research, testing, and delivery**
