/**
 * Validação ponta a ponta da operação diária simplificada da Tesouraria.
 *
 * Cobre a jornada produto, casos de negócio, performance/UX da experiência
 * simples, Decimal/timezone/concorrência, Nomus/flags/permissões.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { buildTreasuryBankMovementFingerprint } from "./domain/treasuryBankMovementFingerprint.js";
import { planTreasuryDailyClosingReopen } from "./domain/treasuryDailyClosingRules.js";
import {
  assertTreasuryDailyAccountRoutineConcurrency,
  computeTreasuryDailyDivergence,
  computeTreasuryDailyPredictedClosingBalance,
  computeTreasuryDailyRealizedClosingBalance,
  emptyTreasuryDailyAccountRoutineDayFlow,
  suggestTreasuryDailyOpeningBalance,
} from "./domain/treasuryDailyAccountRoutineRules.js";
import {
  TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS,
  TREASURY_GUIDED_DAILY_CLOSING_NEXT_STEP_HREF,
  deriveTreasuryGuidedDailyClosingSituation,
  formatTreasuryGuidedDailyClosingDivergenceMessage,
} from "./domain/treasuryGuidedDailyClosingRules.js";
import {
  TREASURY_GUIDED_DAILY_OPENING_NEXT_STEP_HREF,
  computeTreasuryGuidedDailyOpeningDifference,
} from "./domain/treasuryGuidedDailyOpeningRules.js";
import {
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS,
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS,
  assertTreasurySimpleOfxNoAutoMatch,
  buildTreasurySimpleOfxInvestigationResult,
} from "./domain/treasurySimpleOfxInvestigationRules.js";
import {
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  buildTreasurySimpleCashRiskSummary,
  computeTreasurySimpleCashRiskReserveIndicator,
  resolveTreasurySimpleCashRiskReserve,
} from "./domain/treasurySimpleCashRiskProjectionRules.js";
import {
  TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS,
  TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS,
} from "./domain/treasurySimpleTitleReviewRules.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  treasuryMoneyToCents,
} from "./treasuryMoney.js";
import { addCivilDays, todayCivilDateLocal } from "./treasuryAgendaUi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "./contracts/treasuryCivilDate.js";
import {
  TREASURY_FEATURE_FLAG_IDS,
  isTreasuryModuleEnabled,
} from "./treasuryFeatureFlags.js";
import {
  TREASURY_LEGACY_BAG_KEYS,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
import {
  TREASURY_UI_PRIMARY_SECTIONS,
  canAccessTreasuryAdvancedNavigation,
} from "./treasurySimpleNavigation.js";
import type { TreasuryAgendaDayDto } from "./contracts/treasuryDto.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const uiDir = join(repoRoot, "src/components/finance/treasury");

const CIVIL = "2026-07-28";
const NEXT_CIVIL = "2026-07-29";

function dayFlow(
  partial: Partial<ReturnType<typeof emptyTreasuryDailyAccountRoutineDayFlow>>
) {
  return { ...emptyTreasuryDailyAccountRoutineDayFlow(), ...partial };
}

function agendaDay(
  partial: Partial<TreasuryAgendaDayDto> & { civilDate: string }
): TreasuryAgendaDayDto {
  return {
    civilDate: partial.civilDate,
    accountId: null,
    accountCode: null,
    accountName: null,
    openingBalance: partial.openingBalance ?? "100000.00",
    plannedInflows: partial.plannedInflows ?? "0.00",
    confirmedInflows: "0.00",
    realizedInflows: "0.00",
    plannedOutflows: partial.plannedOutflows ?? "0.00",
    programmedOutflows: "0.00",
    realizedOutflows: "0.00",
    transfers: partial.transfers ?? "0.00",
    closingBalance: partial.closingBalance ?? "100000.00",
    riskAmount: "0.00",
    riskCode: "NONE",
    riskLabel: "Sem risco",
    inflows: partial.plannedInflows ?? "0.00",
    outflows: partial.plannedOutflows ?? "0.00",
    net: "0.00",
    realized: "0.00",
    itemCount: 0,
    items: partial.items ?? null,
    alerts: [],
  };
}

describe("treasury simple daily operation — fluxo completo (18 passos)", () => {
  it("percorre vincular → abrir → CR/CP → saldos → divergência → OFX → fechar → D+1 → projeção", () => {
    // 1) Vincular conta Nomus
    const accountsPage = readFileSync(
      join(uiDir, "TreasuryAccountsPage.tsx"),
      "utf8"
    );
    assert.match(accountsPage, /nomusBankAccountId/);
    assert.ok(
      existsSync(join(here, "adapters/treasuryOfficialTitlesAdapter.server.ts"))
    );

    // 2–3) Abrir o dia / informar saldo inicial
    const openingSuggested = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: {
        closingId: "close-prev",
        civilDate: "2026-07-27",
        observedBalance: "100000.00",
      },
    });
    assert.equal(openingSuggested.suggestedAmount, "100000.00");
    assert.equal(openingSuggested.requiresManualInput, false);
    const openingDiff = computeTreasuryGuidedDailyOpeningDifference({
      previousClosingBalance: "100000.00",
      informedOpeningBalance: "100000.00",
    });
    assert.equal(openingDiff.hasDifference, false);
    assert.equal(openingDiff.difference, "0.00");

    // 4–7) CR/CP previsto e realizado (parcial) + transferências + tarifa/juros
    const flow = dayFlow({
      plannedReceivables: "15000.00",
      settledReceivables: "10000.00",
      plannedPayables: "8000.00",
      settledPayables: "3000.00",
      realizedTransferIn: "500.00",
      realizedTransferOut: "500.00",
      realizedLocalOutflows: "25.00",
      realizedLocalInflows: "10.00",
    });

    // 8–9) Calcular saldo previsto e realizado
    const predicted = computeTreasuryDailyPredictedClosingBalance({
      openingBalance: "100000.00",
      dayFlow: flow,
    });
    assert.equal(predicted, "107000.00");

    const realized = computeTreasuryDailyRealizedClosingBalance({
      openingBalance: "100000.00",
      dayFlow: flow,
    });
    assert.equal(realized, "106985.00");

    // 10–11) Informar saldo final e encontrar divergência
    const informedClosing = "106960.00";
    const divergence = computeTreasuryDailyDivergence({
      informedClosingBankBalance: informedClosing,
      realizedClosingBalance: realized,
    });
    assert.equal(divergence, "-25.00");
    assert.equal(
      deriveTreasuryGuidedDailyClosingSituation({
        isActive: true,
        openingBalance: "100000.00",
        informedClosingBalance: informedClosing,
        divergence,
        formalClosingStatus: "OPEN",
      }),
      "HAS_DIVERGENCE"
    );
    assert.match(
      formatTreasuryGuidedDailyClosingDivergenceMessage(divergence) ?? "",
      /diferença/i
    );

    // 12–15) Importar OFX, conciliar, lançamento manual autorizado, zerar divergência
    assert.doesNotThrow(() => assertTreasurySimpleOfxNoAutoMatch(false));
    assert.throws(() => assertTreasurySimpleOfxNoAutoMatch(true));
    const ofx = buildTreasurySimpleOfxInvestigationResult({
      divergenceBefore: "-25.00",
      movements: [
        {
          id: "m-fee",
          amount: "25.00",
          reconciliationStatus: "PENDING",
          reconciledAmount: "0.00",
        },
      ],
    });
    assert.ok(ofx.remainingDivergence != null);
    assert.ok(TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS.includes("FEE"));
    assert.equal(
      TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS.FEE,
      "Registrar como tarifa"
    );
    assert.ok(
      TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.some(
        (a) => a.id === "IMPORT_STATEMENT"
      )
    );
    assert.ok(
      TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.some(
        (a) => a.id === "REGISTER_FEE"
      )
    );
    assert.ok(
      existsSync(join(here, "treasurySimpleOfxInvestigationActions.ts"))
    );
    const actions = readFileSync(
      join(here, "treasurySimpleOfxInvestigationActions.ts"),
      "utf8"
    );
    assert.match(actions, /createTreasurySimpleOfxManualFromMovement/);

    const flowAfterFee = dayFlow({
      ...flow,
      realizedLocalOutflows: "50.00",
    });
    const realizedAfter = computeTreasuryDailyRealizedClosingBalance({
      openingBalance: "100000.00",
      dayFlow: flowAfterFee,
    });
    assert.equal(
      computeTreasuryDailyDivergence({
        informedClosingBankBalance: informedClosing,
        realizedClosingBalance: realizedAfter,
      }),
      "0.00"
    );

    // 16) Fechar o dia (ressalva disponível) + reabertura
    assert.ok(
      TREASURY_GUIDED_DAILY_CLOSING_INVESTIGATION_ACTIONS.some(
        (a) => a.id === "CLOSE_WITH_CAVEAT"
      )
    );
    const reopen = planTreasuryDailyClosingReopen({
      current: {
        id: "close-today",
        companyCode: "LAZARIOS",
        civilDate: CIVIL,
        version: 1,
        status: "CLOSED",
        sourceHash: "hash-1",
      },
      reason: "Correção operacional",
    });
    assert.equal(reopen.nextVersion, 2);
    assert.equal(reopen.newStatus, "OPEN");

    // 17) Sugerir abertura do próximo dia
    const nextOpening = suggestTreasuryDailyOpeningBalance({
      accountIsActive: true,
      previousClosedPosition: {
        closingId: "close-today",
        civilDate: CIVIL,
        observedBalance: informedClosing,
      },
    });
    assert.equal(nextOpening.suggestedAmount, informedClosing);
    assert.equal(nextOpening.sourceCivilDate, CIVIL);
    assert.equal(TREASURY_GUIDED_DAILY_CLOSING_NEXT_STEP_HREF, "/finance/treasury/today");
    assert.equal(TREASURY_GUIDED_DAILY_OPENING_NEXT_STEP_HREF, "/finance/treasury/today");

    // 18) Visualizar projeção
    const summary = buildTreasurySimpleCashRiskSummary({
      days: [
        agendaDay({
          civilDate: NEXT_CIVIL,
          openingBalance: informedClosing,
          plannedInflows: "5000.00",
          plannedOutflows: "2000.00",
          closingBalance: "109960.00",
        }),
        agendaDay({
          civilDate: addCivilDays(NEXT_CIVIL, 1),
          openingBalance: "109960.00",
          plannedOutflows: "200000.00",
          closingBalance: "-90040.00",
        }),
      ],
      minimumReserve: resolveTreasurySimpleCashRiskReserve([
        {
          isActive: true,
          includeInConsolidated: true,
          minimumBalance: "100000.00",
        },
      ]),
      scenario: "PROBABLE",
    });
    assert.equal(summary.firstNegativeDate, addCivilDays(NEXT_CIVIL, 1));
    assert.equal(summary.reserve?.minimumReserve, "100000.00");
    assert.match(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.CONTRACTUAL.description,
      /datas oficiais/i
    );
  });
});

describe("treasury simple daily operation — casos de negócio", () => {
  it("parcial, vencido, conta não vinculada, tarifa/juros, OFX duplicado, transferência neutra, reserva zero", () => {
    assert.equal(
      TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS.PARTIALLY_RECEIVED,
      "Parcialmente recebido"
    );
    assert.equal(
      TREASURY_SIMPLE_PAYABLE_CATEGORY_LABELS.PARTIALLY_PAID,
      "Parcialmente pago"
    );
    assert.equal(TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS.OVERDUE, "Vencido");
    assert.equal(
      TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS.UNLINKED_ACCOUNT,
      "Conta não vinculada"
    );

    const fp1 = buildTreasuryBankMovementFingerprint({
      accountId: "acc-1",
      fitId: "FIT-999",
      postedCivilDate: CIVIL,
      direction: "DEBIT",
      amount: "25.00",
      description: "TARIFA",
    });
    const fp2 = buildTreasuryBankMovementFingerprint({
      accountId: "acc-1",
      fitId: "FIT-999",
      postedCivilDate: CIVIL,
      direction: "DEBIT",
      amount: "25.00",
      description: "TARIFA DUPLICADA",
    });
    assert.equal(fp1, fp2);

    assert.ok(TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTIONS.includes("INTEREST"));
    assert.equal(
      TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS.INTEREST,
      "Registrar como juros"
    );

    assert.equal(
      addTreasuryMoney("1500.00", normalizeTreasuryMoneyString("-1500.00")),
      "0.00"
    );

    const noReserve = computeTreasurySimpleCashRiskReserveIndicator({
      projectedBalance: "5000.00",
      minimumReserve: "0.00",
    });
    assert.equal(noReserve.surplusPercent, null);
    assert.equal(noReserve.kind, "NO_RESERVE");
  });

  it("título cancelado sem jargão técnico; estorno/reabertura versionada", () => {
    const labels = Object.values(TREASURY_SIMPLE_RECEIVABLE_CATEGORY_LABELS).join(
      " "
    );
    assert.doesNotMatch(labels, /\bCANCELLED\b/);
    const reopen = planTreasuryDailyClosingReopen({
      current: {
        id: "c1",
        companyCode: "LAZARIOS",
        civilDate: CIVIL,
        version: 3,
        status: "CLOSED",
        sourceHash: "h",
      },
      reason: "Estorno operacional pós-fechamento",
    });
    assert.equal(reopen.nextVersion, 4);
    assert.equal(reopen.previousStatus, "REOPENED");
  });
});

describe("treasury simple daily operation — performance e payload", () => {
  it("Hoje usa um único fetch agregado; listas CR/CP paginam; projeção reusa agenda/fila", () => {
    const todayPage = readFileSync(join(uiDir, "TreasuryTodayPage.tsx"), "utf8");
    assert.match(todayPage, /fetchTreasuryToday/);
    assert.doesNotMatch(todayPage, /fetchTreasuryAccounts/);
    assert.doesNotMatch(todayPage, /fetchTreasuryReceivables/);
    assert.doesNotMatch(todayPage, /fetchTreasuryPayables/);
    assert.doesNotMatch(todayPage, /fetchTreasuryAgenda/);

    const todayService = readFileSync(
      join(here, "services/treasuryGuidedTodayService.server.ts"),
      "utf8"
    );
    assert.match(todayService, /Promise\.all/);
    assert.match(todayService, /dashboard/);
    assert.match(todayService, /closingPreview/);

    const receivablesPage = readFileSync(
      join(uiDir, "TreasurySimpleReceivablesReviewPage.tsx"),
      "utf8"
    );
    assert.match(receivablesPage, /pageSize:\s*50/);

    const projectionPage = readFileSync(
      join(uiDir, "TreasurySimpleCashRiskProjectionPage.tsx"),
      "utf8"
    );
    assert.match(projectionPage, /fetchTreasuryAgenda/);
    assert.doesNotMatch(projectionPage, /runTreasuryProjectionEngine/);
    assert.doesNotMatch(projectionPage, /projections\.calculate/);

    assert.ok(
      existsSync(
        join(here, "services/treasuryProjectionRecalcQueueService.server.ts")
      )
    );
  });
});

describe("treasury simple daily operation — UX simples", () => {
  it("linguagem leiga, estados loading/vazio/erro, mobile e mensagens humanas", () => {
    assert.deepEqual(
      TREASURY_UI_PRIMARY_SECTIONS.map((s) => s.label),
      ["Contas", "Caixa"]
    );

    const todayPanel = readFileSync(join(uiDir, "TreasuryTodayPanel.tsx"), "utf8");
    assert.match(todayPanel, /treasury-today-loading/);
    assert.match(todayPanel, /treasury-today-empty/);
    assert.match(todayPanel, /treasury-today-error/);
    assert.match(todayPanel, /treasury-today-denied/);
    assert.match(todayPanel, /aria-label|aria-labelledby/);
    assert.match(todayPanel, /sm:flex-row|grid-cols-1/);
    assert.doesNotMatch(todayPanel, /\bCONTRACTUAL\b|\bPROBABLE\b|\bCONFIRMED\b/);

    assert.match(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.CONTRACTUAL.description,
      /datas oficiais/i
    );
    assert.match(
      TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS.PROBABLE.description,
      /expectativas informadas/i
    );

    for (const file of [
      "TreasuryTodayPage.tsx",
      "TreasuryTodayOpeningPage.tsx",
      "TreasuryTodayClosingPage.tsx",
      "TreasurySimpleReceivablesReviewPage.tsx",
      "TreasurySimplePayablesReviewPage.tsx",
      "TreasurySimpleOfxInvestigationPage.tsx",
      "TreasuryOfxImportDialog.tsx",
    ]) {
      const src = readFileSync(join(uiDir, file), "utf8");
      assert.doesNotMatch(
        src,
        /buildFinanceTabLoadError\(\s*err\s*,/,
        `${file} ainda passa err como 1º argumento`
      );
    }
  });
});

describe("treasury simple daily operation — Nomus, permissões, flags, Decimal, timezone, concorrência", () => {
  it("Nomus read-only; flags opt-in; permissões; Decimal; timezone SP; concorrência", () => {
    const adapter = readFileSync(
      join(here, "adapters/treasuryOfficialTitlesAdapter.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(adapter, /\.(create|update|upsert|delete)\s*\(/);

    assert.equal(isTreasuryModuleEnabled({}), false);
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.dashboard.enabled"));
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.projection.enabled"));
    assert.ok(TREASURY_FEATURE_FLAG_IDS.includes("treasury.ofxImport.enabled"));

    assert.equal(TREASURY_RESOURCE_KEYS.root, "finance.treasury");
    assert.ok(
      (TREASURY_LEGACY_BAG_KEYS as readonly string[]).includes(
        "finance.treasury.view"
      )
    );
    assert.equal(canAccessTreasuryAdvancedNavigation("ADMIN"), true);
    assert.equal(canAccessTreasuryAdvancedNavigation("SELLER"), false);

    assert.equal(treasuryMoneyToCents("10.10"), 1010n);
    assert.equal(compareTreasuryMoney(addTreasuryMoney("0.10", "0.20"), "0.30"), 0);

    const local = todayCivilDateLocal();
    const sp = todayTreasuryCivilDateInSaoPaulo();
    assert.match(local, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(local, sp);
    assert.equal(addCivilDays("2026-12-31", 1), "2027-01-01");

    assert.throws(() =>
      assertTreasuryDailyAccountRoutineConcurrency({
        expectedVersion: 1,
        currentVersion: 2,
      })
    );
    assert.doesNotThrow(() =>
      assertTreasuryDailyAccountRoutineConcurrency({
        expectedVersion: 2,
        currentVersion: 2,
      })
    );
  });
});
