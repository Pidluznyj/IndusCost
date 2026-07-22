import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ENGINE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/shadowPurchasePlanningEngine.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/shadowPurchasePlanningService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/shadowPurchasePlanningRoutes.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/ShadowPurchasePlanningModule.tsx"),
  "utf8"
);
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
const FLAGS = readFileSync(
  join(process.cwd(), "src/lib/supply-chain/supplyChainFeatureFlags.ts"),
  "utf8"
);
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");

describe("shadow purchase planning schema (OP-25)", () => {
  it("1. motor e serviço são read-only sobre oficiais e excluem inbound inseguro", () => {
    assert.match(ENGINE, /comprasConfirmadasNoPrazo/);
    assert.match(ENGINE, /classifyInboundPurchase/);
    assert.match(ENGINE, /atrasada|não confirmado|Sem data/i);
    assert.match(SERVICE, /createOfficialDataProviders/);
    assert.match(SERVICE, /mutatesBom:\s*false/);
    assert.match(SERVICE, /createsProductionOrder:\s*false/);
    assert.match(SERVICE, /createsPurchaseRequestAutomatically:\s*false/);
    assert.match(SERVICE, /updatesPublishedCost:\s*false/);
    assert.match(SERVICE, /writesOfficialEngines:\s*false/);
    assert.match(SERVICE, /confirmHumanAction/);
    assert.doesNotMatch(SERVICE, /productBOM\.(create|update|delete)/);
    assert.doesNotMatch(SERVICE, /nomusProductionOrder\.(create|update|delete)/);
  });

  it("2. draft só com ação humana; flag default-off; UI/API integrados", () => {
    assert.match(FLAGS, /SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED/);
    assert.match(ROUTES, /requireEnvFlagEnabled/);
    assert.match(ROUTES, /confirmHumanAction/);
    assert.match(ROUTES, /shadow-purchase-planning\/create-draft/);
    assert.match(SERVER, /registerShadowPurchasePlanningRoutes/);
    assert.match(APP, /purchases\/shadow-planning/);
    assert.match(APP, /ShadowPurchasePlanningModule/);
    assert.match(UI, /confirmHumanAction:\s*true/);
    assert.match(UI, /window\.confirm/);
    assert.match(UI, /Modo sombra/);
    assert.match(UI, /Criar rascunho SC/);
    assert.match(UI, /SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED/);
  });
});
