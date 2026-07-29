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
  /** Coluna visual de produção do Kanban (pedidos oficiais com OP pendente/aberta). */
  WAITING_PRODUCTION_ORDER: "Em produção",
  /** Produção com apontamento parcial normalizado (distinct de WAITING_PRODUCTION_ORDER). */
  IN_PRODUCTION: "Em apontamento",
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

/**
 * Motivos determinísticos do estágio do item (auditoria / stageReason).
 * Mensagens humanas permanecem em português; o código é o prefixo canônico.
 */
export const SALES_ORDER_ITEM_FLOW_STAGE_REASON = {
  PRODUCTION_ORDER_MISSING:
    "PRODUCTION_ORDER_MISSING — Saldo residual exige produção e não há OP válida vinculada para cobri-lo.",
  PRODUCTION_ORDER_QUANTITY_INSUFFICIENT:
    "PRODUCTION_ORDER_QUANTITY_INSUFFICIENT — Cobertura de OP insuficiente para o saldo residual — há OP parcial; falta complementar a cobertura (não é ausência total de OP).",
  PRODUCTION_ORDER_RELEASED_AWAITING_EXECUTION:
    "PRODUCTION_ORDER_RELEASED_AWAITING_EXECUTION — OP Liberada cobre o planejamento; aguarda evidência real de execução (não é produção concluída).",
  PRODUCTION_ORDER_REQUISITIONED_AWAITING_EXECUTION_EVIDENCE:
    "PRODUCTION_ORDER_REQUISITIONED_AWAITING_EXECUTION_EVIDENCE — OP Requisitada cobre o planejamento; aguarda evidência real de execução (não presume produção).",
  PRODUCTION_ORDER_CLOSED_AWAITING_OUTPUT_DOCUMENT:
    "PRODUCTION_ORDER_CLOSED_AWAITING_OUTPUT_DOCUMENT — OP Encerrada cobre a obrigação; falta Documento de Saída.",
  PRODUCTION_ORDER_AWAITING_EXECUTION_EVIDENCE:
    "PRODUCTION_ORDER_AWAITING_EXECUTION_EVIDENCE — OP planejada cobre o residual sem evidência de execução; permanece aguardando produção.",
  PRODUCED_QUANTITY_PARTIAL:
    "PRODUCED_QUANTITY_PARTIAL — Quantidade produzida real parcial; produção em andamento.",
  DOCUMENTED_AWAITING_NFE:
    "DOCUMENTED_AWAITING_NFE — Documento de Saída cobre a obrigação; falta NF-e válida.",
  PARTIALLY_DOCUMENTED_AWAITING_REMAINING_OUTPUT:
    "PARTIALLY_DOCUMENTED_AWAITING_REMAINING_OUTPUT — Documento de Saída parcial; falta complementar a cobertura documental.",
  INVOICED_QUANTITY_COMPLETED:
    "INVOICED_QUANTITY_COMPLETED — NF-e válida cobre a obrigação (envio/conclusão).",
  UNKNOWN_STATUS_WITHOUT_DOWNSTREAM_EVIDENCE:
    "UNKNOWN_STATUS_WITHOUT_DOWNSTREAM_EVIDENCE — Status comercial desconhecido sem evidência operacional de DS/NF-e; mantém aguardando liberação.",
} as const;

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
  "DOCUMENT_QUANTITY_NOT_NORMALIZED",
  "DOCUMENT_WITHOUT_NFE",
  "NFE_WITHOUT_DOCUMENT",
  "NFE_ITEM_ALLOCATION_AMBIGUOUS",
  "NFE_CANCELED_WITH_ACTIVE_ITEMS",
  "NFE_SHIP_DATE_MISSING",
  "PARTIAL_WITHOUT_REMAINING_QTY",
  "CUT_WITHOUT_OFFICIAL_STATUS",
  "FULFILLED_WITHOUT_COVERAGE",
  "FULFILLED_WITHOUT_PRODUCTION",
  "EXCESS_COVERAGE",
  "STALE_ITEM_PRESENT",
  "MIXED_ACTIVE_ITEM_STAGES",
  "O2C_ALLOCATION_STALE",
  "DUPLICATE_TRUTH_RISK",
  "ORDER_COMPLETED_AT_MISSING",
] as const;

export type SalesOrderFlowInconsistencyCode =
  (typeof SALES_ORDER_FLOW_INCONSISTENCY_CODES)[number];

export const SALES_ORDER_FLOW_INCONSISTENCY_SEVERITY_BY_CODE = {
  ITEM_STATUS_UNKNOWN: "WARNING",
  REQUIRES_PRODUCTION_UNKNOWN: "WARNING",
  PRODUCTION_QTY_NOT_NORMALIZED: "WARNING",
  OP_LINK_WITHOUT_QUANTITY: "WARNING",
  DOCUMENT_QUANTITY_NOT_NORMALIZED: "WARNING",
  DOCUMENT_WITHOUT_NFE: "INFO",
  NFE_WITHOUT_DOCUMENT: "WARNING",
  NFE_ITEM_ALLOCATION_AMBIGUOUS: "WARNING",
  NFE_CANCELED_WITH_ACTIVE_ITEMS: "ERROR",
  NFE_SHIP_DATE_MISSING: "INFO",
  PARTIAL_WITHOUT_REMAINING_QTY: "WARNING",
  CUT_WITHOUT_OFFICIAL_STATUS: "ERROR",
  FULFILLED_WITHOUT_COVERAGE: "WARNING",
  FULFILLED_WITHOUT_PRODUCTION: "INFO",
  EXCESS_COVERAGE: "WARNING",
  STALE_ITEM_PRESENT: "INFO",
  MIXED_ACTIVE_ITEM_STAGES: "INFO",
  O2C_ALLOCATION_STALE: "WARNING",
  DUPLICATE_TRUTH_RISK: "CRITICAL",
  ORDER_COMPLETED_AT_MISSING: "INFO",
} as const satisfies Record<
  SalesOrderFlowInconsistencyCode,
  SalesOrderFlowInconsistencySeverity
>;

export const SALES_ORDER_FLOW_INCONSISTENCY_LABELS = {
  ITEM_STATUS_UNKNOWN: "Status Nomus do item desconhecido",
  REQUIRES_PRODUCTION_UNKNOWN: "Necessidade de produção não contratada",
  PRODUCTION_QTY_NOT_NORMALIZED: "Quantidade produzida ainda não normalizada no stage",
  OP_LINK_WITHOUT_QUANTITY: "Vínculo OP sem linkedQuantity",
  DOCUMENT_QUANTITY_NOT_NORMALIZED:
    "Documento de saída alocado sem quantidade O2C normalizada",
  DOCUMENT_WITHOUT_NFE: "Documento de saída sem NF-e válida",
  NFE_WITHOUT_DOCUMENT: "NF-e vinculada sem documento de saída alocado",
  NFE_ITEM_ALLOCATION_AMBIGUOUS:
    "NF-e do pedido sem alocação O2C por item (cobertura ambígua em multi-item)",
  NFE_CANCELED_WITH_ACTIVE_ITEMS: "NF-e cancelada com itens ativos no fluxo",
  NFE_SHIP_DATE_MISSING: "Data de envio/saída da NF-e não normalizada",
  PARTIAL_WITHOUT_REMAINING_QTY: "Parcial sem saldo residual coerente",
  CUT_WITHOUT_OFFICIAL_STATUS: "Corte inferido sem status oficial FULFILLED_WITH_CUT",
  FULFILLED_WITHOUT_COVERAGE: "Atendido sem cobertura documental/fiscal",
  FULFILLED_WITHOUT_PRODUCTION:
    "Atendido pelo estoque / sem necessidade de OP",
  EXCESS_COVERAGE: "Cobertura documental/fiscal/OP excede a obrigação ativa",
  STALE_ITEM_PRESENT: "Item stale presente no pedido",
  MIXED_ACTIVE_ITEM_STAGES: "Itens ativos em estágios distintos",
  O2C_ALLOCATION_STALE: "Alocação O2C possivelmente defasada",
  DUPLICATE_TRUTH_RISK: "Risco de segunda fonte da verdade",
  ORDER_COMPLETED_AT_MISSING:
    "Pedido concluído sem data de conclusão segura (envio/documento/NF-e)",
} as const satisfies Record<SalesOrderFlowInconsistencyCode, string>;

export type SalesOrderFlowInconsistencyGuidance = {
  meaning: string;
  howToFix: string;
  responsibleAreaHint: string;
};

const SALES_ORDER_FLOW_INCONSISTENCY_GUIDANCE_FALLBACK: SalesOrderFlowInconsistencyGuidance =
  {
    meaning:
      "O motor do Fluxo de Pedidos registrou uma condição auxiliar que merece revisão operacional.",
    howToFix:
      "Confira as abas Itens, Produção, Documentos e NF-e/Envio deste pedido; ajuste a origem no Nomus e aguarde nova sincronização/reprocessamento.",
    responsibleAreaHint: "Operacional",
  };

/**
 * Orientação humana por código — o que significa e como agir.
 * Não marca resolução; só guia a conferência na origem.
 */
export const SALES_ORDER_FLOW_INCONSISTENCY_GUIDANCE = {
  ITEM_STATUS_UNKNOWN: {
    meaning:
      "O status comercial do item no Nomus não foi reconhecido pelo motor.",
    howToFix:
      "No Nomus, revise o status do item do pedido e sincronize novamente o pedido de venda.",
    responsibleAreaHint: "Comercial",
  },
  REQUIRES_PRODUCTION_UNKNOWN: {
    meaning:
      "Não foi possível saber se o item precisa de Ordem de Produção ou sai de estoque.",
    howToFix:
      "Confirme no cadastro/pedido se o item é fabricação própria ou estoque e reprocessar o fluxo.",
    responsibleAreaHint: "PCP / Produção",
  },
  PRODUCTION_QTY_NOT_NORMALIZED: {
    meaning:
      "Há indício de produção, mas a quantidade produzida ainda não está normalizada no stage.",
    howToFix:
      "Verifique apontamentos da OP no Nomus e aguarde a sincronização de produção.",
    responsibleAreaHint: "PCP / Produção",
  },
  OP_LINK_WITHOUT_QUANTITY: {
    meaning: "Existe vínculo com OP, porém sem quantidade vinculada utilizável.",
    howToFix:
      "Abra a OP no Nomus e confira se o item do pedido aparece em itensPedido com quantidade.",
    responsibleAreaHint: "PCP / Produção",
  },
  DOCUMENT_QUANTITY_NOT_NORMALIZED: {
    meaning:
      "Há Documento de Saída ligado, mas a quantidade alocada (O2C) ainda não está clara.",
    howToFix:
      "Confira o Documento de Saída e a alocação ao item no Nomus; reprocessar O2C se necessário.",
    responsibleAreaHint: "Expedição",
  },
  DOCUMENT_WITHOUT_NFE: {
    meaning: "Há Documento de Saída, mas ainda não há NF-e válida correspondente.",
    howToFix:
      "Emita/autorize a NF-e no fiscal e confirme o vínculo com o documento de saída.",
    responsibleAreaHint: "Fiscal",
  },
  NFE_WITHOUT_DOCUMENT: {
    meaning: "Há NF-e do pedido sem Documento de Saída alocado ao item.",
    howToFix:
      "Vincule ou emita o Documento de Saída correspondente à NF-e no Nomus.",
    responsibleAreaHint: "Expedição / Fiscal",
  },
  NFE_ITEM_ALLOCATION_AMBIGUOUS: {
    meaning:
      "A NF-e está no pedido, mas a distribuição por item ficou ambígua (pedido multi-item).",
    howToFix:
      "Revise a alocação O2C/itens da NF-e e garanta referência clara ao item do pedido.",
    responsibleAreaHint: "Fiscal / TI",
  },
  NFE_CANCELED_WITH_ACTIVE_ITEMS: {
    meaning: "Existe NF-e cancelada enquanto itens do pedido ainda estão ativos no fluxo.",
    howToFix:
      "Confirme o cancelamento fiscal e o impacto nos itens; regularize NF-e/documentos ativos.",
    responsibleAreaHint: "Fiscal",
  },
  NFE_SHIP_DATE_MISSING: {
    meaning:
      "A NF-e é válida, mas não há data de envio/saída normalizada; o sistema usa a data de faturamento como referência de envio.",
    howToFix:
      "No Nomus/fiscal, preencha a data de saída/envio da NF-e (quando existir) e sincronize novamente.",
    responsibleAreaHint: "Fiscal",
  },
  PARTIAL_WITHOUT_REMAINING_QTY: {
    meaning: "O atendimento está parcial, mas o saldo residual não está coerente.",
    howToFix:
      "Conferir quantidades pedidas, cortadas, faturadas e restantes no item do pedido.",
    responsibleAreaHint: "Comercial / Expedição",
  },
  CUT_WITHOUT_OFFICIAL_STATUS: {
    meaning: "Há corte aparente sem o status oficial de atendimento com corte.",
    howToFix:
      "Ajuste o status/classificação de atendimento no Nomus para refletir o corte oficial.",
    responsibleAreaHint: "Comercial",
  },
  FULFILLED_WITHOUT_COVERAGE: {
    meaning: "O item aparece atendido sem cobertura documental/fiscal suficiente.",
    howToFix:
      "Verifique Documento de Saída e NF-e vinculados às quantidades do item.",
    responsibleAreaHint: "Fiscal / Expedição",
  },
  FULFILLED_WITHOUT_PRODUCTION: {
    meaning:
      "O item foi atendido sem Ordem de Produção — típico de saída de estoque ou compra/terceiro.",
    howToFix:
      "Se for estoque, nenhuma OP é necessária. Se deveria fabricar, abra/vincule a OP no Nomus.",
    responsibleAreaHint: "PCP / Estoque",
  },
  EXCESS_COVERAGE: {
    meaning:
      "Documentos, NF-e ou OP cobrem mais do que a obrigação ativa do item.",
    howToFix:
      "Revise vínculos e quantidades de OP/DS/NF-e para não ultrapassar o saldo do pedido.",
    responsibleAreaHint: "Expedição / Fiscal",
  },
  STALE_ITEM_PRESENT: {
    meaning: "Há item defasado (stale) ainda presente no pedido.",
    howToFix:
      "Revisar sincronização do pedido e itens inativos/cancelados no Nomus.",
    responsibleAreaHint: "TI / Comercial",
  },
  MIXED_ACTIVE_ITEM_STAGES: {
    meaning:
      "Itens ativos do mesmo pedido estão em etapas diferentes do Kanban (ex.: um enviado e outro aguardando NF-e).",
    howToFix:
      "Trate o gargalo do item mais atrasado; a coluna do pedido segue a primeira obrigação pendente.",
    responsibleAreaHint: "Comercial / Operações",
  },
  O2C_ALLOCATION_STALE: {
    meaning: "A alocação Order-to-Cash pode estar desatualizada em relação às evidências atuais.",
    howToFix:
      "Reprocesse/recompute o fluxo do pedido após sincronizar DS e NF-e.",
    responsibleAreaHint: "TI",
  },
  DUPLICATE_TRUTH_RISK: {
    meaning:
      "Há risco de duas fontes conflitantes para a mesma verdade operacional (dados duplicados ou divergentes).",
    howToFix:
      "Audite vínculos OP/DS/NF-e e remova duplicidades antes de confiar na conclusão do fluxo.",
    responsibleAreaHint: "TI",
  },
  ORDER_COMPLETED_AT_MISSING: {
    meaning:
      "O pedido parece concluído, mas falta uma data segura de conclusão (envio, documento ou NF-e).",
    howToFix:
      "Garanta data de envio/saída ou evidência fiscal completa e reprocessar o fluxo.",
    responsibleAreaHint: "Fiscal / Expedição",
  },
} as const satisfies Record<
  SalesOrderFlowInconsistencyCode,
  SalesOrderFlowInconsistencyGuidance
>;

export function getSalesOrderFlowInconsistencyGuidance(
  code: string
): SalesOrderFlowInconsistencyGuidance {
  if (isSalesOrderFlowInconsistencyCode(code)) {
    return SALES_ORDER_FLOW_INCONSISTENCY_GUIDANCE[code];
  }
  return SALES_ORDER_FLOW_INCONSISTENCY_GUIDANCE_FALLBACK;
}

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

/**
 * Estágio oficial do pedido para Kanban/diagnóstico:
 * COALESCE(bottleneckStage, currentStage).
 * Única função compartilhada — não replicar a regra em outros módulos.
 */
export function resolveSalesOrderFlowOfficialStage(input: {
  currentStage: unknown;
  bottleneckStage?: unknown;
}): SalesOrderFlowStage | null {
  if (isSalesOrderFlowStage(input.bottleneckStage)) {
    return input.bottleneckStage;
  }
  if (isSalesOrderFlowStage(input.currentStage)) {
    return input.currentStage;
  }
  return null;
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
