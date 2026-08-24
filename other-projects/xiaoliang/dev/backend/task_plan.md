# Backend Task Plan

## Goal

Implement the first usable backend slices for auth, submission evidence, review, and skill publication without carrying any desktop release management semantics.

## Current Phase

- Phase A1: Create package structure, config, database, error handling, and ORM models. Completed.
- Phase A2: Add auth services and routes. Completed.
- Phase A3: Add submission and skill domain models, services, and routes. Completed.
- Phase A4: Update docs, local env files, and run validation. Completed.

## Implemented In This Pass

- Replaced the old single-file backend with a package-based FastAPI app under `app/`.
- Added SQLAlchemy models for organizations, users, memberships, refresh tokens, and audit logs.
- Added auth endpoints for register, login, refresh, logout, and current user lookup.
- Added submission draft, asset registration, geometry snapshot, submit, and review endpoints.
- Added global skill publication and multi-field descriptor search endpoints.
- Added environment/config handling, Docker Compose for local PostgreSQL, and refreshed backend docs.
- Removed backend release metadata routes/config so desktop versions stay governed by GitHub Releases only.
- Generated a real local `.env` file and validated the full smoke chain.

## Next Focus

- Connect the Electron client to submission creation, evidence registration, and skill search.
- Replace metadata-only asset registration with real file upload / object storage flows.
- Add email verification and password recovery on top of the generated `.env` placeholders.

## Constraints

- Start with a clean FastAPI package structure under `dev/backend/app`.
- Client remains responsible for local CAD data collection; backend becomes the authority for auth and shared data.