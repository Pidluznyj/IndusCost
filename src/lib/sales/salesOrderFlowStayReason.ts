/**
 * Motivo de permanência na coluna do Kanban (Fluxo de Pedidos).
 * Reutiliza bottleneckReason/stageReason do motor — não inventa segunda verdade.
 */

import {
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGE_NEXT_ACTION,
  type SalesOrderFlowStage,
} from "@/src/lib/sales/salesOrderFlowCatalog.js";

/** Fallback humano por etapa quando o snapshot não tem bottleneckReason. */
export const SALES_ORDER_FLOW_STAGE_STAY_REASON = {
  WAITING_RELEASE:
    "Ainda há itens aguardando liberação comercial no Nomus.",
  WAITING_PRODUCTION_ORDER:
    "Há saldo residual que exige produção e a cobertura de OP ainda é insuficiente.",
  IN_PRODUCTION:
    "A cobertura de OP existe, mas a evidência de produção ainda não fechou o residual.",
  WAITING_OUTPUT_DOCUMENT:
    "Falta Documento de Saída cobrindo a obrigação ativa do pedido.",
  WAITING_NFE:
    "Há documento/cobertura parcial, mas falta NF-e válida autorizada.",
  SHIPPED_COMPLETED:
    "Fluxo operacional concluído nesta coluna — nenhuma pendência de avanço.",
  CANCELED: "Pedido ou itens cancelados — fora do fluxo ativo.",
} as const satisfies Record<SalesOrderFlowStage, string>;

export type SalesOrderFlowCardStayReason = {
  /** Texto curto: por que o card está nesta coluna. */
  whyHere: string;
  /** O que falta para sair / próxima obrigação. */
  missingToLeave: string;
  /** Código/motivo bruto do gargalo (auditoria). */
  bottleneckReason: string | null;
};

/**
 * Remove o prefixo canônico `CODE — ` e devolve a mensagem humana.
 */
export function humanizeSalesOrderFlowStageReason(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const sep = " — ";
  const idx = trimmed.indexOf(sep);
  if (idx >= 0) {
    const human = trimmed.slice(idx + sep.length).trim();
    return human || trimmed;
  }
  return trimmed;
}

export function buildSalesOrderFlowCardStayReason(input: {
  stage: SalesOrderFlowStage;
  bottleneckReason?: string | null;
  nextAction?: string | null;
}): SalesOrderFlowCardStayReason {
  const humanReason = humanizeSalesOrderFlowStageReason(input.bottleneckReason);
  const whyHere =
    humanReason ||
    SALES_ORDER_FLOW_STAGE_STAY_REASON[input.stage] ||
    `Pedido na coluna ${SALES_ORDER_FLOW_STAGE_LABELS[input.stage]}.`;

  const missingToLeave =
    input.nextAction?.trim() ||
    SALES_ORDER_FLOW_STAGE_NEXT_ACTION[input.stage] ||
    "Revisar evidências do pedido no detalhe do fluxo.";

  return {
    whyHere,
    missingToLeave,
    bottleneckReason: input.bottleneckReason?.trim() || null,
  };
}
