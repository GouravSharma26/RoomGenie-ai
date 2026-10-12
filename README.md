# RoomGenie AI

An AI-Agent-Assisted Interior Design System combining interactive 3D furniture placement, room-photo analysis, budget-aware recommendations, optional photo-to-3D reconstruction, and AR visualization.

> **Project Type:** Solo B.Tech CSE Project (Gourav Sharma)  
> **Status:** Phase 4 (AI Interior-Design Agent with Two-Phase Approval) Implemented & Verified; Ready for Review  
> **Visual Verification:** See [docs/SCREENSHOTS.md](docs/SCREENSHOTS.md) for live browser screenshots.

---

## Technical Stack & Locked Decisions

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **3D Engine:** Three.js + React Three Fiber + Drei (Phase 1)
- **Backend:** Python 3.12 + Django 5.2 LTS + Django REST Framework + CORS Headers (Phase 2)
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
│   │   ├── services/           # Typed API clients (health check, designApi, etc.)
│   │   ├── components/editor/  # Viewport headers, palettes, persistence modals
│   │   ├── editor3d/           # Three.js Canvas, Zustand store, scene validation
│   │   ├── App.tsx             # System dashboard & 3D Editor
│   │   └── App.test.tsx        # Vitest & React Testing Library test suite
│   ├── package.json
│   └── vite.config.ts
└── backend/                    # Django REST Framework backend
    ├── config/                 # Project configuration (settings, urls, views, tests)
    │   ├── settings.py         # Environment-based PostgreSQL settings
    │   ├── urls.py             # API routing (/api/v1/health/, /auth/, /rooms/, /furniture/, /designs/)
    │   ├── views.py            # Health check endpoint
    │   └── tests.py            # DRF APIClient health tests
    ├── apps/                   # Modular monolith Django applications
    │   ├── accounts/           # Token authentication, registration, demo user auth
    │   ├── rooms/              # Room envelope models, serializers, CRUD viewsets
    │   ├── furniture/          # Catalogue models, seed data command, search viewsets
    │   └── designs/            # Scene JSON persistence, canonical schema validation, CRUD
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
python manage.py test                # Run full Django test suite (53 tests across accounts, rooms, furniture, designs)
python manage.py seed_furniture      # Seed 10 architectural CC0 furniture catalogue assets
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
- Auth endpoints: `http://127.0.0.1:8000/api/v1/auth/` (`register/`, `login/`, `me/`, `demo/` [gated by `ALLOW_DEMO_AUTH = DEBUG and ...`; 403 in production])
- Room envelopes CRUD: `http://127.0.0.1:8000/api/v1/rooms/`
- Furniture catalogue: `http://127.0.0.1:8000/api/v1/furniture/` (with category, style_tags, dimension, and price range filtering)
- Deterministic budget estimate: `http://127.0.0.1:8000/api/v1/budgets/estimate/` (integer paise calculation with 3D room containment validation)
- Room designs persistence: `http://127.0.0.1:8000/api/v1/designs/` (`{id}/duplicate/`)

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
- [x] **Phase 2 — Django API and persistence (Reviewed & Corrected)**
  - Modular monolith Django apps: `accounts`, `rooms`, `furniture`, `designs`
  - Relational models on PostgreSQL 17: `User`, `Room`, `FurnitureAsset`, `Design`
  - DRF Token & Session Authentication with strict user-level ownership isolation (404 on cross-user queries)
  - Development-only demo authentication endpoint (`/api/v1/auth/demo/` gated by `ALLOW_DEMO_AUTH = DEBUG and ...`; strictly returns 403 Forbidden in production)
  - Authoritative canonical scene schema validation (`schemaVersion`, metric units, room dimensions, object transforms)
  - Exact 3D transformed oriented bounding box (OBB) extents containment: validates dimensions, scale, Euler XYZ rotation matrix, position, floor boundary ($Y_{min} \ge 0$), ceiling boundary ($Y_{max} \le \text{height}$), and lateral room walls
  - Full CRUD endpoints: `/api/v1/rooms/`, `/api/v1/furniture/`, `/api/v1/designs/` with design cloning (`duplicate`)
  - Initial catalogue seed command (`seed_furniture`)
  - Frontend persistence service ([`frontend/src/services/designApi.ts`](frontend/src/services/designApi.ts)) & Save/Load UI modal
  - Automated test suite: 39 Django tests, 22 frontend Vitest tests, 0 lint warnings
- [x] **Phase 3 — Furniture catalogue and budget**
  - Expanded catalogue model with 10 architectural models across seating, tables, storage, beds, and decor
  - Multi-attribute filtering in `FurnitureAssetViewSet`: category, style tags, keyword search, price range (`min_price`, `max_price`), and dimension compatibility (`max_width`, `max_depth`, `max_height`)
  - Deterministic backend budget estimation engine (`POST /api/v1/budgets/estimate/` in `apps/furniture/budget.py`) using integer paise math (minor units) to prevent floating-point rounding errors
  - Category subtotals, itemized pricing, and explicit handling of unpriced custom assets (`price_paise: None` rendered as "Price on Request" without invented prices)
  - Full transformed 3D room containment validation in budget estimates to detect out-of-bounds furniture
  - Enhanced frontend `FurniturePalette.tsx` with live search, category tabs, style filter pills, budget slider, and API fallback
  - Interactive `BudgetBreakdownModal.tsx` showing authoritative calculation, category subtotals, and room envelope compliance
  - Full automated tests passing: 53 Django tests, 27 frontend Vitest tests, 0 lint warnings
- [x] **Phase 4 — AI interior-design agent**
  - Modular `apps/ai_agent` application with `AgentSession` and `AgentRun` persistence
  - Configurable adapter architecture: `BaseDesignLLMAdapter` interface with Google Gemini API adapter (`gemini-3.8-flash`) and offline deterministic `MockDesignLLMAdapter` active by default in dev/tests
  - Strictly allowlisted typed actions (`add_furniture`, `move_object`, `replace_furniture`, `remove_object`, `set_material`, `clear_room`); zero execution of arbitrary code, SQL, shell, or unrestricted HTTP
  - Deterministic pre-flight simulation engine (`validate_and_simulate_actions`) computing 3D room containment and integer paise budget impact before persistence
  - Two-phase approval workflow: `/prompt/` proposes structured modifications without mutating the design; scene changes are applied only upon explicit user approval via `/apply/`
  - Strict user-ownership isolation (sessions and runs isolated by `owner=request.user`, 404 for cross-user queries)
  - Interactive frontend slide-out `AiAgentDrawer.tsx` with conversation history, suggested prompt chips, structured proposal preview card, authoritative budget impact, and Approve/Discard controls
  - Automated tests passing: 64 Django tests, 28 frontend Vitest tests, 0 lint warnings, production bundle verified
- [ ] **Phase 5 — Room photo analysis**
- [ ] **Phase 6 — Photo-to-3D furniture approximation**
- [ ] **Phase 7 — Real-world AR placement**
- [ ] **Phase 8 — Research, testing, and delivery**
