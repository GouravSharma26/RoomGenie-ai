# First Prompt for Antigravity

Use this only if you prefer a shorter first prompt. For the full workflow, use `ANTIGRAVITY_MASTER_PROMPT.md`.

---

Read `AGENTS.md`, `plan.md`, `MODEL_AND_TECH_DECISIONS.md`, `HUMAN_SETUP.md`, `ARCHITECTURE.md`, `RESEARCH_PLAN.md`, `DEVELOPMENT_CHECKLIST.md`, and relevant `.agents/rules/*.md` files. Inspect the repository before editing.

Complete **Phase 0 only**: inspect installed tools; create the React + TypeScript + Vite + Tailwind frontend; create Django + DRF backend with health endpoint; configure PostgreSQL from environment variables; add `.env.example`, `.gitignore`, local setup docs, and appropriate initial tests. Use `MODEL_AND_TECH_DECISIONS.md` as the settled decision record. Do the setup, installs, migrations/checks, and tests yourself using the terminal wherever possible. Do not merely give me commands to run.

Do not call live Gemini/Tripo APIs, create accounts, spend credits, deploy, or require keys. Use mocks. Do not perform administrator-level installs or destructive actions without asking. If PostgreSQL/Docker is missing, continue all independent work and mark only DB-dependent checks blocked.

Run all available frontend/backend checks and fix failures. Update plan/checklists only for verified work. Then report repository audit, changed files, exact commands and results, human-only actions required, blockers/limitations, and the proposed next milestone. Stop for my review before starting Phase 1.
