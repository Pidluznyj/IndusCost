/**
 * FASE 2C — fiação PURA "documento resolvido + pedido → alocação".
 *
 * Este é o passo que produz `stockDocuments[].allocatedValue`, o único insumo
 * dependente de OrderToCashAuditFact que comprovadamente MOVE o número do
 * Fluxo de Caixa (ver cashFlowLightProjectionFeasibility.test.ts).
 *
 * Antes vivia inline em `loadOrderFullAuditUncached`. Foi extraído para que o
 * auditor 360º e o loader leve do Fluxo de Caixa usem a MESMA implementação —
 * não duas cópias que podem divergir com o tempo.
 *
 * As três funções de regra (`allocationLinesFromResolvedO2c`,
 * `projectOutputDocumentAllocation`, `allocatedValueForSalesOrder`) já eram
 * puras e exportadas; o que estava duplicável era a FIAÇÃO entre elas —
 * inclusive a precedência resolver > facts e o preenchimento de
 * `externalProductId` no caminho de fallback. É isso que mora aqui.
 *
 * Sem Prisma. Sem I/O. Recebe dados já carregados.
 */

import {
  allocatedValueForSalesOrder,
  allocationLinesFromResolvedO2c,
  projectOutputDocumentAllocation,
  type OutputDocumentAllocationOrderItemHint,
  type OutputDocumentAllocationProjection,
  type OutputDocumentAllocationStageDocumentInput,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";

/** Linhas do resolver DS-03.7 (`ResolvedOutputDocument.o2c.allocationLines`). */
export type ResolvedAllocationLines = Parameters<
  typeof allocationLinesFromResolvedO2c
>[0];

/**
 * Fact O2C usado como FALLBACK quando o documento não veio do resolver.
 * Mesmo shape que o audit já montava.
 */
export type OutputDocumentFallbackFactLine = {
  stockDocumentItemId?: string | null;
  salesOrderId?: string | null;
  salesOrderItemId?: string | null;
  orderCode?: string | null;
  allocatedValueByDocumentPrice?: unknown;
  quantityUsedForOrder?: unknown;
  stockDocumentItemExternalProductId?: number | null;
};

export type ProjectOutputDocumentForSalesOrderInput = {
  document: OutputDocumentAllocationStageDocumentInput;
  /** Linhas do resolver; `null` quando o documento não foi resolvido. */
  resolvedAllocationLines: ResolvedAllocationLines | null;
  /** Facts do documento — só entram quando não há resolver. */
  fallbackFacts: ReadonlyArray<OutputDocumentFallbackFactLine>;
  orderItemHints: ReadonlyArray<OutputDocumentAllocationOrderItemHint>;
  salesOrderId: string;
  orderCode: string | null;
  /** productExternalId por salesOrderItemId — completa o fallback. */
  productExternalIdBySalesOrderItemId?: ReadonlyMap<string, number | null>;
};

export type ProjectedOutputDocumentForSalesOrder = {
  projection: OutputDocumentAllocationProjection;
  allocatedValueCents: number;
  allocatedValue: number;
};

export function projectOutputDocumentForSalesOrder(
  input: ProjectOutputDocumentForSalesOrderInput
): ProjectedOutputDocumentForSalesOrder {
  // Precedência idêntica à do audit: resolver DS-03.7 primeiro; facts só
  // quando o documento não foi resolvido.
  const allocationLines = input.resolvedAllocationLines
    ? allocationLinesFromResolvedO2c(
        input.resolvedAllocationLines,
        input.document.items.map((item) => ({
          stockDocumentItemId: item.id,
          externalProductId: item.externalProductId ?? null,
        }))
      )
    : input.fallbackFacts.map((f) => ({
        stockDocumentItemId: f.stockDocumentItemId ?? null,
        salesOrderId: f.salesOrderId ?? input.salesOrderId,
        salesOrderItemId: f.salesOrderItemId ?? null,
        orderCode: f.orderCode ?? input.orderCode ?? null,
        allocatedValueByDocumentPrice: f.allocatedValueByDocumentPrice,
        quantityUsedForOrder: f.quantityUsedForOrder,
        externalProductId:
          f.stockDocumentItemExternalProductId ??
          (f.salesOrderItemId
            ? input.productExternalIdBySalesOrderItemId?.get(
                f.salesOrderItemId
              ) ?? null
            : null),
      }));

  const projection = projectOutputDocumentAllocation({
    document: input.document,
    allocationLines,
    orderItemHints: input.orderItemHints,
    focusSalesOrderId: input.salesOrderId,
  });

  const forThisOrder = allocatedValueForSalesOrder(
    projection,
    input.salesOrderId
  );

  return {
    projection,
    allocatedValueCents: forThisOrder.allocatedValueCents,
    allocatedValue: forThisOrder.allocatedValue,
  };
}
