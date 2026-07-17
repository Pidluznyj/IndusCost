/**
 * Fixtures FIN-05 — agenda financeira efetiva.
 */

import type { BuildSalesOrderEffectiveFinancialScheduleInput } from "./salesOrderEffectiveFinancialSchedule.js";

const ORDER_ID = "so-fin05-001";
const ORDER_CODE = "PD 09999";

/** Pedido R$ 10.000 — 2 parcelas iguais, um item. */
export function fixtureOrder10000Base(
  overrides: Partial<BuildSalesOrderEffectiveFinancialScheduleInput> = {}
): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: ORDER_ID,
    orderCode: ORDER_CODE,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "5000.00" },
      { installmentNumber: 2, dueDate: "2026-09-01", amount: "5000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 2,
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      },
    ],
    realReceivables: [],
    documents: [],
    referenceDate: new Date(2026, 6, 17),
    ...overrides,
  };
}

/** Documento R$ 9.000 sem parcelas comprovadas + item parcial (1.000 residual). */
export function fixturePartialWithDoc9000Awaiting(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 3,
        orderedQuantity: 10,
        fulfilledQuantity: 9,
        documentAllocations: [
          {
            allocationKey: "alloc-doc-1",
            allocatedByOrderPrice: "9000.00",
            allocatedByDocumentPrice: "9000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 5001,
        allocatedByOrderPrice: "9000.00",
        provenInstallments: null,
      },
    ],
  });
}

/** Mesmo cenário com condição documental comprovada. */
export function fixturePartialWithDoc9000Proven(): BuildSalesOrderEffectiveFinancialScheduleInput {
  const base = fixturePartialWithDoc9000Awaiting();
  return {
    ...base,
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 5001,
        allocatedByOrderPrice: "9000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-20", amount: "9000.00" },
        ],
      },
    ],
  };
}

/** CR da mesma NF substitui documento — sem duplicar. */
export function fixtureCrReplacesDocumentSameNfe(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          {
            allocationKey: "alloc-doc-1",
            allocatedByOrderPrice: "10000.00",
          },
        ],
        crAllocations: [
          {
            allocationKey: "cr-1",
            amountReceivable: "10000.00",
            amountReceived: "0",
            balanceReceivable: "10000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 7001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-15", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 9001,
        sourceInvoiceId: 7001,
        dueDate: "2026-07-15",
        amountReceivable: "10000.00",
        amountReceived: "0",
        balanceReceivable: "10000.00",
      },
    ],
  });
}

/** Item com corte — sem previsão residual. */
export function fixtureCut10000Doc9000(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    items: [
      {
        salesOrderItemId: "item-cut",
        plannedNetValue: "10000.00",
        status: 5,
        orderedQuantity: 10,
        fulfilledQuantity: 9,
        documentAllocations: [
          {
            allocationKey: "alloc-cut",
            allocatedByOrderPrice: "9000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-cut",
        sourceInvoiceId: 6001,
        allocatedByOrderPrice: "9000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "9000.00" },
        ],
      },
    ],
  });
}

/** Item cancelado. */
export function fixtureCanceledItem(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    items: [
      {
        salesOrderItemId: "item-c",
        plannedNetValue: "10000.00",
        status: 6,
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      },
    ],
  });
}

/** UNKNOWN com cobertura parcial. */
export function fixtureUnknownPartialCoverage(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    items: [
      {
        salesOrderItemId: "item-u",
        plannedNetValue: "10000.00",
        status: 99,
        orderedQuantity: 10,
        fulfilledQuantity: 2,
        documentAllocations: [
          {
            allocationKey: "alloc-u",
            allocatedByOrderPrice: "2000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-u",
        allocatedByOrderPrice: "2000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-01", amount: "2000.00" },
        ],
      },
    ],
  });
}
