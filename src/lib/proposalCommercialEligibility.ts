/**
 * Elegibilidade comercial das propostas — regra ÚNICA (browser + server safe).
 *
 * Caso que motivou (teste_bi, 29/10/2026): 70 propostas do Nomus com `totalNetValue <= 0`, sem item mapeado e
 * sem pedido de venda (ex.: CP 01818 a 01822, JAIRO M AVELINO LTDA, `valorTotal=0`, `valorTotalNfe=42.900`,
 * `totalItems=0`) inflavam contagens, derrubavam o ticket médio e a taxa de conversão.
 *
 * Duas perguntas diferentes, dois predicados:
 *
 * 1. VISÍVEL NO GRID PADRÃO? Some só a proposta do Nomus sem valor comercial: Nomus + líquido <= 0 + nenhum item
 *    mapeado + nenhum pedido vinculado. Proposta local em elaboração continua no grid (é trabalho em andamento).
 *    Anomalia (zerada com item mapeado ou com pedido) continua visível, marcada, para investigação.
 *    O filtro administrativo "Exibir propostas sem valor comercial" mostra as ocultas; o detalhe por ID nunca some.
 *
 * 2. ENTRA NOS INDICADORES COMERCIAIS? Só proposta efetiva: líquido > 0 OU pedido de venda vinculado.
 *    Vale para propostas no ano/mês, em aberto, valor proposto, ticket médio, convertidas, taxa de conversão e o
 *    gráfico YTD — sempre a mesma população, independente da página e do filtro administrativo.
 *
 * Nada é gravado: a classificação é calculada na consulta a partir dos dados atuais, então uma nova sincronização
 * do Nomus reclassifica sozinha (sem script de limpeza). Valor bruto (`valorTotalNfe` → `totalGrossValue`) nunca
 * torna a proposta comercialmente válida e nunca vira `totalNetValue`.
 */
import type { Prisma } from "@prisma/client";

export const PROPOSAL_NOMUS_SOURCE_SYSTEM = "NOMUS";

/** Parâmetro da listagem para o filtro administrativo. */
export const PROPOSAL_INCLUDE_WITHOUT_COMMERCIAL_VALUE_PARAM = "includeWithoutCommercialValue";

/** Chave oficial que libera o filtro administrativo (quem edita propostas). */
export const PROPOSAL_WITHOUT_COMMERCIAL_VALUE_FILTER_PERMISSION = "proposals.edit";

export type ProposalCommercialClass =
  /** Líquido > 0: proposta efetiva. */
  | "EFFECTIVE"
  /** Pedido de venda vinculado com líquido <= 0: visível e contada (o pedido existe), merece revisão. */
  | "ZERO_WITH_SALES_ORDER"
  /** Nomus, líquido <= 0, com item mapeado e sem pedido: anomalia visível, fora dos indicadores. */
  | "NOMUS_ZERO_WITH_ITEMS"
  /** Nomus, líquido <= 0, sem item mapeado e sem pedido: oculta por padrão, fora dos indicadores. */
  | "NOMUS_WITHOUT_COMMERCIAL_VALUE"
  /** Local (não Nomus) sem valor e sem pedido: em elaboração, visível, fora dos indicadores. */
  | "LOCAL_WITHOUT_VALUE";

export type ProposalCommercialEligibility = {
  commercialClass: ProposalCommercialClass;
  visibleByDefault: boolean;
  countsInCommercialMetrics: boolean;
  /** Texto curto para a marca visual no grid; null na proposta efetiva. */
  label: string | null;
};

export type ProposalEligibilityFacts = {
  sourceSystem: string | null | undefined;
  totalNetValue: number | string | { toString(): string } | null | undefined;
  /** Itens gravados em ProposalItem (mapeados), não `totalItems` nem o array bruto do Nomus. */
  mappedItemCount: number;
  hasSalesOrder: boolean;
};

function netValue(value: ProposalEligibilityFacts["totalNetValue"]): number {
  if (value == null) return 0;
  const amount = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(amount) ? amount : 0;
}

export function isNomusProposalSource(sourceSystem: string | null | undefined): boolean {
  return sourceSystem === PROPOSAL_NOMUS_SOURCE_SYSTEM;
}

/** Mesma regra dos predicados Prisma abaixo, para marcar linhas e para o resumo calculado no navegador. */
export function classifyProposalCommercialEligibility(facts: ProposalEligibilityFacts): ProposalCommercialEligibility {
  const net = netValue(facts.totalNetValue);
  if (net > 0) {
    return { commercialClass: "EFFECTIVE", visibleByDefault: true, countsInCommercialMetrics: true, label: null };
  }
  if (facts.hasSalesOrder) {
    return {
      commercialClass: "ZERO_WITH_SALES_ORDER",
      visibleByDefault: true,
      countsInCommercialMetrics: true,
      label: "Sem valor, com pedido vinculado — revisar",
    };
  }
  if (isNomusProposalSource(facts.sourceSystem)) {
    if (facts.mappedItemCount > 0) {
      return {
        commercialClass: "NOMUS_ZERO_WITH_ITEMS",
        visibleByDefault: true,
        countsInCommercialMetrics: false,
        label: "Sem valor, com itens — revisar",
      };
    }
    return {
      commercialClass: "NOMUS_WITHOUT_COMMERCIAL_VALUE",
      visibleByDefault: false,
      countsInCommercialMetrics: false,
      label: "Sem valor comercial (Nomus)",
    };
  }
  return {
    commercialClass: "LOCAL_WITHOUT_VALUE",
    visibleByDefault: true,
    countsInCommercialMetrics: false,
    label: "Em elaboração — fora dos indicadores",
  };
}

/** Nomus sem valor comercial (as que somem do grid padrão). Usado no filtro e no diagnóstico. */
export const PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE: Prisma.ProposalWhereInput = {
  sourceSystem: PROPOSAL_NOMUS_SOURCE_SYSTEM,
  totalNetValue: { lte: 0 },
  items: { none: {} },
  salesOrder: { is: null },
};

/**
 * Visível no grid padrão = NÃO (Nomus sem valor comercial), escrito de forma positiva.
 * `NOT` sobre coluna anulável em SQL descartaria `sourceSystem IS NULL` (NULL = 'NOMUS' é NULL), por isso a
 * ausência de origem entra explicitamente.
 */
export const PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE: Prisma.ProposalWhereInput = {
  OR: [
    { sourceSystem: null },
    { sourceSystem: { not: PROPOSAL_NOMUS_SOURCE_SYSTEM } },
    { totalNetValue: { gt: 0 } },
    { items: { some: {} } },
    { salesOrder: { isNot: null } },
  ],
};

/** População dos indicadores comerciais: líquido > 0 ou pedido de venda vinculado. */
export const PROPOSAL_COMMERCIAL_METRICS_WHERE: Prisma.ProposalWhereInput = {
  OR: [{ totalNetValue: { gt: 0 } }, { salesOrder: { isNot: null } }],
};

/**
 * Junta fragmentos com AND sem que um `OR` (busca, visibilidade, convertidas) sobrescreva o outro — o que
 * acontecia com `{ ...where, OR: [...] }`.
 */
export function andProposalWhere(...parts: Array<Prisma.ProposalWhereInput | null | undefined>): Prisma.ProposalWhereInput {
  const kept = parts.filter((part): part is Prisma.ProposalWhereInput => Boolean(part) && Object.keys(part!).length > 0);
  if (kept.length === 0) return {};
  if (kept.length === 1) return kept[0]!;
  return { AND: kept };
}

/** Linha do grid com a marca visual. `_count.items` vem do include da listagem. */
export function withProposalCommercialEligibility<T extends object>(
  row: T
): T & { commercialEligibility: ProposalCommercialEligibility } {
  const facts = row as {
    sourceSystem?: string | null;
    totalNetValue?: ProposalEligibilityFacts["totalNetValue"];
    salesOrder?: unknown;
    _count?: { items?: number } | null;
  };
  return {
    ...row,
    commercialEligibility: classifyProposalCommercialEligibility({
      sourceSystem: facts.sourceSystem ?? null,
      totalNetValue: facts.totalNetValue ?? 0,
      mappedItemCount: Number(facts._count?.items ?? 0),
      hasSalesOrder: facts.salesOrder != null,
    }),
  };
}
