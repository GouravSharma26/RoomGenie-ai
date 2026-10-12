# RoomGenie AI — Architecture and Contracts

## 1. Architectural approach

Use a modular monolith: one React client, one Django REST API, one PostgreSQL database, and optional asynchronous workers only when needed. Keep model providers replaceable behind adapters. Store image/model files in file storage and keep only metadata/URLs in PostgreSQL.

## 2. Repository layout

```text
roomgenie-ai/
├── AGENTS.md
├── plan.md
├── ARCHITECTURE.md
├── HUMAN_SETUP.md
├── RESEARCH_PLAN.md
├── DEVELOPMENT_CHECKLIST.md
├── frontend/
│   ├── public/models/furniture/
│   └── src/
│       ├── app/
│       ├── components/
│       ├── features/{auth,rooms,ai-agent,furniture,budget,designs}/
│       ├── editor3d/
│       ├── services/
│       ├── types/
│       └── utils/
├── backend/
│   ├── manage.py
│   ├── config/
│   └── apps/{accounts,rooms,furniture,designs,ai_agent,image_analysis,reconstruction,budgets}/
├── ml/{room_analysis,image_to_3d,evaluation}/
├── docs/
└── .agents/rules/
```

Create directories only when the feature is implemented. Avoid empty placeholder apps without a use case.

## 3. Main modules

- **rooms:** room dimensions, uploaded room photos, room-analysis association.
- **furniture:** catalogue metadata, asset location, licence/source, dimensions, price/currency, category, tags.
- **designs:** saved design snapshots, owner, room, scene JSON, version/history where feasible.
- **ai_agent:** conversation/session records, provider adapter, tool schemas, validated action proposals.
- **image_analysis:** upload validation, vision-provider adapter, structured analysis result.
- **reconstruction:** long-running jobs, input image references, provider, output asset, status/errors.
- **budgets:** deterministic totals, constraint checking, estimates from catalogue prices.

## 4. Canonical scene schema

Use metres for all physical dimensions. Use Three.js conventions (Y is vertical; X/Z span the floor). Document every conversion to another tool's coordinates.

Example only:

```json
{
  "schemaVersion": 1,
  "unit": "m",
  "room": { "width": 5, "length": 4, "height": 2.8 },
  "objects": [
    {
      "id": "placement-uuid",
      "assetId": "sofa-model-uuid",
      "position": [1.2, 0, -0.5],
      "rotationEuler": [0, 1.57, 0],
      "scale": [1, 1, 1],
      "materialOverrides": { "color": "#c8b8a6" }
    }
  ]
}
```

The scene JSON is serializable data. Never save Three.js object instances or functions. Use a schema version so future changes can be migrated.

## 5. Initial data model

- **User:** Django authentication identity.
- **Room:** owner, name, dimensions, photo path/URL, timestamps.
- **FurnitureAsset:** name, category, style tags, model path/URL, thumbnail, dimensions, price, currency, source, licence, active flag.
- **Design:** owner, room, title, budget, style preferences, scene JSON, timestamps.
- **AgentRun:** design, user instruction, status, proposed actions, validation results, provider/model metadata where appropriate.
- **AnalysisJob:** room/photo reference, status, output JSON, safe error category.
- **ReconstructionJob:** input file references, status, provider, output asset reference, dimensions/quality metadata, safe error category.

A separate FurniturePlacement table is optional. For the first prototype, object placements can live within `Design.scene_json`; add normalized placement rows only if queries/auditing require them. Do not maintain two unsynchronized sources of truth.

## 6. API conventions

Prefix all endpoints with `/api/v1/`. Use JSON. Return appropriate HTTP status codes and predictable errors. Require authentication for private data; every query/update must enforce ownership.

Initial endpoint groups:

- `POST/GET /rooms/`, `GET/PATCH/DELETE /rooms/{id}/`
- `POST /rooms/{id}/analyze/`, `GET /analysis-jobs/{id}/`
- `GET /furniture/`, `GET /furniture/{id}/`
- `POST/GET /designs/`, `GET/PATCH/DELETE /designs/{id}/`
- `POST /designs/{id}/duplicate/`
- `POST /agent/sessions/`, `POST /agent/sessions/{id}/messages/`, `GET /agent/runs/{id}/`
- `POST /reconstruction-jobs/`, `GET /reconstruction-jobs/{id}/`
- `POST /budgets/estimate/`

Use pagination/filtering for catalogue endpoints once the sample catalogue grows. Never return filesystem paths or provider secrets.

## 7. Agent action schema

Use an allowlisted set of actions, for example:

- `add_furniture`: asset ID + validated transform.
- `move_object`: placement ID + new position/rotation.
- `replace_furniture`: existing placement ID + replacement asset ID.
- `remove_object`: placement ID, requiring confirmation.
- `set_material`: placement ID + allowed material properties.
- `propose_layout`: preference/constraint input; returns a proposal, not an automatic destructive edit.

For every action:

1. Parse against a typed schema.
2. Verify the user owns the design.
3. Check referenced assets/placements exist.
4. Check transform bounds, dimensions, room boundaries, collisions, doorway rules, and budget when relevant.
5. Return a proposal with warnings and validation results.
6. Apply only after explicit user confirmation.
7. Save a reversible change record if supported.

The LLM is not the source of truth for prices, dimensions, coordinates, or authorization.

## 8. Provider interfaces

Use replaceable adapters such as:

```python
class RoomVisionProvider:
    def analyze_room(self, image_reference: str) -> dict: ...

class DesignLLMProvider:
    def propose_actions(self, messages: list[dict], tool_schemas: list[dict]) -> dict: ...

class ImageTo3DProvider:
    def create_model(self, image_references: list[str], options: dict) -> dict: ...
```

This is illustrative, not a requirement to use these exact signatures. Define proper types, timeouts, error handling, and tests in implementation. Include a deterministic mock adapter for tests and development.

## 9. Asset handling

- Prefer GLB for portable bundled models when supported by the chosen tools.
- Record licence/source and do not use assets whose reuse terms are unknown.
- Validate file size and content type; do not trust filename extensions alone.
- Store generated/uploaded media outside public static assets when private.
- Keep large asset binaries out of PostgreSQL.
- Establish a maximum upload size and timeouts before accepting public user uploads.

## 10. AR boundary

The web editor is the source of design data. An AR module receives an asset reference, target dimensions, and user-adjustable transform. Do not assume browser AR availability on every device. Verify target-device support before selecting web AR or a Unity AR Foundation companion. AR preview is not a certified safety or measurement tool.
