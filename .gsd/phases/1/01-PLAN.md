---
phase: 1
plan: 1
wave: 1
depends_on: []
files_modified:
  - package.json
  - tsconfig.json
  - .gitignore
  - src/cli.ts
  - src/shared/paths.ts
  - src/shared/runtime-layout.ts
  - workspace/.gitkeep
  - .agent-bus/state/.gitkeep
  - .agent-bus/logs/.gitkeep
autonomous: true
user_setup: []
must_haves:
  truths:
    - The repository boots as a typed Node CLI project with deterministic build, typecheck, and test scripts.
    - Shared artifact workspace and internal runtime state directories are defined once and resolved through code instead of ad hoc string paths.
  artifacts:
    - package.json
    - tsconfig.json
    - src/cli.ts
    - src/shared/paths.ts
    - src/shared/runtime-layout.ts
---

# Plan 1.1: Bootstrap Runtime Skeleton

<objective>
Create the minimal project foundation that every later phase will depend on: package scripts, TypeScript configuration, filesystem conventions, and a single CLI entrypoint.

Purpose: Phase 1 needs a stable place to hang manifest loading, storage, and daemon startup before any orchestration logic is built.
Output: A runnable Node/TypeScript skeleton with shared layout helpers and committed workspace/state directories.
</objective>

<context>
Load for context:
- .gsd/SPEC.md
- .gsd/ROADMAP.md
- .gsd/phases/1/RESEARCH.md
</context>

<tasks>

<task type="auto">
  <name>Bootstrap package scripts and TypeScript settings</name>
  <files>
    package.json
    tsconfig.json
    .gitignore
  </files>
  <action>
    Create a minimal Node 22 + TypeScript package with scripts for `build`, `typecheck`, `test`, and daemon execution.

    Steps:
    1. Add only the dependencies needed for the current architecture choices, including YAML parsing and schema validation.
    2. Configure TypeScript for strict checking, ESM-compatible output, and a clean `dist/` build target.
    3. Ignore generated build output and runtime state files while keeping committed placeholder directories for workspace and internal state.

    AVOID: pulling in framework or bundler complexity because the project is a local CLI/daemon, not a web app.
    USE: a minimal script surface because later plans should verify against stable commands like `npm run build` and `npm run test`.
  </action>
  <verify>
    npm install
    npm run typecheck
    npm run build
  </verify>
  <done>
    `npm install`, `npm run typecheck`, and `npm run build` complete successfully with the new package configuration.
  </done>
</task>

<task type="auto">
  <name>Establish filesystem conventions and CLI entrypoint</name>
  <files>
    src/cli.ts
    src/shared/paths.ts
    src/shared/runtime-layout.ts
    workspace/.gitkeep
    .agent-bus/state/.gitkeep
    .agent-bus/logs/.gitkeep
  </files>
  <action>
    Create the shared path utilities and initial CLI entrypoint that later phases can extend without rewriting path logic.

    Steps:
    1. Define repository-root-relative paths for `workspace/`, `.agent-bus/state/`, and `.agent-bus/logs/`.
    2. Add helpers that ensure those directories exist at runtime.
    3. Create a thin `src/cli.ts` entrypoint that can parse a minimal command surface and prove the runtime boots cleanly.

    AVOID: hard-coding paths throughout the codebase because later manifest, storage, and daemon code all need the same layout rules.
    USE: a single shared module for layout resolution because filesystem conventions are part of the product contract.
  </action>
  <verify>
    npm run build
    node dist/cli.js --help
  </verify>
  <done>
    The CLI starts without throwing, and layout helpers create or resolve the expected workspace and state directories.
  </done>
</task>

</tasks>

<verification>
After all tasks, verify:
- [ ] The repository has stable scripts for build, typecheck, and test.
- [ ] Filesystem conventions for visible artifacts and internal runtime state are centralized in code.
</verification>

<success_criteria>
- [ ] All tasks verified
- [ ] Must-haves confirmed
- [ ] No unowned runtime paths remain in the bootstrap code
</success_criteria>
