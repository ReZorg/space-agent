#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TESTS_DIR, "..");
const DEFAULT_CATALOG_PATH = path.join(TESTS_DIR, "test-lane-catalog.json");
const DEFAULT_RESULTS_DIR = path.join(process.env.RUNNER_TEMP || "/tmp", "space-agent-test-results");

function parseArgs(argv) {
  const options = {
    allowFlakyRetries: null,
    catalogPath: DEFAULT_CATALOG_PATH,
    includeHeavy: null,
    includeQuarantined: null,
    lane: "",
    outputPath: "",
    resultsDir: DEFAULT_RESULTS_DIR
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");

    if (arg === "--lane") {
      options.lane = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (arg.startsWith("--lane=")) {
      options.lane = arg.slice("--lane=".length).trim();
      continue;
    }

    if (arg === "--catalog") {
      options.catalogPath = path.resolve(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }

    if (arg.startsWith("--catalog=")) {
      options.catalogPath = path.resolve(arg.slice("--catalog=".length).trim());
      continue;
    }

    if (arg === "--results-dir") {
      options.resultsDir = path.resolve(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }

    if (arg.startsWith("--results-dir=")) {
      options.resultsDir = path.resolve(arg.slice("--results-dir=".length).trim());
      continue;
    }

    if (arg === "--json-output") {
      options.outputPath = path.resolve(String(argv[index + 1] || "").trim());
      index += 1;
      continue;
    }

    if (arg.startsWith("--json-output=")) {
      options.outputPath = path.resolve(arg.slice("--json-output=".length).trim());
      continue;
    }

    if (arg === "--include-heavy") {
      options.includeHeavy = true;
      continue;
    }

    if (arg === "--exclude-heavy") {
      options.includeHeavy = false;
      continue;
    }

    if (arg === "--allow-flaky-retries") {
      options.allowFlakyRetries = true;
      continue;
    }

    if (arg === "--disallow-flaky-retries") {
      options.allowFlakyRetries = false;
      continue;
    }

    if (arg === "--include-quarantined") {
      options.includeQuarantined = true;
      continue;
    }

    if (arg === "--exclude-quarantined") {
      options.includeQuarantined = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.lane) {
    throw new Error("Missing required --lane argument.");
  }

  return options;
}

async function readCatalog(catalogPath) {
  const raw = await fs.readFile(catalogPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid lane catalog at ${catalogPath}.`);
  }
  return parsed;
}

function normalizeLineEndings(value) {
  return String(value || "").replace(/\r\n/gu, "\n");
}

function compactOutput(rawOutput, maxLength = 12000) {
  const output = normalizeLineEndings(rawOutput).trim();
  if (!output) {
    return "";
  }
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(output.length - maxLength);
}

function extractFailureReason(output) {
  const lines = normalizeLineEndings(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const preferred = lines.find((line) => /^Error[:\s]/u.test(line));
  if (preferred) {
    return preferred;
  }
  return lines[lines.length - 1] || "Test failed without a captured error line.";
}

function laneTests(catalog, laneName, includeHeavyOverride, includeQuarantinedOverride) {
  const lane = catalog?.lanes?.[laneName];
  if (!lane) {
    throw new Error(`Unknown lane "${laneName}" in lane catalog.`);
  }

  const categories = new Set(Array.isArray(lane.categories) ? lane.categories : []);
  if (categories.size === 0) {
    throw new Error(`Lane "${laneName}" does not define categories.`);
  }

  const includeHeavy = includeHeavyOverride ?? Boolean(lane.includeHeavy);
  const includeQuarantined = includeQuarantinedOverride ?? Boolean(lane.includeQuarantined);
  const selected = Object.entries(catalog.tests || {})
    .filter(([, meta = {}]) => categories.has(String(meta.category || "")))
    .filter(([, meta = {}]) => includeHeavy || !meta.heavy)
    .filter(([, meta = {}]) => includeQuarantined || !meta.quarantined)
    .map(([id, meta = {}]) => ({
      category: String(meta.category || ""),
      flakyProne: Boolean(meta.flakyProne),
      heavy: Boolean(meta.heavy),
      quarantined: Boolean(meta.quarantined),
      id
    }))
    .sort((left, right) => left.id.localeCompare(right.id));

  if (selected.length === 0) {
    throw new Error(`Lane "${laneName}" selected zero tests.`);
  }

  return {
    lane,
    selected
  };
}

function resolveAttemptsForTest(lane, testMeta, allowFlakyRetriesOverride) {
  const retry = lane.retry || {};
  const retriesAllowed = allowFlakyRetriesOverride ?? Boolean(retry.enabled);
  if (!retriesAllowed) {
    return 1;
  }

  const maxAttempts = Math.max(1, Number.parseInt(String(retry.maxAttempts || "1"), 10) || 1);
  const onlyFlakyProne = Boolean(retry.onlyFlakyProne);
  if (onlyFlakyProne && !testMeta.flakyProne) {
    return 1;
  }

  return maxAttempts;
}

function runNodeTest(testId, timeoutMs) {
  const testPath = path.join(TESTS_DIR, testId);
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [
    "--test",
    `--test-timeout=${timeoutMs}`,
    testPath
  ], {
    cwd: PROJECT_ROOT,
    encoding: "utf8"
  });
  const finishedAt = Date.now();

  return {
    durationMs: finishedAt - startedAt,
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    stderr: String(result.stderr || ""),
    stdout: String(result.stdout || ""),
    testId
  };
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

function buildTimestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

async function writeResultFiles(options, resultPayload) {
  const timestamp = buildTimestamp();
  const laneDir = path.join(options.resultsDir, options.lane);
  await ensureDirectory(laneDir);
  const outputPath = options.outputPath || path.join(laneDir, `${timestamp}.json`);
  await fs.writeFile(outputPath, JSON.stringify(resultPayload, null, 2), "utf8");
  return outputPath;
}

function printSummary(summary) {
  console.log(`Lane ${summary.lane}`);
  console.log(`Selected tests: ${summary.total}`);
  console.log(`Passed: ${summary.passed}`);
  console.log(`Failed: ${summary.failed}`);
  console.log(`Retries used: ${summary.retriesUsed}`);
  console.log(`Elapsed: ${summary.elapsedMs}ms`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = await readCatalog(options.catalogPath);
  const { lane, selected } = laneTests(
    catalog,
    options.lane,
    options.includeHeavy,
    options.includeQuarantined
  );
  const timeoutMs = Math.max(1000, Number.parseInt(String(lane.timeoutMs || "120000"), 10) || 120000);
  const startedAt = Date.now();
  const records = [];
  let retriesUsed = 0;

  for (const testMeta of selected) {
    const attemptsAllowed = resolveAttemptsForTest(lane, testMeta, options.allowFlakyRetries);
    let finalAttempt = null;

    for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
      const attemptResult = runNodeTest(testMeta.id, timeoutMs);
      const combinedOutput = `${attemptResult.stdout}\n${attemptResult.stderr}`;
      const passed = attemptResult.exitCode === 0;
      finalAttempt = {
        attempt,
        category: testMeta.category,
        durationMs: attemptResult.durationMs,
        failureReason: passed ? "" : extractFailureReason(combinedOutput),
        flakyProne: testMeta.flakyProne,
        heavy: testMeta.heavy,
        quarantined: testMeta.quarantined,
        outputTail: compactOutput(combinedOutput),
        passed,
        test: testMeta.id
      };

      if (passed) {
        if (attempt > 1) {
          retriesUsed += attempt - 1;
        }
        break;
      }

      if (attempt < attemptsAllowed) {
        retriesUsed += 1;
      }
    }

    records.push(finalAttempt);
    if (!finalAttempt.passed) {
      console.error(`✖ ${finalAttempt.test}`);
      console.error(`  ${finalAttempt.failureReason}`);
    } else {
      console.log(`✔ ${finalAttempt.test} (${finalAttempt.durationMs}ms)`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  const failed = records.filter((record) => !record.passed).length;
  const payload = {
    catalogPath: options.catalogPath,
    elapsedMs,
    lane: options.lane,
    results: records,
    summary: {
      elapsedMs,
      failed,
      lane: options.lane,
      passed: records.length - failed,
      retriesUsed,
      total: records.length
    },
    timestamp: new Date().toISOString()
  };
  const outputPath = await writeResultFiles(options, payload);
  printSummary(payload.summary);
  console.log(`Wrote lane result: ${outputPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
