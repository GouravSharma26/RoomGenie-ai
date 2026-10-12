---
trigger: glob
globs: "backend/**/*.py"
description: "Django API, database, validation, and security rules for RoomGenie AI."
---

# RoomGenie AI Backend Rules

- Use Django and Django REST Framework with clear separation between models, serializers, API views, and service functions.
- Use PostgreSQL configuration through environment variables. Never hardcode passwords or secret keys.
- Enforce authentication and ownership checks for user-private rooms, designs, uploaded media, and job results.
- Treat the backend as authoritative for budget calculations, catalogue metadata, design persistence, and authorization.
- Validate IDs, dimensions, prices, uploads, and all agent action arguments.
- Do not execute raw SQL built from untrusted strings; prefer Django ORM and parameterized queries.
- Use explicit job statuses and safe error categories for slow provider operations.
- Add tests for both valid and invalid requests, ownership boundaries, and failure paths.
- Never report a database/provider operation succeeded unless it actually did.
