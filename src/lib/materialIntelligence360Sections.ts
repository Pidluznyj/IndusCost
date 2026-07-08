/**
 * Seções preparadas da visão 360º — Inteligência de Mercado por matéria-prima.
 */

export type MaterialIntelligence360SectionId =
  | "recentQuotes"
  | "priceHistory"
  | "suppliers"
  | "dollar"
  | "brent"
  | "impactedProducts"
  | "timeline"
  | "audit";

export type MaterialIntelligence360SectionDef = {
  id: MaterialIntelligence360SectionId;
  title: string;
  description: string;
  emptyMessage: string;
};

export const MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS: MaterialIntelligence360SectionDef[] = [
  {
    id: "priceHistory",
    title: "Histórico de Preços",
    description: "Evolução de custos e cotações ao longo do tempo.",
    emptyMessage: "O histórico detalhado de preços será exibido nesta área.",
  },
  {
    id: "suppliers",
    title: "Fornecedores",
    description: "Fornecedores vinculados e condições de compra.",
    emptyMessage: "O panorama de fornecedores será consolidado nesta área.",
  },
  {
    id: "dollar",
    title: "Dólar",
    description: "Correlação com câmbio e impacto estimado no custo.",
    emptyMessage: "Os sinais de dólar serão exibidos nesta área.",
  },
  {
    id: "brent",
    title: "Brent",
    description: "Correlação com petróleo e derivados relevantes.",
    emptyMessage: "Os sinais de Brent serão exibidos nesta área.",
  },
  {
    id: "impactedProducts",
    title: "Produtos Impactados",
    description: "Produtos e estruturas que consomem esta matéria-prima.",
    emptyMessage: "Os produtos impactados serão listados nesta área.",
  },
  {
    id: "timeline",
    title: "Timeline",
    description: "Linha do tempo de eventos de mercado e decisões.",
    emptyMessage: "A timeline de mercado será exibida nesta área.",
  },
  {
    id: "audit",
    title: "Auditoria",
    description: "Registro de alterações de monitoramento e custos.",
    emptyMessage: "O histórico de auditoria será exibido nesta área.",
  },
];

export const MATERIAL_INTELLIGENCE_RECENT_QUOTES_EMPTY_MESSAGE =
  "Nenhuma cotação registrada para esta matéria-prima ainda.";

export function formatMaterialIntelligenceQuoteDate(iso: string | null | undefined): string {
  if (!iso?.trim()) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
