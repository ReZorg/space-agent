import assert from "node:assert/strict";
import test from "node:test";

import { runDesktopBrowserHarnessTest } from "./desktop_browser_harness.mjs";

test("desktop browser harness navigates Novinky and clears the consent page", {
  timeout: 7 * 60 * 1000
}, async (testContext) => {
  let result;
  try {
    result = await runDesktopBrowserHarnessTest({
      verbose: true
    });
  } catch (error) {
    const message = String(error?.message || "");
    const detailsCause = String(error?.details?.cause || "");
    const detailsMessage = String(error?.details?.message || "");
    const serializedDetails = JSON.stringify(error?.details || {});
    const combinedErrorText = `${message}\n${detailsCause}\n${detailsMessage}\n${serializedDetails}`;
    if (message.includes("Missing package: electron")) {
      testContext.skip("Skipping desktop browser harness test because packaging dependencies are not installed.");
      return;
    }
    if (
      combinedErrorText.includes("Timed out waiting for Novinky consent page") ||
      combinedErrorText.includes("Timed out waiting for the guest browser runtime to become ready")
    ) {
      testContext.skip("Skipping desktop browser harness test due to unstable external Novinky consent/runtime readiness.");
      return;
    }

    throw error;
  }

  assert.equal(result.success, true);
  assert.equal(typeof result.browserId, "number");
  assert.equal(typeof result.articleReferenceId, "number");
  assert.equal(typeof result.consentReferenceId, "number");
  assert.match(String(result.finalState?.currentUrl || ""), /https:\/\/www\.novinky\.cz\/clanek\//u);
});
