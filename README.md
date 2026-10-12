# RoomGenie AI

An AI-Agent-Assisted Interior Design System combining interactive 3D furniture placement, room-photo analysis, budget-aware recommendations, optional photo-to-3D reconstruction, and AR visualization.

> **Project Type:** Solo B.Tech CSE Project (Gourav Sharma)  
> **Status:** Phase 0 (Setup & Scaffold) Verified

---

## Technical Stack & Locked Decisions

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4
- **3D Engine:** Three.js + React Three Fiber + Drei (Phase 1)
- **Backend:** Python 3.12 + Django 5.1 + Django REST Framework + CORS Headers
- **Database:** PostgreSQL 17 (authoritative relational & scene persistence)
- **AI Baselines:** 
  - LLM & Vision: Google Gemini API (`gemini-3.7-flash`), default mock adapter in dev/tests
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
├── MODEL_AND_TECH_DECISIONS.md # Locked tech stack & provider decisions
├── HUMAN_SETUP.md              # Human-owned actions & approval boundaries
├── RESEARCH_PLAN.md            # Empirical research study protocol & metrics
├── DEVELOPMENT_CHECKLIST.md    # Milestone definition of done & verification checklist
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

### 4. Running Database with Docker Compose (Optional)

If you prefer running PostgreSQL via Docker instead of local Windows service:
```powershell
docker compose up -d postgres
```

---

## Progress Tracker

- [x] **Phase 0 — Setup and scaffold**
  - OS and environment inspection (Git, Node, Python, PostgreSQL, Docker)
  - React + TypeScript + Vite + Tailwind CSS frontend scaffold
  - Vitest + Testing Library tests passing
  - Django + DRF backend with environment-based PostgreSQL settings
  - Health check endpoint `/api/v1/health/` and unit test suite
  - Locked tech stack verification & mock provider configurations
- [ ] **Phase 1 — Interactive 3D room editor**
- [ ] **Phase 2 — Django API and persistence**
- [ ] **Phase 3 — Furniture catalogue and budget**
- [ ] **Phase 4 — AI interior-design agent**
- [ ] **Phase 5 — Room photo analysis**
- [ ] **Phase 6 — Photo-to-3D furniture approximation**
- [ ] **Phase 7 — Real-world AR placement**
- [ ] **Phase 8 — Research, testing, and delivery**
