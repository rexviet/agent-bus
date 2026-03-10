import { readFile, writeFile } from "node:fs/promises";

const workPackagePath = process.env.AGENT_BUS_WORK_PACKAGE_PATH;
const resultFilePath = process.env.AGENT_BUS_RESULT_FILE_PATH;

if (!workPackagePath || !resultFilePath) {
  throw new Error("Agent Bus work package environment is missing.");
}

const workPackage = JSON.parse(await readFile(workPackagePath, "utf8"));
const mode = workPackage.event.payload.mode;

const result =
  mode === "fatal"
    ? {
        schemaVersion: 1,
        status: "fatal_error",
        errorMessage: "Permanent adapter failure."
      }
    : {
        schemaVersion: 1,
        status: "retryable_error",
        errorMessage: "Temporary adapter failure.",
        retryDelayMs: 5000
      };

await writeFile(resultFilePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
