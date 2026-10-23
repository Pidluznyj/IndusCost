/** Rótulos pt-BR do painel e da lista de Pedidos de Compra Nomus (puro, compartilhado UI/testes). */

export const PURCHASE_ORDER_SYNC_OVERALL_LABEL: Record<string, string> = {
  OK: "Sincronização em dia",
  RUNNING: "Sincronização em andamento",
  STALE: "Sincronização atrasada",
  FAILED: "Última execução falhou",
  INCONCLUSIVE: "Última execução inconclusiva (parcial)",
  NEVER_RAN: "Nenhuma execução registrada",
};

export function purchaseOrderSyncOverallLabel(status: string | null | undefined): string {
  return PURCHASE_ORDER_SYNC_OVERALL_LABEL[String(status ?? "")] ?? "Status desconhecido";
}

export function purchaseOrderSyncOverallTone(status: string | null | undefined): "success" | "info" | "warning" | "danger" {
  switch (status) {
    case "OK":
      return "success";
    case "RUNNING":
      return "info";
    case "INCONCLUSIVE":
    case "NEVER_RAN":
      return "warning";
    default:
      return "danger";
  }
}

export const PURCHASE_ORDER_RUN_STATUS_LABEL: Record<string, string> = {
  RUNNING: "Em execução",
  SUCCESS: "Sucesso",
  FAILED: "Falha",
  INCONCLUSIVE: "Inconclusiva",
  SKIPPED: "Pulada",
};

export const PURCHASE_ORDER_STRATEGY_LABEL: Record<string, string> = {
  RECENT_WINDOW: "Incremental (45 dias)",
  FULL_RECONCILIATION: "Reconciliação completa",
  TARGETED_LOOKUP: "Consulta por ID",
  RECENT_WINDOW_PREVIEW: "Incremental — prévia",
  FULL_RECONCILIATION_PREVIEW: "Reconciliação — prévia",
  TARGETED_LOOKUP_PREVIEW: "Consulta por ID — prévia",
};

export const PURCHASE_ORDER_TRIGGER_LABEL: Record<string, string> = {
  SCHEDULED_HOURLY: "Agenda horária",
  SCHEDULED_DAILY: "Agenda diária",
  CHAIN_AFTER_AR: "Após Contas a Receber",
  ADMIN_PANEL: "Painel",
  CLI: "Linha de comando",
  TARGETED_AUDIT: "Auditoria",
};

export const PURCHASE_ORDER_SKIP_REASON_LABEL: Record<string, string> = {
  INDEPENDENT_SCHEDULE_INACTIVE_SOURCE_IS_CHAIN: "Agenda própria inativa (fonte ativa: após Contas a Receber)",
  CHAIN_AFTER_AR_INACTIVE_SOURCE_IS_INDEPENDENT: "Encadeamento inativo (fonte ativa: agenda própria)",
  GLOBAL_LOCK_WAIT_TIMEOUT: "Lock global Nomus ocupado além da espera",
  ENTITY_LOCK_HELD: "Outra execução de Pedidos de Compra em andamento",
};

export const PURCHASE_ORDER_PRESENCE_FILTERS = [
  { value: "ACTIVE", label: "Carteira (exclui ausentes confirmados)" },
  { value: "MISSING", label: "Ausentes no Nomus" },
  { value: "MISSING_CANDIDATE", label: "Ausentes — em verificação" },
  { value: "MISSING_CONFIRMED", label: "Ausentes — confirmados (histórico)" },
  { value: "ALL", label: "Todos (inclui histórico)" },
] as const;

export type PurchaseOrderPresenceFilter = (typeof PURCHASE_ORDER_PRESENCE_FILTERS)[number]["value"];

export function parsePurchaseOrderPresenceFilter(raw: unknown): PurchaseOrderPresenceFilter {
  const value = String(raw ?? "").trim().toUpperCase();
  return (PURCHASE_ORDER_PRESENCE_FILTERS.map((f) => f.value) as string[]).includes(value)
    ? (value as PurchaseOrderPresenceFilter)
    : "ACTIVE";
}

/** Selo da linha: cancelado oficial ≠ ausente em verificação ≠ ausente confirmado. */
export function purchaseOrderPresenceBadge(input: {
  sourcePresenceStatus?: string | null;
  stage?: string | null;
}): { key: string; label: string; tone: "neutral" | "warning" | "danger" | "muted" } | null {
  if (input.sourcePresenceStatus === "MISSING_CONFIRMED") {
    return { key: "MISSING_CONFIRMED", label: "Ausente no Nomus — confirmado", tone: "danger" };
  }
  if (input.sourcePresenceStatus === "MISSING_CANDIDATE") {
    return { key: "MISSING_CANDIDATE", label: "Ausente no Nomus — em verificação", tone: "warning" };
  }
  return null;
}

export const PURCHASE_ORDER_PRESENCE_EVENT_LABEL: Record<string, string> = {
  MISSING_CANDIDATE: "Não encontrado em varredura completa (em verificação)",
  MISSING_CONFIRMED: "Ausência confirmada no Nomus",
  REACTIVATE: "Voltou a aparecer no Nomus",
};
