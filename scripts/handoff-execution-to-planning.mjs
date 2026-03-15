#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const planningRoot = path.join(repoRoot, ".planning");
const gsdRoot = path.join(repoRoot, ".gsd");
const args = parseArgs(process.argv.slice(2));

const phaseDirectories = await loadPlanningPhaseDirectories();
const selectedPhaseDirectory = selectPhaseDirectory(phaseDirectories, args.phaseNumber);
const reversePathMap = await buildReversePathMap(phaseDirectories);

const touchedFiles = [];
touchedFiles.push(...(await handoffRootDocs(reversePathMap)));
touchedFiles.push(...(await handoffPhaseDirectory(selectedPhaseDirectory, reversePathMap)));

process.stdout.write(
  [
    `Handed off ${touchedFiles.length} file(s) from .gsd to .planning.`,
    ...touchedFiles.map((file) => `- ${file}`)
  ].join("\n") + "\n"
);

function parseArgs(argv) {
  if (argv.length === 0) {
    throw new Error("Phase number is required. Example: node scripts/handoff-execution-to-planning.mjs 6");
  }

  if (argv.length !== 1 || !/^\d+$/.test(argv[0])) {
    throw new Error(`Invalid arguments: ${argv.join(" ")}`);
  }

  const phaseNumber = Number.parseInt(argv[0], 10);

  if (!Number.isInteger(phaseNumber) || phaseNumber < 1) {
    throw new Error(`Invalid phase number "${argv[0]}".`);
  }

  return { phaseNumber };
}

async function loadPlanningPhaseDirectories() {
  const phasesDirectory = path.join(planningRoot, "phases");
  const entries = await readdir(phasesDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const match = entry.name.match(/^(\d+)-(.+)$/);

      if (!match) {
        return null;
      }

      return {
        sourceName: entry.name,
        sourcePath: path.join(phasesDirectory, entry.name),
        phaseNumber: Number.parseInt(match[1], 10),
        phasePrefix: match[1]
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.phaseNumber - right.phaseNumber);
}

function selectPhaseDirectory(phaseDirectories, phaseNumber) {
  const selected = phaseDirectories.find((item) => item.phaseNumber === phaseNumber);

  if (!selected) {
    throw new Error(`No .planning phase directory found for phase ${phaseNumber}.`);
  }

  return selected;
}

async function buildReversePathMap(phaseDirectories) {
  const map = new Map([
    [".gsd/SPEC.md", ".planning/PROJECT.md"],
    [".gsd/REQUIREMENTS.md", ".planning/REQUIREMENTS.md"],
    [".gsd/ROADMAP.md", ".planning/ROADMAP.md"],
    [".gsd/STATE.md", ".planning/STATE.md"],
    [".gsd/MILESTONES.md", ".planning/MILESTONES.md"],
    [".gsd/ARCHITECTURE.md", ".planning/research/ARCHITECTURE.md"],
    [".gsd/STACK.md", ".planning/research/STACK.md"],
    [".gsd/research/FEATURES.md", ".planning/research/FEATURES.md"],
    [".gsd/research/PITFALLS.md", ".planning/research/PITFALLS.md"],
    [".gsd/research/SUMMARY.md", ".planning/research/SUMMARY.md"]
  ]);

  for (const phaseDirectory of phaseDirectories) {
    const baseSource = `.gsd/phases/${phaseDirectory.phaseNumber}`;
    const baseTarget = `.planning/phases/${phaseDirectory.sourceName}`;

    map.set(baseSource, baseTarget);

    const entries = await readdir(phaseDirectory.sourcePath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }

      const gsdFileName = mapPlanningFileNameToGsd(entry.name, phaseDirectory.phasePrefix);
      map.set(`${baseSource}/${gsdFileName}`, `${baseTarget}/${entry.name}`);
    }
  }

  return map;
}

function mapPlanningFileNameToGsd(fileName, phasePrefix) {
  if (fileName.startsWith(`${phasePrefix}-`)) {
    return fileName.slice(phasePrefix.length + 1);
  }

  return fileName;
}

async function handoffRootDocs(reversePathMap) {
  const mappings = [
    {
      source: ".gsd/ROADMAP.md",
      target: ".planning/ROADMAP.md"
    },
    {
      source: ".gsd/STATE.md",
      target: ".planning/STATE.md"
    }
  ];

  const touched = [];

  for (const mapping of mappings) {
    const sourceContent = await readFile(path.join(repoRoot, mapping.source), "utf8");
    const transformed = transformRootContent(sourceContent, reversePathMap);

    await writeRelativeFile(mapping.target, transformed);
    touched.push(mapping.target);
  }

  return touched;
}

async function handoffPhaseDirectory(phaseDirectory, reversePathMap) {
  const sourceDirectory = path.join(gsdRoot, "phases", String(phaseDirectory.phaseNumber));
  const planningEntries = new Set(
    (await readdir(phaseDirectory.sourcePath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
  );
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const touched = [];

  for (const entry of entries) {
    const targetBaseName = mapGsdFileNameToPlanning(entry.name, phaseDirectory.phasePrefix);
    const sourceContent = await readFile(path.join(sourceDirectory, entry.name), "utf8");

    if (!shouldHandoffPhaseFile(entry.name, targetBaseName, sourceContent, planningEntries)) {
      continue;
    }

    const targetRelativePath = `.planning/phases/${phaseDirectory.sourceName}/${targetBaseName}`;
    const transformed = transformPhaseContent(sourceContent, {
      reversePathMap,
      phaseDirectory,
      targetBaseName
    });

    await writeRelativeFile(targetRelativePath, transformed);
    touched.push(targetRelativePath);
  }

  return touched;
}

function shouldHandoffPhaseFile(fileName, targetBaseName, sourceContent, planningEntries) {
  if (fileName.endsWith("-SUMMARY.md")) {
    return true;
  }

  if (fileName === "VERIFICATION.md") {
    return true;
  }

  if (fileName.endsWith("-PLAN.md")) {
    return sourceContent.includes("gap_closure: true") || !planningEntries.has(targetBaseName);
  }

  return false;
}

function mapGsdFileNameToPlanning(fileName, phasePrefix) {
  if (fileName.startsWith(`${phasePrefix}-`)) {
    return fileName;
  }

  return `${phasePrefix}-${fileName}`;
}

function transformRootContent(content, reversePathMap) {
  const stripped = stripGeneratedNotice(content);
  return ensureTrailingNewline(rewriteKnownPaths(stripped, reversePathMap));
}

function transformPhaseContent(content, options) {
  const stripped = stripGeneratedNotice(content);
  const rewritten = rewriteKnownPaths(stripped, options.reversePathMap, options.phaseDirectory);
  const frontmatterRewritten = rewritePhaseFrontmatter(rewritten, {
    phaseDirectory: options.phaseDirectory,
    targetBaseName: options.targetBaseName
  });

  return ensureTrailingNewline(frontmatterRewritten);
}

function stripGeneratedNotice(content) {
  return content
    .replace(
      /^<!-- AUTO-GENERATED from .*? by scripts\/sync-planning-to-gsd\.mjs\. Edit the source file, not this projection\. -->\r?\n?/m,
      ""
    )
    .replace(/^> \*\*Status\*\*: `FINALIZED`\r?\n?/m, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\r?\n/, "");
}

function rewriteKnownPaths(content, reversePathMap, selectedPhaseDirectory = null) {
  let output = content;
  const orderedMappings = [...reversePathMap.entries()].sort(
    (left, right) => right[0].length - left[0].length
  );

  for (const [source, target] of orderedMappings) {
    output = output.split(source).join(target);
  }

  return output.replace(
    /(\.gsd\/phases\/(\d+)\/)([A-Za-z0-9._-]+\.md)/g,
    (match, _prefix, phaseNumberText, fileName) => {
      const phaseNumber = Number.parseInt(phaseNumberText, 10);
      const phaseDirectory =
        selectedPhaseDirectory && selectedPhaseDirectory.phaseNumber === phaseNumber
          ? selectedPhaseDirectory
          : null;

      if (!phaseDirectory) {
        return match;
      }

      const targetFileName = mapGsdFileNameToPlanning(fileName, phaseDirectory.phasePrefix);
      return `.planning/phases/${phaseDirectory.sourceName}/${targetFileName}`;
    }
  );
}

function rewritePhaseFrontmatter(content, options) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);

  if (!frontmatterMatch) {
    return content;
  }

  const phasePrefix = options.phaseDirectory.phasePrefix;
  const bodyStart = frontmatterMatch[0].length;
  const frontmatterLines = frontmatterMatch[1].split(/\r?\n/).map((line) => {
    if (line.startsWith("phase: ")) {
      const value = line.slice("phase: ".length).trim();

      if (/^\d+$/.test(value)) {
        return `phase: ${options.phaseDirectory.sourceName}`;
      }
    }

    if (line.startsWith("plan: ")) {
      const planMatch = options.targetBaseName.match(
        new RegExp(`^${phasePrefix}-(\\d+)-(PLAN|SUMMARY)\\.md$`)
      );

      if (planMatch) {
        return `plan: ${planMatch[1]}`;
      }
    }

    if (line.startsWith("depends_on:")) {
      return line.replace(/\b(\d{1,2})\b/g, (_match, numberText) => {
        const padded = numberText.padStart(2, "0");
        return `"${phasePrefix}-${padded}"`;
      });
    }

    return line;
  });

  return `---\n${frontmatterLines.join("\n")}\n---\n${content.slice(bodyStart)}`;
}

function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

async function writeRelativeFile(relativePath, content) {
  const absolutePath = path.join(repoRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, ensureTrailingNewline(content), "utf8");
}
