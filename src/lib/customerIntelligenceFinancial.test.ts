import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceFinancial,
  filterCustomerIntelligenceArRowsByCustomer,
} from "./customerIntelligenceFinancial.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import { buildCustomerIntelligenceReport } from "./customerIntelligence.js";
import { createDefaultCustomerIntelligenceFilters } from "./customerIntelligenceUtils.js";
import type { CustomerIntelligenceBuildInput } from "./customerIntelligenceTypes.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const NOW = new Date("2026-06-17T12:00:00.000Z");
const CUSTOMER_CNPJ = "12.345.678/0001-90";
const CUSTOMER_CNPJ_ALT = "12345678000190";

function syncCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: overrides.externalId ?? 1,
    companyName: "KOPPETEL",
    personName: "Cliente Teste LTDA",
    personCnpj: CUSTOMER_CNPJ,
    description: "Pedido teste",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 500,
    sourceInvoiceNumber: "NF-500",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

describe("buildCustomerIntelligenceFinancial", () => {
  it("cliente com AR aberto aparece", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [arRow({ externalId: 1, balanceReceivable: 2500 })],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.linkedByCnpj, true);
    assert.equal(financial.receivableOpenAmount, 2500);
    assert.equal(financial.openTitlesCount, 1);
    assert.equal(financial.openTitles.length, 1);
  });

  it("cliente com AR vencido com NF aparece em vencido", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 1,
          dueDate: new Date(2026, 5, 1),
          balanceReceivable: 800,
          sourceInvoiceId: 10,
          sourceInvoiceNumber: "NF-10",
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.overdueAmount, 800);
    assert.equal(financial.overdueTitlesCount, 1);
    assert.equal(financial.overdueTitles[0]!.externalId, 1);
    assert.equal(financial.financialStatus, "overdue");
    assert.ok(financial.riskAlert);
  });

  it("cliente com AR vencido sem NF não aparece em vencido", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 2,
          dueDate: new Date(2026, 5, 1),
          balanceReceivable: 900,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.overdueAmount, 0);
    assert.equal(financial.overdueTitlesCount, 0);
    assert.equal(financial.overdueTitles.length, 0);
    assert.ok(financial.dataQuality.overdueWithoutFiscalExcludedCount >= 1);
  });

  it("cliente com AR futuro sem NF aparece como previsão/a vencer", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 3,
          dueDate: new Date(2026, 7, 15),
          balanceReceivable: 1200,
          sourceInvoiceId: null,
          sourceInvoiceNumber: null,
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.upcomingAmount, 1200);
    assert.equal(financial.openTitlesCount, 1);
    assert.equal(financial.openTitles[0]!.isForecast, true);
    assert.equal(financial.overdueAmount, 0);
  });

  it("AR stale não entra", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 4,
          syncedAt: STALE_SYNC,
          balanceReceivable: 5000,
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.receivableOpenAmount, 0);
    assert.equal(financial.dataQuality.staleExcludedCount, 1);
  });

  it("AR recebido não entra como aberto", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 5,
          balanceReceivable: 0,
          amountReceived: 1000,
          settlementDate: new Date(2026, 5, 1),
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.receivableOpenAmount, 0);
    assert.equal(financial.openTitlesCount, 0);
    assert.ok(financial.paymentHistory.length >= 1);
  });

  it("aging soma com total vencido", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: CUSTOMER_CNPJ,
      arRows: [
        arRow({
          externalId: 6,
          dueDate: new Date(2026, 5, 5),
          balanceReceivable: 300,
        }),
        arRow({
          externalId: 7,
          dueDate: new Date(2026, 4, 1),
          balanceReceivable: 700,
        }),
      ],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    const agingOverdue = financial.agingBuckets
      .filter((b) => b.key.startsWith("overdue"))
      .reduce((acc, b) => acc + b.amount, 0);

    assert.equal(financial.overdueAmount, 1000);
    assert.equal(agingOverdue, 1000);
  });

  it("CNPJ normalizado vincula corretamente", () => {
    const rows = [
      arRow({ externalId: 1, personCnpj: "12.345.678/0001-90" }),
      arRow({ externalId: 2, personCnpj: "99.999.999/0001-99", balanceReceivable: 5000 }),
    ];
    const filtered = filterCustomerIntelligenceArRowsByCustomer(rows, CUSTOMER_CNPJ_ALT);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 1);
  });

  it("sem CNPJ retorna warning", () => {
    const financial = buildCustomerIntelligenceFinancial({
      customerTaxId: "",
      arRows: [arRow()],
      arSyncCutoff: syncCutoff(),
      referenceDate: NOW,
    });

    assert.equal(financial.linkedByCnpj, false);
    assert.equal(financial.financialStatus, "unlinked");
    assert.ok(
      financial.dataQuality.warnings.some((w) => w.includes("CNPJ"))
    );
  });
});

describe("buildCustomerIntelligenceReport — financeiro integrado", () => {
  function buildInput(
    overrides: Partial<CustomerIntelligenceBuildInput> = {}
  ): CustomerIntelligenceBuildInput {
    return {
      customer: {
        id: "11111111-1111-4111-8111-111111111111",
        companyName: "Cliente Teste LTDA",
        tradeName: "Cliente Teste",
        taxId: CUSTOMER_CNPJ,
        city: "Curitiba",
        state: "PR",
        accountOwner: "Maria",
        createdAt: new Date("2024-01-10T00:00:00.000Z"),
      },
      orders: [],
      activities: [],
      arRows: [],
      arSyncCutoff: null,
      arLinkedByCnpj: true,
      filters: createDefaultCustomerIntelligenceFilters(NOW),
      now: NOW,
      ...overrides,
    };
  }

  it("integração report expõe payload financial completo", () => {
    const report = buildCustomerIntelligenceReport(
      buildInput({
        arRows: [
          arRow({
            externalId: 10,
            dueDate: new Date(2026, 5, 1),
            balanceReceivable: 1500,
          }),
        ],
        arSyncCutoff: syncCutoff(),
      })
    );

    assert.ok(Array.isArray(report.financial.agingBuckets));
    assert.ok(Array.isArray(report.financial.openTitles));
    assert.equal(report.financial.overdueAmount, 1500);
    assert.ok(report.financial.dataQuality.fiscalBackingNote.includes("vencidos sem NF"));
  });
});
