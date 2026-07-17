/**
 * FIN-09 — regressão por consumidor da agenda efetiva.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fixtureCrReplacesDocumentSameNfe,
  fixtureCut10000Doc9000,
  fixturePartialWithDoc9000Awaiting,
} from "./salesOrderEffectiveFinancialSchedule.fixtures.js";
import { buildSalesOrderEffectiveFinancialSchedule } from "./salesOrderEffectiveFinancialSchedule.js";
import {
  buildEffectiveScheduleConsumerAlerts,
  projectEffectiveScheduleForOrderAudit,
} from "./effectiveScheduleAuditProjection.js";
import { mapEffectiveScheduleToDetailFinancial } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import { computeConsolidatedFinancialSummary } from "@/src/lib/sales/orderFinancialConsolidation.js";
import { resolveFinancialEvidenceWithoutDoubleCount } from "@/src/lib/output-documents/auditOutputDocumentsFinancial.js";
import { buildFinanceArEffectiveTitles } from "./financeAccountsReceivableEffectiveTitles.js";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import type {
  OrderFullAuditItem,
  OrderFullAuditReceivable,
  OrderFullAuditStockDocument,
} from "./orderFullAuditClient.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

function readSrc(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

describe("FIN-09 — alertas (agenda efetiva)", () => {
  it("residual vencido gera alerta; substituída não", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Awaiting()
    );
    // Força residual vencido.
    for (const line of schedule.activeOrderResidualSchedule) {
      line.dueDate = "2026-01-01";
    }
    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [],
      [],
      {
        totalAmount: 0,
        openAmount: 0,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 0,
        totalCount: 0,
      },
      REF
    );
    const alerts = buildEffectiveScheduleConsumerAlerts({
      schedule,
      plannedReceivables: [
        ...financial.plannedReceivables,
        ...financial.supersededPlannedReceivables,
      ],
    });
    assert.ok(
      alerts.some((a) => a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR")
    );
    assert.ok(
      !alerts.some(
        (a) =>
          a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR" &&
          /substitu/i.test(a.description)
      )
    );
    // Substituídas existem no payload mas não geram OVERDUE.
    assert.ok(financial.supersededPlannedReceivables.length > 0);
  });

  it("corte não gera alerta financeiro de aberto/vencido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureCut10000Doc9000()
    );
    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [],
      [],
      {
        totalAmount: 0,
        openAmount: 0,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 0,
        totalCount: 0,
      },
      REF
    );
    const alerts = buildEffectiveScheduleConsumerAlerts({
      schedule,
      plannedReceivables: [
        ...financial.plannedReceivables,
        ...financial.supersededPlannedReceivables,
      ],
    });
    assert.ok(Number(schedule.cutAmount.toFixed(2)) > 0);
    assert.equal(financial.plannedReceivables.length, 0);
    assert.ok(
      !alerts.some((a) =>
        a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR" ||
        a.code === "PLANNED_RECEIVABLE_WITHOUT_REAL_CR"
      )
    );
  });

  it("Documento aguardando gera alerta de materialização (não como parcela Pedido vencida)", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Awaiting()
    );
    const alerts = buildEffectiveScheduleConsumerAlerts({
      schedule,
      plannedReceivables: [],
    });
    assert.ok(
      alerts.some((a) => a.code === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE")
    );
  });
});

describe("FIN-09 — Auditoria 360° / projeção", () => {
  it("projectEffectiveScheduleForOrderAudit usa FIN-05 (sem motor legado no source)", () => {
    const items: OrderFullAuditItem[] = [
      {
        salesOrderItemId: "item-1",
        externalSalesOrderItemId: null,
        itemSequence: "1",
        productCode: "SKU",
        sku: "SKU",
        productName: "Item",
        productExternalId: null,
        unit: "UN",
        quantity: 10,
        unitPrice: 1000,
        totalNetValue: 10000,
        nomusItemStatusRaw: "3",
        nomusItemStatusNormalized: "PARTIAL",
        itemStatus: "PARTIAL",
        nomusIsCanceled: false,
        nomusIsCut: false,
        nomusIsStale: false,
        nomusQuantityFulfilled: 9,
        nomusQuantityPending: 1,
        matchConfidence: null,
        proposalItemId: null,
        activeQuantity: 10,
        canceledQuantity: 0,
        cutQuantity: 0,
        activePendingQuantity: 1,
        activeValue: 10000,
        canceledValue: 0,
        cutValue: 0,
        expectedDeliveryDate: null,
        productionQuantity: null,
        invoicedQuantity: null,
        saldoAFaturar: null,
        saldoPronto: null,
        movementType: null,
        cfop: null,
        linkedStockDocumentExternalIds: [1],
        linkedNfeExternalIds: [],
        linkedReceivableExternalIds: [],
        alerts: [],
      } as OrderFullAuditItem,
    ];
    const stockDocuments: OrderFullAuditStockDocument[] = [
      {
        stockDocumentExternalId: 1,
        idNfe: 5001,
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
        linkOrigin: "ITEM_EVIDENCE",
        tipoDocumentoEstoque: null,
        dataDocumento: null,
        dataMovimentacao: null,
        customerName: null,
        companyName: null,
      } as OrderFullAuditStockDocument,
    ];
    const result = projectEffectiveScheduleForOrderAudit({
      salesOrderId: "so-1",
      orderCode: "PD 01010",
      issueDate: new Date(2026, 5, 1),
      paymentTerms: "30/60",
      paymentMethod: null,
      nomusRawResponse: null,
      totalActiveValue: 10000,
      items,
      receivables: [],
      stockDocuments,
      referenceDate: REF,
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "5000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "5000.00" },
      ],
    });
    assert.match(result.source, /FIN-05/);
    assert.equal(result.plannedReceivablesTotal.applicableExpected, 1000);
    assert.ok(
      result.plannedReceivables.every(
        (p) => p.replacedByRealCr || p.entryKind === "RESIDUAL_ORDER_PLAN"
      )
    );
  });
});

describe("FIN-09 — consolidação comercial / cards", () => {
  it("não soma CR + previsão substituída", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureCrReplacesDocumentSameNfe()
    );
    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [
        {
          receivableExternalId: 9001,
          amountReceivable: 10000,
          amountReceived: 0,
          balanceReceivable: 10000,
        } as OrderFullAuditReceivable,
      ],
      [],
      {
        totalAmount: 10000,
        openAmount: 10000,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: "2026-07-15",
        maxAmount: 10000,
        totalCount: 1,
      },
      REF
    );
    const consolidated = computeConsolidatedFinancialSummary({
      totals: financial.totals,
      plannedTotals: financial.plannedTotals,
    });
    assert.equal(consolidated.realCrTotal, 10000);
    assert.equal(consolidated.plannedTotal, 0);
    assert.equal(consolidated.totalFinancialValue, 10000);
    assert.ok(consolidated.totalFinancialValue < 20000);
  });
});

describe("FIN-09 — Documentos de Saída (evidência sem dupla contagem)", () => {
  it("CR + Documento mesma cadeia usa max, não soma", () => {
    const r = resolveFinancialEvidenceWithoutDoubleCount({
      receivableCents: 900_000,
      documentCents: 900_000,
      orderForecastCents: 1_000_000,
    });
    assert.equal(r.wouldDoubleCountIfSummed, true);
    assert.equal(r.coveredByReceivableCents, 900_000);
    assert.equal(r.coveredByDocumentIncrementalCents, 0);
    assert.equal(r.coveredByOrderIncrementalCents, 100_000);
    assert.equal(r.dominantCoverageCents, 1_000_000);
  });
});

describe("FIN-09 — Contas a Receber contextual (FIN-08)", () => {
  it("Doc coberto por CR não aparece; residual parcial sim", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureCrReplacesDocumentSameNfe()
    );
    const { items } = buildFinanceArEffectiveTitles({
      nomusRows: [
        {
          externalId: 9001,
          companyName: "E",
          personId: 1,
          personName: "C",
          personCnpj: "00",
          description: "PD",
          comments: null,
          dueDate: new Date(2026, 6, 15),
          competenceDate: null,
          settlementDate: null,
          amountReceivable: 10000,
          amountReceived: 0,
          balanceReceivable: 10000,
          paymentMethodName: null,
          bankAccountName: null,
          sourceInvoiceId: 7001,
          sourceInvoiceNumber: "NF",
          suspendCollection: false,
          nomusStatus: true,
          syncedAt: REF,
        } satisfies FinanceArDashboardRow,
      ],
      orderContexts: [
        {
          schedule,
          personId: 1,
          personName: "C",
          personCnpj: "00",
        },
      ],
      orderCode: schedule.orderCode,
      referenceDate: REF,
    });
    assert.ok(items.every((i) => i.lineKind !== "DOCUMENT_AWAITING_CR"));
    assert.ok(items.some((i) => i.lineKind === "CR_REAL"));
  });
});

describe("FIN-09 — Fluxo de Caixa (sem previsão de Pedido)", () => {
  it("dataset oficial não importa motor de previsão do Pedido", () => {
    const dataset = readSrc("src/lib/financeCashFlowDataset.ts");
    assert.doesNotMatch(dataset, /buildSalesOrderPlannedReceivables/);
    assert.doesNotMatch(dataset, /salesOrderEffectiveFinancialSchedule/);
    assert.doesNotMatch(dataset, /projectEffectiveScheduleForOrderAudit/);
  });
});

describe("FIN-09 — wiring Auditoria usa projeção FIN-05", () => {
  it("orderFullAuditService importa effectiveScheduleAuditProjection", () => {
    const src = readSrc("src/lib/finance/orderFullAuditService.ts");
    assert.match(src, /projectEffectiveScheduleForOrderAudit/);
    assert.match(src, /buildEffectiveScheduleConsumerAlerts/);
    assert.doesNotMatch(src, /buildSalesOrderPlannedReceivables\(/);
  });
});
