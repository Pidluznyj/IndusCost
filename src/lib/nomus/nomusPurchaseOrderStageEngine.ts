/**
 * PURCH-MIRROR-01 — Motor puro de classificação de fase operacional do
 * Pedido de Compra Nomus.
 *
 * Recebe status BRUTOS por item (código Nomus 1..8, ou string desconhecida)
 * e o status bruto do cabeçalho quando existir, e produz uma fase derivada
 * (`NomusPurchaseOrderDerivedStage`) para uso em UI/API/indicadores.
 *
 * Regras duras:
 *  - função pura, sem I/O, sem Prisma;
 *  - NUNCA sobrescreve/descarta o status bruto (o chamador sempre grava
 *    nomusStatusCode/nomusStatusName brutos separadamente);
 *  - NUNCA escreve de volta no Nomus — é só leitura/derivação;
 *  - status desconhecido nunca é "adivinhado" como um dos conhecidos — cai
 *    em MISTO com o motivo explícito preservado.
 *
 * Mapa de status brutos historicamente observado/documentado (ver
 * docs/NOMUS_PURCHASE_ORDERS_MIRROR.md — "Status brutos" para a lista de
 * incertezas ainda não validadas contra a API real):
 *   1 = Aguardando liberação   5 = Atendido com corte
 *   2 = Liberado               6 = Cancelado
 *   3 = Atendido parcialmente  7 = Devolvido parcialmente
 *   4 = Atendido totalmente    8 = Devolvido totalmente
 */

export type NomusPurchaseOrderDerivedStage =
  | "AGUARDANDO_LIBERACAO"
  | "LIBERADO"
  | "PARCIALMENTE_ATENDIDO"
  | "CONCLUIDO"
  | "ATENDIDO_COM_CORTE"
  | "CANCELADO"
  | "DEVOLUCAO"
  | "MISTO";

/** Categoria semântica de um código de status bruto de item. */
export type NomusPurchaseOrderRawItemStatusCategory =
  | "AWAITING_RELEASE"
  | "RELEASED"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "FULFILLED_WITH_CUT"
  | "CANCELED"
  | "RETURNED_PARTIAL"
  | "RETURNED_TOTAL"
  | "UNKNOWN";

const RAW_STATUS_CATEGORY_BY_CODE: Record<
  string,
  NomusPurchaseOrderRawItemStatusCategory
> = {
  "1": "AWAITING_RELEASE",
  "2": "RELEASED",
  "3": "PARTIALLY_FULFILLED",
  "4": "FULFILLED",
  "5": "FULFILLED_WITH_CUT",
  "6": "CANCELED",
  "7": "RETURNED_PARTIAL",
  "8": "RETURNED_TOTAL",
};

/**
 * Classifica um único código de status bruto de item. Código desconhecido
 * (fora de 1..8, vazio, ou não numérico) → UNKNOWN, nunca inventado.
 */
export function classifyNomusPurchaseOrderRawItemStatus(
  rawStatusCode: string | number | null | undefined
): NomusPurchaseOrderRawItemStatusCategory {
  if (rawStatusCode === null || rawStatusCode === undefined) return "UNKNOWN";
  const key = String(rawStatusCode).trim();
  if (!key) return "UNKNOWN";
  return RAW_STATUS_CATEGORY_BY_CODE[key] ?? "UNKNOWN";
}

export type NomusPurchaseOrderItemForStage = {
  /** Código de status bruto do item (string ou number, como veio do Nomus). */
  rawStatusCode: string | number | null | undefined;
};

export type NomusPurchaseOrderStageClassification = {
  stage: NomusPurchaseOrderDerivedStage;
  reason: string;
  /** Contagem por categoria — útil para debug/auditoria do motor. */
  categoryCounts: Record<NomusPurchaseOrderRawItemStatusCategory, number>;
};

function emptyCategoryCounts(): Record<
  NomusPurchaseOrderRawItemStatusCategory,
  number
> {
  return {
    AWAITING_RELEASE: 0,
    RELEASED: 0,
    PARTIALLY_FULFILLED: 0,
    FULFILLED: 0,
    FULFILLED_WITH_CUT: 0,
    CANCELED: 0,
    RETURNED_PARTIAL: 0,
    RETURNED_TOTAL: 0,
    UNKNOWN: 0,
  };
}

/**
 * Classifica a fase operacional derivada de um Pedido de Compra a partir dos
 * status brutos de seus itens. Regras (nesta ordem de precedência):
 *
 *  1. sem itens → MISTO (não há base para derivar; motivo NO_ITEMS).
 *  2. algum item com status UNKNOWN → MISTO (nunca adivinha; motivo
 *     UNKNOWN_STATUS_PRESENT — precedência alta porque um código não
 *     mapeado pode mudar a leitura correta do pedido inteiro).
 *  3. todos os itens CANCELED → CANCELADO.
 *  4. todos os itens RETURNED_PARTIAL/RETURNED_TOTAL (mistura entre os
 *     dois permitida) → DEVOLUCAO.
 *  5. todos os itens FULFILLED → CONCLUIDO.
 *  6. todos os itens FULFILLED_WITH_CUT (ou mistura de FULFILLED +
 *     FULFILLED_WITH_CUT, sem nenhum pendente) → ATENDIDO_COM_CORTE.
 *  7. existe pelo menos um item com saldo pendente (AWAITING_RELEASE,
 *     RELEASED, PARTIALLY_FULFILLED) E pelo menos um item já
 *     concluído/cortado/cancelado/devolvido → PARCIALMENTE_ATENDIDO
 *     (misto operacional esperado: pedido em atendimento parcial).
 *  8. todos os itens RELEASED → LIBERADO.
 *  9. todos os itens AWAITING_RELEASE → AGUARDANDO_LIBERACAO.
 *  10. qualquer outra combinação não coberta explicitamente → MISTO
 *      (nunca inventa uma regra nova silenciosamente).
 */
export function classifyNomusPurchaseOrderStage(
  items: readonly NomusPurchaseOrderItemForStage[]
): NomusPurchaseOrderStageClassification {
  const categoryCounts = emptyCategoryCounts();

  if (!items || items.length === 0) {
    return { stage: "MISTO", reason: "NO_ITEMS", categoryCounts };
  }

  const categories = items.map((item) =>
    classifyNomusPurchaseOrderRawItemStatus(item.rawStatusCode)
  );
  for (const category of categories) categoryCounts[category] += 1;

  if (categoryCounts.UNKNOWN > 0) {
    return { stage: "MISTO", reason: "UNKNOWN_STATUS_PRESENT", categoryCounts };
  }

  const total = categories.length;
  const isAll = (pred: (c: NomusPurchaseOrderRawItemStatusCategory) => boolean) =>
    categories.every(pred);

  if (isAll((c) => c === "CANCELED")) {
    return { stage: "CANCELADO", reason: "ALL_ITEMS_CANCELED", categoryCounts };
  }

  if (
    categoryCounts.RETURNED_PARTIAL + categoryCounts.RETURNED_TOTAL === total &&
    (categoryCounts.RETURNED_PARTIAL > 0 || categoryCounts.RETURNED_TOTAL > 0)
  ) {
    return { stage: "DEVOLUCAO", reason: "ALL_ITEMS_RETURNED", categoryCounts };
  }

  if (isAll((c) => c === "FULFILLED")) {
    return { stage: "CONCLUIDO", reason: "ALL_ITEMS_FULFILLED", categoryCounts };
  }

  const pendingCount =
    categoryCounts.AWAITING_RELEASE +
    categoryCounts.RELEASED +
    categoryCounts.PARTIALLY_FULFILLED;
  const settledCount =
    categoryCounts.FULFILLED +
    categoryCounts.FULFILLED_WITH_CUT +
    categoryCounts.CANCELED +
    categoryCounts.RETURNED_PARTIAL +
    categoryCounts.RETURNED_TOTAL;

  if (
    categoryCounts.FULFILLED + categoryCounts.FULFILLED_WITH_CUT === total &&
    categoryCounts.FULFILLED_WITH_CUT > 0
  ) {
    return {
      stage: "ATENDIDO_COM_CORTE",
      reason: "ALL_ITEMS_FULFILLED_OR_CUT",
      categoryCounts,
    };
  }

  if (pendingCount > 0 && settledCount > 0) {
    return {
      stage: "PARCIALMENTE_ATENDIDO",
      reason: "MIX_OF_PENDING_AND_SETTLED_ITEMS",
      categoryCounts,
    };
  }

  if (isAll((c) => c === "RELEASED")) {
    return { stage: "LIBERADO", reason: "ALL_ITEMS_RELEASED", categoryCounts };
  }

  if (isAll((c) => c === "AWAITING_RELEASE")) {
    return {
      stage: "AGUARDANDO_LIBERACAO",
      reason: "ALL_ITEMS_AWAITING_RELEASE",
      categoryCounts,
    };
  }

  if (categoryCounts.PARTIALLY_FULFILLED > 0 && settledCount === 0) {
    return {
      stage: "PARCIALMENTE_ATENDIDO",
      reason: "SOME_ITEMS_PARTIALLY_FULFILLED",
      categoryCounts,
    };
  }

  return { stage: "MISTO", reason: "UNMAPPED_COMBINATION", categoryCounts };
}
