/**
 * Pontos de atenção objetivos. Sem parecer de mérito.
 */

export const ATTENTION_FLAGS = [
  "MULTIPLE_GROUP_DEFENDANTS",
  "GROUP_ENTITY_PASSIVE",
  "NEW_PUBLICATION",
  "OPEN_CRITICAL_ALERT",
  "FUTURE_HEARING",
  "RECENT_MOVEMENT",
  "INCOMPLETE_ENRICHMENT",
  "SOURCE_DEGRADED",
  "PROCESS_ARCHIVED",
] as const;
export type AttentionFlag = (typeof ATTENTION_FLAGS)[number];

export const ATTENTION_FLAG_LABELS: Record<AttentionFlag, string> = {
  MULTIPLE_GROUP_DEFENDANTS: "Empresas do grupo no polo passivo",
  GROUP_ENTITY_PASSIVE: "Empresa do grupo no polo passivo",
  NEW_PUBLICATION: "Nova publicação identificada",
  OPEN_CRITICAL_ALERT: "Ação requerida em aberto",
  FUTURE_HEARING: "Audiência futura identificada",
  RECENT_MOVEMENT: "Movimentação nos últimos 7 dias",
  INCOMPLETE_ENRICHMENT: "Dados processuais ainda incompletos",
  SOURCE_DEGRADED: "Fonte oficial degradada",
  PROCESS_ARCHIVED: "Arquivamento informado pela fonte",
};

export function attentionLabel(flag: AttentionFlag, extra?: { count?: number }): string {
  if (flag === "MULTIPLE_GROUP_DEFENDANTS" && extra?.count && extra.count > 1) {
    return `${extra.count} empresas do grupo no polo passivo`;
  }
  return ATTENTION_FLAG_LABELS[flag];
}

export function collectAttentionFlags(input: {
  passiveGroupCount: number;
  publicationDaysAgo: number | null;
  openCriticalAlerts: number;
  nextHearingAt: string | null;
  latestMovementAt: string | null;
  enrichmentIncomplete: boolean;
  sourceDegraded: boolean;
  archivedAt: string | null;
  now: Date;
}): AttentionFlag[] {
  const flags: AttentionFlag[] = [];
  if (input.passiveGroupCount > 1) flags.push("MULTIPLE_GROUP_DEFENDANTS");
  else if (input.passiveGroupCount === 1) flags.push("GROUP_ENTITY_PASSIVE");
  if (input.publicationDaysAgo != null && input.publicationDaysAgo <= 7) flags.push("NEW_PUBLICATION");
  if (input.openCriticalAlerts > 0) flags.push("OPEN_CRITICAL_ALERT");
  if (input.nextHearingAt && Date.parse(input.nextHearingAt) > input.now.getTime()) flags.push("FUTURE_HEARING");
  if (input.latestMovementAt) {
    const age = input.now.getTime() - Date.parse(input.latestMovementAt);
    if (Number.isFinite(age) && age <= 7 * 24 * 60 * 60 * 1000) flags.push("RECENT_MOVEMENT");
  }
  if (input.enrichmentIncomplete) flags.push("INCOMPLETE_ENRICHMENT");
  if (input.sourceDegraded) flags.push("SOURCE_DEGRADED");
  if (input.archivedAt) flags.push("PROCESS_ARCHIVED");
  return flags;
}
