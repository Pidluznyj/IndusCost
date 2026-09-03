/**
 * Modal de saldo inicial/final do Caixa.
 *
 * O repositório roda testes de React por SSR (`renderToStaticMarkup`, sem
 * jsdom), então o comportamento assíncrono é coberto por (a) markup do
 * primeiro paint e (b) asserts de wiring sobre o fonte — as regras puras de
 * hidratação/optimistic lock têm teste próprio em
 * `treasuryPredictiveCashFlowBalanceEdit.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PredictiveCashFlowAccount } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { PredictiveCashFlowBalanceCorrectDialog } from "./PredictiveCashFlowBalanceCorrectDialog.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../../..");
const dialogSource = readFileSync(
  join(here, "PredictiveCashFlowBalanceCorrectDialog.tsx"),
  "utf8"
);

function noop() {}

function account(
  over: Partial<PredictiveCashFlowAccount> = {}
): PredictiveCashFlowAccount {
  return {
    id: "acc-1",
    name: "Caixa Itaú",
    institutionName: "Itaú",
    initialBalance: 125699.11,
    isActive: true,
    includeInConsolidated: true,
    ...over,
  } as PredictiveCashFlowAccount;
}

function render(over?: {
  isSuperAdmin?: boolean;
  disabled?: boolean;
}): string {
  return renderToStaticMarkup(
    <PredictiveCashFlowBalanceCorrectDialog
      account={account()}
      open
      isSuperAdmin={over?.isSuperAdmin ?? false}
      disabled={over?.disabled}
      onClose={noop}
      onSaved={noop}
    />
  );
}

describe("PredictiveCashFlowBalanceCorrectDialog — abertura imediata", () => {
  it("abre já mostrando a conta e o saldo que estava na lista", () => {
    const html = render();
    assert.match(html, /predictive-cf-balance-correct-dialog/);
    assert.match(html, /Caixa Itaú/);
    assert.match(html, /Itaú/);
    // Saldo da lista aparece no primeiro paint (sem esperar request).
    assert.match(html, /125\.699,11/);
  });

  it("campos de saldo já nascem editáveis (hidratação não trava o modal)", () => {
    const html = render();
    const opening = /<input[^>]*data-testid="predictive-cf-balance-correct-opening"[^>]*>/.exec(
      html
    );
    const closing = /<input[^>]*data-testid="predictive-cf-balance-correct-closing"[^>]*>/.exec(
      html
    );
    assert.ok(opening, "campo de saldo inicial presente");
    assert.ok(closing, "campo de saldo final presente");
    assert.equal(opening[0].includes("disabled"), false);
    assert.equal(closing[0].includes("disabled"), false);
  });

  it("motivo e Cancelar não são bloqueados pela hidratação", () => {
    const html = render();
    const reason = /<textarea[^>]*data-testid="predictive-cf-balance-correct-reason"[^>]*>/.exec(
      html
    );
    assert.ok(reason, "campo de motivo presente");
    assert.equal(reason[0].includes("disabled"), false);
    assert.match(html, /Cancelar/);
  });

  it("submit fica bloqueado até a versão persistida ser conhecida", () => {
    const html = render();
    const submit = /<button[^>]*data-testid="predictive-cf-balance-correct-submit"[^>]*>/.exec(
      html
    );
    assert.ok(submit, "botão de salvar presente");
    assert.equal(
      submit[0].includes("disabled"),
      true,
      "sem versão hidratada o submit não pode gravar (optimistic lock)"
    );
  });

  it("tem lugar para dizer se está criando ou corrigindo cada saldo", () => {
    const html = render();
    assert.match(html, /predictive-cf-balance-correct-opening-state/);
    assert.match(html, /predictive-cf-balance-correct-closing-state/);
    assert.match(dialogSource, /Corrigindo o saldo inicial já informado/);
    assert.match(dialogSource, /Nenhum saldo inicial informado ainda/);
    assert.match(dialogSource, /Corrigindo o saldo final já informado/);
    assert.match(dialogSource, /Nenhum saldo final informado ainda/);
    assert.match(dialogSource, /Carregando saldo gravado…/);
  });

  it("antes de hidratar não afirma que não existe saldo informado", () => {
    // SSR/primeiro paint: a consulta ainda não respondeu, então o modal não
    // pode alegar nem "existe" nem "não existe".
    const html = render();
    assert.equal(html.includes("Nenhum saldo inicial informado ainda"), false);
    assert.equal(html.includes("Nenhum saldo final informado ainda"), false);
    assert.equal(html.includes("Corrigindo o saldo inicial"), false);
    assert.equal(html.includes("Corrigindo o saldo final"), false);
  });

  it("data só é editável por SUPER_ADMIN", () => {
    const common = /<input[^>]*data-testid="predictive-cf-balance-correct-date"[^>]*>/;
    const asUser = common.exec(render())?.[0] ?? "";
    const asAdmin = common.exec(render({ isSuperAdmin: true }))?.[0] ?? "";
    assert.equal(asUser.includes("disabled"), true);
    assert.equal(asAdmin.includes("disabled"), false);
    assert.match(render(), /Alterar dias passados exige SUPER_ADMIN/);
    assert.match(
      render({ isSuperAdmin: true }),
      /SUPER_ADMIN pode mudar a data para corrigir dias passados/
    );
  });
});

describe("PredictiveCashFlowBalanceCorrectDialog — leitura leve por conta", () => {
  it("hidrata pela leitura leve accountId + civilDate", () => {
    assert.match(dialogSource, /fetchTreasuryAccountDailyBalance/);
    assert.match(
      dialogSource,
      /fetchTreasuryAccountDailyBalance\(\{\s*accountId: account\.id,\s*date: civilDate,\s*signal: ac\.signal,/
    );
  });

  it("não usa mais os workspaces completos de abertura e fechamento", () => {
    assert.equal(
      dialogSource.includes("fetchTreasuryTodayOpening"),
      false,
      "workspace de abertura não deve ser carregado para dois inputs"
    );
    assert.equal(
      dialogSource.includes("fetchTreasuryTodayClosing"),
      false,
      "workspace de fechamento não deve ser carregado para dois inputs"
    );
  });

  it("não carrega preview de fechamento, CR/CP nem previsão", () => {
    for (const forbidden of [
      "DailyClosingPreview",
      "fetchTreasuryDailyClosingPreview",
      "CrCpByAccount",
      "predictedToday",
      "closeGates",
      "treasuryCaixa",
    ]) {
      assert.equal(
        dialogSource.includes(forbidden),
        false,
        `modal não deve depender de ${forbidden}`
      );
    }
  });

  it("continua gravando pelas rotinas canônicas de abertura e fechamento", () => {
    assert.match(dialogSource, /saveTreasuryTodayOpening/);
    assert.match(dialogSource, /saveTreasuryTodayClosing/);
    assert.match(dialogSource, /justificationCode: "OTHER"/);
    assert.match(dialogSource, /justificationDetail: reason/);
  });

  it("aborta a consulta anterior ao trocar conta ou data", () => {
    assert.match(dialogSource, /new AbortController\(\)/);
    assert.match(dialogSource, /return \(\) => ac\.abort\(\)/);
    assert.match(dialogSource, /\[open, civilDate, account\.id, isSuperAdmin, today\]/);
  });

  it("descarta resposta de conta/data que já não está em edição", () => {
    assert.match(dialogSource, /requestKey !== currentKeyRef\.current/);
    assert.match(dialogSource, /if \(ac\.signal\.aborted\) return;/);
  });

  it("protege o que o usuário digitou com dirty state", () => {
    assert.match(dialogSource, /openingDirtyRef/);
    assert.match(dialogSource, /closingDirtyRef/);
    assert.match(dialogSource, /openingDirtyRef\.current = true/);
    assert.match(dialogSource, /closingDirtyRef\.current = true/);
    assert.match(dialogSource, /shouldApplyTreasuryBalanceHydration/);
    // Reset ao trocar conta/data.
    assert.match(dialogSource, /openingDirtyRef\.current = false/);
    assert.match(dialogSource, /closingDirtyRef\.current = false/);
  });

  it("separa hidratação de gravação (sem um único loading global)", () => {
    assert.match(dialogSource, /const \[hydrating, setHydrating\]/);
    assert.match(dialogSource, /const \[saving, setSaving\]/);
    assert.equal(
      /const \[loading, setLoading\]/.test(dialogSource),
      false,
      "não deve voltar a existir um loading que inutiliza o modal"
    );
  });

  it("ao salvar abertura + fechamento, reconsulta a versão pela leitura leve", () => {
    // A versão da rotina é compartilhada: gravar abertura invalida o
    // expectedVersion do fechamento — mas isso não justifica o workspace.
    const submitBlock = dialogSource.slice(
      dialogSource.indexOf("async function onSubmit")
    );
    assert.match(submitBlock, /fetchTreasuryAccountDailyBalance/);
    assert.match(submitBlock, /refreshed\.closing\.expectedVersion/);
    assert.equal(submitBlock.includes("fetchTreasuryTodayClosing"), false);
  });

  it("usa expectedVersion vindo do servidor nos dois saves", () => {
    assert.match(dialogSource, /expectedVersion: openingVersion/);
    assert.match(dialogSource, /expectedVersion: closingExpectedVersion/);
  });
});

describe("Caixa e rotas — integração da leitura leve", () => {
  it("o card do Caixa continua abrindo o modal sem processamento pesado", () => {
    const summary = readFileSync(
      join(
        repoRoot,
        "src/components/finance/treasury/TreasuryCaixaAccountsSummary.tsx"
      ),
      "utf8"
    );
    assert.match(summary, /PredictiveCashFlowBalanceCorrectDialog/);
    assert.match(summary, /onClick=\{\(\) => setEditing\(a\)\}/);
    assert.equal(summary.includes("fetchTreasury"), false);
  });

  it("a rota leve fica registrada antes de accounts/:id e com os mesmos guards", () => {
    const routes = readFileSync(
      join(repoRoot, "src/lib/treasury/treasuryRoutes.ts"),
      "utf8"
    );
    const lightIdx = routes.indexOf(
      "TREASURY_ACCOUNT_DAILY_BALANCE_PATH_SUFFIX}`"
    );
    // Com vírgula: casa a registração da rota, não menção em comentário.
    const genericIdx = routes.indexOf("`${TREASURY_ACCOUNTS_PATH}/:id`,");
    assert.ok(lightIdx > 0, "rota leve registrada");
    assert.ok(genericIdx > 0, "rota genérica de conta registrada");
    assert.ok(
      lightIdx < genericIdx,
      "a rota leve precisa vir antes de /:id para não ser capturada como id"
    );

    const block = routes.slice(lightIdx, lightIdx + 400);
    for (const guard of [
      "requireAppAuth",
      "moduleEnabled",
      "dashboardEnabled",
      "balancesEnabled",
      "viewAccounts",
    ]) {
      assert.match(block, new RegExp(guard), `guard ${guard} presente`);
    }
  });

  it("os workspaces completos continuam existindo para as telas guiadas", () => {
    const routes = readFileSync(
      join(repoRoot, "src/lib/treasury/treasuryRoutes.ts"),
      "utf8"
    );
    assert.match(routes, /TREASURY_TODAY_OPENING_PATH/);
    assert.match(routes, /TREASURY_TODAY_CLOSING_PATH/);
    assert.match(routes, /guidedOpening\.getWorkspace/);
    assert.match(routes, /guidedClosing\.getWorkspace/);
    assert.match(routes, /guidedOpening\.saveOpenings/);
    assert.match(routes, /guidedClosing\.saveFinalBalances/);

    // A rotina guiada de fechamento segue usando o workspace pesado.
    const closingPage = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryTodayClosingPage.tsx"),
      "utf8"
    );
    assert.match(closingPage, /fetchTreasuryTodayClosing/);
    const openingPage = readFileSync(
      join(repoRoot, "src/components/finance/treasury/TreasuryTodayOpeningPage.tsx"),
      "utf8"
    );
    assert.match(openingPage, /fetchTreasuryTodayOpening/);
  });
});
