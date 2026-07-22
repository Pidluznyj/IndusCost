import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ENGINE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchasingWorkstationEngine.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchasingWorkstationService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchasingWorkstationRoutes.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/PurchaseWorkstationModule.tsx"),
  "utf8"
);
const SHELL = readFileSync(
  join(process.cwd(), "src/components/supply-chain/SupplyChainModuleShell.tsx"),
  "utf8"
);
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");
const FLAGS = readFileSync(
  join(process.cwd(), "src/lib/supply-chain/supplyChainFeatureFlags.ts"),
  "utf8"
);

describe("purchasing workstation (OP-21)", () => {
  it("1. motor exclusivo + pendente/ganho ortogonais", () => {
    assert.match(ENGINE, /resolveExclusivePipelineStages/);
    assert.match(ENGINE, /pipelineTotal/);
    assert.match(ENGINE, /ganhoNegociado/);
    assert.match(ENGINE, /pendente/);
    assert.match(ENGINE, /kind === "EVIDENCE"/);
  });

  it("2. serviço agrega SC/cotação/negociação/evidência/aprovação/PO e cards no backend", () => {
    assert.match(SERVICE, /buildPurchasingWorkstation/);
    assert.match(SERVICE, /buildWorkstationCards/);
    assert.match(SERVICE, /assertCardsDoNotDoubleCountPipeline/);
    assert.match(SERVICE, /purchaseRequest\.findMany/);
    assert.match(SERVICE, /purchaseQuotation\.findMany/);
    assert.match(SERVICE, /purchaseQuotationAward\.findMany/);
    assert.match(SERVICE, /purchaseOrder\.findMany/);
    assert.match(SERVICE, /purchaseApproval\.findMany/);
    assert.match(SERVICE, /purchaseEvidence\.findMany/);
    assert.doesNotMatch(SERVICE, /accountsPayable\.create/i);
    assert.doesNotMatch(SERVICE, /inventoryMovement\.create/i);
  });

  it("3. rota, UI, shell SC e flag default-off", () => {
    assert.match(ROUTES, /\/api\/purchase-workstation/);
    assert.match(SERVER, /registerPurchasingWorkstationRoutes/);
    assert.match(APP, /purchases\/workstation/);
    assert.match(APP, /PurchaseWorkstationModule/);
    assert.match(UI, /purchase-workstation/);
    assert.match(UI, /SystemTotalizerCard/);
    assert.match(UI, /ws-card-solicitado/);
    assert.match(UI, /ws-card-ganho/);
    assert.match(SHELL, /PurchaseWorkstationModule/);
    assert.match(SHELL, /sc-purchases/);
    assert.match(FLAGS, /SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED/);
    assert.match(FLAGS, /defaultWhenAbsent:\s*false/);
  });
});
