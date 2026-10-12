# RoomGenie AI — Locked Model and Technology Decisions

**Status:** Baseline decisions for implementation. The coding agent should follow these unless a real compatibility blocker is found. Do not repeatedly reopen decisions that are already settled.

## 1. Core stack

| Area | Decision | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | Single-page web app; browser-first development. |
| Styling | Tailwind CSS | Use a compatible current stable release and lock dependencies. |
| 3D | Three.js + React Three Fiber + Drei | GLB/GLTF is the standard asset format. Check React/R3F major-version compatibility before installing. |
| UI state | Zustand, only if needed for shared editor state | Keep the serializable scene model separate from live Three.js objects. Do not add Redux without a reason. |
| Backend | Python + Django + Django REST Framework | Modular monolith, one backend. |
| Database | PostgreSQL | Use Docker Compose if Docker is already installed and working; otherwise use an existing local PostgreSQL. Do not silently switch the main app to SQLite. |
| API client | `fetch` wrapper or Axios | Prefer a small typed API wrapper; do not add both. |
| Backend schemas | Django serializers; Pydantic only at provider/tool boundaries if useful | Avoid duplicate schema frameworks without a clear benefit. |
| Tests | Vitest + React Testing Library; Django TestCase/DRF APIClient; Playwright only for a few high-value end-to-end flows | Run what the environment supports and report blockers honestly. |
| Background work | No Celery/Redis in initial scaffold. Add Celery + Redis only for real long-running reconstruction jobs. | Keep initial setup simple. |
| File storage | Local private media for development | Add cloud object storage only when deployment requires it. |
| Currency | INR (₹) | All catalogue prices and budget totals use integer paise or Decimal, never floating-point money. |

## 2. AI model selection

### Primary LLM and room-image analysis

- **Provider:** Google Gemini API.
- **Initial model ID:** `gemini-3.7-flash`.
- **Use cases:** structured design-agent tool calling, room-photo observations, style/colour descriptions, and furniture/category suggestions.
- **Official references:** [Gemini models](https://ai.google.dev/gemini-api/docs/models), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [pricing and free-tier terms](https://ai.google.dev/gemini-api/docs/pricing).
- **Implementation rule:** read the official docs at implementation time and verify that the exact model ID remains available to the selected API key/region. Keep the model ID configurable as `GEMINI_MODEL`; do not hardcode it in multiple modules.
- **Privacy/cost rule:** use a deterministic mock provider for all automated tests and while no API key is configured. Do not send personal room photos to a provider unless the developer knowingly configures the key and has reviewed the provider's current data-use terms. Do not enable paid billing, purchase credits, or call live models without explicit user approval.
- **Model responsibilities:** the LLM may propose typed actions only. Django validates the actions; the model cannot directly mutate the database or execute code.

### Photo-to-3D

- **Provider adapter:** implement an `ImageTo3DProvider` interface and a working `MockImageTo3DProvider` first.
- **Optional hosted provider:** Tripo API, model ID `v3.1-20260211` where available; keep the version configurable and verify official docs before integration. Official references: [image-to-3D endpoint](https://developers.tripo3d.ai/en/docs/generation-image-to-model), [model details](https://developers.tripo3d.com/en/models/v3-1), [pricing](https://developers.tripo3d.ai/en/pricing).
- **Cost:** Tripo is usage/credit based; current published prices can change. Treat every generation as potentially billable. Do not call the real API, create an account, or spend credits until the developer explicitly approves it and configures `TRIPO_API_KEY`.
- **Fallback:** catalogue-based similar GLB model with adjustable dimensions/materials. This fallback must work without any external key.
- **Truthfulness:** label generated assets as approximate. Never promise exact replicas, especially from one photo.

### Interior moodboard images

Do not add an image-generation API to the first release. The app should initially generate design plans from existing furniture assets, material swatches, and layout suggestions. If concept-image generation is later justified, propose it as a separate decision with current pricing and privacy review.

## 3. AR decision

- Build and test the browser 3D editor first.
- Do not commit to browser AR until the target phone/browser is known and tested.
- Preferred fallback for a reliable Android demo: a separate Unity + AR Foundation companion that consumes exported GLB/GLTF assets or a documented converted format.
- The agent should check available devices and support, then report what the developer needs to test. Do not claim AR is verified without a real-device test.

## 4. Local setup decisions

- First inspect OS, installed tools, repository contents, and Docker/PostgreSQL availability using safe commands.
- If Docker is already installed, use a small `docker-compose.yml` for PostgreSQL with credentials from `.env`; never commit the actual `.env`.
- If Docker is unavailable but PostgreSQL is installed, use that instance and provide the exact `.env` fields needed.
- If neither is available, continue implementing code and running frontend/unit tests; report PostgreSQL integration as blocked and give the developer the shortest install/setup instructions. Do not install system software or request administrator privileges without permission.
- The agent should create a Python virtual environment, install project dependencies, run migrations/checks/tests, install frontend dependencies, and run type/build/tests wherever its terminal permissions allow.

## 5. Provider interface contract

Create interfaces/adapters such as:

- `DesignLLMProvider.propose_actions(...)`
- `RoomVisionProvider.analyze_room(...)`
- `ImageTo3DProvider.create_model(...)`

Implement mocks before live adapters. Provider selection must be configurable by environment variables. Never expose API keys in frontend code, logs, source control, or error responses.

## 6. Decision-change policy

The agent should not ask the developer to choose the stack again. If a selected package/model is unavailable or incompatible:
1. verify against official documentation;
2. explain the concrete blocker and alternatives;
3. select the closest compatible option only if it does not introduce a new paid service, privacy exposure, or major architecture change;
4. otherwise stop only that blocked integration, continue unrelated work, and ask for a decision.
