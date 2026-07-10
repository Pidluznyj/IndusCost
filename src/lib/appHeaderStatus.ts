/**
 * Formatação e labels do status operacional do header global.
 * Sem impacto em regras de negócio, RBAC ou dados.
 */

export type HeaderSyncStatus = "SUCCESS" | "FAILED" | "UNKNOWN" | "SKIPPED" | "—";

export function formatHeaderSyncStatusLabel(status: HeaderSyncStatus): string {
  switch (status) {
    case "SUCCESS":
      return "Sucesso";
    case "FAILED":
      return "Falha";
    case "SKIPPED":
      return "Ignorado";
    case "UNKNOWN":
      return "Indisponível";
    default:
      return "—";
  }
}

export function resolveHeaderSyncStatusClass(status: HeaderSyncStatus): string {
  switch (status) {
    case "SUCCESS":
      return "text-green-600";
    case "FAILED":
      return "text-red-600";
    case "SKIPPED":
      return "text-slate-600";
    default:
      return "text-amber-600";
  }
}

/** Converte Date para texto curto "dd/mm HH:mm" (pt-BR). */
export function formatHeaderDateTimeCompact(value: Date | string | null | undefined): string {
  if (value == null || value === "" || value === "—") return "—";

  if (typeof value === "string") {
    const asText = value.trim();
    // Preferir padrão pt-BR já formatado (evita ambiguidade MM/DD do Date.parse).
    const match = asText.match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})/);
    if (match) return `${match[1]}/${match[2]} ${match[4]}:${match[5]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).trim() || "—";
  }
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

export function formatHeaderNomusSyncFull(input: {
  lastSyncAt: string;
  statusLabel: string;
}): string {
  return `Última sincronia com o Nomus: ${input.lastSyncAt} (${input.statusLabel})`;
}

export function formatHeaderNomusSyncCompact(input: {
  lastSyncAt: string;
  statusLabel: string;
}): string {
  const when = formatHeaderDateTimeCompact(input.lastSyncAt);
  return `Nomus: ${when} (${input.statusLabel})`;
}

export function formatHeaderNextNomusRunFull(nextRun: string): string {
  return `Próxima prevista: ${nextRun}`;
}

export function formatHeaderNextNomusRunCompact(nextRun: string): string {
  return `Próx.: ${formatHeaderDateTimeCompact(nextRun)}`;
}

/** Próxima execução Nomus no minuto :17 da hora atual/seguinte. */
export function resolveNextNomusRunAt(now = new Date()): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  if (now.getMinutes() < 17) {
    next.setMinutes(17);
  } else {
    next.setHours(now.getHours() + 1, 17, 0, 0);
  }
  return next;
}
