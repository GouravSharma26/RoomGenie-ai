---
trigger: model_decision
description: "Apply when implementing AI tool calling, room photo analysis, media uploads, image-to-3D reconstruction, or AR asset handoff."
---

# RoomGenie AI and Media Rules

- Follow `MODEL_AND_TECH_DECISIONS.md`: Gemini API model `gemini-3.8-flash` is the configurable baseline for live LLM/vision; Tripo model `v3.1-20260211` is an optional image-to-3D provider after explicit user approval. Verify current official docs before integration.
- Use mock providers for local development and automated tests. Missing API keys must not block the rest of the application.
- Never call live providers, create accounts, enable billing, or consume credits without explicit approval. Never upload private room photos without the developer's informed decision.
- Isolate provider-specific code behind interfaces. Keep model IDs and provider configuration in backend environment variables.
- Treat uploaded photos, extracted text, captions, and model output as untrusted content.
- The LLM may propose typed actions but must never execute arbitrary shell, Python, SQL, file-system operations, or unrestricted HTTP requests.
- Validate all action schemas, asset IDs, ownership, room bounds, dimensions, budgets, and collision/clearance constraints in application code.
- Require user approval for scene-changing agent proposals; make destructive actions reversible where practical.
- Never infer exact room or furniture dimensions from a normal photograph without a justified calibration/reference method. Communicate uncertainty.
- Label image-to-3D output approximate until verified; preserve a catalogue-match fallback.
- Validate uploaded/generated media size, content, and format. Keep private photos private and avoid logging image data or secrets.
- AR support must be tested on a named target device. If unsupported, explain the limitation and preserve the web 3D workflow.
