#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const planningRoot = path.join(repoRoot, ".planning");
const args = parseArgs(process.argv.slice(2));

const phaseDirectories = await loadPlanningPhaseDirectories();
const selectedPhaseDirectories = selectPhaseDirectories(
  phaseDirectories,
  args.phaseNumber
);
const pathMap = buildPathMap(selectedPhaseDirectories);

const touchedFiles = [];

if (!args.phasesOnly) {
  touchedFiles.push(...(await syncRootDocs(pathMap)));
  touchedFiles.push(...(await syncTodoProjection()));
}

if (!args.rootOnly) {
  for (const phaseDirectory of selectedPhaseDirectories) {
    touchedFiles.push(...(await syncPhaseDirectory(phaseDirectory, pathMap)));
  }
}

process.stdout.write(
  [
    `Synced ${touchedFiles.length} file(s) from .planning to .gsd.`,
    ...touchedFiles.map((file) => `- ${file}`)
  ].join("\n") + "\n"
);

function parseArgs(argv) {
  let phaseNumber = null;
  let rootOnly = false;
  let phasesOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--phase") {
      const value = argv[index + 1];

      if (!value || value.startsWith("--")) {
        throw new Error("--phase requires a numeric value.");
      }

      phaseNumber = Number.parseInt(value, 10);

      if (!Number.isInteger(phaseNumber) || phaseNumber < 1) {
        throw new Error(`Invalid --phase value "${value}".`);
      }

      index += 1;
      continue;
    }

    if (/^\d+$/.test(arg)) {
      phaseNumber = Number.parseInt(arg, 10);
      continue;
    }

    if (arg === "--root-only") {
      rootOnly = true;
      continue;
    }

    if (arg === "--phases-only") {
      phasesOnly = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (rootOnly && phasesOnly) {
    throw new Error("--root-only and --phases-only cannot be used together.");
  }

  return {
    phaseNumber,
    rootOnly,
    phasesOnly
  };
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

function selectPhaseDirectories(phaseDirectories, phaseNumber) {
  if (phaseNumber === null) {
    return phaseDirectories;
  }

  const selected = phaseDirectories.filter((item) => item.phaseNumber === phaseNumber);

  if (selected.length === 0) {
    throw new Error(`No .planning phase directory found for phase ${phaseNumber}.`);
  }

  return selected;
}

function buildPathMap(phaseDirectories) {
  const map = new Map([
    [".planning/PROJECT.md", ".gsd/SPEC.md"],
    [".planning/REQUIREMENTS.md", ".gsd/REQUIREMENTS.md"],
    [".planning/ROADMAP.md", ".gsd/ROADMAP.md"],
    [".planning/STATE.md", ".gsd/STATE.md"],
    [".planning/MILESTONES.md", ".gsd/MILESTONES.md"],
    [".planning/research/ARCHITECTURE.md", ".gsd/ARCHITECTURE.md"],
    [".planning/research/STACK.md", ".gsd/STACK.md"],
    [".planning/research/FEATURES.md", ".gsd/research/FEATURES.md"],
    [".planning/research/PITFALLS.md", ".gsd/research/PITFALLS.md"],
    [".planning/research/SUMMARY.md", ".gsd/research/SUMMARY.md"]
  ]);

  for (const phaseDirectory of phaseDirectories) {
    const baseSource = `.planning/phases/${phaseDirectory.sourceName}`;
    const baseTarget = `.gsd/phases/${phaseDirectory.phaseNumber}`;

    map.set(baseSource, baseTarget);
  }

  return map;
}

async function syncRootDocs(pathMap) {
  const mappings = [
    {
      source: ".planning/PROJECT.md",
      target: ".gsd/SPEC.md",
      transform: (content, source) =>
        transformContent(content, {
          source,
          pathMap,
          extraLines: ['> **Status**: `FINALIZED`']
        })
    },
    {
      source: ".planning/REQUIREMENTS.md",
      target: ".gsd/REQUIREMENTS.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/ROADMAP.md",
      target: ".gsd/ROADMAP.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/STATE.md",
      target: ".gsd/STATE.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/MILESTONES.md",
      target: ".gsd/MILESTONES.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/research/ARCHITECTURE.md",
      target: ".gsd/ARCHITECTURE.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/research/STACK.md",
      target: ".gsd/STACK.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/research/FEATURES.md",
      target: ".gsd/research/FEATURES.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/research/PITFALLS.md",
      target: ".gsd/research/PITFALLS.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    },
    {
      source: ".planning/research/SUMMARY.md",
      target: ".gsd/research/SUMMARY.md",
      transform: (content, source) => transformContent(content, { source, pathMap })
    }
  ];

  const touched = [];

  for (const mapping of mappings) {
    const sourcePath = path.join(repoRoot, mapping.source);
    const sourceContent = await readFile(sourcePath, "utf8");
    const outputContent = mapping.transform(sourceContent, mapping.source);

    await writeRelativeFile(mapping.target, outputContent);
    touched.push(mapping.target);
  }

  return touched;
}

async function syncTodoProjection() {
  const pendingDirectory = path.join(planningRoot, "todos", "pending");
  const entries = await readdir(pendingDirectory, { withFileTypes: true });
  const pendingFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));

  const lines = [
    "<!-- AUTO-GENERATED from .planning/todos/pending by scripts/sync-planning-to-gsd.mjs. Edit the source files, not this projection. -->",
    "# TODO.md",
    "",
    "## Synced Pending Items",
    ""
  ];

  if (pendingFiles.length === 0) {
    lines.push("- [ ] No pending items in `.planning/todos/pending`.");
  }

  for (const entry of pendingFiles) {
    const relativeSource = `.planning/todos/pending/${entry.name}`;
    const sourcePath = path.join(pendingDirectory, entry.name);
    const content = await readFile(sourcePath, "utf8");
    const title = extractFrontmatterValue(content, "title") ?? entry.name.replace(/\.md$/, "");
    const created = extractFrontmatterValue(content, "created") ?? "unknown-date";
    const area = extractFrontmatterValue(content, "area");

    lines.push(
      `- [ ] ${title}${area ? ` \`${area}\`` : ""} — ${created} (${relativeSource})`
    );
  }

  lines.push("");

  await writeRelativeFile(".gsd/TODO.md", `${lines.join("\n")}`);

  return [".gsd/TODO.md"];
}

async function syncPhaseDirectory(phaseDirectory, pathMap) {
  const entries = (await readdir(phaseDirectory.sourcePath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const touched = [];

  for (const entry of entries) {
    const sourceRelativePath = `.planning/phases/${phaseDirectory.sourceName}/${entry.name}`;
    const targetBaseName = mapPhaseFileName(entry.name, phaseDirectory.phasePrefix);
    const targetRelativePath = `.gsd/phases/${phaseDirectory.phaseNumber}/${targetBaseName}`;

    pathMap.set(sourceRelativePath, targetRelativePath);
  }

  for (const entry of entries) {
    const sourceRelativePath = `.planning/phases/${phaseDirectory.sourceName}/${entry.name}`;
    const targetBaseName = mapPhaseFileName(entry.name, phaseDirectory.phasePrefix);
    const targetRelativePath = `.gsd/phases/${phaseDirectory.phaseNumber}/${targetBaseName}`;
    const sourceContent = await readFile(path.join(phaseDirectory.sourcePath, entry.name), "utf8");
    const transformed = transformPhaseContent(sourceContent, {
      source: sourceRelativePath,
      pathMap,
      phaseNumber: phaseDirectory.phaseNumber,
      targetBaseName
    });
    await writeRelativeFile(targetRelativePath, transformed);
    touched.push(targetRelativePath);
  }

  return touched;
}

function mapPhaseFileName(fileName, phasePrefix) {
  if (fileName.startsWith(`${phasePrefix}-`)) {
    return fileName.slice(phasePrefix.length + 1);
  }

  return fileName;
}

function transformPhaseContent(content, options) {
  let output = rewriteKnownPaths(content, options.pathMap);
  output = rewritePhaseFrontmatter(output, {
    phaseNumber: options.phaseNumber,
    targetBaseName: options.targetBaseName
  });

  return injectGeneratedNotice(
    output,
    options.source,
    [],
    createContentFingerprint(content)
  );
}

function transformContent(content, options) {
  const rewritten = rewriteKnownPaths(content, options.pathMap);

  return injectGeneratedNotice(
    rewritten,
    options.source,
    options.extraLines ?? [],
    createContentFingerprint(content)
  );
}

function rewriteKnownPaths(content, pathMap) {
  let output = content;
  const orderedMappings = [...pathMap.entries()].sort(
    (left, right) => right[0].length - left[0].length
  );

  for (const [source, target] of orderedMappings) {
    output = output.split(source).join(target);
  }

  return output.replace(
    /(\.gsd\/phases\/(\d+)\/)(\d{2})-(.+?\.md)/g,
    (match, phaseDirectoryPrefix, phaseNumberText, filePhasePrefix, remainder) => {
      const phaseNumber = Number.parseInt(phaseNumberText, 10);
      const filePhaseNumber = Number.parseInt(filePhasePrefix, 10);

      if (phaseNumber !== filePhaseNumber) {
        return match;
      }

      return `${phaseDirectoryPrefix}${remainder}`;
    }
  );
}

function rewritePhaseFrontmatter(content, options) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);

  if (!frontmatterMatch) {
    return content;
  }

  const bodyStart = frontmatterMatch[0].length;
  const frontmatterLines = frontmatterMatch[1].split(/\r?\n/).map((line) => {
    if (line.startsWith("phase: ")) {
      return `phase: ${options.phaseNumber}`;
    }

    if (line.startsWith("plan: ")) {
      const planMatch = options.targetBaseName.match(/^(\d+)-PLAN\.md$/);

      if (planMatch) {
        return `plan: ${Number.parseInt(planMatch[1], 10)}`;
      }
    }

    if (line.startsWith("depends_on:")) {
      return line.replace(/\b\d{2}-(\d{2})\b/g, "$1");
    }

    return line;
  });

  return `---\n${frontmatterLines.join("\n")}\n---\n${content.slice(bodyStart)}`;
}

function injectGeneratedNotice(content, source, extraLines = [], sourceFingerprint = null) {
  const noticeLines = [
    `<!-- AUTO-GENERATED from ${source} by scripts/sync-planning-to-gsd.mjs.${sourceFingerprint ? ` source-sha256: ${sourceFingerprint}.` : ""} Edit the source file, not this projection. -->`,
    ...extraLines
  ];
  const noticeBlock = `${noticeLines.join("\n")}\n\n`;
  const frontmatterMatch = content.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);

  if (!frontmatterMatch) {
    return `${noticeBlock}${ensureTrailingNewline(content)}`;
  }

  const insertOffset = frontmatterMatch[0].length;

  return `${content.slice(0, insertOffset)}${noticeBlock}${ensureTrailingNewline(content.slice(insertOffset))}`;
}

function ensureTrailingNewline(content) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function createContentFingerprint(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeRelativeFile(relativePath, content) {
  const absolutePath = path.join(repoRoot, relativePath);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, ensureTrailingNewline(content), "utf8");
}

function extractFrontmatterValue(content, key) {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!frontmatterMatch) {
    return null;
  }

  const line = frontmatterMatch[1]
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${key}:`));

  if (!line) {
    return null;
  }

  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}
