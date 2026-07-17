/**
 * FIN-06 — contrato e regressão do financeiro do Detalhe do Pedido.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import {
  fixtureCut10000Doc9000,
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
    for (const p of financial.supersededPlannedReceivables) {
      assert.equal(p.statusLabel, "Substituída");
      assert.notEqual(p.statusLabel, "Vencido");
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
    assert.equal(financial.coverageSummary.activeOrderResidualTotal, 1000);
    assert.notEqual(financial.coverageSummary.activeOrderResidualTotal, 1500);
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
