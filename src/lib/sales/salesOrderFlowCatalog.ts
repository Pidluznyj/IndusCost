/**
 * OP-46 — Catálogo central da máquina de estados do Fluxo de Pedidos (Kanban).
 *
 * Fonte normativa: `docs/commercial/sales-order-flow/state-machine.md`
 * Auditoria prévia: `docs/commercial/sales-order-flow/current-state-audit.md`
 *
 * Este módulo formaliza tipos, prioridades, labels, próxima ação e inconsistências.
 * Não coleta evidências Nomus/DB — o motor de classificação fica para OP posteriores.
 */

/** Colunas operacionais do Kanban (pedido). */
export const SALES_ORDER_FLOW_STAGES = [
  "WAITING_RELEASE",
  "WAITING_PRODUCTION_ORDER",
  "IN_PRODUCTION",
  "WAITING_OUTPUT_DOCUMENT",
  "WAITING_NFE",
  "SHIPPED_COMPLETED",
  "CANCELED",
] as const;

export type SalesOrderFlowStage = (typeof SALES_ORDER_FLOW_STAGES)[number];

/**
 * Estágio operacional do item ativo.
 * Mesmos valores do pedido — a coluna do pedido é a primeira obrigação
 * ainda não cumprida entre os itens ativos.
 */
export type SalesOrderItemFlowStage = SalesOrderFlowStage;

/**
 * Condição auxiliar (não é coluna do Kanban).
 * Pode coexistir com qualquer estágio operacional.
 */
export const SALES_ORDER_FLOW_AUXILIARY_CONDITIONS = ["INCONSISTENT"] as const;

export type SalesOrderFlowAuxiliaryCondition =
  (typeof SALES_ORDER_FLOW_AUXILIARY_CONDITIONS)[number];

/**
 * Prioridade da obrigação (menor = mais cedo no fluxo = vence na agregação).
 * CANCELED fica no fim: só vira coluna do pedido quando não há itens ativos.
 */
export const SALES_ORDER_FLOW_STAGE_PRIORITY = {
  WAITING_RELEASE: 10,
  WAITING_PRODUCTION_ORDER: 20,
  IN_PRODUCTION: 30,
  WAITING_OUTPUT_DOCUMENT: 40,
  WAITING_NFE: 50,
  SHIPPED_COMPLETED: 60,
  CANCELED: 90,
} as const satisfies Record<SalesOrderFlowStage, number>;

/** Alias pedido no prompt OP-46. */
export const stagePriority = SALES_ORDER_FLOW_STAGE_PRIORITY;

export const SALES_ORDER_FLOW_STAGE_LABELS = {
  WAITING_RELEASE: "Aguardando liberação",
  WAITING_PRODUCTION_ORDER: "Aguardando OP",
  IN_PRODUCTION: "Em produção",
  WAITING_OUTPUT_DOCUMENT: "Aguardando documento de saída",
  WAITING_NFE: "Aguardando NF-e",
  SHIPPED_COMPLETED: "Enviado / concluído",
  CANCELED: "Cancelado",
} as const satisfies Record<SalesOrderFlowStage, string>;

export type SalesOrderFlowResponsibleArea =
  | "COMERCIAL"
  | "PCP_PRODUCAO"
  | "EXPEDICAO_FATURAMENTO"
  | "FISCAL"
  | "TI"
  | "NENHUMA";

export const SALES_ORDER_FLOW_STAGE_RESPONSIBLE_AREA = {
  WAITING_RELEASE: "COMERCIAL",
  WAITING_PRODUCTION_ORDER: "PCP_PRODUCAO",
  IN_PRODUCTION: "PCP_PRODUCAO",
  WAITING_OUTPUT_DOCUMENT: "EXPEDICAO_FATURAMENTO",
  WAITING_NFE: "FISCAL",
  SHIPPED_COMPLETED: "NENHUMA",
  CANCELED: "NENHUMA",
} as const satisfies Record<SalesOrderFlowStage, SalesOrderFlowResponsibleArea>;

export const SALES_ORDER_FLOW_STAGE_NEXT_ACTION = {
  WAITING_RELEASE: "Liberar itens pendentes no Nomus / acompanhar liberação comercial.",
  WAITING_PRODUCTION_ORDER: "Abrir ou vincular Ordem de Produção aos itens liberados.",
  IN_PRODUCTION: "Acompanhar apontamento/andamento da OP até cobrir a quantidade ativa.",
  WAITING_OUTPUT_DOCUMENT: "Emitir/sincronizar Documento de Saída alocado ao pedido.",
  WAITING_NFE: "Emitir/autorizar NF-e válida vinculada ao documento/pedido.",
  SHIPPED_COMPLETED: "Nenhuma ação operacional pendente no fluxo.",
  CANCELED: "Nenhuma ação operacional — pedido/itens cancelados.",
} as const satisfies Record<SalesOrderFlowStage, string>;

export const SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES = [
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL",
] as const;

export type SalesOrderFlowInconsistencySeverity =
  (typeof SALES_ORDER_FLOW_INCONSISTENCY_SEVERITIES)[number];

/**
 * Códigos de inconsistência (condição auxiliar INCONSISTENT).
 * Não substituem a coluna operacional.
 */
export const SALES_ORDER_FLOW_INCONSISTENCY_CODES = [
  "ITEM_STATUS_UNKNOWN",
  "REQUIRES_PRODUCTION_UNKNOWN",
  "PRODUCTION_QTY_NOT_NORMALIZED",
  "OP_LINK_WITHOUT_QUANTITY",
  "DOCUMENT_WITHOUT_NFE",
  "NFE_WITHOUT_DOCUMENT",
  "NFE_CANCELED_WITH_ACTIVE_ITEMS",
  "NFE_SHIP_DATE_MISSING",
  "PARTIAL_WITHOUT_REMAINING_QTY",
  "CUT_WITHOUT_OFFICIAL_STATUS",
  "FULFILLED_WITHOUT_COVERAGE",
  "EXCESS_COVERAGE",
  "STALE_ITEM_PRESENT",
  "MIXED_ACTIVE_ITEM_STAGES",
  "O2C_ALLOCATION_STALE",
  "DUPLICATE_TRUTH_RISK",
] as const;

export type SalesOrderFlowInconsistencyCode =
  (typeof SALES_ORDER_FLOW_INCONSISTENCY_CODES)[number];

export const SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE = {
  ITEM_STATUS_UNKNOWN: "WARNING",
  REQUIRES_PRODUCTION_UNKNOWN: "WARNING",
  PRODUCTION_QTY_NOT_NORMALIZED: "WARNING",
  OP_LINK_WITHOUT_QUANTITY: "WARNING",
  DOCUMENT_WITHOUT_NFE: "INFO",
  NFE_WITHOUT_DOCUMENT: "WARNING",
  NFE_CANCELED_WITH_ACTIVE_ITEMS: "ERROR",
  NFE_SHIP_DATE_MISSING: "INFO",
  PARTIAL_WITHOUT_REMAINING_QTY: "WARNING",
  CUT_WITHOUT_OFFICIAL_STATUS: "ERROR",
  FULFILLED_WITHOUT_COVERAGE: "WARNING",
  EXCESS_COVERAGE: "WARNING",
  STALE_ITEM_PRESENT: "INFO",
  MIXED_ACTIVE_ITEM_STAGES: "INFO",
  O2C_ALLOCATION_STALE: "WARNING",
  DUPLICATE_TRUTH_RISK: "CRITICAL",
} as const satisfies Record<
  SalesOrderFlowInconsistencyCode,
  SalesOrderFlowInconsistencySeverity
>;

export const SALES_ORDER_FLOW_INCONSISTENCY_LABELS = {
  ITEM_STATUS_UNKNOWN: "Status Nomus do item desconhecido",
  REQUIRES_PRODUCTION_UNKNOWN: "Necessidade de produção não contratada",
  PRODUCTION_QTY_NOT_NORMALIZED: "Quantidade produzida ainda não normalizada no stage",
  OP_LINK_WITHOUT_QUANTITY: "Vínculo OP sem linkedQuantity",
  DOCUMENT_WITHOUT_NFE: "Documento de saída sem NF-e válida",
  NFE_WITHOUT_DOCUMENT: "NF-e vinculada sem documento de saída alocado",
  NFE_CANCELED_WITH_ACTIVE_ITEMS: "NF-e cancelada com itens ativos no fluxo",
  NFE_SHIP_DATE_MISSING: "Data de envio/saída da NF-e não normalizada",
  PARTIAL_WITHOUT_REMAINING_QTY: "Parcial sem saldo residual coerente",
  CUT_WITHOUT_OFFICIAL_STATUS: "Corte inferido sem status oficial FULFILLED_WITH_CUT",
  FULFILLED_WITHOUT_COVERAGE: "Atendido sem cobertura documental/fiscal",
  EXCESS_COVERAGE: "Cobertura documental/fiscal/OP excede a obrigação ativa",
  STALE_ITEM_PRESENT: "Item stale presente no pedido",
  MIXED_ACTIVE_ITEM_STAGES: "Itens ativos em estágios distintos",
  O2C_ALLOCATION_STALE: "Alocação O2C possivelmente defasada",
  DUPLICATE_TRUTH_RISK: "Risco de segunda fonte da verdade",
} as const satisfies Record<SalesOrderFlowInconsistencyCode, string>;

export function isSalesOrderFlowStage(value: unknown): value is SalesOrderFlowStage {
  return (
    typeof value === "string" &&
    (SALES_ORDER_FLOW_STAGES as readonly string[]).includes(value)
  );
}

export function isSalesOrderFlowInconsistencyCode(
  value: unknown
): value is SalesOrderFlowInconsistencyCode {
  return (
    typeof value === "string" &&
    (SALES_ORDER_FLOW_INCONSISTENCY_CODES as readonly string[]).includes(value)
  );
}

export function getSalesOrderFlowStagePriority(stage: SalesOrderFlowStage): number {
  return SALES_ORDER_FLOW_STAGE_PRIORITY[stage];
}

export function getSalesOrderFlowStageLabel(stage: SalesOrderFlowStage): string {
  return SALES_ORDER_FLOW_STAGE_LABELS[stage];
}

export function compareSalesOrderFlowStagePriority(
  a: SalesOrderFlowStage,
  b: SalesOrderFlowStage
): number {
  return getSalesOrderFlowStagePriority(a) - getSalesOrderFlowStagePriority(b);
}

/**
 * Estágios ordenados pela obrigação (primeira → última).
 * CANCELED fica por último na ordenação operacional.
 */
export function listSalesOrderFlowStagesByPriority(): SalesOrderFlowStage[] {
  return [...SALES_ORDER_FLOW_STAGES].sort(compareSalesOrderFlowStagePriority);
}

/**
 * Regra central do Kanban (agregação pura):
 * a coluna do pedido é a primeira obrigação ainda não cumprida
 * entre os estágios dos itens ativos.
 *
 * - Itens `CANCELED` não votam.
 * - Itens `SHIPPED_COMPLETED` só vencem se forem a única obrigação restante
 *   (todos os ativos concluídos).
 * - Se não houver item ativo → `CANCELED`.
 * - Lista vazia → `null` (pedido sem evidência de item).
 */
export function pickSalesOrderFlowStageFromItemStages(
  itemStages: readonly SalesOrderItemFlowStage[]
): SalesOrderFlowStage | null {
  if (itemStages.length === 0) return null;

  const active = itemStages.filter((stage) => stage !== "CANCELED");
  if (active.length === 0) return "CANCELED";

  let earliest: SalesOrderFlowStage = active[0]!;
  for (let i = 1; i < active.length; i += 1) {
    const stage = active[i]!;
    if (compareSalesOrderFlowStagePriority(stage, earliest) < 0) {
      earliest = stage;
    }
  }
  return earliest;
}

export function salesOrderFlowHasAuxiliaryInconsistency(
  codes: readonly SalesOrderFlowInconsistencyCode[]
): boolean {
  return codes.length > 0;
}

export function maxSalesOrderFlowInconsistencySeverity(
  codes: readonly SalesOrderFlowInconsistencyCode[]
): SalesOrderFlowInconsistencySeverity | null {
  if (codes.length === 0) return null;
  const rank: Record<SalesOrderFlowInconsistencySeverity, number> = {
    INFO: 1,
    WARNING: 2,
    ERROR: 3,
    CRITICAL: 4,
  };
  let max: SalesOrderFlowInconsistencySeverity = "INFO";
  for (const code of codes) {
    const severity = SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE[code];
    if (rank[severity] > rank[max]) max = severity;
  }
  return max;
}
