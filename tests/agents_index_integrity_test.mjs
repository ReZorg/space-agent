import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_AGENTS_PATH = path.join(ROOT_DIR, "AGENTS.md");

function extractIndexedAgentsPaths(sourceText) {
  const lines = String(sourceText || "").split(/\r?\n/u);
  const indexedPaths = [];
  let inIndexSection = false;

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();

    if (!inIndexSection && trimmed === "## AGENTS File Index") {
      inIndexSection = true;
      continue;
    }

    if (!inIndexSection) {
      continue;
    }

    if (trimmed.startsWith("## ") && trimmed !== "## AGENTS File Index") {
      break;
    }

    const match = line.match(/^\s*-\s+`(\/[^`]+\/AGENTS\.md)`\s*$/u);
    if (!match) {
      continue;
    }

    indexedPaths.push(match[1]);
  }

  return indexedPaths;
}

test("root AGENTS file index paths exist in the repository", async () => {
  const sourceText = await fs.readFile(ROOT_AGENTS_PATH, "utf8");
  const indexedPaths = extractIndexedAgentsPaths(sourceText);
  assert.ok(indexedPaths.length > 0, "Expected at least one AGENTS.md path in the root AGENTS index.");

  const uniquePaths = [...new Set(indexedPaths)];
  assert.equal(uniquePaths.length, indexedPaths.length, "Root AGENTS index contains duplicate AGENTS.md paths.");

  const missingPaths = [];

  await Promise.all(
    uniquePaths.map(async (indexedPath) => {
      const repoRelativePath = indexedPath.replace(/^\/+/u, "");
      const absolutePath = path.resolve(ROOT_DIR, repoRelativePath);

      if (absolutePath !== ROOT_DIR && !absolutePath.startsWith(`${ROOT_DIR}${path.sep}`)) {
        missingPaths.push(indexedPath);
        return;
      }

      try {
        const stats = await fs.stat(absolutePath);
        if (!stats.isFile()) {
          missingPaths.push(indexedPath);
        }
      } catch {
        missingPaths.push(indexedPath);
      }
    })
  );

  assert.deepEqual(
    missingPaths.sort(),
    [],
    `Root AGENTS index references missing paths: ${missingPaths.join(", ")}`
  );
});
