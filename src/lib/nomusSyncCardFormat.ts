/** Formatação visual compartilhada — cards de Logs de Sincronização Nomus (somente apresentação). */

export function formatSyncCardDateTime(iso: string | null | undefined): {
  value: string;
  subtitle?: string;
} {
  if (!iso) return { value: "—" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { value: "—" };
  return {
    value: d.toLocaleDateString("pt-BR"),
    subtitle: d.toLocaleTimeString("pt-BR"),
  };
}

export function formatSyncCardDateTimeLine(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export function formatSyncDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  if (hh > 0) return `${hh}h ${mm}m`;
  return `${mm}m ${ss}s`;
}

export function formatSyncIntOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return String(Math.trunc(value));
}
