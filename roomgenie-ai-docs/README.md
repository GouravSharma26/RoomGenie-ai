# RoomGenie AI — Project Documentation Pack

This repository is the implementation guide for a solo-developer B.Tech CSE project combining an interactive 3D interior editor, an AI design agent, room-photo analysis, budget-aware recommendations, optional furniture photo-to-3D reconstruction, and later AR placement.

## Start here

1. Extract the documentation pack into `roomgenie-ai/` and open that folder in Antigravity.
2. Read `MODEL_AND_TECH_DECISIONS.md` for the settled stack and model choices.
3. Paste `ANTIGRAVITY_MASTER_PROMPT.md` into Antigravity. The agent should inspect the repository, set up the scaffold, run tests, and report what only you need to do.
4. Review the milestone report and manually check the app before approving the next phase.

## Documentation files

- `plan.md` — phases, timeline, acceptance criteria, progress.
- `AGENTS.md` — persistent coding-agent rules and workflow.
- `MODEL_AND_TECH_DECISIONS.md` — selected stack/models, cost/privacy gates, provider fallback strategy.
- `ANTIGRAVITY_MASTER_PROMPT.md` — full initial prompt for Antigravity.
- `ANTIGRAVITY_FIRST_PROMPT.md` — shorter alternative first prompt.
- `HUMAN_SETUP.md` — only human-owned tasks, approvals, credentials, device testing, and research participants.
- `ARCHITECTURE.md` — system architecture, database, API, scene contract.
- `RESEARCH_PLAN.md` — research questions, design, measures, ethics, analysis.
- `DEVELOPMENT_CHECKLIST.md` — definition of done and test checklist.
- `.agents/rules/frontend.md` — frontend conventions.
- `.agents/rules/backend.md` — backend and security conventions.
- `.agents/rules/ai-and-media.md` — AI, image, reconstruction, and AR rules.

## Locked technical baseline

- React + TypeScript + Vite + Tailwind CSS.
- Three.js + React Three Fiber + Drei; GLB/GLTF furniture assets.
- Django + Django REST Framework + PostgreSQL.
- Gemini API `gemini-3.7-flash` for the first live LLM/vision adapter, configurable and verified against current official docs.
- Tripo API model `v3.1-20260211` as an optional image-to-3D adapter only after explicit approval of account/key and potential charges.
- Mock AI providers for automated tests and development without keys.

See `MODEL_AND_TECH_DECISIONS.md` for official documentation links and decision details. Model availability, prices, and terms can change; verify at implementation time.

## Agent workflow

Antigravity should do safe local setup, coding, dependency installation, migrations, automated tests, type checks, builds, and documentation updates itself where possible. It should ask you only for genuine human actions: approving privileged/destructive commands, installing missing system software, supplying secrets locally, approving paid services, testing physical-device AR, and recruiting/consenting research participants.

Work one milestone at a time. Do not implement all features in one prompt. Stop after a milestone for your review.

## Progress

- [ ] Phase 0 — audit, environment checks, and scaffold
- [ ] Phase 1 — interactive 3D room editor
- [ ] Phase 2 — Django persistence
- [ ] Phase 3 — furniture catalogue and budget logic
- [ ] Phase 4 — AI design agent
- [ ] Phase 5 — room photo analysis
- [ ] Phase 6 — photo-to-3D approximation
- [ ] Phase 7 — real-world AR prototype
- [ ] Phase 8 — research evaluation and final report
