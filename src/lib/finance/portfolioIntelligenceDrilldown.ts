import type {
  PortfolioIntelligenceCardDto,
  PortfolioIntelligenceGroupDto,
  PortfolioIntelligenceOrderRow,
} from "@/src/lib/financePortfolioReconciliationClient";

/** Sanfonas de status principal + alerta de divergência técnica. */
export const INTELLIGENCE_ACCORDION_KEYS = [
  "RECEBIDO",
  "CR_ABERTO",
  "FATURADO_SEM_CR",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "DIVERGENCIA_TECNICA",
  "SEM_EVIDENCIA",
] as const;

export type IntelligenceAccordionKey = (typeof INTELLIGENCE_ACCORDION_KEYS)[number];

/** Mapeia card do topo → sanfona. */
export function cardKeyToAccordionKey(cardKey: string): IntelligenceAccordionKey | null {
  if (cardKey === "RISCO_SUPERESTIMACAO") return "CARTEIRA_VENCIDA_BLOQUEADA";
  if ((INTELLIGENCE_ACCORDION_KEYS as readonly string[]).includes(cardKey)) {
    return cardKey as IntelligenceAccordionKey;
  }
  return null;
}

/** Pedidos exibidos em cada sanfona (divergência = tag, sem mudar status principal). */
export function rowsForIntelligenceAccordion(
  key: IntelligenceAccordionKey,
  rows: readonly PortfolioIntelligenceOrderRow[]
): PortfolioIntelligenceOrderRow[] {
  if (key === "DIVERGENCIA_TECNICA") {
    return rows.filter((r) => r.tagsAlerta?.includes("DIVERGENCIA_TECNICA"));
  }
  return rows.filter((r) => r.statusPrincipal === key);
}

export type AccordionHeaderStats = {
  value: number;
  count: number;
  percentage: number | null;
  averageConfidence: number;
  isAlert: boolean;
};

export function statsForIntelligenceAccordion(
  key: IntelligenceAccordionKey,
  groups: readonly PortfolioIntelligenceGroupDto[],
  cards: readonly PortfolioIntelligenceCardDto[],
  rows: readonly PortfolioIntelligenceOrderRow[],
  carteiraTotal: number
): AccordionHeaderStats {
  if (key === "DIVERGENCIA_TECNICA") {
    const card = cards.find((c) => c.key === "DIVERGENCIA_TECNICA");
    const list = rowsForIntelligenceAccordion(key, rows);
    const value = card?.value ?? list.reduce((s, r) => s + r.orderValue, 0);
    const valueWeight = list.reduce((s, r) => s + r.orderValue, 0);
    const conf =
      list.length === 0
        ? 0
        : list.reduce((s, r) => s + r.confidenceScore * r.orderValue, 0) /
          Math.max(valueWeight, 1);
    return {
      value,
      count: card?.count ?? list.length,
      percentage:
        card?.percentage ??
        (carteiraTotal > 0 ? Number(((value / carteiraTotal) * 100).toFixed(2)) : null),
      averageConfidence: Number(conf.toFixed(2)),
      isAlert: true,
    };
  }

  const group = groups.find((g) => g.statusPrincipal === key);
  const card = cards.find((c) => c.key === key);
  return {
    value: group?.orderValue ?? card?.value ?? 0,
    count: group?.ordersCount ?? card?.count ?? 0,
    percentage:
      card?.percentage ??
      (carteiraTotal > 0 && group
        ? Number(((group.orderValue / carteiraTotal) * 100).toFixed(2))
        : null),
    averageConfidence: group?.averageConfidence ?? 0,
    isAlert: false,
  };
}

/** Soma dos grupos principais (exclui alerta de divergência). */
export function sumPrincipalGroupValues(
  groups: readonly PortfolioIntelligenceGroupDto[]
): number {
  return groups
    .filter((g) => g.statusPrincipal !== "DIVERGENCIA_TECNICA")
    .reduce((s, g) => s + g.orderValue, 0);
}

/**
 * Um pedido não pode ter dois status principais nos grupos.
 * Retorna códigos duplicados se a API/agrupamento estiver inconsistente.
 */
export function findDuplicateOrderCodesAcrossPrincipalGroups(
  groups: readonly PortfolioIntelligenceGroupDto[]
): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const g of groups) {
    if (g.statusPrincipal === "DIVERGENCIA_TECNICA") continue;
    for (const code of g.orderCodes ?? []) {
      const prev = seen.get(code);
      if (prev && prev !== g.statusPrincipal) {
        dupes.push(code);
      } else {
        seen.set(code, g.statusPrincipal);
      }
    }
  }
  return [...new Set(dupes)];
}
