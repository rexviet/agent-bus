import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

function sanitizePathSegment(value) {
  return value.replace(/[^a-z0-9._-]+/gi, "_");
}

const workPackagePath = process.env.AGENT_BUS_WORK_PACKAGE_PATH;
const resultFilePath = process.env.AGENT_BUS_RESULT_FILE_PATH;

if (!workPackagePath || !resultFilePath) {
  throw new Error("Agent Bus work package environment is missing.");
}

const workPackage = JSON.parse(await readFile(workPackagePath, "utf8"));
const outputRelativePath = path.posix.join(
  "generated",
  `${sanitizePathSegment(workPackage.delivery.deliveryId)}.md`
);
const outputAbsolutePath = path.join(
  workPackage.workspace.workspaceDir,
  outputRelativePath
);

await mkdir(path.dirname(outputAbsolutePath), { recursive: true });
await writeFile(
  outputAbsolutePath,
  `topic=${workPackage.event.topic}\nagent=${workPackage.agent.id}\n`,
  "utf8"
);
await writeFile(
  resultFilePath,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: "success",
      summary: "Fixture adapter completed successfully.",
      outputArtifacts: [
        {
          path: outputRelativePath,
          role: "primary"
        }
      ],
      events: [
        {
          topic: "implementation_done",
          payload: {
            sourceDeliveryId: workPackage.delivery.deliveryId
          }
        }
      ]
    },
    null,
    2
  )}\n`,
  "utf8"
);
