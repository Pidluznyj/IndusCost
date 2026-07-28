import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { runTreasuryValidateDeploy } from "../../../scripts/treasuryValidateDeploy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

describe("treasuryValidateDeploy", () => {
  it("passa checks estruturais no repositório atual", () => {
    const result = runTreasuryValidateDeploy(root);
    assert.equal(result.ok, true, JSON.stringify(result.checks, null, 2));
    assert.ok(result.checks.length >= 8);
  });
});
