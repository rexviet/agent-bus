import * as assert from "node:assert/strict";
import { test } from "node:test";

import { buildAdapterCommand } from "../../src/adapters/registry.js";

function createInput(mcpUrl?: string) {
  return {
    agent: {
      id: "ba_codex",
      runtime: "codex",
      command: ["codex"],
      environment: {
        CUSTOM_ENV: "yes"
      }
    },
    workingDirectory: "/repo",
    workPackagePath: "/repo/.agent-bus/state/work-package.json",
    resultFilePath: "/repo/.agent-bus/state/result.json",
    logFilePath: "/repo/.agent-bus/logs/run.log",
    ...(mcpUrl ? { mcpUrl } : {})
  };
}

test("buildAdapterCommand includes AGENT_BUS_MCP_URL when mcpUrl is provided", () => {
  const command = buildAdapterCommand(createInput("http://127.0.0.1:12345/mcp"));

  assert.equal(command.environment.AGENT_BUS_MCP_URL, "http://127.0.0.1:12345/mcp");
  assert.ok(command.args.includes('mcp_servers.agent_bus.url="http://127.0.0.1:12345/mcp"'));
  assert.ok(command.args.includes("mcp_servers.agent_bus.enabled=true"));
});

test("buildAdapterCommand omits AGENT_BUS_MCP_URL when mcpUrl is missing", () => {
  const command = buildAdapterCommand(createInput());

  assert.equal("AGENT_BUS_MCP_URL" in command.environment, false);
});

test("buildAdapterCommand still includes required AGENT_BUS_* variables", () => {
  const command = buildAdapterCommand(createInput("http://127.0.0.1:12345/mcp"));

  assert.equal(command.environment.AGENT_BUS_SCHEMA_VERSION, "1");
  assert.equal(command.environment.AGENT_BUS_AGENT_ID, "ba_codex");
  assert.equal(command.environment.AGENT_BUS_RUNTIME, "codex");
  assert.equal(
    command.environment.AGENT_BUS_WORK_PACKAGE_PATH,
    "/repo/.agent-bus/state/work-package.json"
  );
  assert.equal(
    command.environment.AGENT_BUS_RESULT_FILE_PATH,
    "/repo/.agent-bus/state/result.json"
  );
  assert.equal(command.environment.AGENT_BUS_LOG_FILE_PATH, "/repo/.agent-bus/logs/run.log");
  assert.equal(command.environment.CUSTOM_ENV, "yes");
});
