import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_BANK_IMPORTS_PATH,
  TREASURY_BANK_MOVEMENTS_PATH,
} from "./contracts/treasuryContracts.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("treasuryBankMovementQueryApi — wiring", () => {
  it("registra GET lotes e movimentos com ACL de conciliação", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_BANK_IMPORTS_PATH, "/api/finance/treasury/bank-imports");
    assert.equal(
      TREASURY_BANK_MOVEMENTS_PATH,
      "/api/finance/treasury/bank-movements"
    );
    assert.match(routes, /TREASURY_BANK_IMPORTS_PATH/);
    assert.match(routes, /TREASURY_BANK_MOVEMENTS_PATH/);
    assert.match(routes, /createTreasuryBankMovementQueryControllers/);
    assert.match(routes, /treasury\.reconciliation\.enabled/);
    assert.match(routes, /viewReconciliation/);
    assert.match(routes, /listBatches/);
    assert.match(routes, /listMovements/);
  });
});
