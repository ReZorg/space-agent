import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { __test as setCommandTest } from "../commands/set.js";
import { resolveRequestedGitBackend } from "../server/lib/git/shared.js";
import { createRuntimeParams, loadParamSpecs, validateConfigValue } from "../server/lib/utils/runtime_params.js";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMMANDS_DIR = path.join(PROJECT_ROOT, "commands");

test("set parses one or more KEY=VALUE assignments", () => {
  assert.deepEqual(setCommandTest.parseSetArgs(["HOST=127.0.0.1"]), [
    {
      paramName: "HOST",
      value: "127.0.0.1"
    }
  ]);
  assert.deepEqual(setCommandTest.parseSetArgs(["HOST=127.0.0.1", "PORT=3100"]), [
    {
      paramName: "HOST",
      value: "127.0.0.1"
    },
    {
      paramName: "PORT",
      value: "3100"
    }
  ]);
});

test("set rejects non assignment arguments", () => {
  assert.throws(() => {
    setCommandTest.parseSetArgs(["HOST", "127.0.0.1"]);
  }, /Expected KEY=VALUE/);
});

test("runtime params schema exposes GIT_BACKEND with auto default", async () => {
  const specs = await loadParamSpecs(PROJECT_ROOT);
  const spec = specs.find((entry) => entry.name === "GIT_BACKEND");

  assert.ok(spec);
  assert.equal(spec.defaultValue, "auto");
  assert.deepEqual(spec.allowed, ["auto", "native", "isomorphic"]);
  assert.equal(validateConfigValue(spec, "native"), "native");
  assert.equal(validateConfigValue(spec, "isomorphic"), "isomorphic");
  assert.throws(() => {
    validateConfigValue(spec, "unsupported");
  }, /GIT_BACKEND must match one of/);
});

test("runtime params and env resolve requested git backend", async () => {
  const runtimeParams = await createRuntimeParams(PROJECT_ROOT, {
    env: {},
    overrides: {
      GIT_BACKEND: "native"
    },
    storedValues: {}
  });

  assert.equal(resolveRequestedGitBackend({ runtimeParams }), "native");
  assert.equal(resolveRequestedGitBackend({ backendName: undefined, runtimeParams }), "native");

  const autoRuntimeParams = await createRuntimeParams(PROJECT_ROOT, {
    env: {},
    overrides: {},
    storedValues: {}
  });

  assert.equal(
    resolveRequestedGitBackend({
      env: { GIT_BACKEND: "isomorphic" },
      runtimeParams: autoRuntimeParams
    }),
    "isomorphic"
  );
});

test("set apply helper executes assignments in order", async () => {
  const calls = [];
  const result = await setCommandTest.applySetArgs(
    PROJECT_ROOT,
    COMMANDS_DIR,
    setCommandTest.parseSetArgs(["HOST=127.0.0.1", "PORT=3100"]),
    {
      setServerConfigParam: async (projectRoot, commandsDir, paramName, value) => {
        calls.push({
          commandsDir,
          paramName,
          projectRoot,
          value
        });

        return {
          name: paramName,
          value
        };
      }
    }
  );

  assert.deepEqual(calls, [
    {
      commandsDir: COMMANDS_DIR,
      paramName: "HOST",
      projectRoot: PROJECT_ROOT,
      value: "127.0.0.1"
    },
    {
      commandsDir: COMMANDS_DIR,
      paramName: "PORT",
      projectRoot: PROJECT_ROOT,
      value: "3100"
    }
  ]);
  assert.deepEqual(result, [
    {
      name: "HOST",
      value: "127.0.0.1"
    },
    {
      name: "PORT",
      value: "3100"
    }
  ]);
});
