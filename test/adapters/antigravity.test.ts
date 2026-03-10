import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildAntigravityCommand } from "../../src/adapters/vendors/antigravity.js";

test("buildAntigravityCommand produces an antigravity chat agent invocation", () => {
  const command = buildAntigravityCommand({
    executable: "antigravity",
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

  assert.equal(command.command, "antigravity");
  assert.equal(command.args[0], "chat");
  assert.ok(command.args.includes("--mode"));
  assert.ok(command.args.includes("--add-file"));
  assert.ok(command.args.includes("/repo/.agent-bus/state/run/work-package.json"));
  assert.ok(command.args.at(-1)?.includes("/repo/.agent-bus/state/run/result.json"));
});

test("buildAntigravityCommand rejects unsupported executables", () => {
  assert.throws(
    () =>
      buildAntigravityCommand({
        executable: "node",
        existingArgs: [],
        workingDirectory: "/repo",
        workPackagePath: "/repo/work-package.json",
        resultFilePath: "/repo/result.json",
        logFilePath: "/repo/run.log",
        baseEnvironment: {}
      }),
    /Antigravity adapter requires/
  );
});
