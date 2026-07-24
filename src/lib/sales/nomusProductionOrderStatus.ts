/**
 * Normalização canônica do status de Ordem de Produção Nomus (`/rest/ordens.status`).
 *
 * Status conhecidos no ambiente: Encerrada, Cancelada, Liberada,
 * Requisitada totalmente, Requisitada parcialmente.
 *
 * Não inferir Encerrada a partir de datas (ex.: dataHoraEntrega).
 */

export const NOMUS_PRODUCTION_ORDER_STATUS = [
  "CLOSED",
  "CANCELED",
  "RELEASED",
  "REQUISITIONED_PARTIAL",
  "REQUISITIONED_TOTAL",
  "UNKNOWN",
] as const;

export type NomusProductionOrderStatusNormalized =
  (typeof NOMUS_PRODUCTION_ORDER_STATUS)[number];

export type NormalizedNomusProductionOrderStatus = {
  statusRaw: string | null;
  statusNormalized: NomusProductionOrderStatusNormalized;
  isCanceled: boolean;
  /** Planejamento válido (não cancelada). */
  isActivePlan: boolean;
  /** Evidência conservadora de produção concluída. */
  isClosed: boolean;
  /** Liberada — não prova execução. */
  isReleased: boolean;
  /** Requisitada parcial ou total — não prova produção nesta versão. */
  isRequisitioned: boolean;
};

function foldStatusText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Interpreta o status textual da OP Nomus de forma conservadora.
 * Status desconhecido ≠ Encerrada.
 */
export function normalizeNomusProductionOrderStatus(
  status: string | null | undefined
): NormalizedNomusProductionOrderStatus {
  const statusRaw =
    status == null ? null : typeof status === "string" ? status.trim() || null : null;
  if (statusRaw == null) {
    return {
      statusRaw: null,
      statusNormalized: "UNKNOWN",
      isCanceled: false,
      isActivePlan: true,
      isClosed: false,
      isReleased: false,
      isRequisitioned: false,
    };
  }

  const folded = foldStatusText(statusRaw);

  if (
    folded.includes("cancel") ||
    folded === "canceled" ||
    folded === "cancelled"
  ) {
    return {
      statusRaw,
      statusNormalized: "CANCELED",
      isCanceled: true,
      isActivePlan: false,
      isClosed: false,
      isReleased: false,
      isRequisitioned: false,
    };
  }

  if (
    folded === "encerrada" ||
    folded === "encerrado" ||
    folded === "closed" ||
    folded === "finalizada" ||
    folded === "finalizado"
  ) {
    return {
      statusRaw,
      statusNormalized: "CLOSED",
      isCanceled: false,
      isActivePlan: true,
      isClosed: true,
      isReleased: false,
      isRequisitioned: false,
    };
  }

  if (
    folded === "liberada" ||
    folded === "liberado" ||
    folded === "released"
  ) {
    return {
      statusRaw,
      statusNormalized: "RELEASED",
      isCanceled: false,
      isActivePlan: true,
      isClosed: false,
      isReleased: true,
      isRequisitioned: false,
    };
  }

  if (
    folded === "requisitada parcialmente" ||
    folded === "requisitada parcial" ||
    folded.includes("requisitada parcial")
  ) {
    return {
      statusRaw,
      statusNormalized: "REQUISITIONED_PARTIAL",
      isCanceled: false,
      isActivePlan: true,
      isClosed: false,
      isReleased: false,
      isRequisitioned: true,
    };
  }

  if (
    folded === "requisitada totalmente" ||
    folded === "requisitada total" ||
    folded.includes("requisitada total")
  ) {
    return {
      statusRaw,
      statusNormalized: "REQUISITIONED_TOTAL",
      isCanceled: false,
      isActivePlan: true,
      isClosed: false,
      isReleased: false,
      isRequisitioned: true,
    };
  }

  // Desconhecido: OP pode existir como plano, mas não prova início nem conclusão.
  return {
    statusRaw,
    statusNormalized: "UNKNOWN",
    isCanceled: false,
    isActivePlan: true,
    isClosed: false,
    isReleased: false,
    isRequisitioned: false,
  };
}

export function isNomusProductionOrderStatusCanceled(
  status: string | null | undefined
): boolean {
  return normalizeNomusProductionOrderStatus(status).isCanceled;
}

export function isNomusProductionOrderStatusClosed(
  status: string | null | undefined
): boolean {
  return normalizeNomusProductionOrderStatus(status).isClosed;
}
