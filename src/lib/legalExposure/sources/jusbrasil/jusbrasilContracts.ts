export const JUSBRASIL_DEFAULT_BASE = "https://op.digesto.com.br";
export const JUSBRASIL_DEFAULT_TIMEOUT_MS = 15_000;

export function jusbrasilProcessPath(processNumber: string): string {
  return `/api/base-judicial/tribproc/${encodeURIComponent(processNumber)}`;
}

export function clampJusbrasilTimeoutMs(raw: string | undefined): number {
  const parsed = Number.parseInt(String(raw ?? JUSBRASIL_DEFAULT_TIMEOUT_MS), 10);
  if (!Number.isFinite(parsed)) return JUSBRASIL_DEFAULT_TIMEOUT_MS;
  return Math.min(60_000, Math.max(3_000, parsed));
}
