/**
 * Motivo de permanência na coluna do Kanban (Fluxo de Pedidos).
 * Reutiliza bottleneckReason/stageReason do motor — não inventa segunda verdade.
 * Textos exibidos ao usuário são sempre em português claro (sem jargão técnico).
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
    "Ainda falta Ordem de Produção (ou quantidade nela) para cobrir o que precisa ser produzido.",
  IN_PRODUCTION:
    "A Ordem de Produção existe, mas a produção ainda não fechou o que falta.",
  WAITING_OUTPUT_DOCUMENT:
    "Falta Documento de Saída cobrindo o que ainda está pendente neste pedido.",
  WAITING_NFE:
    "Há documento, mas ainda falta NF-e válida autorizada.",
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

/** Substituições de jargão técnico / inglês → português para leigos. */
const TECHNICAL_PHRASE_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/linkedQuantity/gi, "quantidade vinculada"],
  [/\(\s*status\s+PENDING\s*\)/gi, ""],
  [/\bstatus\s+PENDING\b/gi, "aguardando liberação"],
  [/\bPENDING\b/g, "aguardando liberação"],
  [/\bproxy\s+OP\b/gi, "referência da Ordem de Produção"],
  [/\bproxy de OP\b/gi, "referência da Ordem de Produção"],
  [/\bproxy de envio\b/gi, "considerado como enviado"],
  [/\bproxy de autorização\b/gi, "autorização da NF-e"],
  [/\bpor proxy\b/gi, "como referência"],
  [/\bItem stale\b/gi, "Item desatualizado"],
  [/\bstale\b/gi, "desatualizado"],
  [/\bSHIPPED_COMPLETED\b/g, "enviado/concluído"],
  [/\bWAITING_PRODUCTION_ORDER\b/g, "aguardando OP"],
  [/\bWAITING_OUTPUT_DOCUMENT\b/g, "aguardando documento de saída"],
  [/\bWAITING_NFE\b/g, "aguardando NF-e"],
  [/\bWAITING_RELEASE\b/g, "aguardando liberação"],
  [/\bIN_PRODUCTION\b/g, "em produção"],
  [/\bPCP_PRODUCAO\b/g, "PCP / Produção"],
  [/\bEXPEDICAO_FATURAMENTO\b/g, "Expedição / Faturamento"],
  [/\bCOMERCIAL\b/g, "Comercial"],
  [/\bausência histórica de OP\b/gi, "sem Ordem de Produção anterior"],
];

function scrubTechnicalPhrases(text: string): string {
  let out = text;
  for (const [pattern, replacement] of TECHNICAL_PHRASE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

/**
 * Remove o prefixo canônico `CODE — ` e limpa jargão técnico da mensagem.
 */
export function humanizeSalesOrderFlowStageReason(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const sep = " — ";
  const idx = trimmed.indexOf(sep);
  const human =
    idx >= 0 ? trimmed.slice(idx + sep.length).trim() || trimmed : trimmed;
  return scrubTechnicalPhrases(human);
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
    scrubTechnicalPhrases(input.nextAction?.trim() || "") ||
    SALES_ORDER_FLOW_STAGE_NEXT_ACTION[input.stage] ||
    "Revisar o pedido no detalhe do fluxo.";

  return {
    whyHere,
    missingToLeave,
    bottleneckReason: input.bottleneckReason?.trim() || null,
  };
}
