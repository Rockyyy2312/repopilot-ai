# RepoPilot AI: SaaS-scale architecture

This document describes the recommended evolution of the current RepoPilot AI
application into a multi-tenant SaaS product. It is intentionally incremental:
the current FastAPI and React code can remain the product foundation while the
stateful and CPU-heavy parts are moved behind durable service boundaries.

## 1. Current baseline

The current product is a deterministic repository analysis workspace:

- React 19 + TypeScript + Vite frontend.
- FastAPI + Python 3.11 API and analysis engine.
- SQLite for auth, projects, and job records.
- In-process memory cache for active projects.
- A process-local `ThreadPoolExecutor(max_workers=1)` for imports.
- One container serving the frontend bundle and API from the same origin.

This is a good single-instance MVP. The process-local executor, SQLite files,
local persistent volume, and in-memory project cache are the first limits when
running more than one API instance.

## 2. Target architecture

```text
Browser
  |
CDN / WAF / Load balancer
  |------------------------------|
Static frontend                 API service (stateless FastAPI)
                                 |-- Auth / organizations / RBAC
                                 |-- Projects / search / graph / reports
                                 |-- Usage / billing webhooks
                                 |
                 ----------------+------------------
                 |                |                |
              Postgres          Redis          Object storage
          tenant metadata,   rate limits,       source archives,
          jobs, memberships   cache, locks      analysis artifacts
                 |
              Queue (SQS/RabbitMQ/Redis Streams)
                 |
         Analysis worker fleet (autoscaled, no public ingress)
          import -> extract -> analyze -> index -> persist
                 |
       Optional search index (Postgres FTS first, OpenSearch later)
```

Use a **modular monolith plus workers** first. Do not split every Python module
into a microservice. The API, worker, and shared domain modules can live in one
repository and be deployed as separate process types. This keeps local
development and transactions simple while allowing analysis capacity to scale
independently from HTTP traffic.

## 3. Recommended technology stack

| Concern | Recommendation | Reason |
| --- | --- | --- |
| Frontend | Keep React + TypeScript + Vite | Existing UI is already a deployable SPA; no need to migrate to Next.js unless SEO/server rendering becomes a product requirement. |
| API | Keep FastAPI + Python 3.11 initially | Matches the analysis implementation and has strong async/API validation support. |
| API contracts | OpenAPI generated from FastAPI; use `openapi-typescript` for frontend types | Prevents frontend/backend payload drift. |
| Primary database | PostgreSQL 16+ with SQLAlchemy 2 + Alembic | Concurrent writes, transactions, indexes, JSONB, migrations, and tenant-safe constraints. |
| Queue | AWS SQS + DLQ, or RabbitMQ if self-hosting is required | Durable import jobs and retry behavior without tying work to an API process. |
| Cache/coordination | Redis | Distributed rate limits, short-lived cache, idempotency keys, and locks. Never use it as the source of truth for jobs. |
| Repository/artifact storage | S3-compatible object storage | Archives and analysis results are large, durable, cheap, and should not live in Postgres rows or container disks. |
| Search | PostgreSQL full-text/trigram search initially; OpenSearch when measured query volume requires it | Avoid operating a second indexing system until search latency or scale justifies it. |
| Auth | OIDC provider such as WorkOS/Auth0/Clerk; keep local auth only for development | MFA, password reset, sessions, enterprise SSO, SCIM, and audit requirements are expensive to maintain yourself. |
| Billing | Stripe Billing + webhook consumer | Subscription lifecycle and payment state should be event-driven and auditable. |
| Hosting | CDN/WAF + managed Postgres/Redis/object storage + ECS/Fargate or equivalent containers | Scales the current Docker deployment without taking on Kubernetes operations too early. |
| Observability | OpenTelemetry, Prometheus/Grafana, and Sentry | Correlate API request, job, tenant, and analysis failures with trace IDs. |
| CI/CD | GitHub Actions: lint, typecheck, unit, integration, build, image scan, deploy | Every merge should produce a reproducible image and a migration-safe release. |

## 4. Core data model for multi-tenancy

Introduce organizations/workspaces before adding team features. Every business
record must carry `organization_id` (or `workspace_id`) and be checked at the
repository/service boundary.

Minimum tables:

```text
organizations(id, name, plan, created_at)
users(id, auth_subject, email, created_at)
memberships(organization_id, user_id, role)
projects(id, organization_id, source_type, source_ref, status, created_at)
project_versions(id, project_id, object_key, content_hash, analysis_version, status)
analysis_runs(id, project_version_id, job_id, status, metrics_json, error)
jobs(id, organization_id, type, idempotency_key, status, attempts, timestamps)
usage_events(id, organization_id, metric, quantity, source_id, created_at)
subscriptions(organization_id, stripe_customer_id, stripe_subscription_id, status)
audit_events(id, organization_id, actor_id, action, resource, metadata_json)
```

Rules:

1. Use UUID/ULID identifiers; never expose sequential tenant counts.
2. Add composite indexes such as `(organization_id, created_at)` and
   `(organization_id, status)`.
3. Enforce ownership in SQL queries and service methods. PostgreSQL Row Level
   Security is an additional defense for sensitive tables.
4. Store repository bytes in object storage. Keep only metadata, hashes, and
   derived summaries in Postgres.
5. Make `content_hash + analysis_version + analyzer_config_hash` the cache key.

## 5. Import and analysis flow

1. `POST /projects/import` authenticates the member, checks plan limits, and
   creates a project version plus a `queued` job in one database transaction.
2. The API returns `202 Accepted`, the job ID, and a status URL. It does not
   download or analyze the repository in the request process.
3. The worker claims the job with a lease, downloads from GitHub using a GitHub
   App token where applicable, and writes the archive to a private object key.
4. A sandboxed extraction step enforces compressed size, extracted size, file
   count, path traversal, symlink, timeout, and sensitive-file limits.
5. The analysis worker runs the existing deterministic engine, writes the
   normalized result and summary, and publishes progress events.
6. The API reads job/project state from Postgres and signed artifact URLs from
   object storage. WebSocket/SSE progress is an optimization, not the source
   of truth.
7. Failed jobs retry with exponential backoff. Permanent failures go to a DLQ
   and are visible to operators without leaking repository content.

Every job needs an idempotency key and a state machine such as:

```text
queued -> running -> succeeded
                 \-> retry_wait -> running
                 \-> failed
queued/running -> cancelled
```

Workers must be safe to run twice. A unique constraint on the idempotency key,
content hashes, and an atomic status transition prevent duplicate projects and
duplicate usage charges.

## 6. API and service boundaries

Keep these modules inside the first modular monolith:

- `identity`: users, organizations, memberships, roles, sessions.
- `projects`: project metadata, versions, retention, access checks.
- `imports`: GitHub/archive intake and object storage adapters.
- `analysis`: parser engine, analyzer versions, artifact serialization.
- `jobs`: queue publishing, leasing, retries, cancellation, progress.
- `search`: query/index adapters.
- `billing`: plans, entitlements, usage, Stripe webhooks.
- `audit`: security and organization activity records.

Extract a separate analysis service only when worker deployment, language
tooling, or resource isolation requires it. Keep the public API stable while
changing the worker implementation behind the queue.

## 7. Security and reliability requirements

- Treat repository contents as untrusted input; never execute imported code.
- Run extraction and analysis workers as non-root with a read-only filesystem,
  no public ingress, CPU/memory/time quotas, and restricted egress.
- Use private buckets, encryption at rest, short-lived signed URLs, and a
  deletion lifecycle for source archives and derived artifacts.
- Keep tenant IDs in logs and traces, but never log source contents, tokens, or
  full stack traces containing secrets.
- Add per-tenant quotas for repository size, projects, concurrent jobs, API
  requests, and analysis minutes. Enforce them in Redis plus database-backed
  usage records.
- Add request IDs, job IDs, and an audit event for imports, exports, deletes,
  membership changes, and billing changes.
- Use health/readiness endpoints. Readiness must fail if required database or
  queue connectivity is unavailable.
- Define an SLO target before scaling, for example 99.9% API availability and
  95% of standard imports completed within five minutes.

## 8. Testing strategy

The current tests are a good foundation: pytest covers the analysis/security
and API behavior, while Vitest covers frontend normalizers and screens. Add the
following layers as the architecture changes:

```text
Unit: pure parsers, path/security rules, ranking, quota, state transitions
Integration: Postgres, Redis, object storage, queue using Testcontainers
Contract: OpenAPI response/request compatibility between frontend and API
Worker: retry, lease expiry, cancellation, duplicate delivery, DLQ behavior
E2E: Playwright import -> progress -> overview/search/graph -> delete
Load: k6 scenarios for status polling, search, and concurrent imports
Security: dependency/image scan, secret scan, fuzz archive/path inputs
```

Keep unit tests fast on every pull request. Run integration, E2E, load-smoke,
and image tests in CI or pre-release environments. Measure coverage by domain
risk rather than chasing a universal percentage; import safety, tenancy, job
transitions, billing webhooks, and deletion behavior deserve the highest bar.

## 9. Migration plan

### Phase 1: production-ready single instance

- Add SQLAlchemy/Alembic and move SQLite access behind repositories.
- Add explicit organization/member tables and ownership checks.
- Replace the process-local project cache with database-backed reads plus Redis.
- Add structured logging, request IDs, metrics, and error tracking.
- Keep one container and the existing deterministic analyzer.

### Phase 2: horizontal API scaling

- Move auth, project metadata, jobs, and usage to managed PostgreSQL.
- Move archives/results to object storage.
- Replace `ThreadPoolExecutor` with a durable queue and worker deployment.
- Run two or more stateless API replicas behind a load balancer.
- Add idempotency, leases, retries, DLQ, and job progress persistence.

### Phase 3: SaaS capabilities

- Add OIDC, organizations, RBAC, invitations, SSO/SCIM for enterprise plans.
- Add Stripe subscriptions, entitlements, usage metering, and audit logs.
- Add GitHub App installation/webhooks for private repositories.
- Add retention policies, export/delete workflows, and tenant administration.

### Phase 4: scale by measured bottleneck

- Add OpenSearch only if Postgres search no longer meets latency/cost goals.
- Separate heavy language analyzers into worker pools with independent limits.
- Add regional object storage/compute only for data residency or latency needs.
- Consider Kubernetes only when service count, scheduling, or platform-team
  needs justify its operational cost.

## 10. Immediate next engineering backlog

1. Introduce `organization_id` and ownership-aware repository interfaces.
2. Define the job state machine and idempotency constraints in PostgreSQL.
3. Add an object-storage adapter with a local filesystem implementation for
   development and tests.
4. Extract the current import body into a worker-callable service function.
5. Add queue-backed worker tests for duplicate delivery and restart recovery.
6. Add OpenAPI-generated TypeScript types and contract tests.
7. Add Playwright import and authentication journeys.
8. Add metrics for import duration, queue depth, analyzer errors, and per-plan
   usage before attempting high-volume load tests.

The key decision is to scale **state and work independently**: PostgreSQL is
the source of truth, object storage holds repository artifacts, Redis handles
short-lived coordination, and workers perform analysis asynchronously. That
preserves the current product behavior while removing the single-process
limits that prevent SaaS growth.
