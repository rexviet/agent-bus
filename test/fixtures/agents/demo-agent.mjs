import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function writeWorkspaceArtifact(workPackage, relativePath, content) {
  const absolutePath = path.join(workPackage.workspace.workspaceDir, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf8");
}

async function loadPlanText(workPackage) {
  const planArtifact = workPackage.artifactInputs.find(
    (artifact) => artifact.path === "docs/plan.md"
  );

  if (!planArtifact) {
    return "Plan artifact unavailable.";
  }

  return readFile(planArtifact.absolutePath, "utf8");
}

function resultEnvelopePath() {
  const resultPath = process.env.AGENT_BUS_RESULT_FILE_PATH;

  if (!resultPath) {
    throw new Error("AGENT_BUS_RESULT_FILE_PATH is required.");
  }

  return resultPath;
}

async function main() {
  const workPackagePath = process.env.AGENT_BUS_WORK_PACKAGE_PATH;

  if (!workPackagePath) {
    throw new Error("AGENT_BUS_WORK_PACKAGE_PATH is required.");
  }

  const workPackage = JSON.parse(await readFile(workPackagePath, "utf8"));
  const planText = await loadPlanText(workPackage);
  let result;

  if (workPackage.agent.id === "tech_lead_demo") {
    await writeWorkspaceArtifact(
      workPackage,
      "docs/system-design.md",
      `# System Design\n\nDerived from the approved plan:\n\n${planText.trim()}\n`
    );
    result = {
      schemaVersion: 1,
      status: "success",
      summary: "Generated a deterministic system design artifact.",
      outputArtifacts: [
        {
          path: "docs/system-design.md",
          role: "primary",
          description: "Deterministic demo system design."
        }
      ],
      events: []
    };
  } else if (workPackage.agent.id === "qa_demo") {
    const failureMarkerPath = path.join(
      workPackage.workspace.stateDir,
      "demo-agent-markers",
      `${workPackage.delivery.deliveryId}.failed-once`
    );

    if (!(await fileExists(failureMarkerPath))) {
      await mkdir(path.dirname(failureMarkerPath), { recursive: true });
      await writeFile(failureMarkerPath, "failed-once\n", "utf8");
      result = {
        schemaVersion: 1,
        status: "retryable_error",
        errorMessage: "Deterministic QA failure. Replay this delivery to continue the demo.",
        retryDelayMs: 60_000,
        summary: "Intentional first-run QA failure for operator replay.",
        outputArtifacts: [],
        events: []
      };
    } else {
      await writeWorkspaceArtifact(
        workPackage,
        "docs/test-cases.md",
        `# Test Cases\n\nGenerated after replay for delivery ${workPackage.delivery.deliveryId}.\n`
      );
      result = {
        schemaVersion: 1,
        status: "success",
        summary: "Generated deterministic QA test cases after replay.",
        outputArtifacts: [
          {
            path: "docs/test-cases.md",
            role: "primary",
            description: "Deterministic QA test cases."
          }
        ],
        events: []
      };
    }
  } else {
    result = {
      schemaVersion: 1,
      status: "fatal_error",
      errorMessage: `Unsupported demo agent: ${workPackage.agent.id}`,
      summary: "Unknown demo agent.",
      outputArtifacts: [],
      events: []
    };
  }

  await writeFile(resultEnvelopePath(), `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

await main();
