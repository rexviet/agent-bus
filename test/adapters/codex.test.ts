import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildCodexCommand } from "../../src/adapters/vendors/codex.js";

test("buildCodexCommand produces a non-interactive codex exec invocation", () => {
  const command = buildCodexCommand({
    executable: "codex",
    existingArgs: [],
    workingDirectory: "/repo",
    workPackagePath: "/repo/.agent-bus/state/run/work-package.json",
    resultFilePath: "/repo/.agent-bus/state/run/result.json",
    logFilePath: "/repo/.agent-bus/logs/run.log",
    baseEnvironment: {
      AGENT_BUS_WORK_PACKAGE_PATH: "/repo/.agent-bus/state/run/work-package.json",
      AGENT_BUS_RESULT_FILE_PATH: "/repo/.agent-bus/state/run/result.json"
    }
  });

  assert.equal(command.command, "codex");
  assert.equal(command.args[0], "exec");
  assert.ok(command.args.includes("--output-last-message"));
  assert.ok(command.args.at(-1)?.includes("/repo/.agent-bus/state/run/work-package.json"));
  assert.ok(command.args.at(-1)?.includes("/repo/.agent-bus/state/run/result.json"));
});

test("buildCodexCommand includes identity file in prompt when provided", () => {
  const command = buildCodexCommand({
    executable: "codex",
    existingArgs: [],
    workingDirectory: "/repo",
    workPackagePath: "/repo/work-package.json",
    resultFilePath: "/repo/result.json",
    logFilePath: "/repo/run.log",
    baseEnvironment: {},
    identityFilePath: "/repo/.agent/identities/developer.md"
  });

  assert.ok(command.args.at(-1)?.includes(".agent/identities/developer.md"));
});

test("buildCodexCommand rejects non-codex executables", () => {
  assert.throws(
    () =>
      buildCodexCommand({
        executable: "node",
        existingArgs: [],
        workingDirectory: "/repo",
        workPackagePath: "/repo/work-package.json",
        resultFilePath: "/repo/result.json",
        logFilePath: "/repo/run.log",
        baseEnvironment: {}
      }),
    /Codex adapter requires/
  );
});
