/** Rótulos amigáveis para status da Manutenção Nomus (somente frontend). */

export const EFFECTIVE_BOM_STATUS_LABEL: Record<string, string> = {
  READY_FOR_PRICING_PREVIEW: "Pronto para preview de precificação",
  READY_WITH_LOCAL_REVIEW: "Pronto com decisões locais",
  PENDING_LOCAL_REVIEW: "Itens locais pendentes",
  PENDING_OPTIONAL_SELECTION: "Opcionais pendentes",
  STALE_OPTIONAL_SELECTION: "Seleção de opcionais desatualizada",
  BLOCKED_UNRESOLVED_COMPONENTS: "Componentes não resolvidos",
  NO_NOMUS_BOM: "Sem BOM Nomus",
};

export const OPTIONAL_PRICING_STATUS_LABEL: Record<string, string> = {
  PENDING: "Opcionais pendentes",
  RESOLVED: "Opcionais resolvidos",
  NO_OPTIONALS: "Sem opcionais",
  STALE: "Opcionais desatualizados",
};

export const COST_IMPACT_STATUS_LABEL: Record<string, string> = {
  READY: "Pronto",
  BLOCKED_EFFECTIVE_BOM_NOT_READY: "BOM efetiva ainda não está pronta",
  NO_INDUS_PRODUCT: "Sem produto IndusCost",
  CURRENT_COST_UNAVAILABLE: "Custo atual indisponível",
};

export function formatNomusStatusLabel(
  status: string | null | undefined,
  labels: Record<string, string> = EFFECTIVE_BOM_STATUS_LABEL
): string {
  if (!status || status === "—") return "—";
  return labels[status] ?? status.replace(/_/g, " ");
}

export function nomusStatusBadgeClass(status: string): string {
  if (status.includes("READY") || status === "RESOLVED") return "bg-green-100 text-green-800";
  if (status.includes("PENDING") || status === "STALE") return "bg-amber-100 text-amber-900";
  if (status.includes("BLOCKED") || status === "NO_NOMUS_BOM") return "bg-red-100 text-red-900";
  return "bg-muted text-muted-foreground";
}
