/**
 * FIN-11 — Fixtures da matriz completa da agenda financeira efetiva.
 */

import type { BuildSalesOrderEffectiveFinancialScheduleInput } from "./salesOrderEffectiveFinancialSchedule.js";
import {
  fixtureCanceledItem,
  fixtureCrReplacesDocumentSameNfe,
  fixtureCut10000Doc9000,
  fixtureOrder10000Base,
  fixturePartialWithDoc9000Awaiting,
  fixturePartialWithDoc9000Proven,
  fixtureUnknownPartialCoverage,
} from "./salesOrderEffectiveFinancialSchedule.fixtures.js";

const REF = new Date(2026, 6, 17, 12, 0, 0, 0);

export const MATRIX_REF = REF;

/** 1 — Pedido sem Documento. */
export function matrixPedidoSemDocumento(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({ referenceDate: REF });
}

/** 2 — Pedido com Documento total e sem CR. */
export function matrixDocumentoTotalSemCr(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "alloc-full", allocatedByOrderPrice: "10000.00" },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-full",
        sourceInvoiceId: 81001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-25", amount: "4000.00" },
          { installmentNumber: 2, dueDate: "2026-08-25", amount: "6000.00" },
        ],
      },
    ],
  });
}

/** 3 — Pedido com Documento total e CR. */
export function matrixDocumentoTotalComCr(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureCrReplacesDocumentSameNfe();
}

/** 4 — Item totalmente atendido (sem residual). */
export function matrixItemTotalmenteAtendido(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return matrixDocumentoTotalSemCr();
}

/** 5 — Item atendido com corte. */
export function matrixItemComCorte(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureCut10000Doc9000();
}

/** 6 — Item atendido parcialmente. */
export function matrixItemParcial(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixturePartialWithDoc9000Proven();
}

/** 7 — Item não atendido. */
export function matrixItemNaoAtendido(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-open",
        plannedNetValue: "10000.00",
        status: 2,
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      },
    ],
  });
}

/** 8 — Item cancelado. */
export function matrixItemCancelado(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureCanceledItem();
}

/** 9 — Status desconhecido. */
export function matrixStatusDesconhecido(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureUnknownPartialCoverage();
}

/** 10 — Vários itens com situações diferentes. */
export function matrixVariosItensMistos(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: "so-fin11-mixed",
    orderCode: "PD 11010",
    referenceDate: REF,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "6000.00" },
      { installmentNumber: 2, dueDate: "2026-09-01", amount: "6000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-fulfilled",
        plannedNetValue: "4000.00",
        status: 4,
        orderedQuantity: 4,
        fulfilledQuantity: 4,
        documentAllocations: [
          { allocationKey: "d-f", allocatedByOrderPrice: "4000.00" },
        ],
      },
      {
        salesOrderItemId: "item-partial",
        plannedNetValue: "4000.00",
        status: 3,
        orderedQuantity: 4,
        fulfilledQuantity: 2,
        documentAllocations: [
          { allocationKey: "d-p", allocatedByOrderPrice: "2000.00" },
        ],
      },
      {
        salesOrderItemId: "item-cut",
        plannedNetValue: "2000.00",
        status: 5,
        orderedQuantity: 2,
        fulfilledQuantity: 1,
        documentAllocations: [
          { allocationKey: "d-c", allocatedByOrderPrice: "1000.00" },
        ],
      },
      {
        salesOrderItemId: "item-canceled",
        plannedNetValue: "2000.00",
        status: 6,
        orderedQuantity: 2,
        fulfilledQuantity: 0,
      },
    ],
    documents: [
      {
        documentKey: "doc-mixed-a",
        sourceInvoiceId: 82001,
        allocatedByOrderPrice: "4000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-20", amount: "4000.00" },
        ],
      },
      {
        documentKey: "doc-mixed-b",
        sourceInvoiceId: 82002,
        allocatedByOrderPrice: "2000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-22", amount: "2000.00" },
        ],
      },
      {
        documentKey: "doc-mixed-c",
        sourceInvoiceId: 82003,
        allocatedByOrderPrice: "1000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-23", amount: "1000.00" },
        ],
      },
    ],
    realReceivables: [],
  };
}

/** 11 — Vários Documentos. */
export function matrixVariosDocumentos(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: "so-fin11-docs",
    orderCode: "PD 11011",
    referenceDate: REF,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "10000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 3,
        orderedQuantity: 10,
        fulfilledQuantity: 7,
        documentAllocations: [
          { allocationKey: "d1", allocatedByOrderPrice: "4000.00" },
          { allocationKey: "d2", allocatedByOrderPrice: "3000.00" },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 83001,
        allocatedByOrderPrice: "4000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "4000.00" },
        ],
      },
      {
        documentKey: "doc-2",
        sourceInvoiceId: 83002,
        allocatedByOrderPrice: "3000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-15", amount: "3000.00" },
        ],
      },
    ],
    realReceivables: [],
  };
}

/**
 * 12 — Documento com várias NF-es (duas NFes cobrindo o mesmo faturamento do pedido,
 * sem CR — ambas entram na agenda documental).
 */
export function matrixDocumentoVariasNfes(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return {
    salesOrderId: "so-fin11-multi-nfe",
    orderCode: "PD 11012",
    referenceDate: REF,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-08-01", amount: "10000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "nfe-a", allocatedByOrderPrice: "6000.00" },
          { allocationKey: "nfe-b", allocatedByOrderPrice: "4000.00" },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-saida-1:nfe-a",
        sourceInvoiceId: 84001,
        allocatedByOrderPrice: "6000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-18", amount: "6000.00" },
        ],
      },
      {
        documentKey: "doc-saida-1:nfe-b",
        sourceInvoiceId: 84002,
        allocatedByOrderPrice: "4000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-19", amount: "4000.00" },
        ],
      },
    ],
    realReceivables: [],
  };
}

/** 13 — CR com várias parcelas. */
export function matrixCrVariasParcelas(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "d", allocatedByOrderPrice: "10000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr-1",
            amountReceivable: "5000.00",
            amountReceived: "0",
            balanceReceivable: "5000.00",
          },
          {
            allocationKey: "cr-2",
            amountReceivable: "5000.00",
            amountReceived: "0",
            balanceReceivable: "5000.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 85001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 95001,
        sourceInvoiceId: 85001,
        dueDate: "2026-07-30",
        amountReceivable: "5000.00",
        amountReceived: "0",
        balanceReceivable: "5000.00",
      },
      {
        externalId: 95002,
        sourceInvoiceId: 85001,
        dueDate: "2026-08-30",
        amountReceivable: "5000.00",
        amountReceived: "0",
        balanceReceivable: "5000.00",
      },
    ],
  });
}

/** 14 — CR parcialmente recebido. */
export function matrixCrParcialmenteRecebido(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "d", allocatedByOrderPrice: "10000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr-1",
            amountReceivable: "10000.00",
            amountReceived: "3500.00",
            balanceReceivable: "6500.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 86001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 96001,
        sourceInvoiceId: 86001,
        dueDate: "2026-07-20",
        amountReceivable: "10000.00",
        amountReceived: "3500.00",
        balanceReceivable: "6500.00",
      },
    ],
  });
}

/** 15 — CR totalmente recebido. */
export function matrixCrTotalmenteRecebido(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "d", allocatedByOrderPrice: "10000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr-1",
            amountReceivable: "10000.00",
            amountReceived: "10000.00",
            balanceReceivable: "0",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 87001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 97001,
        sourceInvoiceId: 87001,
        dueDate: "2026-07-20",
        amountReceivable: "10000.00",
        amountReceived: "10000.00",
        balanceReceivable: "0",
      },
    ],
  });
}

/** 16 — Diferença entre Documento e CR (mesma NF: CR prevalece, sem soma). */
export function matrixDiferencaDocumentoCr(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          {
            allocationKey: "d",
            allocatedByOrderPrice: "10000.00",
            allocatedByDocumentPrice: "10000.00",
          },
        ],
        crAllocations: [
          {
            allocationKey: "cr-1",
            amountReceivable: "9500.00",
            amountReceived: "0",
            balanceReceivable: "9500.00",
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-1",
        sourceInvoiceId: 88001,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 98001,
        sourceInvoiceId: 88001,
        dueDate: "2026-07-22",
        amountReceivable: "9500.00",
        amountReceived: "0",
        balanceReceivable: "9500.00",
      },
    ],
  });
}

/** 18 — Documento cancelado (isValid=false). */
export function matrixDocumentoCancelado(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 3,
        orderedQuantity: 10,
        fulfilledQuantity: 5,
        documentAllocations: [
          {
            allocationKey: "d-canceled",
            allocatedByOrderPrice: "5000.00",
            isValid: false,
          },
        ],
      },
    ],
    documents: [
      {
        documentKey: "doc-canceled",
        sourceInvoiceId: 89001,
        isValid: false,
        allocatedByOrderPrice: "5000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-10", amount: "5000.00" },
        ],
      },
    ],
  });
}

/** 19 — NF cancelada (documento inválido + alocação inválida). */
export function matrixNfCancelada(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return matrixDocumentoCancelado();
}

/** 21 — Previsão residual vencida. */
export function matrixPrevisaoResidualVencida(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-01-01", amount: "5000.00" },
      { installmentNumber: 2, dueDate: "2026-02-01", amount: "5000.00" },
    ],
  });
}

/** 22 — Previsão substituída vencida (sem alerta de residual ativo). */
export function matrixPrevisaoSubstituidaVencida(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixtureOrder10000Base({
    referenceDate: REF,
    originalInstallments: [
      { installmentNumber: 1, dueDate: "2026-01-01", amount: "5000.00" },
      { installmentNumber: 2, dueDate: "2026-02-01", amount: "5000.00" },
    ],
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "10000.00",
        status: 4,
        orderedQuantity: 10,
        fulfilledQuantity: 10,
        documentAllocations: [
          { allocationKey: "d", allocatedByOrderPrice: "10000.00" },
        ],
        crAllocations: [
          {
            allocationKey: "cr",
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
        sourceInvoiceId: 90011,
        allocatedByOrderPrice: "10000.00",
        provenInstallments: [
          { installmentNumber: 1, dueDate: "2026-07-15", amount: "10000.00" },
        ],
      },
    ],
    realReceivables: [
      {
        externalId: 99011,
        sourceInvoiceId: 90011,
        dueDate: "2026-07-15",
        amountReceivable: "10000.00",
        amountReceived: "0",
        balanceReceivable: "10000.00",
      },
    ],
  });
}

/** 23 — Documento sem condição de pagamento. */
export function matrixDocumentoSemCondicao(): BuildSalesOrderEffectiveFinancialScheduleInput {
  return fixturePartialWithDoc9000Awaiting();
}
