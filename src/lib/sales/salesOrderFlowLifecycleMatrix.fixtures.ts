/**
 * OP-76 — Fixtures da matriz completa do motor do Kanban (puro).
 */

import type { ResolveSalesOrderItemFlowInput } from "./salesOrderItemFlowEngine.js";
import { resolveSalesOrderItemFlow } from "./salesOrderItemFlowEngine.js";
import {
  resolveSalesOrderFlow,
  type ResolveSalesOrderFlowOrderContext,
  type ResolveSalesOrderFlowResult,
} from "./salesOrderFlowEngine.js";
import type { ResolveSalesOrderItemFlowResult } from "./salesOrderItemFlowEngine.js";
import type { SalesOrderFlowStage } from "./salesOrderFlowCatalog.js";

export const MATRIX_ORDER_ID = "order-op76-matrix";
export const MATRIX_REF = "2026-07-17T12:00:00.000Z";

export type LifecycleMatrixCase = {
  id: number;
  title: string;
  /** Resultado do item principal (cenários 1–25, 29–30 focam item). */
  item: ResolveSalesOrderItemFlowResult;
  /** Pedido agregado quando o cenário exige votação multi-item. */
  order?: ResolveSalesOrderFlowResult;
  expectedItemStage: SalesOrderFlowStage;
  expectedOrderStage?: SalesOrderFlowStage;
  expectedCodes?: readonly string[];
  /** Asserções extras além do estágio/códigos. */
  extraAssert?: (ctx: {
    item: ResolveSalesOrderItemFlowResult;
    order?: ResolveSalesOrderFlowResult;
  }) => void;
};

export function itemInput(
  partial: Partial<ResolveSalesOrderItemFlowInput> & {
    salesOrderItemId?: string;
  } = {}
): ResolveSalesOrderItemFlowInput {
  return {
    salesOrderItemId: partial.salesOrderItemId ?? "item-1",
    orderedQuantity: partial.orderedQuantity ?? 10,
    fulfilledQuantity: partial.fulfilledQuantity ?? 0,
    status: partial.status ?? 2,
    statusNormalized: partial.statusNormalized ?? "RELEASED",
    referenceDate: partial.referenceDate ?? MATRIX_REF,
    ...partial,
  };
}

export function orderCtx(
  partial: Partial<ResolveSalesOrderFlowOrderContext> = {}
): ResolveSalesOrderFlowOrderContext {
  return {
    salesOrderId: MATRIX_ORDER_ID,
    referenceDate: MATRIX_REF,
    promisedDeliveryAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

function item(
  partial: Partial<ResolveSalesOrderItemFlowInput> & {
    salesOrderItemId?: string;
  } = {}
): ResolveSalesOrderItemFlowResult {
  return resolveSalesOrderItemFlow(itemInput(partial));
}

function caseOf(
  id: number,
  title: string,
  input: Partial<ResolveSalesOrderItemFlowInput> & {
    salesOrderItemId?: string;
  },
  expectedItemStage: SalesOrderFlowStage,
  options?: {
    expectedCodes?: readonly string[];
    extraAssert?: LifecycleMatrixCase["extraAssert"];
  }
): LifecycleMatrixCase {
  const resolved = item(input);
  return {
    id,
    title,
    item: resolved,
    expectedItemStage,
    expectedCodes: options?.expectedCodes,
    extraAssert: options?.extraAssert,
  };
}

/** 1–35 cenários normativos da OP-76 (motor puro). */
export function buildLifecycleMatrixCases(): LifecycleMatrixCase[] {
  const cases: LifecycleMatrixCase[] = [];

  cases.push(
    caseOf(
      1,
      "Pedido aguardando liberação",
      {
        status: 1,
        statusNormalized: "PENDING",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      },
      "WAITING_RELEASE",
      {
        extraAssert: ({ item: r }) => {
          if (!r.isActiveForKanban) throw new Error("item deve votar no Kanban");
          if (!r.activeRemainingQuantity?.eq(10)) {
            throw new Error("saldo ativo deve ser 10");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      2,
      "Pedido liberado (próxima obrigação = OP)",
      {
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [],
      },
      "WAITING_PRODUCTION_ORDER",
      {
        extraAssert: ({ item: r }) => {
          if (r.requiresProduction !== true) {
            throw new Error("liberado com OWN_PROCESS exige produção");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      3,
      "Item fabricado sem OP",
      {
        costingMode: "OWN_PROCESS",
        hasProductBom: true,
        productionOrderLinks: [],
      },
      "WAITING_PRODUCTION_ORDER"
    )
  );

  cases.push(
    caseOf(
      4,
      "OP criada (cobertura suficiente, qty produzida não normalizada)",
      {
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        expectedCodes: ["PRODUCTION_QTY_NOT_NORMALIZED"],
        extraAssert: ({ item: r }) => {
          if (!r.productionOrderQuantity.eq(10)) {
            throw new Error("OP deve cobrir 10");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      5,
      "Produção parcial",
      {
        costingMode: "OWN_PROCESS",
        hasProductBom: true,
        productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
        producedQuantity: 4,
      },
      "IN_PRODUCTION"
    )
  );

  cases.push(
    caseOf(
      6,
      "Produção concluída",
      {
        costingMode: "OWN_PROCESS",
        hasProductRouting: true,
        productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
        producedQuantity: 10,
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        extraAssert: ({ item: r }) => {
          if (r.producedQuantity == null || !r.producedQuantity.eq(10)) {
            throw new Error("producedQuantity deve ser 10");
          }
          if (
            r.inconsistencies.some(
              (i) => i.code === "PRODUCTION_QTY_NOT_NORMALIZED"
            )
          ) {
            throw new Error("qty normalizada não deve emitir PRODUCTION_QTY_NOT_NORMALIZED");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      7,
      "Produto que não exige produção (revenda)",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "SHIPPED_COMPLETED",
      {
        extraAssert: ({ item: r }) => {
          if (r.requiresProduction !== false) {
            throw new Error("revenda não exige produção");
          }
          if (
            r.currentStage === "WAITING_PRODUCTION_ORDER" ||
            r.currentStage === "IN_PRODUCTION"
          ) {
            throw new Error("revenda não deve passar por OP/produção");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      8,
      "Necessidade de produção desconhecida",
      {
        // Sem sinais de produto/OP → UNKNOWN; não forçar coluna OP.
        productionOrderLinks: [],
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        expectedCodes: ["REQUIRES_PRODUCTION_UNKNOWN"],
        extraAssert: ({ item: r }) => {
          if (r.requiresProduction !== null) {
            throw new Error("requiresProduction deve ser null (UNKNOWN)");
          }
          if (r.currentStage === "WAITING_PRODUCTION_ORDER") {
            throw new Error("UNKNOWN não força WAITING_PRODUCTION_ORDER");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      9,
      "Documento parcial",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 4 }],
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        expectedCodes: ["DOCUMENT_WITHOUT_NFE"],
        extraAssert: ({ item: r }) => {
          if (!r.documentedQuantity.eq(4)) throw new Error("doc=4");
          if (!r.progress.documented.eq(40)) throw new Error("progresso doc 40%");
        },
      }
    )
  );

  cases.push(
    caseOf(
      10,
      "Documento completo (ainda sem NF)",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      },
      "WAITING_NFE",
      {
        expectedCodes: ["DOCUMENT_WITHOUT_NFE"],
      }
    )
  );

  cases.push(
    caseOf(
      11,
      "Documento cancelado",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [
          { allocationKey: "d1", quantity: 10, isCanceled: true },
        ],
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        extraAssert: ({ item: r }) => {
          if (!r.documentedQuantity.eq(0)) {
            throw new Error("doc cancelado não cobre");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      12,
      "NF válida",
      {
        productCommercialClass: "STOCK",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 4,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: false,
          },
        ],
      },
      "SHIPPED_COMPLETED",
      {
        expectedCodes: ["NFE_SHIP_DATE_MISSING"],
        extraAssert: ({ item: r }) => {
          if (!r.shippedQuantity.eq(10)) throw new Error("NF válida = envio proxy");
        },
      }
    )
  );

  cases.push(
    caseOf(
      13,
      "NF cancelada",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 7,
            quantity: 10,
            isCanceled: true,
            isValidForBilling: false,
            hasDocument: true,
          },
        ],
      },
      "WAITING_NFE",
      {
        expectedCodes: ["NFE_CANCELED_WITH_ACTIVE_ITEMS"],
        extraAssert: ({ item: r }) => {
          if (!r.invoicedQuantity.eq(0) || !r.shippedQuantity.eq(0)) {
            throw new Error("NF cancelada não cobre envio");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      14,
      "Envio parcial",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 4,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "WAITING_NFE",
      {
        extraAssert: ({ item: r }) => {
          if (!r.shippedQuantity.eq(4)) throw new Error("envio parcial 4");
          if (!r.progress.shipped.eq(40)) throw new Error("progresso envio 40%");
        },
      }
    )
  );

  cases.push(
    caseOf(
      15,
      "Envio completo",
      {
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 10,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "SHIPPED_COMPLETED"
    )
  );

  cases.push(
    caseOf(
      16,
      "Item não atendido",
      {
        status: 1,
        statusNormalized: "PENDING",
        orderedQuantity: 10,
        fulfilledQuantity: 0,
      },
      "WAITING_RELEASE",
      {
        extraAssert: ({ item: r }) => {
          if (r.fulfillment.classification !== "NOT_FULFILLED") {
            throw new Error("classification NOT_FULFILLED");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      17,
      "Item parcial",
      {
        status: 3,
        statusNormalized: "PARTIAL",
        orderedQuantity: 10,
        fulfilledQuantity: 4,
        productCommercialClass: "RESALE",
        documentAllocations: [{ allocationKey: "d1", quantity: 4 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 4,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "WAITING_OUTPUT_DOCUMENT",
      {
        extraAssert: ({ item: r }) => {
          if (r.fulfillment.classification !== "PARTIALLY_FULFILLED") {
            throw new Error("PARTIALLY_FULFILLED");
          }
          if (!r.activeRemainingQuantity?.eq(6)) {
            throw new Error("saldo residual 6");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      18,
      "Item com corte",
      {
        status: 5,
        statusNormalized: "FULFILLED_WITH_CUT",
        orderedQuantity: 10,
        fulfilledQuantity: 7,
        productCommercialClass: "MANUFACTURED",
        productionOrderLinks: [{ linkedQuantity: 7, isCurrent: true }],
        documentAllocations: [{ allocationKey: "d1", quantity: 7 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 7,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "SHIPPED_COMPLETED",
      {
        extraAssert: ({ item: r }) => {
          if (!r.cutQuantity.eq(3)) throw new Error("corte 3");
          if (!r.activeRemainingQuantity?.eq(0)) {
            throw new Error("residual zero após corte");
          }
        },
      }
    )
  );

  cases.push(
    caseOf(
      19,
      "Item cancelado",
      {
        status: 6,
        statusNormalized: "CANCELED",
        orderedQuantity: 10,
        nomusIsCanceled: true,
      },
      "CANCELED",
      {
        extraAssert: ({ item: r }) => {
          if (r.isActiveForKanban) throw new Error("cancelado não vota");
          if (!r.canceledQuantity.eq(10)) throw new Error("canceledQuantity 10");
        },
      }
    )
  );

  cases.push(
    caseOf(
      20,
      "Status desconhecido",
      {
        status: 99,
        statusNormalized: "UNKNOWN",
        orderedQuantity: 8,
        fulfilledQuantity: 2,
      },
      "WAITING_RELEASE",
      {
        expectedCodes: ["ITEM_STATUS_UNKNOWN"],
        extraAssert: ({ item: r }) => {
          if (r.currentStage === "SHIPPED_COMPLETED") {
            throw new Error("UNKNOWN nunca conclui como enviado");
          }
          if (!r.activeRemainingQuantity?.eq(6)) {
            throw new Error("saldo preservado");
          }
        },
      }
    )
  );

  // 21 — várias OPs
  {
    const resolved = item({
      costingMode: "OWN_PROCESS",
      hasProductRouting: true,
      productionOrderLinks: [
        { linkedQuantity: 4, isCurrent: true },
        { linkedQuantity: 6, isCurrent: true },
      ],
      producedQuantity: 10,
    });
    cases.push({
      id: 21,
      title: "Várias OPs",
      item: resolved,
      expectedItemStage: "WAITING_OUTPUT_DOCUMENT",
      extraAssert: ({ item: r }) => {
        if (!r.productionOrderQuantity.eq(10)) {
          throw new Error("soma de OPs deve ser 10");
        }
      },
    });
  }

  // 22 — vários documentos
  {
    const resolved = item({
      productCommercialClass: "RESALE",
      documentAllocations: [
        { allocationKey: "d1", quantity: 3 },
        { allocationKey: "d2", quantity: 7 },
      ],
    });
    cases.push({
      id: 22,
      title: "Vários Documentos",
      item: resolved,
      expectedItemStage: "WAITING_NFE",
      extraAssert: ({ item: r }) => {
        if (!r.documentedQuantity.eq(10)) {
          throw new Error("soma docs deve ser 10");
        }
      },
    });
  }

  // 23 — várias NF-es
  {
    const resolved = item({
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 6,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
        {
          nfeExternalId: 2,
          quantity: 4,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    cases.push({
      id: 23,
      title: "Várias NF-es",
      item: resolved,
      expectedItemStage: "SHIPPED_COMPLETED",
      extraAssert: ({ item: r }) => {
        if (!r.shippedQuantity.eq(10)) {
          throw new Error("soma NFs válidas deve ser 10");
        }
      },
    });
  }

  // 24 — vínculos duplicados
  {
    const resolved = item({
      productCommercialClass: "RESALE",
      documentAllocations: [
        { allocationKey: "same", quantity: 4 },
        { allocationKey: "same", quantity: 4 },
        { allocationKey: "other", quantity: 2 },
      ],
    });
    cases.push({
      id: 24,
      title: "Vínculos duplicados",
      item: resolved,
      expectedItemStage: "WAITING_OUTPUT_DOCUMENT",
      extraAssert: ({ item: r }) => {
        if (!r.documentedQuantity.eq(6)) {
          throw new Error("dedupe por allocationKey: 4+2=6");
        }
      },
    });
  }

  cases.push(
    caseOf(
      25,
      "Quantidade excedente",
      {
        productCommercialClass: "RESALE",
        orderedQuantity: 10,
        documentAllocations: [{ allocationKey: "d1", quantity: 15 }],
        nfeAllocations: [
          {
            nfeExternalId: 1,
            quantity: 15,
            isValidForBilling: true,
            hasDocument: true,
            hasShipDate: true,
          },
        ],
      },
      "SHIPPED_COMPLETED",
      {
        expectedCodes: ["EXCESS_COVERAGE"],
        extraAssert: ({ item: r }) => {
          if (!r.progress.documented.eq(100) || !r.progress.shipped.eq(100)) {
            throw new Error("progresso capped em 100%");
          }
        },
      }
    )
  );

  // 26 — itens em etapas diferentes
  {
    const a = item({
      salesOrderItemId: "A",
      status: 4,
      statusNormalized: "FULFILLED",
      orderedQuantity: 10,
      fulfilledQuantity: 10,
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "da", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const b = item({
      salesOrderItemId: "B",
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "db", quantity: 10 }],
    });
    const c = item({
      salesOrderItemId: "C",
      costingMode: "OWN_PROCESS",
      hasProductRouting: true,
      productionOrderLinks: [{ linkedQuantity: 10, isCurrent: true }],
      producedQuantity: 3,
    });
    const d = item({
      salesOrderItemId: "D",
      costingMode: "OWN_PROCESS",
      hasProductBom: true,
      productionOrderLinks: [],
    });
    const order = resolveSalesOrderFlow(
      [a, b, c, d],
      orderCtx({
        itemFinancials: [
          { salesOrderItemId: "A", plannedNetValue: 100 },
          { salesOrderItemId: "B", plannedNetValue: 100 },
          { salesOrderItemId: "C", plannedNetValue: 100 },
          { salesOrderItemId: "D", plannedNetValue: 100 },
        ],
      })
    );
    cases.push({
      id: 26,
      title: "Pedido com itens em etapas diferentes",
      item: d,
      order,
      expectedItemStage: "WAITING_PRODUCTION_ORDER",
      expectedOrderStage: "WAITING_PRODUCTION_ORDER",
      expectedCodes: ["MIXED_ACTIVE_ITEM_STAGES"],
      extraAssert: ({ order: o }) => {
        if (!o) throw new Error("order required");
        if (o.currentBottleneck?.salesOrderItemId !== "D") {
          throw new Error("bottleneck D");
        }
        if (o.pendingItems !== 3) throw new Error("pendingItems 3");
        if (!o.badges.includes("MIXED_STAGES")) {
          throw new Error("badge MIXED_STAGES");
        }
      },
    });
  }

  // 27 — concluído com corte
  {
    const cut = item({
      salesOrderItemId: "cut",
      status: 5,
      statusNormalized: "FULFILLED_WITH_CUT",
      orderedQuantity: 10,
      fulfilledQuantity: 6,
      productCommercialClass: "MANUFACTURED",
      productionOrderLinks: [{ linkedQuantity: 6, isCurrent: true }],
      documentAllocations: [{ allocationKey: "d", quantity: 6 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 6,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const order = resolveSalesOrderFlow(
      [cut],
      orderCtx({
        itemFinancials: [{ salesOrderItemId: "cut", plannedNetValue: 100 }],
        itemShippedAt: [
          { salesOrderItemId: "cut", shippedAt: "2026-07-10T10:00:00.000Z" },
        ],
      })
    );
    cases.push({
      id: 27,
      title: "Pedido concluído com corte",
      item: cut,
      order,
      expectedItemStage: "SHIPPED_COMPLETED",
      expectedOrderStage: "SHIPPED_COMPLETED",
      extraAssert: ({ order: o }) => {
        if (!o) throw new Error("order required");
        if (!o.badges.includes("CUT") || !o.badges.includes("COMPLETED")) {
          throw new Error("badges CUT+COMPLETED");
        }
        if (!o.cutValue.eq(40)) throw new Error("cutValue 40");
      },
    });
  }

  // 28 — parcial ainda aberto
  {
    const pending = item({
      salesOrderItemId: "p",
      status: 1,
      statusNormalized: "PENDING",
      orderedQuantity: 10,
    });
    const partial = item({
      salesOrderItemId: "q",
      status: 3,
      statusNormalized: "PARTIAL",
      orderedQuantity: 10,
      fulfilledQuantity: 4,
      productCommercialClass: "RESALE",
    });
    const order = resolveSalesOrderFlow(
      [pending, partial],
      orderCtx({
        itemFinancials: [
          { salesOrderItemId: "p", plannedNetValue: "100.00" },
          { salesOrderItemId: "q", plannedNetValue: "100.00" },
        ],
      })
    );
    cases.push({
      id: 28,
      title: "Pedido parcial ainda aberto",
      item: pending,
      order,
      expectedItemStage: "WAITING_RELEASE",
      expectedOrderStage: "WAITING_RELEASE",
      extraAssert: ({ order: o }) => {
        if (!o) throw new Error("order required");
        if (!o.isInActiveOperationalColumn) {
          throw new Error("ainda em coluna operacional");
        }
        if (!o.badges.includes("PARTIAL")) throw new Error("badge PARTIAL");
        if (o.currentStage === "SHIPPED_COMPLETED") {
          throw new Error("não conclui com saldo aberto");
        }
      },
    });
  }

  // 29 — retorno após cancelamento de Documento
  {
    const before = item({
      salesOrderItemId: "doc-ret",
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d1", quantity: 10 }],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
    });
    const after = item({
      salesOrderItemId: "doc-ret",
      productCommercialClass: "RESALE",
      documentAllocations: [
        { allocationKey: "d1", quantity: 10, isCanceled: true },
      ],
      nfeAllocations: [
        {
          nfeExternalId: 1,
          quantity: 10,
          isValidForBilling: true,
          hasDocument: false,
          hasShipDate: true,
        },
      ],
    });
    cases.push({
      id: 29,
      title: "Retorno após cancelamento de Documento",
      item: after,
      expectedItemStage: "WAITING_OUTPUT_DOCUMENT",
      expectedCodes: ["NFE_WITHOUT_DOCUMENT"],
      extraAssert: () => {
        if (before.currentStage !== "SHIPPED_COMPLETED") {
          throw new Error("antes: SHIPPED_COMPLETED");
        }
        if (after.currentStage === before.currentStage) {
          throw new Error("deve regredir após cancelar Documento");
        }
        if (!after.documentedQuantity.eq(0)) {
          throw new Error("doc cancelado zera cobertura");
        }
      },
    });
  }

  // 30 — retorno após cancelamento de NF
  {
    const before = item({
      salesOrderItemId: "nf-ret",
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d2", quantity: 5 }],
      nfeAllocations: [
        {
          nfeExternalId: 2,
          quantity: 5,
          isValidForBilling: true,
          hasDocument: true,
          hasShipDate: true,
        },
      ],
      orderedQuantity: 5,
    });
    const after = item({
      salesOrderItemId: "nf-ret",
      productCommercialClass: "RESALE",
      documentAllocations: [{ allocationKey: "d2", quantity: 5 }],
      nfeAllocations: [
        {
          nfeExternalId: 2,
          quantity: 5,
          isCanceled: true,
          isValidForBilling: false,
          hasDocument: true,
        },
      ],
      orderedQuantity: 5,
    });
    const orderBefore = resolveSalesOrderFlow([before], orderCtx());
    const orderAfter = resolveSalesOrderFlow([after], orderCtx());
    cases.push({
      id: 30,
      title: "Retorno após cancelamento de NF",
      item: after,
      order: orderAfter,
      expectedItemStage: "WAITING_NFE",
      expectedOrderStage: "WAITING_NFE",
      expectedCodes: ["NFE_CANCELED_WITH_ACTIVE_ITEMS"],
      extraAssert: () => {
        if (orderBefore.currentStage !== "SHIPPED_COMPLETED") {
          throw new Error("antes: pedido SHIPPED_COMPLETED");
        }
        if (orderAfter.currentStage === orderBefore.currentStage) {
          throw new Error("pedido deve regredir com NF cancelada");
        }
      },
    });
  }

  return cases;
}
