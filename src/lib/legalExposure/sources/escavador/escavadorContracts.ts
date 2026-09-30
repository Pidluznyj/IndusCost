export const ESCAVADOR_DEFAULT_BASE = "https://api.escavador.com";
export const ESCAVADOR_DEFAULT_TIMEOUT_MS = 15_000;

export function escavadorProcessPath(processNumber: string): string {
  return `/api/v2/processos/numero_cnj/${encodeURIComponent(processNumber)}`;
}

export function escavadorMovementsPath(processNumber: string): string {
  return `/api/v2/processos/numero_cnj/${encodeURIComponent(processNumber)}/movimentacoes`;
}

export function clampEscavadorTimeoutMs(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ESCAVADOR_DEFAULT_TIMEOUT_MS), 10);
  if (!Number.isFinite(parsed)) return ESCAVADOR_DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.max(3_000, parsed));
}
