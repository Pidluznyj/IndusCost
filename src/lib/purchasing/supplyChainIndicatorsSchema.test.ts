import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ENGINE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/supplyChainIndicatorsEngine.ts"),
  "utf8"
);
const SERVICE = readFileSync(
  join(process.cwd(), "src/lib/purchasing/supplyChainIndicatorsService.server.ts"),
  "utf8"
);
const ROUTES = readFileSync(
  join(process.cwd(), "src/lib/purchasing/supplyChainIndicatorsRoutes.ts"),
  "utf8"
);
const UI = readFileSync(
  join(process.cwd(), "src/components/contextual/PurchaseIndicatorsDashboard.tsx"),
  "utf8"
);
const FLAGS = readFileSync(
  join(process.cwd(), "src/lib/supply-chain/supplyChainFeatureFlags.ts"),
  "utf8"
);
const SERVER = readFileSync(join(process.cwd(), "server.ts"), "utf8");
const APP = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

describe("supply chain indicators schema (OP-26)", () => {
  it("1. cobre os indicadores exigidos com base/grain e anti-dupla contagem", () => {
    for (const id of [
      "valor_solicitado",
      "valor_cotado",
      "valor_negociado",
      "ganho_negociado",
      "ganho_realizado",
      "pedidos_em_aberto",
      "quantidade_pendente",
      "atrasos_fornecedor",
      "estoque_fisico",
      "estoque_reservado",
      "estoque_bloqueado",
      "estoque_disponivel",
      "materiais_abaixo_minimo",
      "cobertura_estimada",
      "negociacoes_sem_evidencia",
      "recebimentos_divergentes",
    ]) {
      assert.match(ENGINE, new RegExp(id));
    }
    assert.match(ENGINE, /doNotSumMoneyAcrossStages:\s*true/);
    assert.match(ENGINE, /stockLayersAreNotAdditiveTotal:\s*true/);
    assert.match(ENGINE, /pickOnePerPipelineKey/);
    assert.match(ENGINE, /mutatesOfficialEngines:\s*false/);
  });

  it("2. serviço read-only, flag default-off, API/UI/relatórios integrados", () => {
    assert.match(FLAGS, /SUPPLY_CHAIN_INDICATORS_ENABLED/);
    assert.match(SERVICE, /createOfficialDataProviders/);
    assert.match(SERVICE, /computeSavingsComparison/);
    assert.match(SERVICE, /buildSupplyChainIndicatorCards/);
    assert.doesNotMatch(SERVICE, /productBOM\.(create|update|delete)/);
    assert.doesNotMatch(SERVICE, /materialCostTableItem\.(create|update)/);
    assert.match(ROUTES, /requireEnvFlagEnabled/);
    assert.match(ROUTES, /\/api\/supply-chain\/indicators/);
    assert.match(SERVER, /registerSupplyChainIndicatorsRoutes/);
    assert.match(APP, /purchases\/indicators/);
    assert.match(UI, /sc-executive-indicators/);
    assert.match(UI, /doNotSumMoneyAcrossStages|Não some solicitação/);
    assert.match(UI, /Bases e notas/);
    assert.match(UI, /Relatório — atrasos/);
    assert.match(UI, /SUPPLY_CHAIN_INDICATORS_ENABLED/);
  });
});
