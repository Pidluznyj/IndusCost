/**
 * Tabelas de tradução PT-BR dos enums de sistema exibidos na aba
 * Financeiro → Conciliação de Carteira → Status Pedidos / Auditoria Pedido → Caixa.
 *
 * Regras:
 * - Não é para "renomear" código: `lineType`, `paymentStatus`, `orderToCashStage` etc.
 *   continuam com valores canônicos internamente. Estas tabelas só existem para exibir
 *   nas colunas/badges do frontend em português claro para o usuário.
 * - Se um valor não estiver mapeado, o próprio valor bruto é devolvido — evita ocultar
 *   status novo até a UI ser atualizada. Registre o novo valor aqui quando aparecer.
 * - Frontend puro: nenhum import de server/Prisma.
 */

const LINE_TYPE_PT_BR: Record<string, string> = {
  ORDER_ITEM_PENDING: "Pendente ativo",
  ORDER_ITEM_ALLOCATED: "Atendido (alocado)",
  ORDER_ITEM_CANCELED: "Cancelado",
  ORDER_ITEM_CUT: "Atendido com corte",
  QUANTITY_SURPLUS: "Excedente do documento",
  DOCUMENT_EXTRA_ITEM: "Fora do pedido",
};

const PAYMENT_STATUS_PT_BR: Record<string, string> = {
  PAID: "Pago",
  PAID_LATE: "Pago em atraso",
  PARTIALLY_PAID: "Parcialmente pago",
  OPEN: "Em aberto",
  OVERDUE: "Vencido",
  PLANNED_ONLY: "Só previsto",
  AWAITING_CR: "Aguardando CR",
  CANCELED: "Cancelado",
  DIVERGENT: "Divergente",
};

const OPERATIONAL_STAGE_PT_BR: Record<string, string> = {
  FULLY_FULFILLED: "Atendido totalmente",
  FULLY_FULFILLED_WITH_EXCESS: "Atendido com excedente",
  PARTIALLY_FULFILLED: "Atendido parcial",
  NOT_FULFILLED: "Sem atendimento",
  CANCELADO: "Cancelado",
};

const FISCAL_STAGE_PT_BR: Record<string, string> = {
  NFE_AUTHORIZED: "NF autorizada",
  NFE_CANCELED: "NF cancelada",
  HEADER_ONLY: "Só cabeçalho de NF",
  NO_NFE: "Sem NF",
};

const FINANCIAL_STAGE_PT_BR: Record<string, string> = {
  CR_OPEN: "CR em aberto",
  CR_RECEIVED: "CR recebido",
  CR_PARTIALLY_RECEIVED: "CR parcialmente recebido",
  CR_OVERDUE: "CR vencido",
  INVOICED_WITHOUT_CR: "Faturado sem CR",
  NO_CR: "Sem CR",
};

const CASH_STAGE_PT_BR: Record<string, string> = {
  CASH_RECEIVED: "Caixa realizado",
  CASH_RECEIVED_LATE: "Caixa realizado (com atraso)",
  CASH_OPEN: "Caixa em aberto",
  CASH_EXPECTED: "Caixa previsto",
  NO_CASH: "Sem caixa",
};

const COMMERCIAL_STAGE_PT_BR: Record<string, string> = {
  ORDER_CANCELLED: "Pedido cancelado",
  ORDER_OLD_WITHOUT_EVOLUTION: "Pedido antigo sem evolução",
  ORDER_FUTURE: "Pedido futuro",
  ORDER_RECENT: "Pedido recente",
  ORDER_PENDING: "Pedido pendente",
};

const ORDER_TO_CASH_STAGE_PT_BR: Record<string, string> = {
  RECEBIDO: "Recebido",
  RECEBIDO_COM_ATRASO: "Recebido com atraso",
  RECEBIDO_COM_CANCELAMENTO: "Recebido (com cancelamento)",
  COMPLETO_CR_ABERTO: "Completo · CR em aberto",
  COMPLETO_SEM_CR: "Completo · sem CR",
  COMPLETO_COM_CANCELAMENTO: "Completo (com cancelamento)",
  PARCIAL_RECEBIDO: "Parcial · recebido",
  PARCIAL_CR_ABERTO: "Parcial · CR em aberto",
  PARCIAL_SEM_CR: "Parcial · sem CR",
  PARCIAL_COM_CANCELAMENTO: "Parcial (com cancelamento)",
  NF_SEM_CR: "NF sem CR",
  SEM_ATENDIMENTO_FUTURO: "Sem atendimento (futuro)",
  SEM_ATENDIMENTO_ATRASADO: "Sem atendimento (atrasado)",
  PEDIDO_FUTURO_SAUDAVEL: "Pedido futuro saudável",
  BLOQUEADO_REVISAO: "Bloqueado (revisão)",
  CANCELADO: "Cancelado",
  SEM_EVIDENCIA: "Sem evidência",
};

const TEMPERATURE_PT_BR: Record<string, string> = {
  QUENTE: "Quente",
  MORNO: "Morno",
  FRIO: "Frio",
  CONGELADO: "Congelado",
  AMARELO: "Morno",
  AMBAR: "Morno",
  ÂMBAR: "Morno",
  VERDE: "Frio",
  VERMELHO: "Quente",
  RED: "Quente",
  GREEN: "Frio",
};

const CONFIDENCE_PT_BR: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  BLOCKED: "Bloqueada",
  ALTA: "Alta",
  MEDIA: "Média",
  MÉDIA: "Média",
  BAIXA: "Baixa",
  BLOQUEADA: "Bloqueada",
};

const EVIDENCE_LEVEL_PT_BR: Record<string, string> = {
  ITEM: "Evidência de item",
  ORDER_TITLE: "Só título do pedido",
};

const LINE_BILLED_SOURCE_PT_BR: Record<string, string> = {
  STOCK_DOCUMENT_ITEM: "Item de documento",
  ALLOCATED_DOCUMENT_PRICE: "Preço do documento",
  NFE_ITEM: "Item de NF",
  NOT_BILLED: "Não faturado",
  NOT_IDENTIFIED: "Não identificado",
};

const ITEM_MATCH_CONFIDENCE_PT_BR: Record<string, string> = {
  HIGH: "Alta",
  MEDIUM: "Média",
  LOW: "Baixa",
  AMBIGUOUS: "Ambígua",
  NONE: "Sem casamento",
};

const NOMUS_ITEM_STATUS_NORMALIZED_PT_BR: Record<string, string> = {
  FULFILLED: "Atendido totalmente",
  FULFILLED_WITH_CUT: "Atendido com corte",
  PARTIAL: "Atendido parcial",
  PENDING: "Aguardando liberação",
  RELEASED: "Liberado",
  CANCELED: "Cancelado",
  STALE: "Removido do pedido",
  UNKNOWN: "Desconhecido",
};

const ORDER_ITEM_STATUS_PT_BR: Record<string, string> = {
  ATENDIDO: "Atendido totalmente",
  ATENDIDO_COM_CORTE: "Atendido com corte",
  PARCIAL: "Atendido parcial",
  LIBERADO: "Liberado",
  PENDENTE: "Aguardando liberação",
  CANCELADO: "Cancelado",
  STALE: "Removido do pedido",
  DESCONHECIDO: "Desconhecido",
  ...NOMUS_ITEM_STATUS_NORMALIZED_PT_BR,
};

function normalize(value: string | null | undefined): string | null {
  if (value == null) return null;
  const t = String(value).trim();
  return t.length > 0 ? t : null;
}

function labelOr(
  table: Record<string, string>,
  value: string | null | undefined,
  fallback = "—"
): string {
  const raw = normalize(value);
  if (!raw) return fallback;
  const upper = raw.toUpperCase();
  return table[raw] ?? table[upper] ?? raw;
}

export function formatOrderToCashLineType(value: string | null | undefined): string {
  return labelOr(LINE_TYPE_PT_BR, value);
}

export function formatOrderToCashPaymentStatus(value: string | null | undefined): string {
  return labelOr(PAYMENT_STATUS_PT_BR, value);
}

export function formatOrderToCashOperationalStage(value: string | null | undefined): string {
  return labelOr(OPERATIONAL_STAGE_PT_BR, value);
}

export function formatOrderToCashFiscalStage(value: string | null | undefined): string {
  return labelOr(FISCAL_STAGE_PT_BR, value);
}

export function formatOrderToCashFinancialStage(value: string | null | undefined): string {
  return labelOr(FINANCIAL_STAGE_PT_BR, value);
}

export function formatOrderToCashCashStage(value: string | null | undefined): string {
  return labelOr(CASH_STAGE_PT_BR, value);
}

export function formatOrderToCashCommercialStage(value: string | null | undefined): string {
  return labelOr(COMMERCIAL_STAGE_PT_BR, value);
}

export function formatOrderToCashStage(value: string | null | undefined): string {
  return labelOr(ORDER_TO_CASH_STAGE_PT_BR, value);
}

export function formatOrderToCashTemperature(value: string | null | undefined): string {
  return labelOr(TEMPERATURE_PT_BR, value);
}

export function formatOrderToCashConfidence(value: string | null | undefined): string {
  return labelOr(CONFIDENCE_PT_BR, value);
}

export function formatOrderToCashEvidenceLevel(value: string | null | undefined): string {
  return labelOr(EVIDENCE_LEVEL_PT_BR, value);
}

export function formatOrderToCashLineBilledSource(value: string | null | undefined): string {
  return labelOr(LINE_BILLED_SOURCE_PT_BR, value);
}

export function formatOrderItemStatus(value: string | null | undefined): string {
  return labelOr(ORDER_ITEM_STATUS_PT_BR, value);
}

export function formatNomusItemStatusNormalized(
  value: string | null | undefined
): string {
  return labelOr(NOMUS_ITEM_STATUS_NORMALIZED_PT_BR, value);
}

export function formatNomusItemMatchConfidence(
  value: string | null | undefined
): string {
  return labelOr(ITEM_MATCH_CONFIDENCE_PT_BR, value);
}

/** Traduz para exibição sem perder o valor bruto quando desconhecido. */
export function formatOrderToCashEnum(
  kind:
    | "lineType"
    | "paymentStatus"
    | "operationalStage"
    | "fiscalStage"
    | "financialStage"
    | "cashStage"
    | "commercialStage"
    | "orderToCashStage"
    | "temperature"
    | "confidence"
    | "evidenceLevel"
    | "lineBilledSource"
    | "orderItemStatus"
    | "nomusItemStatusNormalized"
    | "nomusItemMatchConfidence",
  value: string | null | undefined
): string {
  switch (kind) {
    case "lineType":
      return formatOrderToCashLineType(value);
    case "paymentStatus":
      return formatOrderToCashPaymentStatus(value);
    case "operationalStage":
      return formatOrderToCashOperationalStage(value);
    case "fiscalStage":
      return formatOrderToCashFiscalStage(value);
    case "financialStage":
      return formatOrderToCashFinancialStage(value);
    case "cashStage":
      return formatOrderToCashCashStage(value);
    case "commercialStage":
      return formatOrderToCashCommercialStage(value);
    case "orderToCashStage":
      return formatOrderToCashStage(value);
    case "temperature":
      return formatOrderToCashTemperature(value);
    case "confidence":
      return formatOrderToCashConfidence(value);
    case "evidenceLevel":
      return formatOrderToCashEvidenceLevel(value);
    case "lineBilledSource":
      return formatOrderToCashLineBilledSource(value);
    case "orderItemStatus":
      return formatOrderItemStatus(value);
    case "nomusItemStatusNormalized":
      return formatNomusItemStatusNormalized(value);
    case "nomusItemMatchConfidence":
      return formatNomusItemMatchConfidence(value);
  }
}

/** Retorna label PT-BR e mantém o valor bruto num tooltip para debug/auditoria. */
export function withRawTooltip(label: string, raw: string | null | undefined): {
  label: string;
  title: string;
} {
  const rawStr = normalize(raw);
  return {
    label,
    title: rawStr && rawStr !== label ? `${label} · ${rawStr}` : label,
  };
}
