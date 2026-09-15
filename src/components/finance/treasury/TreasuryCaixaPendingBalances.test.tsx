/**
 * Caixa — lançar saldo NÃO recalcula a tela; fica o aviso de dados
 * desatualizados até "Atualizar tela".
 *
 * Testes de React por SSR (sem jsdom): regras puras, markup do aviso e da linha
 * da conta, e wiring da página sobre o fonte (quem recalcula e quando).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import {
  addTreasuryCaixaPendingBalance,
  describeTreasuryCaixaPendingBalances,
  formatTreasuryCaixaPendingBalance,
  treasuryCaixaPendingBalancesForAccount,
  type TreasuryCaixaPendingBalance,
} from "@/src/lib/treasury/treasuryCaixaPendingBalances.js";
import { TreasuryCaixaAccountsSummary } from "./TreasuryCaixaAccountsSummary.js";
import { TreasuryCaixaStaleBanner } from "./TreasuryCaixaStaleBanner.js";

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(here, "TreasuryCaixaPage.tsx"), "utf8");
const summarySource = readFileSync(join(here, "TreasuryCaixaAccountsSummary.tsx"), "utf8");
const dialogSource = readFileSync(
  join(here, "predictive-cash-flow/PredictiveCashFlowBalanceCorrectDialog.tsx"),
  "utf8"
);

function pending(over: Partial<TreasuryCaixaPendingBalance> = {}): TreasuryCaixaPendingBalance {
  return {
    accountId: "acc-1",
    accountName: "Viacredi - Koppetel",
    civilDate: "2026-09-14",
    openingBalance: "131000.00",
    closingBalance: null,
    // 10:32 em São Paulo.
    savedAt: "2026-09-14T13:32:00.000Z",
    ...over,
  };
}

const ACCOUNTS: PredictiveCashFlowAccount[] = [
  {
    id: "acc-1",
    name: "Viacredi - Koppetel",
    institutionName: "Viacredi",
    initialBalance: 130728.66,
    isActive: true,
    includeInConsolidated: true,
    companyCode: null,
  },
  {
    id: "acc-2",
    name: "Sisprime - Koppetel",
    institutionName: "SISPRIME",
    initialBalance: 169554.59,
    isActive: true,
    includeInConsolidated: true,
    companyCode: null,
  },
];

/** Bloco JSX de um componente no fonte da página (da abertura até o `/>`). */
function jsxBlock(source: string, component: string): string {
  const start = source.indexOf(`<${component}`);
  assert.ok(start >= 0, `${component} renderizado na página`);
  return source.slice(start, source.indexOf("/>", start) + 2);
}

describe("Caixa — saldos lançados pendentes (regras puras)", () => {
  it("um pendente por conta e dia: o último lançamento substitui o anterior", () => {
    let list = addTreasuryCaixaPendingBalance([], pending());
    list = addTreasuryCaixaPendingBalance(list, pending({ openingBalance: "132000.00", savedAt: "2026-09-14T13:40:00.000Z" }));
    assert.equal(list.length, 1);
    assert.equal(list[0]!.openingBalance, "132000.00");
    list = addTreasuryCaixaPendingBalance(list, pending({ civilDate: "2026-09-13" }));
    list = addTreasuryCaixaPendingBalance(list, pending({ accountId: "acc-2", accountName: "Sisprime - Koppetel" }));
    assert.equal(list.length, 3);
    assert.deepEqual(
      treasuryCaixaPendingBalancesForAccount(list, "acc-1").map((p) => p.civilDate),
      ["2026-09-14", "2026-09-13"]
    );
  });

  it("frase do aviso e da linha da conta", () => {
    assert.equal(describeTreasuryCaixaPendingBalances([]), null);
    assert.equal(
      describeTreasuryCaixaPendingBalances([pending()]),
      "1 saldo lançado (Viacredi - Koppetel) depois do último cálculo da tela."
    );
    assert.equal(
      describeTreasuryCaixaPendingBalances([
        pending(),
        pending({ civilDate: "2026-09-13" }),
        pending({ accountId: "acc-2", accountName: "Sisprime - Koppetel" }),
      ]),
      "3 saldos lançados (Viacredi - Koppetel e Sisprime - Koppetel) depois do último cálculo da tela."
    );
    const five = ["A", "B", "C", "D", "E"].map((name, i) => pending({ accountId: `acc-${i}`, accountName: name }));
    assert.match(describeTreasuryCaixaPendingBalances(five)!, /\(A, B, C e mais 2\)/);

    assert.match(
      formatTreasuryCaixaPendingBalance(pending()),
      /^Lançado às 10:32 · saldo inicial R\$\s131\.000,00 de 14\/09\/2026$/
    );
    assert.match(
      formatTreasuryCaixaPendingBalance(pending({ closingBalance: "130500.50" })),
      /saldo inicial R\$\s131\.000,00 e final R\$\s130\.500,50 de 14\/09\/2026$/
    );
  });
});

describe("Caixa — aviso e linha da conta (markup)", () => {
  it("aviso só aparece com saldo pendente e oferece Atualizar tela", () => {
    assert.equal(
      renderToStaticMarkup(<TreasuryCaixaStaleBanner pendingBalances={[]} onRefresh={() => {}} />),
      ""
    );
    const html = renderToStaticMarkup(
      <TreasuryCaixaStaleBanner pendingBalances={[pending()]} onRefresh={() => {}} />
    );
    assert.match(html, /data-testid="caixa-stale-banner"/);
    assert.match(html, /role="status"/);
    assert.match(html, /Dados desatualizados/);
    assert.match(html, /1 saldo lançado \(Viacredi - Koppetel\) depois do último cálculo da tela\./);
    assert.match(html, /O saldo já está salvo\./);
    assert.match(html, /data-testid="caixa-stale-refresh"[^>]*>.*Atualizar tela/);
  });

  it("card Caixa hoje marca o lançamento na linha da conta sem mexer no saldo calculado", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <TreasuryCaixaAccountsSummary accounts={ACCOUNTS} pendingBalances={[pending()]} onBalanceSaved={() => {}} />
      </MemoryRouter>
    );
    assert.match(html, /data-testid="caixa-account-pending-acc-1"/);
    assert.doesNotMatch(html, /caixa-account-pending-acc-2/);
    assert.match(html, /Lançado às 10:32 · saldo inicial R\$\s131\.000,00 de 14\/09\/2026 — entra no cálculo ao atualizar a tela/);
    // Valores calculados ficam como estavam até atualizar.
    assert.match(html, /R\$\s130\.728,66/);
    assert.match(html, /data-testid="caixa-accounts-summary-total"[^>]*>R\$\s300\.283,25</);

    const clean = renderToStaticMarkup(
      <MemoryRouter>
        <TreasuryCaixaAccountsSummary accounts={ACCOUNTS} />
      </MemoryRouter>
    );
    assert.doesNotMatch(clean, /caixa-account-pending-/);
  });
});

describe("Caixa — quem recalcula e quando (wiring)", () => {
  it("gravar saldo só guarda como pendente — nenhuma recarga automática", () => {
    const summaryBlock = jsxBlock(pageSource, "TreasuryCaixaAccountsSummary");
    assert.match(summaryBlock, /pendingBalances=\{pendingBalances\}/);
    assert.match(summaryBlock, /onBalanceSaved=\{\(entry\) => setPendingBalances\(\(list\) => addTreasuryCaixaPendingBalance\(list, entry\)\)\}/);
    for (const reload of ["loadAccounts(", "search(", "loadScenarios(", "onChanged"]) {
      assert.equal(summaryBlock.includes(reload), false, `gravar saldo não pode chamar ${reload}`);
    }
    // O card segue sem nenhuma busca própria e repassa o que o modal gravou.
    assert.equal(summarySource.includes("fetchTreasury"), false);
    assert.match(summarySource, /onSaved=\{\(saved\) =>\s*onBalanceSaved\?\.\(\{\s*\.\.\.saved,\s*accountId: editing\.id,/);
    assert.match(dialogSource, /onSaved\(\{ civilDate, openingBalance, closingBalance \}\);/);
  });

  it("Atualizar tela recalcula contas, movimento de hoje, caixa do período e projeção — e limpa o aviso", () => {
    const start = pageSource.indexOf("const refreshScreen = useCallback(");
    assert.ok(start >= 0, "refreshScreen definido");
    const refresh = pageSource.slice(start, pageSource.indexOf("}, [", start));
    // Movimento de hoje, caixa e projeção só quando a movimentação já foi
    // carregada (ver TreasuryCaixaMovementOnDemand.test.tsx).
    for (const step of ["setPendingBalances([])", "loadAccounts()", "loadTodayFlow()", "search()", "loadScenarios()"]) {
      assert.ok(refresh.includes(step), `Atualizar tela precisa chamar ${step}`);
    }
    assert.match(
      pageSource,
      /<TreasuryCaixaStaleBanner\s+pendingBalances=\{pendingBalances\}\s+movementLoaded=\{movementRequested\}\s+onRefresh=\{refreshScreen\}\s*\/>/
    );
    assert.ok(
      pageSource.indexOf("<TreasuryCaixaStaleBanner") < pageSource.indexOf("<TreasuryCaixaAccountsSummary"),
      "aviso acima do card Caixa hoje"
    );
  });
});
