import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/receivingStationService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseReceiptRoutes.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/PurchaseReceivingStationModule.tsx"),
  "utf8"
);
const SHELL = readFileSync(
  join(process.cwd(), "src/components/supply-chain/SupplyChainModuleShell.tsx"),
  "utf8"
);
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const FLAGS = readFileSync(
  join(process.cwd(), "src/lib/supply-chain/supplyChainFeatureFlags.ts"),
  "utf8"
);

describe("receiving station UI (OP-23)", () => {
  it("1. board/detalhe expõem PC, fornecedor, quantidades, lote, docs, custos, movimentos", () => {
    assert.match(SERVICE, /listReceivingStationBoard/);
    assert.match(SERVICE, /getReceivingStationOrderDetail/);
    assert.match(SERVICE, /quantityPending/);
    assert.match(SERVICE, /quantityCancelled/);
    assert.match(SERVICE, /negotiatedUnitCost/);
    assert.match(SERVICE, /receivedUnitCost/);
    assert.match(SERVICE, /inventoryMovements/);
    assert.match(SERVICE, /evidences/);
    assert.match(SERVICE, /confirmedOrderIsNotStock/);
    assert.match(SERVICE, /onlyConfirmedReceiptChangesPhysicalBalance/);
  });

  it("2. rotas, UI, permissões e banners explícitos", () => {
    assert.match(ROUTES, /\/api\/receiving-station/);
    assert.match(ROUTES, /requireSupplyChainModuleEnabled\("sc-receiving"\)/);
    assert.match(APP, /purchases\/receiving/);
    assert.match(APP, /PurchaseReceivingStationModule/);
    assert.match(UI, /receiving-station-board|receiving-station-detail/);
    assert.match(UI, /Pedido confirmado ≠ estoque|Pedido confirmado/);
    assert.match(UI, /PURCHASE_RECEIPT/);
    assert.match(UI, /allowApprove/);
    assert.match(UI, /Reversão autorizada/);
    assert.match(UI, /receiving-station-filters/);
    assert.match(SHELL, /PurchaseReceivingStationModule/);
    assert.match(SHELL, /sc-receiving/);
    assert.match(FLAGS, /SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED/);
    assert.match(FLAGS, /defaultWhenAbsent:\s*false/);
  });
});
