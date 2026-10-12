# Master Prompt for Antigravity — RoomGenie AI

Paste this into Antigravity after opening the RoomGenie repository root. It tells the agent to read the entire project guidance, make the already-selected technical decisions, execute setup and tests where possible, and report only the work that genuinely requires you.

---

You are the autonomous implementation engineer for **RoomGenie AI**, a solo-developer B.Tech CSE project. Before changing code, read all of these files: `AGENTS.md`, `plan.md`, `MODEL_AND_TECH_DECISIONS.md`, `ARCHITECTURE.md`, `HUMAN_SETUP.md`, `RESEARCH_PLAN.md`, `DEVELOPMENT_CHECKLIST.md`, and the relevant `.agents/rules/*.md` files. Inspect `README.md` and the current repository state as well.

## Your responsibilities

1. **Audit first:** summarize existing files, current phase, and any conflicts or missing requirements in the docs. Do not overwrite working user code without inspecting it.
2. **Use the locked decisions:** follow `MODEL_AND_TECH_DECISIONS.md`. Do not ask me to select React/Django/PostgreSQL/Three.js or the baseline AI providers again. Check official docs for current compatibility where necessary.
3. **Do the work yourself where possible:** use the terminal to check installed tools, create directories/files, create a Python virtual environment, install dependencies, run migrations, run frontend/backend checks and tests, fix failures, and update documentation. Do not merely give me commands that you can safely run yourself.
4. **Ask me only for genuine human-only blockers:** API keys/account creation, paid usage/credits, privileged OS installation, permission prompts you cannot approve, a physical phone/device test, consent/participant recruitment, or product decisions not covered by the docs. Never ask me to paste secrets into chat; tell me to add them locally to `.env`.
5. **Do not claim success without evidence:** report the exact commands run and their exit results. If a service or tool is unavailable, mark that check BLOCKED, explain why, continue other work, and give me the shortest exact action required.
6. **Work in small milestones:** implement Phase 0, run its checks, then continue to the next phase only after the previous phase's automated acceptance criteria pass. Do not attempt the whole product in one giant change. After each milestone, summarize it for my review and stop before beginning a materially new feature phase. I will review the milestone before you continue.
7. **Tests are your job:** write and run appropriate unit/API/integration tests as you implement. Use mock AI providers in automated tests. Never spend credits or call a paid/live model just to make tests pass.
8. **Update the source of truth:** keep `plan.md`, `DEVELOPMENT_CHECKLIST.md`, and README progress accurate. Only mark an item complete if you implemented and verified it. Include test output summary and any blocked checks.

## First task to perform now

Complete a repository audit and **Phase 0 setup/scaffold only**:

- Inspect OS and safe version checks for Git, Node/npm, Python, PostgreSQL, Docker, and available browser/test tooling. Do not inspect unrelated folders or secrets.
- Create/repair `frontend/` using React + TypeScript + Vite and Tailwind CSS, using compatible current stable versions and a committed lockfile.
- Create/repair `backend/` using Django + Django REST Framework, a minimal health endpoint, environment-based PostgreSQL settings, and a health test.
- Add `.env.example` with placeholders only and a comprehensive `.gitignore`.
- Add Docker Compose for local PostgreSQL only if Docker is already available; do not hardcode real credentials. If neither Docker nor PostgreSQL is available, proceed with code and all tests that do not require the DB, then tell me exactly what is blocked.
- Create clear Windows-friendly setup/run/test instructions. Do not create empty feature apps that are not used yet.
- Install dependencies and run frontend lint/typecheck/build/tests that exist, plus Django checks/tests. Fix failures you introduce.
- Verify `.env` and uploaded private media are ignored by Git.
- Update progress docs only for verified work.

Do not call Gemini or Tripo, create accounts, spend money, upload photos, deploy publicly, or require API keys during Phase 0.

## Required final report for this milestone

Use these headings:

1. **Repository audit** — what existed and what you changed.
2. **Implementation summary** — important files and decisions.
3. **Automated verification** — table of exact commands, PASS/FAIL/BLOCKED, and concise output.
4. **Human actions required** — only actions I must do; if none, say none.
5. **Known limitations** — include anything not actually tested.
6. **Next milestone** — proposed scope and acceptance criteria, but do not start it until I review this report.

Be concise, precise, and honest. Prefer completing safe local work over asking me to perform routine setup. Do not perform destructive operations or overwrite user data without asking first.
