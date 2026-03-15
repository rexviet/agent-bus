import * as assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

interface ScriptRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const syncScriptPath = path.resolve(
  process.cwd(),
  "scripts",
  "sync-planning-to-gsd.mjs"
);
const handoffScriptPath = path.resolve(
  process.cwd(),
  "scripts",
  "handoff-execution-to-planning.mjs"
);

async function runNodeScript(
  scriptPath: string,
  args: readonly string[],
  cwd: string
): Promise<ScriptRunResult> {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
  });

  return {
    exitCode,
    stdout,
    stderr
  };
}

async function writeRepoFile(
  repositoryRoot: string,
  relativePath: string,
  content: string
): Promise<void> {
  const absolutePath = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function createPlanningFixture(repositoryRoot: string): Promise<void> {
  await writeRepoFile(
    repositoryRoot,
    ".planning/PROJECT.md",
    "# Agent Bus\n\nCanonical planning project doc.\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/REQUIREMENTS.md",
    "# Requirements\n\n- LOG-01\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/MILESTONES.md",
    "# Milestones\n\n- v1.1\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/research/ARCHITECTURE.md",
    "# Architecture\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/research/STACK.md",
    "# Stack\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/research/FEATURES.md",
    "# Features\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/research/PITFALLS.md",
    "# Pitfalls\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/research/SUMMARY.md",
    "# Summary\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/ROADMAP.md",
    `# Roadmap

### Phase 6: Structured Logging
Plans:
- [ ] 06-01-PLAN.md

### Phase 7: Concurrent Workers
Plans: TBD
`
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/STATE.md",
    `---
status: planning
---

# Project State

## Session Continuity

Last session: 2026-03-15T00:00:00Z
Stopped at: Phase 6 ready to execute
Next: Start Phase 6 execution.
`
  );
  await mkdir(path.join(repositoryRoot, ".planning", "todos", "pending"), {
    recursive: true
  });
  await mkdir(path.join(repositoryRoot, ".planning", "todos", "done"), {
    recursive: true
  });
  await writeRepoFile(
    repositoryRoot,
    ".planning/phases/06-structured-logging/06-01-PLAN.md",
    `---
phase: 06-structured-logging
plan: 01
depends_on: []
---

# Plan 01

See .planning/STATE.md and .planning/phases/06-structured-logging/06-CONTEXT.md.
`
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/phases/06-structured-logging/06-CONTEXT.md",
    "# Phase 6 Context\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/phases/06-structured-logging/06-RESEARCH.md",
    "# Phase 6 Research\n"
  );
  await writeRepoFile(
    repositoryRoot,
    ".planning/phases/06-structured-logging/06-VALIDATION.md",
    `---
phase: 6
status: draft
---

# Validation\n`
  );
}

async function withTempRepo(callback: (repositoryRoot: string) => Promise<void>): Promise<void> {
  const repositoryRoot = await mkdtemp(
    path.join(os.tmpdir(), "agent-bus-handoff-execution-")
  );

  try {
    await createPlanningFixture(repositoryRoot);
    await callback(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("handoff refuses to overwrite canonical root docs when planning changed after sync", async () => {
  await withTempRepo(async (repositoryRoot) => {
    const syncResult = await runNodeScript(syncScriptPath, ["6"], repositoryRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const gsdRoadmapPath = path.join(repositoryRoot, ".gsd", "ROADMAP.md");
    const planningRoadmapPath = path.join(repositoryRoot, ".planning", "ROADMAP.md");
    const planningStatePath = path.join(repositoryRoot, ".planning", "STATE.md");

    const mutatedGsdRoadmap = (
      await readFile(gsdRoadmapPath, "utf8")
    ).replace("Plans: TBD", "Plans: execution-updated");
    await writeFile(gsdRoadmapPath, mutatedGsdRoadmap, "utf8");

    const planningState = await readFile(planningStatePath, "utf8");
    await writeFile(
      planningStatePath,
      `${planningState}\nCanonical planning changed after sync.\n`,
      "utf8"
    );

    const handoffResult = await runNodeScript(handoffScriptPath, ["6"], repositoryRoot);

    assert.notEqual(handoffResult.exitCode, 0);
    assert.match(
      handoffResult.stderr,
      /changed in \.planning since the last \/sync-planning-to-gsd/
    );

    const planningRoadmap = await readFile(planningRoadmapPath, "utf8");
    const planningStateAfterFailure = await readFile(planningStatePath, "utf8");

    assert.doesNotMatch(planningRoadmap, /execution-updated/);
    assert.match(planningStateAfterFailure, /Canonical planning changed after sync\./);
  });
});

test("handoff strips execution-only handoff guidance from canonical planning state", async () => {
  await withTempRepo(async (repositoryRoot) => {
    const syncResult = await runNodeScript(syncScriptPath, ["6"], repositoryRoot);
    assert.equal(syncResult.exitCode, 0, syncResult.stderr);

    const gsdStatePath = path.join(repositoryRoot, ".gsd", "STATE.md");
    const gsdState = await readFile(gsdStatePath, "utf8");
    const executedState = gsdState
      .replace("status: planning", "status: executing")
      .replace("Stopped at: Phase 6 ready to execute", "Stopped at: Phase 6 complete and verified")
      .replace(
        "Next: Start Phase 6 execution.",
        "Next: Run `/handoff-execution 6`, then plan Phase 7 (Concurrent Workers)"
      );
    await writeFile(gsdStatePath, executedState, "utf8");

    const handoffResult = await runNodeScript(handoffScriptPath, ["6"], repositoryRoot);
    assert.equal(handoffResult.exitCode, 0, handoffResult.stderr);

    const planningState = await readFile(
      path.join(repositoryRoot, ".planning", "STATE.md"),
      "utf8"
    );

    assert.doesNotMatch(planningState, /\/handoff-execution 6/);
    assert.match(planningState, /Next: Plan Phase 7 \(Concurrent Workers\)/);
  });
});
