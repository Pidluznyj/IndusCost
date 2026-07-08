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

export type MaterialIntelligence360SectionDef = {
  id: MaterialIntelligence360SectionId;
  title: string;
  description: string;
  emptyMessage: string;
};

export const MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS: MaterialIntelligence360SectionDef[] =
  [];

export const MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE =
  "Nenhuma cotação manual registrada para esta matéria-prima ainda.";

export const MATERIAL_INTELLIGENCE_TIMELINE_EMPTY_MESSAGE =
  "Nenhuma compra vinculada ainda.";

export function formatMaterialIntelligenceQuoteDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
