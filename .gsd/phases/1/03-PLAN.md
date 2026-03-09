---
phase: 1
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - src/storage/sqlite-client.ts
  - src/storage/migrate.ts
  - src/storage/migrations/001_initial.sql
  - src/storage/event-store.ts
  - src/storage/run-store.ts
  - test/storage/sqlite-client.test.ts
  - test/storage/event-store.test.ts
autonomous: true
user_setup: []
must_haves:
  truths:
    - The project can create and migrate a local SQLite database for events, deliveries, approvals, runs, and artifact metadata.
    - Persistence is exposed through repository-style modules instead of raw SQL scattered across the runtime.
  artifacts:
    - src/storage/sqlite-client.ts
    - src/storage/migrate.ts
    - src/storage/migrations/001_initial.sql
    - src/storage/event-store.ts
    - src/storage/run-store.ts
---

# Plan 1.3: Build SQLite Persistence Baseline

<objective>
Create the durable storage baseline for Agent Bus: database bootstrap, schema migration, and repositories for the core phase contracts.

Purpose: Phase 2 and Phase 4 both depend on a reliable event log and run state; building the storage boundary now keeps orchestration code focused later.
Output: A migrated SQLite database in WAL mode with repository modules and tests against a temporary database file.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/REQUIREMENTS.md
- .gsd/phases/1/RESEARCH.md
- .gsd/phases/1/02-PLAN.md
</context>

<tasks>

<task type="auto">
  <name>Implement SQLite bootstrap and migration runner</name>
  <files>
    src/storage/sqlite-client.ts
    src/storage/migrate.ts
    src/storage/migrations/001_initial.sql
  </files>
  <action>
    Create the low-level storage bootstrap that opens the database, applies required pragmas, and runs ordered SQL migrations.

    Steps:
    1. Wrap `node:sqlite` in a small client module that opens the file-backed database, enables WAL, and applies busy timeout or foreign key settings.
    2. Implement a migration runner that tracks applied migrations and safely re-runs startup without duplicating schema work.
    3. Define the initial schema for runs, events, deliveries, approvals, and artifact metadata with the indexes needed for later dispatch queries.

    AVOID: letting every service open ad hoc database connections because a single storage boundary is easier to harden and swap later.
    USE: plain SQL migrations because this project needs deterministic, inspectable persistence changes.
  </action>
  <verify>
    npm run build
    npm run test
  </verify>
  <done>
    Startup can create a new database, enable WAL, and apply the initial migration exactly once.
  </done>
</task>

<task type="auto">
  <name>Create event and run repositories on top of the schema</name>
  <files>
    src/storage/event-store.ts
    src/storage/run-store.ts
  </files>
  <action>
    Build the repository layer that later daemon code will call instead of issuing raw SQL.

    Steps:
    1. Implement repository methods for inserting events, creating runs, listing pending approvals, and retrieving persisted event metadata.
    2. Keep repository inputs and outputs aligned with the manifest and event contracts defined in Plan 1.2.
    3. Design repository methods around future orchestration needs such as replay, idempotency, and recovery scans without implementing those policies yet.

    AVOID: baking retry or dispatch policy into repository functions because persistence and orchestration need separate responsibilities.
    USE: narrow repository APIs because later daemon code should express intent, not SQL details.
  </action>
  <verify>
    npm run typecheck
  </verify>
  <done>
    Repository modules can persist and fetch the phase contracts needed for runs, events, and approvals without leaking SQL into callers.
  </done>
</task>

<task type="auto">
  <name>Add persistence tests against a temporary database</name>
  <files>
    test/storage/sqlite-client.test.ts
    test/storage/event-store.test.ts
  </files>
  <action>
    Add tests that prove database bootstrap and repository behavior before daemon logic depends on them.

    Steps:
    1. Create tests that boot a temporary database file and verify migration tracking plus WAL initialization.
    2. Cover inserting events and runs, then reading back persisted metadata and approval rows.
    3. Assert that duplicate or invalid repository input fails predictably where the schema or repository contract requires it.

    AVOID: relying on manual sqlite inspection because persistence regressions should be caught automatically.
    USE: temp-file-backed tests because the real product uses a file-backed database rather than an in-memory-only path.
  </action>
  <verify>
    npm run test
  </verify>
  <done>
    Persistence tests pass on a temporary file-backed database and catch invalid or duplicate writes as designed.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] The runtime can initialize a durable SQLite database with WAL enabled.
- [ ] Core persistence behavior is available through repository modules with automated tests.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] Database bootstrap remains idempotent across repeated startup
</success_criteria>
