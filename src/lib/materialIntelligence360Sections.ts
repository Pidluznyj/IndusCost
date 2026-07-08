/**
 * Seções preparadas da visão 360º — Inteligência de Mercado por matéria-prima.
 */

export type MaterialIntelligence360SectionId =
  | "recentQuotes"
  | "priceHistory"
  | "marketComparison"
  | "suppliers"
  | "impactedProducts"
  | "timeline"
  | "audit";

export const MATERIAL_INTELLIGENCE_IMPACTED_PRODUCTS_EMPTY_MESSAGE =
  "Nenhum produto vinculado a esta matéria-prima na BOM oficial.";

export type MaterialIntelligence360SectionDef = {
  id: MaterialIntelligence360SectionId;
  title: string;
  description: string;
  emptyMessage: string;
};

export const MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS: MaterialIntelligence360SectionDef[] = [
  {
    id: "audit",
    title: "Auditoria",
    description: "Registro de alterações de monitoramento e custos.",
    emptyMessage: "O histórico de auditoria será exibido nesta área.",
  },
];

export const MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE =
  "Nenhuma cotação manual registrada para esta matéria-prima ainda.";

export function formatMaterialIntelligenceQuoteDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
