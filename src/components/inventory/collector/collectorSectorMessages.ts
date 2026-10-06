/**
 * Collector por setor — regras de tela puras (sem React, sem fetch).
 *
 * 1. Capacidades do setor: no setor configurável (STANDARD) quem decide é o
 *    servidor (allowsCounting / allowsWithdrawal no contexto). A tela só
 *    esconde o que o servidor já bloqueia.
 * 2. Mensagens ao operador: cada erro conhecido vira uma frase curta e clara.
 *    Erro inesperado nunca mostra detalhe técnico.
 */

export type CollectorSectorContextSector = {
  code: string;
  label: string;
  slug?: string;
  strategy?: string;
  itemType?: string;
  allowsCounting?: boolean;
  allowsWithdrawal?: boolean;
};

export type CollectorStandardSectorCapabilities = {
  label: string;
  allowsCounting: boolean;
  allowsWithdrawal: boolean;
};

/**
 * Setor configurável do contexto, ou null quando o setor é um dos fixos
 * (Matéria-prima, Componentes, Produto acabado), que seguem a tela de sempre.
 * Capacidade ausente no payload conta como negada.
 */
export function standardSectorFromContext(
  sector: CollectorSectorContextSector | null | undefined
): CollectorStandardSectorCapabilities | null {
  if (!sector || sector.strategy !== "STANDARD") return null;
  return {
    label: sector.label,
    allowsCounting: sector.allowsCounting === true,
    allowsWithdrawal: sector.allowsWithdrawal === true,
  };
}

/**
 * Identificador do setor enviado ao servidor. Setor configurável é resolvido
 * pelo SLUG do deep-link (código e slug podem ser diferentes); setor fixo
 * segue enviando o código, como sempre.
 */
export function collectorSectorRequestKey(
  sector: CollectorSectorContextSector | null | undefined,
  slugFromUrl: string
): string {
  if (sector?.strategy === "STANDARD") return sector.slug?.trim() || slugFromUrl;
  return sector?.code ?? slugFromUrl;
}

const GENERIC_FAILURE = "Não foi possível concluir. Tente novamente.";

const OPERATION_MESSAGES: Record<string, string> = {
  COLLECTOR_ITEM_NOT_ELIGIBLE: "Este item não pertence a este setor ou está inativo.",
  WAREHOUSE_NOT_ELIGIBLE: "Este almoxarifado não pertence a este setor.",
  COLLECTOR_INVALID_SECTOR: "Setor não encontrado. Confira o QR com o supervisor.",
  COLLECTOR_SECTOR_INACTIVE: "Este setor está inativo. Acione o supervisor de estoque.",
  COLLECTOR_SECTOR_WAREHOUSE_INACTIVE:
    "O almoxarifado deste setor está inativo. Acione o supervisor de estoque.",
  COLLECTOR_SECTOR_MISCONFIGURED:
    "Setor com configuração incompleta. Acione o supervisor de estoque.",
  COLLECTOR_SECTOR_STRATEGY_UNSUPPORTED:
    "Setor com configuração incompleta. Acione o supervisor de estoque.",
  COLLECTOR_COUNTING_DENIED: "Este setor não permite contagem.",
  COLLECTOR_WITHDRAWAL_DENIED: "Este setor não permite retirada.",
  COLLECTOR_NO_ELIGIBLE_ITEMS: "Não há itens deste setor para contar.",
  COUNT_LINE_VERSION_CONFLICT:
    "Outro aparelho alterou este item. A lista foi atualizada — confira e conte de novo.",
  COUNT_OPERATION_IDEMPOTENCY_CONFLICT:
    "Esta operação já foi enviada com outros dados. Recarregue a lista e tente de novo.",
  COLLECTOR_CAPABILITY_DENIED: "Este aparelho não tem permissão para esta operação.",
  COLLECTOR_DEVICE_UNAUTHORIZED: "Este aparelho não está autorizado. Acione o supervisor.",
  COST_CENTER_REQUIRED:
    "Setor sem centro de custo configurado. Acione o supervisor de estoque.",
  INVALID_QUANTITY: "Quantidade inválida.",
  WAREHOUSE_INACTIVE: "O almoxarifado deste setor está inativo.",
  WAREHOUSE_LOCKED: "O almoxarifado deste setor está bloqueado para movimentações.",
  SESSION_NOT_FOUND: "Conferência não encontrada. Volte ao início e tente de novo.",
  INVALID_STATUS: "Esta conferência já foi finalizada.",
  SESSION_LOCKED: "Esta conferência já foi finalizada.",
  PENDING_ITEMS: "Existem itens pendentes de contagem.",
};

/** Códigos cuja mensagem do servidor já é a melhor explicação (e é segura). */
const SERVER_MESSAGE_CODES = new Set([
  "COLLECTOR_INSUFFICIENT_STOCK",
  "COLLECTOR_ACTIVE_SESSION_INCOMPATIBLE",
  "COLLECTOR_NO_COUNTED_ITEMS",
  "FIELD_REQUIRED",
  "COLLECTOR_OPERATION_ID_REQUIRED",
  "COLLECTOR_NO_WAREHOUSE_FOR_SECTOR",
  "COLLECTOR_NO_LINES",
]);

/**
 * Frase mostrada ao operador para um erro de operação (contar, finalizar,
 * aplicar, listar, retirar). 5xx e falha de rede nunca expõem o texto cru.
 */
export function collectorOperationErrorMessage(
  error: { status: number | null; code: string | null; message: string | null },
  fallback: string = GENERIC_FAILURE
): string {
  const code = (error.code ?? "").trim();
  if (code && OPERATION_MESSAGES[code]) return OPERATION_MESSAGES[code];
  if (error.status == null) return "Sem conexão com o servidor. Verifique a rede e tente novamente.";
  if (error.status >= 500) return fallback;
  if (code && SERVER_MESSAGE_CODES.has(code) && error.message?.trim()) {
    return error.message.trim();
  }
  // 4xx de validação: a mensagem do servidor é escrita para o operador.
  return error.message?.trim() || fallback;
}

/** Quantidade para a tela: até 3 casas, sem zeros à direita, vírgula decimal. */
export function formatCollectorQuantity(value: number, unit?: string | null): string {
  const rounded = Math.round((value + Number.EPSILON) * 1000) / 1000;
  const text = rounded.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  return unit ? `${text} ${unit}` : text;
}
