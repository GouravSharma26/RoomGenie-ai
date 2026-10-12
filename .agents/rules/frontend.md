---
trigger: glob
globs: "frontend/src/**/*.ts, frontend/src/**/*.tsx, frontend/**/*.css"
description: "Frontend conventions for RoomGenie AI React, TypeScript, and Three.js code."
---

# RoomGenie AI Frontend Rules

- Use React + TypeScript and keep components small and purpose-specific.
- Keep the 3D scene's serializable state separate from live Three.js objects, refs, and renderer instances.
- Use metres and the scene coordinate convention documented in `ARCHITECTURE.md`.
- Use accessible labels, keyboard focus, clear empty/loading/error states, and responsive layout.
- Use React Three Fiber/Drei when they simplify the scene; do not add another 3D framework without justification.
- Keep API calls in service modules, not scattered throughout display components.
- Never put secret API keys in frontend code or variables bundled into the client.
- Render AI-proposed scene changes as a preview/diff and require user approval before applying them.
- Ensure object transforms are reversible and expose clear controls; avoid drag-only interfaces without accessible alternatives.
- Do not claim AR works on devices that have not been tested. Provide capability detection and fallback messaging.
- Run TypeScript checks and build checks after meaningful changes. Report actual command results.
