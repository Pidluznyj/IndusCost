/**
 * Registro de jobs cron da Tesouraria.
 * Recálculo de projeção usa fila PostgreSQL (`TreasuryProjectionRecalcJob`),
 * não setInterval neste catálogo.
 */

export type TreasuryJobDefinition = {
  id: string;
  label: string;
  enabled: boolean;
};

/** Catálogo de cron opcional — desabilitado (fila DB cobre recálculo). */
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

/** No-op intencional: sem timers; worker de projeção é sob demanda/fila. */
export function startTreasuryScheduledJobs(): { started: false; reason: string } {
  return {
    started: false,
    reason:
      "Sem cron in-process; recálculo via fila PostgreSQL TreasuryProjectionRecalcJob.",
  };
}
