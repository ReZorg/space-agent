#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_METADATA = [
  "metadata-latest-windows.yml",
  "metadata-latest-mac.yml",
  "metadata-latest-linux.yml",
  "metadata-latest-linux-arm64.yml"
];

function parseArgs(argv) {
  const options = {
    manifestPath: "",
    smokeCheck: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");

    if (arg === "--smoke-check") {
      options.smokeCheck = true;
      continue;
    }

    if (!options.manifestPath && !arg.startsWith("--")) {
      options.manifestPath = path.resolve(arg);
      continue;
    }

    throw new Error(`Unknown release-assets-verify argument: ${arg}`);
  }

  if (!options.manifestPath) {
    throw new Error("Usage: node packaging/scripts/release-assets-verify.js <manifest-path> [--smoke-check]");
  }

  return options;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Manifest does not exist: ${manifestPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(parsed.uploadFiles) || parsed.uploadFiles.length === 0) {
    throw new Error(`Manifest has no upload files: ${manifestPath}`);
  }
  return parsed;
}

function basenameSet(uploadFiles = []) {
  return new Set(uploadFiles.map((entry) => path.basename(String(entry || ""))));
}

function detectReleaseVersion(fileNames) {
  const appImage = [...fileNames].find((name) => /Space-Agent-(.+)-linux-x64\.AppImage$/u.test(name));
  if (!appImage) {
    throw new Error("Could not detect release version from linux x64 AppImage asset.");
  }

  const match = appImage.match(/^Space-Agent-(.+)-linux-x64\.AppImage$/u);
  if (!match || !match[1]) {
    throw new Error(`Could not parse release version from ${appImage}.`);
  }
  return match[1];
}

function requiredAssetsForVersion(releaseVersion) {
  return [
    `Space-Agent-${releaseVersion}-windows-x64.exe`,
    `Space-Agent-${releaseVersion}-windows-arm64.exe`,
    `Space-Agent-${releaseVersion}-linux-x64.AppImage`,
    `Space-Agent-${releaseVersion}-linux-arm64.AppImage`,
    `Space-Agent-${releaseVersion}-macos-x64.dmg`,
    `Space-Agent-${releaseVersion}-macos-arm64.dmg`,
    `Space-Agent-${releaseVersion}-macos-x64-update.zip`,
    `Space-Agent-${releaseVersion}-macos-arm64-update.zip`,
    ...REQUIRED_METADATA
  ];
}

function assertHasAllRequired(fileNames, required) {
  const missing = required.filter((name) => !fileNames.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing required staged release files:\n- ${missing.join("\n- ")}`);
  }
}

function assertCanonicalNaming(fileNames, releaseVersion) {
  const allowed = new Set(requiredAssetsForVersion(releaseVersion));
  const invalid = [...fileNames].filter((name) => {
    if (allowed.has(name)) {
      return false;
    }
    if (name === ".manifest.json") {
      return false;
    }
    return true;
  });

  if (invalid.length > 0) {
    throw new Error(`Found non-canonical staged filenames:\n- ${invalid.join("\n- ")}`);
  }
}

function assertSmokeCheck(manifestPath, uploadFiles = []) {
  const failed = uploadFiles
    .map((entry) => ({
      filePath: path.isAbsolute(String(entry || ""))
        ? String(entry || "")
        : path.resolve(path.dirname(manifestPath), String(entry || ""))
    }))
    .map((entry) => ({
      ...entry,
      stats: fs.existsSync(entry.filePath) ? fs.statSync(entry.filePath) : null
    }))
    .filter((entry) => !entry.stats || entry.stats.size <= 0);

  if (failed.length > 0) {
    throw new Error(
      `Smoke check failed for staged assets with empty or missing payloads:\n- ${failed
        .map((entry) => entry.filePath)
        .join("\n- ")}`
    );
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readManifest(options.manifestPath);
  const uploadFiles = manifest.uploadFiles.map((entry) => String(entry || ""));
  const fileNames = basenameSet(uploadFiles);
  const releaseVersion = detectReleaseVersion(fileNames);
  const required = requiredAssetsForVersion(releaseVersion);

  assertHasAllRequired(fileNames, required);
  assertCanonicalNaming(fileNames, releaseVersion);

  if (options.smokeCheck) {
    assertSmokeCheck(options.manifestPath, uploadFiles);
  }

  console.log(`Verified staged release assets for ${releaseVersion}.`);
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
