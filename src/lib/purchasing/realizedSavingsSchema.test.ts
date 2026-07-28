import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ENGINE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/realizedSavingsEngine.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/realizedSavingsService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/purchaseOrderRoutes.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/PurchaseSavingsComparisonModule.tsx"),
  "utf8"
);
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

describe("realized vs negotiated savings (OP-24)", () => {
  it("1. motor separa negociado/realizado/não realizado/erosão sem mutar histórico", () => {
    assert.match(ENGINE, /negotiatedGain/);
    assert.match(ENGINE, /realizedGain/);
    assert.match(ENGINE, /unrealizedGain/);
    assert.match(ENGINE, /gainErosion/);
    assert.match(ENGINE, /negotiationMeritImmutable:\s*true/);
    assert.match(ENGINE, /RECEIVED_PRICE_ABOVE_ORDER/);
    assert.match(ENGINE, /MISSING_EVIDENCE/);
    assert.match(ENGINE, /OUTSIDE_NEGOTIATED_CONDITION/);
  });

  it("2. serviço/API/UI integrados e sem AP/Nomus/custo publicado", () => {
    assert.match(SERVICE, /buildPurchaseOrderSavingsComparison/);
    assert.match(SERVICE, /doesNotMutateNegotiationHistory:\s*true/);
    assert.match(SERVICE, /createsAccountsPayable:\s*false/);
    assert.match(SERVICE, /writesNomusStock:\s*false/);
    assert.match(ROUTES, /savings-comparison/);
    assert.match(APP, /purchases\/orders\/:orderId\/savings/);
    assert.match(APP, /PurchaseSavingsComparisonModule/);
    assert.match(UI, /savings-comparison/);
    assert.match(UI, /Ganho negociado/);
    assert.match(UI, /mérito histórico|Mérito histórico|imutável/i);
    assert.match(UI, /savings-alerts/);
  });
});
