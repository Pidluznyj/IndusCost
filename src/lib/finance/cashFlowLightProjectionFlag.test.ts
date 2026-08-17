/**
 * FEATURE FLAG do caminho leve do Fluxo de Caixa.
 *
 * Duas camadas:
 *  - resolução da variável (execução real, com env restaurado a cada caso);
 *  - fiação: quais endpoints podem escolher `light` e quais NÃO podem.
 *
 * A fiação é verificada no texto-fonte porque executar os handlers exigiria
 * Express + banco. É o mesmo padrão do guard DS-05.6 já usado no projeto: o
 * que se protege aqui é ONDE a decisão é tomada, não o cálculo em si.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CASH_FLOW_LIGHT_PROJECTION_ENV,
  isCashFlowLightProjectionEnabled,
  resolveCashFlowProjectionMode,
} from "@/src/lib/finance/cashFlowLightProjectionFlag.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** Roda `run` com a variável no valor pedido e restaura o env depois. */
function withFlag<T>(value: string | undefined, run: () => T): T {
  const prev = process.env[CASH_FLOW_LIGHT_PROJECTION_ENV];
  try {
    if (value === undefined) delete process.env[CASH_FLOW_LIGHT_PROJECTION_ENV];
    else process.env[CASH_FLOW_LIGHT_PROJECTION_ENV] = value;
    return run();
  } finally {
    if (prev === undefined) delete process.env[CASH_FLOW_LIGHT_PROJECTION_ENV];
    else process.env[CASH_FLOW_LIGHT_PROJECTION_ENV] = prev;
  }
}

describe("FLAG — resolução da variável", () => {
  const casos: Array<[string | undefined, "legacy" | "light"]> = [
    [undefined, "legacy"],
    ["0", "legacy"],
    ["1", "light"],
    ["true", "legacy"],
    ["yes", "legacy"],
    ["on", "legacy"],
    ["", "legacy"],
    [" 1", "legacy"],
    ["1 ", "legacy"],
  ];

  for (const [valor, esperado] of casos) {
    it(`${valor === undefined ? "(ausente)" : JSON.stringify(valor)} → ${esperado}`, () => {
      withFlag(valor, () => {
        assert.equal(resolveCashFlowProjectionMode(), esperado);
        assert.equal(isCashFlowLightProjectionEnabled(), esperado === "light");
      });
    });
  }

  it("o env é restaurado depois de cada caso", () => {
    const antes = process.env[CASH_FLOW_LIGHT_PROJECTION_ENV];
    withFlag("1", () => {
      assert.equal(resolveCashFlowProjectionMode(), "light");
    });
    assert.equal(process.env[CASH_FLOW_LIGHT_PROJECTION_ENV], antes);
  });
});

describe("FLAG — fiação: só três endpoints podem escolher light", () => {
  const routes = read("src/lib/financeCashFlowRoutes.ts");

  it("a decisão é tomada exatamente 3 vezes nas rotas do Fluxo de Caixa", () => {
    const ocorrencias = routes.split("resolveCashFlowProjectionMode()").length - 1;
    assert.equal(
      ocorrencias,
      3,
      `esperava 3 pontos de decisão (dashboard, annual-comparison, daily-radar), achei ${ocorrencias}`
    );
  });

  it("os loaders compartilhados têm default legacy e NÃO leem env", () => {
    for (const assinatura of [
      /loadCashFlowRows\([\s\S]{0,200}?projectionMode: CashFlowProjectionMode = "legacy"/,
      /loadDailyRadarPortfolioRows\([\s\S]{0,120}?projectionMode: CashFlowProjectionMode = "legacy"/,
    ]) {
      assert.match(routes, assinatura);
    }
    // process.env da flag não pode aparecer fora do módulo da flag.
    assert.doesNotMatch(routes, /INDUSCOST_CASH_FLOW_LIGHT_PROJECTION/);
  });

  it("cada ponto de decisão está no handler autorizado", () => {
    const trechos: Array<[string, string]> = [
      ["/api/finance/cash-flow/dashboard", "loadCashFlowRows("],
      ["/api/finance/cash-flow/annual-comparison", "loadAnnualComparisonPortfolioRows("],
      ["/api/finance/cash-flow/daily-radar", "loadDailyRadarPortfolioRows("],
    ];
    for (const [rota, chamada] of trechos) {
      const i = routes.indexOf(`"${rota}"`);
      assert.ok(i > 0, `rota ${rota} não encontrada`);
      const janela = routes.slice(i, i + 3000);
      const j = janela.indexOf(chamada);
      assert.ok(j > 0, `chamada ${chamada} não encontrada após ${rota}`);
      assert.match(
        janela.slice(j, j + 300),
        /resolveCashFlowProjectionMode\(\)/,
        `${rota} deveria resolver a flag`
      );
    }
  });

  it("TRAVA: consumidores compartilhados continuam legacy", () => {
    // Nenhum destes pode decidir por light — todos caem no default.
    for (const arquivo of [
      "src/lib/financeExecutiveReport.ts",
      "src/lib/financeExecutiveReportAnnualLoad.ts",
      "src/lib/financeExecutiveReportCashRadar.ts",
      "src/lib/treasury/services/treasuryCaixaService.server.ts",
      "src/lib/financeAccountsReceivableRoutes.ts",
    ]) {
      const src = read(arquivo);
      assert.doesNotMatch(
        src,
        /resolveCashFlowProjectionMode\(\)/,
        `${arquivo} não pode escolher o caminho light nesta fase`
      );
      assert.doesNotMatch(
        src,
        /INDUSCOST_CASH_FLOW_LIGHT_PROJECTION/,
        `${arquivo} não pode ler a variável da flag`
      );
    }
  });

  it("TRAVA: a variável só é lida no módulo da flag", () => {
    const flagModule = read("src/lib/finance/cashFlowLightProjectionFlag.ts");
    assert.match(flagModule, /INDUSCOST_CASH_FLOW_LIGHT_PROJECTION/);
    // Comparação estrita — "true"/"yes" não podem ligar.
    assert.match(flagModule, /=== "1"/);
  });

  it("o default do pipeline compartilhado é legacy", () => {
    const bridge = read("src/lib/finance/financeCashFlowEffectiveAr.server.ts");
    assert.match(bridge, /enrichInput\?\.projectionMode \?\? "legacy"/);

    const contexts = read(
      "src/lib/finance/financeAccountsReceivableEffectiveTitles.server.ts"
    );
    assert.match(
      contexts,
      /projectionMode: CashFlowProjectionMode = "legacy"/,
      "o builder de contextos precisa nascer legacy"
    );
  });
});
