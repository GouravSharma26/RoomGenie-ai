# Human Tasks — What Only You Need to Do

Antigravity should do routine coding, local setup, dependency installation, migrations, automated tests, linting, builds, and documentation wherever its terminal permissions and installed tools allow. Use this file only for actions that genuinely require you.

## 1. Your first actions

- [ ] Extract the documentation ZIP into a folder named `roomgenie-ai`.
- [ ] Open that exact folder as the Antigravity workspace.
- [ ] Paste `ANTIGRAVITY_MASTER_PROMPT.md` into Antigravity.
- [ ] Review the agent's audit and Phase 0 report before approving the next milestone.

You do **not** need to manually create the React/Django project, install project packages, write tests, run routine migrations, or set up directories if Antigravity's terminal can do these tasks. It should try first and report blockers.

## 2. Actions you may need to perform

### Approve local terminal/OS prompts

If Antigravity requests permission to run a command, inspect the command and approve normal project-local commands when you are comfortable. Do not approve destructive commands, administrator installs, database deletion/reset, public deployment, or paid usage without understanding the impact.

### Install missing system prerequisites

If Git, Node.js, Python, PostgreSQL, or Docker is missing and the agent cannot install it safely without administrator access, install it yourself from its official website and tell Antigravity when complete. The agent must first check what is already installed and avoid duplicate installs.

### Configure secrets locally when needed

The project must work in mock mode without API keys. Only when you choose to enable live AI features:

- Create/configure your own Google AI Studio/Gemini API key and add it to the backend `.env` as `GEMINI_API_KEY`.
- For photo-to-3D, live provider access is strictly gated by default to prevent accidental credit spend. To enable live external requests:
  1. Set `IMAGE_TO_3D_PROVIDER_MODE=tripo` in your `.env`.
  2. Set `TRIPO_API_KEY=<your-key>` in `.env`.
  3. Explicitly set `IMAGE_TO_3D_ALLOW_PAID_REQUESTS=true` in `.env` to authorize paid outbound requests. If this flag is omitted or `false`, the backend will always fall back safely to the offline procedural mock adapter.
  4. Remote model downloads are protected against SSRF by validating the destination and any redirects against `IMAGE_TO_3D_ALLOWED_HOSTS` (defaults to `tripo3d.ai,.tripo3d.ai,amazonaws.com,.amazonaws.com,cloudfront.net,.cloudfront.net`) and blocking private/local networks.
- Keep keys out of chat messages, Markdown, screenshots, Git commits, and frontend environment variables.
- Review current pricing, data use, and privacy terms before sending real room photos to any hosted provider.

Do not create these accounts or enable billing just to complete the scaffold or automated tests.

### Physical device testing

Only you can physically confirm camera permissions, tracking, floor detection, AR stability, and performance on your phone. When the AR phase arrives, tell Antigravity the phone make/model, OS, and browser; do not spend time on AR before the 3D editor works.

### Research participant actions

You must recruit participants, obtain consent and any institution-required permission, and supervise any real-world study. Antigravity can prepare test scripts, forms, analysis code, and synthetic test fixtures, but it must not fabricate participants or research results.

## 3. What you should review at every milestone

- [ ] Read the agent's summary of changed files.
- [ ] Confirm the exact tests and builds actually ran and inspect failures/blockers.
- [ ] Open the app and complete the short manual checklist the agent gives you.
- [ ] Check screenshots/UI and decide whether the result matches the project goal.
- [ ] Approve the next milestone only after you are satisfied.

## 4. Keep these boundaries

- Never paste secrets into Antigravity chat; add them locally to `.env`.
- Never allow a paid model call or 3D-generation credit purchase without your explicit approval.
- Never upload personal room photos unless you have reviewed the provider's terms and intended use.
- Do not accept claims that AR or reconstruction works unless it was tested on real supported inputs/devices.
