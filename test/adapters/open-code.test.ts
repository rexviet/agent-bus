import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpenCodeCommand } from "../../src/adapters/vendors/open-code.js";

test("buildOpenCodeCommand produces an opencode run invocation with attached work package", () => {
  const command = buildOpenCodeCommand({
    executable: "opencode",
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

  assert.equal(command.command, "opencode");
  assert.deepEqual(command.args.slice(0, 6), [
    "run",
    "--dir",
    "/repo",
    "--file",
    "/repo/.agent-bus/state/run/work-package.json",
    "--format"
  ]);
  assert.equal(command.args[6], "json");
  assert.ok(command.args.at(-1)?.includes("/repo/.agent-bus/state/run/result.json"));
});

test("buildOpenCodeCommand rejects unsupported executables", () => {
  assert.throws(
    () =>
      buildOpenCodeCommand({
        executable: "node",
        existingArgs: [],
        workingDirectory: "/repo",
        workPackagePath: "/repo/work-package.json",
        resultFilePath: "/repo/result.json",
        logFilePath: "/repo/run.log",
        baseEnvironment: {}
      }),
    /Open Code adapter requires/
  );
});
