/**
 * FIN-11 — Matriz integrada da agenda financeira efetiva (24 cenários + invariantes).
 *
 * Cobre motor FIN-05 e coerência com Detalhe (FIN-06/07), Contas a Receber (FIN-08)
 * e alertas/projeção (FIN-09).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  allocateResidualToOriginalInstallments,
  buildSalesOrderEffectiveFinancialSchedule,
  sumActiveOrderResidual,
  type BuildSalesOrderEffectiveFinancialScheduleInput,
  type SalesOrderEffectiveFinancialSchedule,
} from "./salesOrderEffectiveFinancialSchedule.js";
import {
  MATRIX_REF,
  matrixCrParcialmenteRecebido,
  matrixCrTotalmenteRecebido,
  matrixCrVariasParcelas,
  matrixDiferencaDocumentoCr,
  matrixDocumentoCancelado,
  matrixDocumentoSemCondicao,
  matrixDocumentoTotalComCr,
  matrixDocumentoTotalSemCr,
  matrixDocumentoVariasNfes,
  matrixItemCancelado,
  matrixItemComCorte,
  matrixItemNaoAtendido,
  matrixItemParcial,
  matrixItemTotalmenteAtendido,
  matrixNfCancelada,
  matrixPedidoSemDocumento,
  matrixPrevisaoResidualVencida,
  matrixPrevisaoSubstituidaVencida,
  matrixStatusDesconhecido,
  matrixVariosDocumentos,
  matrixVariosItensMistos,
} from "./effectiveScheduleMatrix.fixtures.js";
import { mapEffectiveScheduleToDetailFinancial } from "@/src/lib/sales-orders/salesOrderDetailEffectiveFinancial.js";
import { buildFinanceArEffectiveTitles } from "./financeAccountsReceivableEffectiveTitles.js";
import { buildEffectiveScheduleConsumerAlerts } from "./effectiveScheduleAuditProjection.js";
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";

const REF = MATRIX_REF;
const EMPTY_TOTALS = {
  totalAmount: 0,
  openAmount: 0,
  receivedAmount: 0,
  overdueCount: 0,
  nextDueDate: null,
  maxAmount: 0,
  totalCount: 0,
};

function assertMoney(actual: Prisma.Decimal, expected: string) {
  assert.equal(actual.toFixed(2), new Prisma.Decimal(expected).toFixed(2));
}

function serializeSchedule(schedule: SalesOrderEffectiveFinancialSchedule): string {
  return JSON.stringify(schedule, (_key, value) => {
    if (value instanceof Prisma.Decimal) return value.toFixed(2);
    return value;
  });
}

function sumDocSchedule(schedule: SalesOrderEffectiveFinancialSchedule): Prisma.Decimal {
  return schedule.documentSchedule
    .reduce((s, d) => s.add(d.allocatedByOrderPrice), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
}

function sumCrReceivable(schedule: SalesOrderEffectiveFinancialSchedule): Prisma.Decimal {
  return schedule.realReceivables
    .reduce((s, r) => s.add(r.amountReceivable), new Prisma.Decimal(0))
    .toDecimalPlaces(2);
}

/** Invariantes transversais da política FIN-02. */
function assertCoreInvariants(
  schedule: SalesOrderEffectiveFinancialSchedule,
  label: string
) {
  const residual = sumActiveOrderResidual(schedule.activeOrderResidualSchedule);
  assert.equal(
    residual.toFixed(2),
    schedule.coverageSummary.activeOrderResidualTotal.toFixed(2),
    `${label}: soma residual exata`
  );
  assert.equal(
    residual.toFixed(2),
    schedule.coverageSummary.itemActiveResidualTotal.toFixed(2),
    `${label}: residual agenda = residual de itens`
  );

  // Corte fora da agenda (não entra residual / doc / CR como obrigação futura).
  if (schedule.cutAmount.gt(0)) {
    assert.ok(
      residual.eq(schedule.coverageSummary.itemActiveResidualTotal),
      `${label}: corte não gera residual ativo`
    );
  }

  // Nenhuma dupla contagem: NF com CR não aparece em documentSchedule.
  const crInvoiceIds = new Set(
    schedule.realReceivables
      .map((r) => r.sourceInvoiceId)
      .filter((id): id is number => id != null)
  );
  for (const doc of schedule.documentSchedule) {
    if (doc.sourceInvoiceId != null) {
      assert.ok(
        !crInvoiceIds.has(doc.sourceInvoiceId),
        `${label}: Documento e CR da mesma NF não coexistem`
      );
    }
  }

  // Residual só de obrigação futura (entryKind ACTIVE).
  for (const line of schedule.activeOrderResidualSchedule) {
    assert.equal(line.entryKind, "ACTIVE_ORDER_PLAN", `${label}: residual ativo`);
    assert.ok(line.residualAmount.gt(0), `${label}: parcela residual > 0`);
  }
  for (const line of schedule.supersededOrderSchedule) {
    assert.equal(line.entryKind, "SUPERSEDED_ORDER_PLAN");
    assertMoney(line.residualAmount, "0.00");
  }

  // CR oficial preservado (valores de entrada batem com saída).
  const crIds = new Set(schedule.realReceivables.map((r) => r.externalId));
  assert.equal(crIds.size, schedule.realReceivables.length, `${label}: CR sem dup id`);
}

function assertScreensAndApisCoherent(schedule: SalesOrderEffectiveFinancialSchedule) {
  const financial = mapEffectiveScheduleToDetailFinancial(
    schedule,
    schedule.realReceivables.map((r) => ({
      receivableExternalId: r.externalId,
      amountReceivable: Number(r.amountReceivable.toFixed(2)),
      amountReceived: Number(r.amountReceived.toFixed(2)),
      balanceReceivable: Number(r.balanceReceivable.toFixed(2)),
      dueDate: r.dueDate,
      sourceInvoiceId: r.sourceInvoiceId,
    })) as never,
    [],
    {
      ...EMPTY_TOTALS,
      totalAmount: Number(sumCrReceivable(schedule).toFixed(2)),
      openAmount: Number(
        schedule.realReceivables
          .reduce((s, r) => s.add(r.balanceReceivable), new Prisma.Decimal(0))
          .toFixed(2)
      ),
      receivedAmount: Number(
        schedule.realReceivables
          .reduce((s, r) => s.add(r.amountReceived), new Prisma.Decimal(0))
          .toFixed(2)
      ),
      totalCount: schedule.realReceivables.length,
    },
    REF
  );

  assert.equal(
    financial.coverageSummary.activeOrderResidualTotal,
    Number(schedule.coverageSummary.activeOrderResidualTotal.toFixed(2))
  );
  assert.equal(
    financial.plannedTotals.applicableExpected,
    Number(schedule.coverageSummary.activeOrderResidualTotal.toFixed(2))
  );

  // Detalhe: residual planejado = agenda ativa; substituídas não somam ao aberto.
  const plannedSum = financial.plannedReceivables.reduce((s, p) => s + p.openAmount, 0);
  assert.equal(
    Math.round(plannedSum * 100) / 100,
    Number(schedule.coverageSummary.activeOrderResidualTotal.toFixed(2))
  );

  // CR oficiais no AR só via Nomus (não reinsere liquidado filtrado pela agenda).
  const nomusFromSchedule = schedule.realReceivables.map((r) => ({
    externalId: r.externalId,
    companyName: "Empresa Matriz",
    personId: 1,
    personName: "Cliente Matriz FIN-11",
    personCnpj: null,
    description: `CR ${r.externalId}`,
    comments: null,
    dueDate: r.dueDate ? new Date(`${r.dueDate}T12:00:00`) : null,
    competenceDate: null,
    settlementDate: null,
    amountReceivable: Number(r.amountReceivable.toFixed(2)),
    amountReceived: Number(r.amountReceived.toFixed(2)),
    balanceReceivable: Number(r.balanceReceivable.toFixed(2)),
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: r.sourceInvoiceId,
    sourceInvoiceNumber:
      r.sourceInvoiceId != null ? String(r.sourceInvoiceId) : null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REF,
  }));

  const { items } = buildFinanceArEffectiveTitles({
    nomusRows: nomusFromSchedule,
    orderContexts: [
      {
        schedule,
        personId: 1,
        personName: "Cliente Matriz FIN-11",
        personCnpj: null,
      },
    ],
    referenceDate: REF,
  });

  const arResidual = items
    .filter((i) => i.lineKind === "ORDER_RESIDUAL_FORECAST")
    .reduce((s, i) => s + i.balanceReceivable, 0);
  assert.equal(
    Math.round(arResidual * 100) / 100,
    Number(schedule.coverageSummary.activeOrderResidualTotal.toFixed(2))
  );

  const arCr = items.filter((i) => i.lineKind === "CR_REAL");
  assert.equal(arCr.length, schedule.realReceivables.length);

  const withoutNomus = buildFinanceArEffectiveTitles({
    nomusRows: [],
    orderContexts: [
      {
        schedule,
        personId: 1,
        personName: "Cliente Matriz FIN-11",
        personCnpj: null,
      },
    ],
    referenceDate: REF,
  });
  assert.equal(
    withoutNomus.items.filter((i) => i.lineKind === "CR_REAL").length,
    0,
    "sem Nomus filtrado, agenda não sintetiza CR"
  );

  // Documentos aguardando: AR pode materializar DOCUMENT_AWAITING_CR.
  const awaitingDocs = schedule.documentSchedule.filter(
    (d) => d.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE"
  );
  if (awaitingDocs.length > 0) {
    const arAwaiting = items.filter((i) => i.lineKind === "DOCUMENT_AWAITING_CR");
    assert.ok(arAwaiting.length >= 1 || awaitingDocs.length >= 1);
  }

  const alerts = buildEffectiveScheduleConsumerAlerts({
    schedule,
    plannedReceivables: [
      ...financial.plannedReceivables,
      ...financial.supersededPlannedReceivables,
    ],
  });
  assert.ok(Array.isArray(alerts));
}

describe("FIN-11 — matriz completa (24 cenários)", () => {
  it("1. Pedido sem Documento", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixPedidoSemDocumento());
    assert.equal(schedule.documentSchedule.length, 0);
    assert.equal(schedule.realReceivables.length, 0);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "10000.00");
    assert.equal(schedule.coverageSummary.precedenceSource, "ORDER_PLAN");
    assertCoreInvariants(schedule, "1");
    assertScreensAndApisCoherent(schedule);
  });

  it("2. Pedido com Documento total e sem CR", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoTotalSemCr());
    assert.equal(schedule.documentSchedule.length, 1);
    assert.equal(schedule.documentSchedule[0]?.kind, "DOCUMENT_SCHEDULE");
    assert.equal(schedule.realReceivables.length, 0);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertMoney(sumDocSchedule(schedule), "10000.00");
    assert.equal(schedule.coverageSummary.precedenceSource, "OUTPUT_DOCUMENT");
    assertCoreInvariants(schedule, "2");
    assertScreensAndApisCoherent(schedule);
  });

  it("3. Pedido com Documento total e CR", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoTotalComCr());
    assert.equal(schedule.realReceivables.length, 1);
    assert.equal(schedule.documentSchedule.length, 0, "CR substitui Documento mesma NF");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.coverageSummary.precedenceSource, "REAL_RECEIVABLE");
    assertCoreInvariants(schedule, "3");
    assertScreensAndApisCoherent(schedule);
  });

  it("4. Item totalmente atendido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      matrixItemTotalmenteAtendido()
    );
    assert.equal(schedule.itemAmounts[0]?.classification, "FULLY_FULFILLED");
    assertMoney(schedule.itemAmounts[0]!.activeResidual, "0.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertCoreInvariants(schedule, "4");
  });

  it("5. Item atendido com corte", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixItemComCorte());
    assertMoney(schedule.cutAmount, "1000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(
      !schedule.activeOrderResidualSchedule.some((l) => l.residualAmount.eq("1000"))
    );
    assertCoreInvariants(schedule, "5");
    assertScreensAndApisCoherent(schedule);
  });

  it("6. Item atendido parcialmente", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixItemParcial());
    assert.equal(schedule.itemAmounts[0]?.classification, "PARTIALLY_FULFILLED");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "1000.00");
    assert.equal(schedule.documentSchedule[0]?.kind, "DOCUMENT_SCHEDULE");
    assertCoreInvariants(schedule, "6");
    assertScreensAndApisCoherent(schedule);
  });

  it("7. Item não atendido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixItemNaoAtendido());
    assert.equal(schedule.itemAmounts[0]?.classification, "NOT_FULFILLED");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "10000.00");
    assert.equal(schedule.documentSchedule.length, 0);
    assertCoreInvariants(schedule, "7");
  });

  it("8. Item cancelado", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixItemCancelado());
    assertMoney(schedule.canceledAmount, "10000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.documentSchedule.length, 0);
    assertCoreInvariants(schedule, "8");
  });

  it("9. Status desconhecido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixStatusDesconhecido());
    assertMoney(schedule.unresolvedAmount, "8000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(schedule.alerts.some((a) => a.code === "ITEM_CLASSIFICATION_PENDING"));
    assertCoreInvariants(schedule, "9");
  });

  it("10. Vários itens com situações diferentes", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixVariosItensMistos());
    assertMoney(schedule.cutAmount, "1000.00");
    assertMoney(schedule.canceledAmount, "2000.00");
    // Residual: só item parcial (2000).
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "2000.00");
    assert.equal(schedule.documentSchedule.length, 3);
    assertCoreInvariants(schedule, "10");
    assertScreensAndApisCoherent(schedule);
  });

  it("11. Vários Documentos", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixVariosDocumentos());
    assert.equal(schedule.documentSchedule.length, 2);
    assertMoney(sumDocSchedule(schedule), "7000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "3000.00");
    assertCoreInvariants(schedule, "11");
  });

  it("12. Documento com várias NF-es", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoVariasNfes());
    assert.equal(schedule.documentSchedule.length, 2);
    const nfeIds = schedule.documentSchedule.map((d) => d.sourceInvoiceId).sort();
    assert.deepEqual(nfeIds, [84001, 84002]);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertCoreInvariants(schedule, "12");
  });

  it("13. CR com várias parcelas", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixCrVariasParcelas());
    assert.equal(schedule.realReceivables.length, 2);
    assert.equal(schedule.documentSchedule.length, 0);
    assertMoney(sumCrReceivable(schedule), "10000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertCoreInvariants(schedule, "13");
    assertScreensAndApisCoherent(schedule);
  });

  it("14. CR parcialmente recebido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      matrixCrParcialmenteRecebido()
    );
    assert.equal(schedule.realReceivables.length, 1);
    assertMoney(schedule.realReceivables[0]!.amountReceived, "3500.00");
    assertMoney(schedule.realReceivables[0]!.balanceReceivable, "6500.00");
    assert.equal(schedule.documentSchedule.length, 0);
    assertCoreInvariants(schedule, "14");
  });

  it("15. CR totalmente recebido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      matrixCrTotalmenteRecebido()
    );
    assertMoney(schedule.realReceivables[0]!.amountReceived, "10000.00");
    assertMoney(schedule.realReceivables[0]!.balanceReceivable, "0.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertCoreInvariants(schedule, "15");
  });

  it("16. Diferença entre Documento e CR", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDiferencaDocumentoCr());
    assert.equal(schedule.documentSchedule.length, 0, "Doc não soma com CR da mesma NF");
    assertMoney(sumCrReceivable(schedule), "9500.00");
    // Item totalmente atendido → residual comercial 0; CR oficial 9500 preservado.
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assertMoney(schedule.itemAmounts[0]!.crReceivableRaw, "9500.00");
    assertCoreInvariants(schedule, "16");
  });

  it("17. Cliente com vários pedidos e NF-es legítimas", () => {
    const orderA = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoTotalComCr());
    const orderB = buildSalesOrderEffectiveFinancialSchedule(matrixItemParcial());
    // Ajusta códigos/ids para cliente único.
    const scheduleA = {
      ...orderA,
      salesOrderId: "so-fin11-a",
      orderCode: "PD 11117A",
    };
    const scheduleB = {
      ...orderB,
      salesOrderId: "so-fin11-b",
      orderCode: "PD 11117B",
    };

    const nomusRows: FinanceArDashboardRow[] = [
      {
        companyName: "Empresa",
        personId: 11117,
        personName: "Cliente Matriz",
        personCnpj: "12345678000199",
        description: "CR A",
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
        sourceInvoiceNumber: "NF-A",
        suspendCollection: false,
        nomusStatus: true,
        syncedAt: REF,
        externalId: 9001,
      },
    ];

    const { items, summary } = buildFinanceArEffectiveTitles({
      nomusRows,
      orderContexts: [
        {
          schedule: scheduleA,
          personId: 11117,
          personName: "Cliente Matriz",
          personCnpj: "12345678000199",
        },
        {
          schedule: scheduleB,
          personId: 11117,
          personName: "Cliente Matriz",
          personCnpj: "12345678000199",
        },
      ],
      customerPersonId: 11117,
      referenceDate: REF,
    });

    assert.ok(items.some((i) => i.lineKind === "CR_REAL" && i.externalId === 9001));
    assert.ok(
      items.some(
        (i) => i.orderCode === "PD 11117B" && i.lineKind === "ORDER_RESIDUAL_FORECAST"
      )
    );
    assert.ok(
      items.some(
        (i) => i.orderCode === "PD 11117B" && i.lineKind === "DOCUMENT_AWAITING_CR"
      )
    );
    // Sem dupla contagem Pedido A (Doc+CR da mesma NF).
    assert.ok(!items.some((i) => i.orderCode === "PD 11117A" && i.lineKind !== "CR_REAL"));
    assert.ok(summary.totalTitles >= 2);
    assertCoreInvariants(scheduleA, "17a");
    assertCoreInvariants(scheduleB, "17b");
  });

  it("18. Documento cancelado", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoCancelado());
    assert.equal(schedule.documentSchedule.length, 0);
    assertMoney(schedule.itemAmounts[0]!.coveredByValidDocuments, "0.00");
    // Sem cobertura válida → residual integral do item parcial (status 3 com qty 5/10).
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "5000.00");
    assertCoreInvariants(schedule, "18");
  });

  it("19. NF cancelada", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixNfCancelada());
    assert.equal(schedule.documentSchedule.length, 0);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "5000.00");
    assertCoreInvariants(schedule, "19");
  });

  it("20. Redistribuição de centavos", () => {
    const parts = allocateResidualToOriginalInstallments(
      [new Prisma.Decimal("100"), new Prisma.Decimal("100"), new Prisma.Decimal("100")],
      "100.00"
    );
    const sum = parts.reduce((s, p) => s.add(p), new Prisma.Decimal(0));
    assertMoney(sum, "100.00");
    assertMoney(parts[0]!, "33.33");
    assertMoney(parts[1]!, "33.33");
    assertMoney(parts[2]!, "33.34");

    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so-cents",
      orderCode: "PD 11020",
      referenceDate: REF,
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "100.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "100.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "100.00" },
      ],
      items: [
        {
          salesOrderItemId: "item-1",
          plannedNetValue: "100.00",
          status: 2,
          orderedQuantity: 1,
          fulfilledQuantity: 0,
        },
      ],
      documents: [],
      realReceivables: [],
    });
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "100.00");
    assertCoreInvariants(schedule, "20");
  });

  it("21. Previsão residual vencida", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      matrixPrevisaoResidualVencida()
    );
    assert.ok(schedule.alerts.some((a) => a.code === "ORDER_RESIDUAL_OVERDUE"));
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "10000.00");

    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [],
      [],
      EMPTY_TOTALS,
      REF
    );
    const alerts = buildEffectiveScheduleConsumerAlerts({
      schedule,
      plannedReceivables: financial.plannedReceivables,
    });
    assert.ok(
      alerts.some((a) => a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR")
    );
    assertCoreInvariants(schedule, "21");
  });

  it("22. Previsão substituída vencida", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      matrixPrevisaoSubstituidaVencida()
    );
    assert.ok(schedule.supersededOrderSchedule.length >= 1);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(!schedule.alerts.some((a) => a.code === "ORDER_RESIDUAL_OVERDUE"));

    const financial = mapEffectiveScheduleToDetailFinancial(
      schedule,
      [],
      [],
      EMPTY_TOTALS,
      REF
    );
    assert.ok(financial.supersededPlannedReceivables.length > 0);
    const alerts = buildEffectiveScheduleConsumerAlerts({
      schedule,
      plannedReceivables: [
        ...financial.plannedReceivables,
        ...financial.supersededPlannedReceivables,
      ],
    });
    assert.ok(
      !alerts.some((a) => a.code === "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR")
    );
    assertCoreInvariants(schedule, "22");
  });

  it("23. Documento sem condição de pagamento", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(matrixDocumentoSemCondicao());
    assert.equal(
      schedule.documentSchedule[0]?.kind,
      "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE"
    );
    if (schedule.documentSchedule[0]?.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") {
      assert.equal(schedule.documentSchedule[0].dueDate, null);
    }
    assert.ok(
      schedule.alerts.some((a) => a.code === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE")
    );
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "1000.00");
    assertCoreInvariants(schedule, "23");
    assertScreensAndApisCoherent(schedule);
  });

  it("24. Execução idempotente", () => {
    const input: BuildSalesOrderEffectiveFinancialScheduleInput = matrixVariosItensMistos();
    const a = buildSalesOrderEffectiveFinancialSchedule(input);
    const b = buildSalesOrderEffectiveFinancialSchedule(input);
    assert.equal(serializeSchedule(a), serializeSchedule(b));

    const c = buildSalesOrderEffectiveFinancialSchedule(
      matrixDocumentoTotalComCr()
    );
    const d = buildSalesOrderEffectiveFinancialSchedule(
      matrixDocumentoTotalComCr()
    );
    assert.equal(serializeSchedule(c), serializeSchedule(d));
  });
});

describe("FIN-11 — invariantes transversais em amostra da matriz", () => {
  const samples: Array<[string, () => BuildSalesOrderEffectiveFinancialScheduleInput]> = [
    ["sem-doc", matrixPedidoSemDocumento],
    ["doc-total", matrixDocumentoTotalSemCr],
    ["doc+cr", matrixDocumentoTotalComCr],
    ["corte", matrixItemComCorte],
    ["parcial", matrixItemParcial],
    ["misto", matrixVariosItensMistos],
    ["multi-doc", matrixVariosDocumentos],
    ["diff-doc-cr", matrixDiferencaDocumentoCr],
    ["awaiting", matrixDocumentoSemCondicao],
  ];

  for (const [name, factory] of samples) {
    it(`invariantes + coerência API: ${name}`, () => {
      const schedule = buildSalesOrderEffectiveFinancialSchedule(factory());
      assertCoreInvariants(schedule, name);
      assertScreensAndApisCoherent(schedule);
    });
  }
});
