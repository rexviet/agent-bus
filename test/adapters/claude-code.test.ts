import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildClaudeCodeCommand } from "../../src/adapters/vendors/claude-code.js";

test("buildClaudeCodeCommand produces a Claude Code headless invocation", () => {
  const command = buildClaudeCodeCommand({
    executable: "claude",
    existingArgs: ["--model", "claude-opus-4-6"],
    workingDirectory: "/repo",
    workPackagePath: "/repo/.agent-bus/state/run/work-package.json",
    resultFilePath: "/repo/.agent-bus/state/run/result.json",
    logFilePath: "/repo/.agent-bus/logs/run.log",
    baseEnvironment: {
      AGENT_BUS_WORK_PACKAGE_PATH: "/repo/.agent-bus/state/run/work-package.json",
      AGENT_BUS_RESULT_FILE_PATH: "/repo/.agent-bus/state/run/result.json"
    }
  });

  assert.equal(command.command, "claude");
  assert.deepEqual(command.args.slice(0, 2), ["--model", "claude-opus-4-6"]);
  assert.equal(command.args.at(-2), "-p");
  assert.ok(command.args.at(-1)?.includes("work-package.json"));
  assert.ok(command.args.at(-1)?.includes("result.json"));
});

test("buildClaudeCodeCommand strips existing -p/--print args", () => {
  const command = buildClaudeCodeCommand({
    executable: "claude",
    existingArgs: ["-p", "old-prompt", "--model", "opus"],
    workingDirectory: "/repo",
    workPackagePath: "/repo/work-package.json",
    resultFilePath: "/repo/result.json",
    logFilePath: "/repo/run.log",
    baseEnvironment: {}
  });

  const pIndex = command.args.indexOf("-p");
  assert.ok(pIndex >= 0, "should have -p flag");
  assert.ok(!command.args.includes("old-prompt"), "old prompt should be stripped");
  assert.equal(command.args.filter((a) => a === "-p").length, 1, "only one -p flag");
});

test("buildClaudeCodeCommand includes identity file in prompt when provided", () => {
  const command = buildClaudeCodeCommand({
    executable: "claude",
    existingArgs: [],
    workingDirectory: "/repo",
    workPackagePath: "/repo/work-package.json",
    resultFilePath: "/repo/result.json",
    logFilePath: "/repo/run.log",
    baseEnvironment: {},
    identityFilePath: "/repo/.agent/identities/reviewer.md"
  });

  assert.ok(command.args.at(-1)?.includes(".agent/identities/reviewer.md"));
});

test("buildClaudeCodeCommand rejects non-claude executables", () => {
  assert.throws(
    () =>
      buildClaudeCodeCommand({
        executable: "codex",
        existingArgs: [],
        workingDirectory: "/repo",
        workPackagePath: "/repo/work-package.json",
        resultFilePath: "/repo/result.json",
        logFilePath: "/repo/run.log",
        baseEnvironment: {}
      }),
    /Claude Code adapter requires/
  );
});
