import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SCHEMA = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(
  join(process.cwd(), "prisma/migrations/20260815120000_purchase_receipt_ledger/migration.sql"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseReceiptService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseReceiptRoutes.ts"),
  "utf8"
);
const WORKFLOW = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseReceiptWorkflow.ts"),
  "utf8"
);
const INV_SERVICE = readFileSync(
  join(process.cwd(), "src/lib/inventory/inventoryService.server.ts"),
  "utf8"
);
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");
const FLAGS = readFileSync(
  join(process.cwd(), "src/lib/supply-chain/supplyChainFeatureFlags.ts"),
  "utf8"
);

describe("purchase receipt ledger (OP-22)", () => {
  it("1. schema/migration aditivos com PURCHASE_RECEIPT e histórico", () => {
    assert.match(SCHEMA, /PURCHASE_RECEIPT/);
    assert.match(SCHEMA, /model PurchaseReceiptHistoryEvent/);
    assert.match(SCHEMA, /confirmIdempotencyKey/);
    assert.match(SCHEMA, /effectiveLineCost/);
    assert.match(SCHEMA, /lotNumber/);
    assert.match(SCHEMA, /freightValueActual/);
    assert.match(SCHEMA, /entryDocumentRef/);
    assert.match(SCHEMA, /reversalMovementId/);
    assert.match(MIGRATION, /ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT'/);
    assert.match(MIGRATION, /PurchaseReceiptHistoryEvent/);
    assert.doesNotMatch(MIGRATION, /\bDROP\s+TABLE\b/i);
  });

  it("2. confirmação atômica + idempotência; estorno não apaga entrada", () => {
    assert.match(SERVICE, /createInventoryMovementInTx/);
    assert.match(SERVICE, /reverseInventoryMovementInTx/);
    assert.match(SERVICE, /movementType:\s*"PURCHASE_RECEIPT"/);
    assert.match(SERVICE, /idempotent/);
    assert.match(SERVICE, /ESTORNADO/);
    assert.match(SERVICE, /originalMovementsPreserved:\s*true/);
    assert.doesNotMatch(SERVICE, /inventoryMovement\.delete/i);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create/i);
    assert.match(SERVICE, /updatesPublishedCost:\s*false/);
    assert.match(SERVICE, /writesNomusStock:\s*false/);
    assert.match(INV_SERVICE, /createInventoryMovementInTx/);
    assert.match(INV_SERVICE, /reverseInventoryMovementInTx/);
    assert.match(WORKFLOW, /buildReceiptLineMovementIdempotencyKey/);
  });

  it("3. rotas atrás da flag receiving default-off", () => {
    assert.match(ROUTES, /\/api\/purchase-receipts/);
    assert.match(ROUTES, /requireSupplyChainModuleEnabled\("sc-receiving"\)/);
    assert.match(SERVER, /registerPurchaseReceiptRoutes/);
    assert.match(FLAGS, /SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED/);
    assert.match(FLAGS, /defaultWhenAbsent:\s*false/);
  });
});
