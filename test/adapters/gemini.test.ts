import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildGeminiCommand } from "../../src/adapters/vendors/gemini.js";

test("buildGeminiCommand produces a Gemini CLI headless invocation", () => {
  const command = buildGeminiCommand({
    executable: "gemini",
    existingArgs: ["--model", "gemini-2.5-pro", "-p", "ignore-me"],
    workingDirectory: "/repo",
    workPackagePath: "/repo/.agent bus/state/run/work package.json",
    resultFilePath: "/repo/.agent-bus/state/run/result.json",
    logFilePath: "/repo/.agent-bus/logs/run.log",
    baseEnvironment: {
      AGENT_BUS_WORK_PACKAGE_PATH: "/repo/.agent bus/state/run/work package.json",
      AGENT_BUS_RESULT_FILE_PATH: "/repo/.agent-bus/state/run/result.json"
    }
  });

  assert.equal(command.command, "gemini");
  assert.deepEqual(command.args.slice(0, 4), [
    "--model",
    "gemini-2.5-pro",
    "--approval-mode",
    "auto_edit"
  ]);
  assert.equal(command.args[4], "-p");
  assert.match(command.args[5] ?? "", /@\.agent\\ bus\/state\/run\/work\\ package\.json/);
  assert.match(command.args[5] ?? "", /result\.json/);
});

test("buildGeminiCommand rejects unsupported executables", () => {
  assert.throws(
    () =>
      buildGeminiCommand({
        executable: "node",
        existingArgs: [],
        workingDirectory: "/repo",
        workPackagePath: "/repo/work-package.json",
        resultFilePath: "/repo/result.json",
        logFilePath: "/repo/run.log",
        baseEnvironment: {}
      }),
    /Gemini adapter requires/
  );
});
