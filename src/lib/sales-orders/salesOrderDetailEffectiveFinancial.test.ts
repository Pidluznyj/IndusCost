/**
 * FIN-06 — contrato e regressão do financeiro do Detalhe do Pedido.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import {
  fixtureCut10000Doc9000,
  fixtureOrder10000Base,
  fixturePartialWithDoc9000Awaiting,
  fixturePartialWithDoc9000Proven,
} from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.fixtures.js";
import {
  buildSalesOrderDetailFinancialFromAudit,
  mapEffectiveScheduleToDetailFinancial,
} from "./salesOrderDetailEffectiveFinancial.js";
import type { OrderFullAuditPayload } from "@/src/lib/finance/orderFullAuditClient.js";

const EMPTY_TOTALS = {
  totalAmount: 0,
  openAmount: 0,
  receivedAmount: 0,
  overdueCount: 0,
  nextDueDate: null as string | null,
  maxAmount: 0,
  totalCount: 0,
};

function project(fixture: ReturnType<typeof fixtureCut10000Doc9000>) {
  const schedule = buildSalesOrderEffectiveFinancialSchedule(fixture);
  return mapEffectiveScheduleToDetailFinancial(
    schedule,
    [],
    [],
    EMPTY_TOTALS,
    new Date(2026, 6, 17)
  );
}

describe("FIN-06 — contrato Detalhe do Pedido", () => {
  it("expõe engine e campos separados do contrato", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    assert.equal(financial.engine, "salesOrderEffectiveFinancialSchedule");
    assert.ok(Array.isArray(financial.realReceivables));
    assert.ok(Array.isArray(financial.documentSchedule));
    assert.ok(Array.isArray(financial.plannedReceivables));
    assert.ok(Array.isArray(financial.supersededPlannedReceivables));
    assert.ok(financial.coverageSummary);
    assert.equal(typeof financial.cutAmount, "number");
    assert.equal(typeof financial.canceledAmount, "number");
    assert.equal(typeof financial.unresolvedAmount, "number");
  });

  it("corte R$ 10.000 / Doc R$ 9.000 → agenda 9.000, residual 0, corte 1.000", () => {
    const financial = project(fixtureCut10000Doc9000());
    assert.equal(financial.coverageSummary.realOrDocumentAgendaTotal, 9000);
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 0);
    assert.equal(financial.plannedTotals.applicableExpected, 0);
    assert.equal(financial.cutAmount, 1000);
    assert.equal(financial.plannedReceivables.length, 0);
    assert.ok(
      financial.supersededPlannedReceivables.every((p) => p.statusLabel === "Substituída")
    );
  });

  it("parcial R$ 10.000 / Doc R$ 9.000 → residual 1.000 nas datas originais", () => {
    const financial = project(fixturePartialWithDoc9000Awaiting());
    assert.equal(financial.coverageSummary.realOrDocumentAgendaTotal, 9000);
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 1000);
    assert.equal(financial.plannedTotals.applicableExpected, 1000);
    assert.equal(financial.cutAmount, 0);
    const residualSum = financial.plannedReceivables.reduce(
      (s, p) => s + p.openAmount,
      0
    );
    assert.equal(Math.round(residualSum * 100) / 100, 1000);
    assert.ok(
      financial.plannedReceivables.every(
        (p) => p.dueDate === "2026-08-01" || p.dueDate === "2026-09-01"
      )
    );
    assert.ok(
      financial.documentSchedule.some(
        (d) => d.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE"
      )
    );
  });

  it("previsão substituída nunca fica como Vencido", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    const allowed = new Set(["Substituída", "Parcialmente substituída"]);
    for (const p of financial.supersededPlannedReceivables) {
      assert.ok(allowed.has(p.statusLabel), `status inesperado: ${p.statusLabel}`);
      assert.notEqual(p.statusLabel, "Vencido");
      assert.notEqual(p.statusLabel, "Vencida");
      assert.equal(p.openAmount, 0);
    }
  });

  it("próximo vencimento usa só entradas efetivas (ignora substituída)", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    // Residual nas datas do Pedido 2026-08 / 2026-09; doc comprovado 2026-07-20.
    assert.equal(financial.effectiveNextDueDate, "2026-07-20");
  });

  it("diff CR×Documento não vira Pedido−CR no residual", () => {
    const fixture = fixturePartialWithDoc9000Awaiting();
    fixture.realReceivables = [
      {
        externalId: 1,
        sourceInvoiceId: 9999, // NF diferente — não substitui o doc 5001
        dueDate: "2026-07-01",
        amountReceivable: "8500",
        balanceReceivable: "8500",
      },
    ];
    fixture.items = [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000",
        status: 3,
        orderedQuantity: 10,
        fulfilledQuantity: 9,
        documentAllocations: [
          { allocationKey: "a", allocatedByOrderPrice: "9000" },
        ],
        crAllocations: [
          {
            allocationKey: "cr1",
            amountReceivable: "8500",
            balanceReceivable: "8500",
          },
        ],
      },
    ];
    const financial = project(fixture);
    // Residual comercial continua 1.000 (itens), não 10.000−8.500=1.500.
    // FIN-13: Doc + CR (NF distinta) ocupam as 2 posições → residual pode ficar órfão na agenda,
    // mas a base comercial de itens permanece 1.000.
    assert.equal(financial.coverageSummary.itemActiveResidualTotal, 1000);
    assert.notEqual(financial.coverageSummary.itemActiveResidualTotal, 1500);
  });
});

describe("FIN-06 — build a partir de audit mínimo", () => {
  it("item com corte no audit → cutAmount e residual zero", () => {
    const audit = {
      ok: true as const,
      salesOrderId: "so-1",
      orderCode: "PD 01000",
      runId: null,
      runMeta: { runId: null, orderToCashFinishedAt: null },
      summary: {
        activeOrderValue: 10000,
        originalOrderValue: 10000,
      },
      salesOrder: {
        orderCode: "PD 01000",
        paymentTerms: "30/60",
        paymentMethod: null,
        issueDate: "2026-06-01",
      },
      items: [
        {
          salesOrderItemId: "item-1",
          totalNetValue: 10000,
          activeValue: 10000,
          quantity: 10,
          unitPrice: 1000,
          nomusItemStatusRaw: "5",
          nomusItemStatusNormalized: "FULFILLED_WITH_CUT",
          nomusIsCut: true,
          nomusIsCanceled: false,
          nomusIsStale: false,
          nomusQuantityFulfilled: 9,
          linkedReceivableExternalIds: [],
          linkedStockDocumentExternalIds: [1],
          linkedNfeExternalIds: [],
        },
      ],
      receivables: [],
      receivablesTotal: EMPTY_TOTALS,
      plannedReceivables: [
        {
          key: "p1",
          orderCode: "PD 01000",
          salesOrderId: "so-1",
          installmentNumber: 1,
          totalInstallments: 2,
          reference: "p1",
          dueDate: "2026-08-01",
          originalExpectedAmount: 5000,
          expectedAmount: 5000,
          openAmount: 5000,
          statusLabel: "A vencer" as const,
          paymentConditionLabel: "x",
          paymentMethodLabel: null,
          origin: "pedido",
          note: "",
          replacedByRealCr: false,
          replacedByReceivableExternalId: null,
        },
        {
          key: "p2",
          orderCode: "PD 01000",
          salesOrderId: "so-1",
          installmentNumber: 2,
          totalInstallments: 2,
          reference: "p2",
          dueDate: "2026-09-01",
          originalExpectedAmount: 5000,
          expectedAmount: 5000,
          openAmount: 5000,
          statusLabel: "A vencer" as const,
          paymentConditionLabel: "x",
          paymentMethodLabel: null,
          origin: "pedido",
          note: "",
          replacedByRealCr: false,
          replacedByReceivableExternalId: null,
        },
      ],
      plannedReceivablesTotal: {
        totalCount: 2,
        totalExpected: 10000,
        applicableExpected: 10000,
        openExpected: 10000,
        overdueExpected: 0,
        overdueCount: 0,
        dueTodayExpected: 0,
        dueTodayCount: 0,
        upcomingCount: 2,
        nextDueDate: "2026-08-01",
        replacedCount: 0,
        replacedAmount: 0,
        netPlannedOpen: 10000,
      },
      stockDocuments: [
        {
          stockDocumentExternalId: 1,
          idNfe: 50,
          allocatedValue: 9000,
          totalValue: 9000,
          outsideOrderValue: 0,
          quantityDocument: 9,
          quantityUsedForOrder: 9,
          excessQuantity: 0,
          outsideOrderQuantity: 0,
          hasExcess: false,
          hasOutside: false,
          productLines: 1,
          status: null,
          linkOrigin: "ITEM_EVIDENCE" as const,
          tipoDocumentoEstoque: null,
          dataDocumento: null,
          dataMovimentacao: null,
          customerName: null,
          companyName: null,
        },
      ],
      stockDocumentItems: [
        {
          stockDocumentExternalId: 1,
          stockDocumentItemId: "sdi-1",
          externalItemId: null,
          productSku: null,
          productName: null,
          productExternalId: null,
          unit: null,
          quantityDocument: 9,
          quantityUsedForOrder: 9,
          excessQuantity: 0,
          unitValue: 1000,
          totalValue: 9000,
          allocatedValue: 9000,
          linkedSalesOrderItemId: "item-1",
          linkedSalesOrderId: "so-1",
          linkedOrderCode: "PD 01000",
          linkedOrderItemSequence: null,
          orderUnitPrice: 1000,
          priceDiffAbsolute: null,
          priceDiffPercent: null,
          financialImpact: null,
          nfeExternalId: 50,
          nfeNumber: null,
          receivableExternalId: null,
          lineType: null,
          alerts: [],
        },
      ],
      receipts: [],
      nfes: [],
      nfeItems: [],
      alerts: [],
    } as unknown as OrderFullAuditPayload;

    const financial = buildSalesOrderDetailFinancialFromAudit(
      audit,
      new Date(2026, 6, 17)
    );
    assert.equal(financial.engine, "salesOrderEffectiveFinancialSchedule");
    assert.equal(financial.cutAmount, 1000);
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 0);
    assert.equal(financial.coverageSummary.realOrDocumentAgendaTotal, 9000);
  });
});

const HISTORY_STATUSES = new Set([
  "Substituída",
  "Parcialmente substituída",
  "Encerrada por corte",
  "Cancelada",
]);

describe("FIN-07 — apresentação financeira do Detalhe do Pedido", () => {
  it("expõe histórico da previsão original com status permitidos", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    assert.ok(Array.isArray(financial.originalForecastHistory));
    assert.ok(financial.originalForecastHistory.length > 0);
    for (const row of financial.originalForecastHistory) {
      assert.ok(
        HISTORY_STATUSES.has(row.status),
        `status histórico inválido: ${row.status}`
      );
      assert.notEqual(row.status, "Vencido");
      assert.notEqual(row.status, "Vencida");
    }
  });

  it("parcial → histórico com posição ocupada + residual na restante (FIN-13)", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    const installments = financial.originalForecastHistory.filter(
      (r) => r.kind === "installment"
    );
    assert.ok(installments.length > 0);
    assert.ok(installments.some((r) => r.status === "Substituída"));
    assert.ok(installments.some((r) => r.status === "Parcialmente substituída"));
    const sumResidual = installments.reduce((s, r) => s + r.residualAmount, 0);
    const sumSub = installments.reduce((s, r) => s + r.substitutedAmount, 0);
    assert.equal(Math.round(sumResidual * 100) / 100, 1000);
    assert.equal(Math.round(sumSub * 100) / 100, 9000);
    assert.ok(
      installments.every(
        (r) => r.dueDate === "2026-08-01" || r.dueDate === "2026-09-01"
      )
    );
  });

  it("corte → Encerrada por corte no histórico; sem Vencida", () => {
    const financial = project(fixtureCut10000Doc9000());
    const cutRow = financial.originalForecastHistory.find(
      (r) => r.kind === "cut_summary"
    );
    assert.ok(cutRow);
    assert.equal(cutRow!.status, "Encerrada por corte");
    assert.equal(cutRow!.originalAmount, 1000);
    for (const row of financial.originalForecastHistory) {
      assert.ok(HISTORY_STATUSES.has(row.status));
      assert.ok(
        !/[Vv]encid/.test(row.status),
        `status não pode ser vencido: ${row.status}`
      );
    }
    assert.equal(financial.plannedReceivables.length, 0);
    assert.equal(financial.coverageSummary.coveredByDocumentsWithoutCr, 9000);
    assert.equal(financial.cutAmount, 1000);
  });

  it("agenda efetiva = CR + Doc sem CR + residual; não inclui previsão integral", () => {
    const financial = project(fixturePartialWithDoc9000Proven());
    const residualOpen = financial.plannedReceivables.reduce(
      (s, p) => s + p.openAmount,
      0
    );
    assert.equal(Math.round(residualOpen * 100) / 100, 1000);
    // Tabela principal não lista a previsão original integral (só residual).
    assert.ok(
      financial.plannedReceivables.every(
        (p) => (p.originalExpectedAmount ?? 0) >= p.expectedAmount
      )
    );
    assert.ok(
      financial.plannedReceivables.every((p) => p.entryKind === "RESIDUAL_ORDER_PLAN")
    );
    // Histórico separado carrega a previsão original tocada.
    assert.ok(
      financial.originalForecastHistory.some((r) => r.kind === "installment")
    );
  });

  it("cards: totais CR, residual ativo e próximo vencimento efetivo", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Proven()
    );
    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [
        {
          receivableExternalId: 10,
          searchReference: "CR-10",
          installmentNumber: 1,
          totalInstallments: 1,
          dueDate: "2026-07-25",
          amountReceivable: 2000,
          balanceReceivable: 500,
          amountReceived: 1500,
          status: "PARTIALLY_RECEIVED",
          sourceInvoiceNumber: "100",
          sourceInvoiceId: null,
        } as never,
      ],
      [],
      {
        totalAmount: 2000,
        openAmount: 500,
        receivedAmount: 1500,
        overdueCount: 0,
        nextDueDate: "2026-07-25",
        maxAmount: 2000,
        totalCount: 1,
      },
      new Date(2026, 6, 17)
    );
    assert.equal(financial.totals.totalAmount, 2000);
    assert.equal(financial.totals.openAmount, 500);
    assert.equal(financial.totals.receivedAmount, 1500);
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 1000);
    assert.equal(financial.coverageSummary.coveredByDocumentsWithoutCr, 9000);
    // Próximo vencimento efetivo: doc 2026-07-20 (antes do CR 25 e residual 08).
    assert.equal(financial.effectiveNextDueDate, "2026-07-20");
  });

  it("sem Doc/CR: rótulo de previsão do Pedido (não residual pós-NF)", () => {
    const financial = project(fixtureOrder10000Base());
    assert.equal(
      financial.coverageSummary.materializationMode,
      "NO_MATERIALIZATION"
    );
    assert.ok(financial.plannedReceivables.length >= 1);
    for (const p of financial.plannedReceivables) {
      assert.ok(!/\(residual\)/i.test(p.reference), p.reference);
      assert.match(p.origin, /previsão vigente/i);
      assert.equal(p.paymentConditionLabel, "Condição do Pedido");
    }
  });

  it("CR integral sem Doc: residual zero no detalhe (não CR + parcela)", () => {
    const financial = project(
      fixtureOrder10000Base({
        originalInstallments: [
          { installmentNumber: 1, dueDate: "2026-10-20", amount: "10000.00" },
        ],
        realReceivables: [
          {
            externalId: 17754,
            sourceInvoiceId: null,
            dueDate: "2026-10-20",
            amountReceivable: "10000.00",
            amountReceived: "0",
            balanceReceivable: "10000.00",
          },
        ],
      })
    );
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 0);
    assert.equal(financial.plannedReceivables.length, 0);
    assert.equal(financial.coverageSummary.coveredByRealReceivables, 10000);
  });
});
