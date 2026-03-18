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

test("buildCodexCommand injects agent_bus MCP config when mcpUrl is provided", () => {
  const command = buildCodexCommand({
    executable: "codex",
    existingArgs: [],
    workingDirectory: "/repo",
    workPackagePath: "/repo/work-package.json",
    resultFilePath: "/repo/result.json",
    logFilePath: "/repo/run.log",
    mcpUrl: "http://127.0.0.1:43111/mcp",
    baseEnvironment: {}
  });

  assert.ok(
    command.args.includes('-c') &&
      command.args.includes('mcp_servers.agent_bus.url="http://127.0.0.1:43111/mcp"')
  );
  assert.ok(command.args.includes("mcp_servers.agent_bus.enabled=true"));
});

test("buildCodexCommand does not duplicate agent_bus MCP config when already provided", () => {
  const command = buildCodexCommand({
    executable: "codex",
    existingArgs: [
      "-c",
      'mcp_servers.agent_bus.url="http://127.0.0.1:9/mcp"',
      "-c",
      "mcp_servers.agent_bus.enabled=true"
    ],
    workingDirectory: "/repo",
    workPackagePath: "/repo/work-package.json",
    resultFilePath: "/repo/result.json",
    logFilePath: "/repo/run.log",
    mcpUrl: "http://127.0.0.1:43111/mcp",
    baseEnvironment: {}
  });

  const agentBusConfigCount = command.args.filter((arg) =>
    arg.startsWith("mcp_servers.agent_bus.")
  ).length;
  assert.equal(agentBusConfigCount, 2);
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
