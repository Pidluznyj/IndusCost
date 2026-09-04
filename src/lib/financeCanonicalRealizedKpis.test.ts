/**
 * Autoridade canônica de Recebido / Pago.
 *
 * Motor: buildOfficialAccountsReceivableRulesResult / buildOfficialAccountsPayableRulesResult
 * Date field AR: settlementDate
 * Date field AP: resolveFinanceApEffectivePaymentDate (política DEFAULTS)
 * Carteira (em aberto, vencido, aging): dueDate — sem mudança.
 *
 * Paridade (mesmo ano, sem mês, filtros gerenciais compatíveis):
 *   AR_CANONICAL_REALIZED === CASH_FLOW_AR_REALIZED === AR_PAGE_RECEIVED
 *   AP_CANONICAL_REALIZED === CASH_FLOW_AP_REALIZED === AP_PAGE_PAID
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOfficialAccountsReceivableDashboard,
  resolveOfficialArCashFlowExecutiveMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  buildOfficialAccountsPayableDashboard,
  resolveOfficialApCashFlowExecutiveMetrics,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceArPrismaWhere,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceApPrismaWhere,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  parseFinanceCashFlowDashboardFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "./financeInternalGroupExclusions.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import { resolveFinanceCanonicalRealizedLoadWindow } from "./financeCanonicalRealizedPeriod.js";

const REF = new Date(2026, 8, 4, 12, 0, 0, 0);
const SYNCED = new Date("2026-09-04T12:00:00.000Z");

const LAZARIOS_CNPJ = FINANCE_INTERNAL_GROUP_COMPANIES[0]!.cnpj;

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: null,
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    comments: null,
    competenceDate: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: null,
    nomusStatus: true,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    ...partial,
  };
}

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 15),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    description: null,
    nomusStatus: true,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    ...partial,
  };
}

function settledAr(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">) {
  const amountReceived = partial.amountReceived ?? 1000;
  return arRow({
    amountReceivable: partial.amountReceivable ?? amountReceived,
    amountReceived,
    balanceReceivable: 0,
    ...partial,
  });
}

function settledAp(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">) {
  const amountPaid = partial.amountPaid ?? 1000;
  return apRow({
    amountPayable: partial.amountPayable ?? amountPaid,
    amountPaid,
    balancePayable: 0,
    ...partial,
  });
}

function arPageReceived(rows: FinanceArDashboardRow[], filters: { year?: number; month?: number; companyName?: string; personName?: string; paymentMethodName?: string; bankAccountName?: string }) {
  return buildOfficialAccountsReceivableDashboard({
    rows,
    filters: { status: "all", ...filters },
    referenceDate: REF,
    syncCutoff: null,
  }).metrics.receivedInAppliedPeriod;
}

function apPagePaid(rows: FinanceApDashboardRow[], filters: { year?: number; month?: number; companyName?: string; personName?: string; paymentMethodName?: string; bankAccountName?: string }) {
  return buildOfficialAccountsPayableDashboard({
    rows,
    filters: { status: "all", ...filters },
    referenceDate: REF,
    syncCutoff: null,
  }).metrics.paidInAppliedPeriod;
}

function cfReceived(arRows: FinanceCashFlowArRow[], year = 2026) {
  return buildFinanceCashFlowDashboard(
    arRows,
    [],
    parseFinanceCashFlowDashboardFilters({ year: String(year) }),
    REF
  ).executiveSummary.receivable.receivedYtd;
}

function cfPaid(apRows: FinanceCashFlowApRow[], year = 2026) {
  return buildFinanceCashFlowDashboard(
    [],
    apRows,
    parseFinanceCashFlowDashboardFilters({ year: String(year) }),
    REF
  ).executiveSummary.payable.paidYtd;
}

describe("finance canonical realized KPIs", () => {
  describe("AR — Recebido por settlementDate", () => {
    it("1. CROSS-YEAR: dueDate 2025 + settlementDate 2026 entra em Recebido 2026", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2025, 11, 20),
          settlementDate: new Date(2026, 0, 10),
          amountReceived: 769.45,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 769.45);
    });

    it("2. INVERSO: dueDate 2026 + settlementDate 2025 não entra em Recebido 2026", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 0, 10),
          settlementDate: new Date(2025, 11, 29),
          amountReceived: 500,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 0);
    });

    it("3. MESMO ANO: dueDate 2026 + settlementDate 2026 entra", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 2, 10),
          settlementDate: new Date(2026, 2, 15),
          amountReceived: 1100,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 1100);
    });

    it("4. MONTH FILTER: agosto entra, setembro não", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 7, 1),
          settlementDate: new Date(2026, 7, 15),
          amountReceived: 800,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 8, 1),
          settlementDate: new Date(2026, 8, 2),
          amountReceived: 900,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026, month: 8 }), 800);
      assert.equal(arPageReceived(rows, { year: 2026, month: 9 }), 900);
    });

    it("5. YTD: ano atual sem mês cobre 01/01 até a data-base", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 0, 5),
          settlementDate: new Date(2026, 0, 5),
          amountReceived: 100,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 8, 4),
          settlementDate: new Date(2026, 8, 4),
          amountReceived: 200,
        }),
      ];
      const payload = buildOfficialAccountsReceivableDashboard({
        rows,
        filters: { status: "all", year: 2026 },
        referenceDate: REF,
        syncCutoff: null,
      });
      assert.equal(payload.metrics.receivedInAppliedPeriodKind, "ytd");
      assert.equal(payload.metrics.receivedInAppliedPeriod, 300);
      assert.equal(payload.metrics.receivedInAppliedPeriod, payload.metrics.receivedYtd);
    });

    it("6. FUTURO: settlementDate posterior à data-base não entra no YTD", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 9, 1),
          settlementDate: new Date(2026, 9, 1),
          amountReceived: 400,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 0);
    });

    it("7. INTERCOMPANY: cliente do grupo econômico é excluído pela regra canônica", () => {
      const rows = [
        settledAr({
          externalId: 1,
          personName: "Lazarios Comercio de Plasticos LTDA",
          personCnpj: LAZARIOS_CNPJ,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
          amountReceived: 9999,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
          amountReceived: 150,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 150);
    });

    it("8. GHOST: continua excluído", () => {
      const rows = [
        arRow({
          externalId: 1,
          amountReceivable: 800,
          amountReceived: 0,
          balanceReceivable: 0,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
          amountReceived: 80,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 80);
    });

    it("9. STALE: continua excluído", () => {
      const cutoff = buildNomusArReportSyncCutoff(SYNCED);
      const staleAt = new Date(SYNCED.getTime() - 3 * 60 * 60 * 1000);
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
          amountReceived: 700,
          syncedAt: staleAt,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 2, 1),
          settlementDate: new Date(2026, 2, 10),
          amountReceived: 70,
        }),
      ];
      const received = buildOfficialAccountsReceivableDashboard({
        rows,
        filters: { status: "all", year: 2026 },
        referenceDate: REF,
        syncCutoff: cutoff,
      }).metrics.receivedInAppliedPeriod;
      assert.equal(received, 70);
    });

    it("10. PRÉ-NF / DEDUP: não reintroduz duplicidade", () => {
      const due = new Date(2026, 3, 10);
      const settlement = new Date(2026, 3, 12);
      const rows = [
        settledAr({
          externalId: 1,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
          dueDate: due,
          settlementDate: settlement,
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
        settledAr({
          externalId: 2,
          sourceInvoiceId: 99,
          sourceInvoiceNumber: "NF-99",
          dueDate: due,
          settlementDate: settlement,
          amountReceivable: 5000,
          amountReceived: 5000,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 5000);
    });

    it("11. SEM SETTLEMENT DATE: amountReceived sozinho não vira recebido do período", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2026, 2, 1),
          settlementDate: null,
          amountReceived: 400,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 0);
    });

    it("12. PARCIAL: soma somente o valor efetivamente recebido", () => {
      const rows = [
        arRow({
          externalId: 1,
          dueDate: new Date(2025, 11, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceivable: 1000,
          amountReceived: 350,
          balanceReceivable: 650,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026 }), 350);
    });

    it("13. FILTRO CLIENTE", () => {
      const rows = [
        settledAr({
          externalId: 1,
          personName: "Cliente Alfa",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 200,
        }),
        settledAr({
          externalId: 2,
          personName: "Cliente Beta",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 300,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026, personName: "Alfa" }), 200);
    });

    it("14. FILTRO EMPRESA", () => {
      const rows = [
        settledAr({
          externalId: 1,
          companyName: "Koppetel",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 120,
        }),
        settledAr({
          externalId: 2,
          companyName: "Outra",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 80,
        }),
      ];
      assert.equal(arPageReceived(rows, { year: 2026, companyName: "Koppetel" }), 120);
    });

    it("15. FILTRO MEIO DE PAGAMENTO / CONTA", () => {
      const rows = [
        settledAr({
          externalId: 1,
          paymentMethodName: "PIX",
          bankAccountName: "Itaú",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 60,
        }),
        settledAr({
          externalId: 2,
          paymentMethodName: "Boleto",
          bankAccountName: "Bradesco",
          dueDate: new Date(2026, 1, 1),
          settlementDate: new Date(2026, 1, 10),
          amountReceived: 90,
        }),
      ];
      assert.equal(
        arPageReceived(rows, { year: 2026, paymentMethodName: "PIX", bankAccountName: "Itaú" }),
        60
      );
    });

    it("25. defeito atual: soma os dois títulos (vence 2025 recebe 2026 + vence e recebe 2026)", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2025, 11, 20),
          settlementDate: new Date(2026, 0, 10),
          amountReceived: 769.45,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 2, 10),
          settlementDate: new Date(2026, 2, 15),
          amountReceived: 10480.1,
        }),
      ];
      const received = arPageReceived(rows, { year: 2026 });
      assert.equal(received, 11249.55);
      const dueDateOnly = buildOfficialAccountsReceivableDashboard({
        rows,
        filters: { status: "all", year: 2026 },
        referenceDate: REF,
        syncCutoff: null,
      }).cards.totalReceivedAmount;
      assert.equal(dueDateOnly, 10480.1, "legado da carteira por vencimento não é o KPI Recebido");
      assert.notEqual(received, dueDateOnly);
    });

    it("26. dueDate continua autoridade da carteira (aberto, vencido, vence hoje)", () => {
      const rows = [
        arRow({
          externalId: 1,
          dueDate: new Date(2026, 8, 1),
          balanceReceivable: 400,
          amountReceivable: 400,
        }),
        arRow({
          externalId: 2,
          dueDate: new Date(2026, 8, 4),
          balanceReceivable: 250,
          amountReceivable: 250,
        }),
        arRow({
          externalId: 3,
          dueDate: new Date(2025, 11, 1),
          balanceReceivable: 900,
          amountReceivable: 900,
        }),
      ];
      const payload = buildOfficialAccountsReceivableDashboard({
        rows,
        filters: { status: "all", year: 2026 },
        referenceDate: REF,
        syncCutoff: null,
      });
      assert.equal(payload.metrics.openAmount, 650);
      assert.equal(payload.cards.overdueAmount, 400);
      assert.equal(payload.cards.dueTodayAmount, 250);
      assert.equal(payload.cards.totalAmountReceivable, 650);
    });
  });

  describe("AP — Pago por data efetiva canônica", () => {
    it("16. dueDate 2025 + pagamento efetivo 2026 entra em Pago 2026", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2025, 11, 20),
          paymentDate: new Date(2026, 0, 10),
          amountPaid: 400,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026 }), 400);
    });

    it("17. dueDate 2026 + pagamento efetivo 2025 fica fora de Pago 2026", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2026, 0, 10),
          paymentDate: new Date(2025, 11, 15),
          amountPaid: 400,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026 }), 0);
    });

    it("18. filtro mensal por data efetiva", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2026, 7, 1),
          paymentDate: new Date(2026, 7, 20),
          amountPaid: 220,
        }),
        settledAp({
          externalId: 2,
          dueDate: new Date(2026, 8, 1),
          paymentDate: new Date(2026, 8, 2),
          amountPaid: 330,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026, month: 8 }), 220);
    });

    it("19. YTD AP: ano atual sem mês", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2026, 0, 5),
          paymentDate: new Date(2026, 0, 5),
          amountPaid: 50,
        }),
        settledAp({
          externalId: 2,
          dueDate: new Date(2026, 10, 1),
          paymentDate: new Date(2026, 10, 1),
          amountPaid: 60,
        }),
      ];
      const payload = buildOfficialAccountsPayableDashboard({
        rows,
        filters: { status: "all", year: 2026 },
        referenceDate: REF,
        syncCutoff: null,
      });
      assert.equal(payload.metrics.paidInAppliedPeriodKind, "ytd");
      assert.equal(payload.metrics.paidInAppliedPeriod, 50);
      assert.equal(payload.metrics.paidInAppliedPeriod, payload.metrics.paidYtd);
    });

    it("20. PARCIAL AP", () => {
      const rows = [
        apRow({
          externalId: 1,
          dueDate: new Date(2025, 11, 1),
          paymentDate: new Date(2026, 1, 10),
          amountPayable: 1000,
          amountPaid: 275,
          balancePayable: 725,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026 }), 275);
    });

    it("21. INTERCOMPANY AP conforme regra oficial (pagador e credor do grupo)", () => {
      const rows = [
        settledAp({
          externalId: 1,
          companyName: "KOPPETEL",
          personName: "Lazarios Comercio de Plasticos LTDA",
          personCnpj: LAZARIOS_CNPJ,
          dueDate: new Date(2026, 2, 1),
          paymentDate: new Date(2026, 2, 10),
          amountPaid: 8888,
        }),
        settledAp({
          externalId: 2,
          dueDate: new Date(2026, 2, 1),
          paymentDate: new Date(2026, 2, 10),
          amountPaid: 110,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026 }), 110);
    });

    it("22. sem data efetiva válida não inventa realizado no período pedido", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2025, 11, 10),
          paymentDate: null,
          settlementDate: null,
          amountPaid: 600,
        }),
      ];
      assert.equal(apPagePaid(rows, { year: 2026 }), 0);
    });
  });

  describe("paridade entre motores", () => {
    it("23. AR_CANONICAL === CASH_FLOW_AR === AR_PAGE para o mesmo ano", () => {
      const rows = [
        settledAr({
          externalId: 1,
          dueDate: new Date(2025, 11, 20),
          settlementDate: new Date(2026, 0, 10),
          amountReceived: 769.45,
        }),
        settledAr({
          externalId: 2,
          dueDate: new Date(2026, 2, 10),
          settlementDate: new Date(2026, 2, 15),
          amountReceived: 10480.1,
        }),
      ];
      const filters = { status: "all" as const, year: 2026 };
      const page = arPageReceived(rows, filters);
      const canonical = resolveOfficialArCashFlowExecutiveMetrics(
        rows,
        filters,
        REF,
        null,
        2026
      ).receivedYtd;
      const cashFlow = cfReceived(rows as FinanceCashFlowArRow[], 2026);
      assert.equal(page, canonical);
      assert.equal(canonical, cashFlow);
      assert.equal(page, 11249.55);
    });

    it("24. AP_CANONICAL === CASH_FLOW_AP === AP_PAGE para o mesmo ano", () => {
      const rows = [
        settledAp({
          externalId: 1,
          dueDate: new Date(2025, 11, 20),
          paymentDate: new Date(2026, 0, 10),
          amountPaid: 400,
        }),
        settledAp({
          externalId: 2,
          dueDate: new Date(2026, 2, 10),
          paymentDate: new Date(2026, 2, 15),
          amountPaid: 250,
        }),
      ];
      const filters = { status: "all" as const, year: 2026 };
      const page = apPagePaid(rows, filters);
      const canonical = resolveOfficialApCashFlowExecutiveMetrics(
        rows,
        filters,
        REF,
        null,
        2026
      ).paidYtd;
      const cashFlow = cfPaid(rows as FinanceCashFlowApRow[], 2026);
      assert.equal(page, canonical);
      assert.equal(canonical, cashFlow);
      assert.equal(page, 650);
    });
  });

  describe("carga Prisma — janela de movimento além do vencimento", () => {
    it("AR admite settlementDate no ano mesmo com vencimento fora", () => {
      const window = resolveFinanceCanonicalRealizedLoadWindow(2026);
      const where = buildFinanceArPrismaWhere(
        { status: "all", year: 2026 },
        REF,
        null,
        { settlementWindow: window }
      );
      const serialized = JSON.stringify(where);
      assert.match(serialized, /settlementDate/);
      assert.match(serialized, /dueDate/);
    });

    it("AP admite paymentDate/settlementDate no ano mesmo com vencimento fora", () => {
      const window = resolveFinanceCanonicalRealizedLoadWindow(2026);
      const where = buildFinanceApPrismaWhere(
        { status: "all", year: 2026 },
        null,
        { paymentWindow: window }
      );
      const serialized = JSON.stringify(where);
      assert.match(serialized, /paymentDate/);
      assert.match(serialized, /settlementDate/);
      assert.match(serialized, /dueDate/);
    });
  });
});
