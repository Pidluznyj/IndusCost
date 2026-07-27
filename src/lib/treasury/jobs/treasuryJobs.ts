/**
 * Registro de jobs da Tesouraria — scaffold sem agendamento.
 * Jobs reais (alertas/OFX) virão em prompts futuros.
 */

export type TreasuryJobDefinition = {
  id: string;
  label: string;
  enabled: boolean;
};

/** Catálogo vazio / desabilitado — nenhum setInterval nesta etapa. */
export const TREASURY_JOB_CATALOG: readonly TreasuryJobDefinition[] = [
  {
    id: "treasury.alerts.scan",
    label: "Varredura de alertas da Tesouraria",
    enabled: false,
  },
] as const;

export function listTreasuryJobs(): readonly TreasuryJobDefinition[] {
  return TREASURY_JOB_CATALOG;
}

/** No-op: não inicia timers no scaffold. */
export function startTreasuryScheduledJobs(): { started: false; reason: string } {
  return {
    started: false,
    reason: "Treasury jobs não iniciados no scaffold (sem regras financeiras).",
  };
}
