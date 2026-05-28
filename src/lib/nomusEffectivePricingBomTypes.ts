/** Tipos e constantes compartilhados — sem Prisma (seguro para o frontend). */

import { normalizeComponentCode } from "@/src/lib/nomusBomComparison";

export type PricingOptionalStatus = "PENDING" | "RESOLVED" | "NO_OPTIONALS" | "STALE";

/** Montagem local IndusCost (ex.: 800.01) — componente de ProductBOM, não roteiro Nomus nesta fase. */
export function isLocalAssemblyComponentCode(componentCode: string): boolean {
  return normalizeComponentCode(componentCode).startsWith("800.");
}

export type NomusBomReviewDecisionType =
  | "PENDING"
  | "INCLUDE_AS_LOCAL_EXCEPTION"
  | "EXCLUDE_FROM_PRICING"
  | "DUPLICATED_BY_NOMUS_COMPONENT"
  | "OPERATIONAL_ROUTING_COST"
  | "NEEDS_ENGINEERING_REVIEW";

export type NomusAggregatedLineFlags = {
  hasOptionalNomusLines: boolean;
  hasAlternativeNomusLines: boolean;
  hasPreferredNomusLines: boolean;
  hasShipmentItemNomusLines: boolean;
};

export type NomusListSummary = {
  listaMateriaisId?: number | null;
  listaMateriaisNome?: string | null;
  listaMateriaisPadrao?: boolean | null;
  listaMateriaisPadraoBlocoK?: boolean | null;
  linesCount: number;
};

export type EffectivePricingBomSource =
  | "NOMUS_REQUIRED"
  | "NOMUS_OPTIONAL_SELECTED"
  | "NOMUS_OPTIONAL_NOT_SELECTED"
  | "NOMUS_OPTIONAL_SELECTED_NONE"
  | "NOMUS_ALTERNATIVE_SELECTED"
  | "NOMUS_ALTERNATIVE_NOT_SELECTED"
  | "LOCAL_ONLY_INDUS_REVIEW"
  | "LOCAL_ONLY_INCLUDED_BY_REVIEW"
  | "LOCAL_ONLY_EXCLUDED_BY_REVIEW"
  | "LOCAL_ONLY_OBSOLETE_NOMUS"
  | "LOCAL_ONLY_DUPLICATED_BY_NOMUS"
  | "LOCAL_ONLY_ENGINEERING_REVIEW"
  | "OPERATIONAL_ROUTING_COST"
  | "OPERATIONAL_IGNORED";

export type EffectivePricingBomDecision = "INCLUDE" | "EXCLUDE" | "REVIEW" | "BLOCKED";

export type EffectivePricingBomStatus =
  | "READY_FOR_PRICING_PREVIEW"
  | "READY_WITH_LOCAL_REVIEW"
  | "PENDING_LOCAL_REVIEW"
  | "PENDING_OPTIONAL_SELECTION"
  | "STALE_OPTIONAL_SELECTION"
  | "BLOCKED_UNRESOLVED_COMPONENTS"
  | "NO_NOMUS_BOM";

export type EffectivePricingBomLine = {
  componentCode: string;
  componentDescription?: string | null;
  quantity: number | null;
  source: EffectivePricingBomSource;
  decision: EffectivePricingBomDecision;
  includedForPricing: boolean;
  reason: string;
  flags: NomusAggregatedLineFlags;
  nomusSourceLineIds: number[];
  groupId?: string;
  groupName?: string;
  selectedChoiceId?: string;
  resolution?: string;
  productBomLineId?: string;
  reviewDecisionId?: string;
  reviewDecisionType?: NomusBomReviewDecisionType;
  relatedNomusComponentCode?: string;
};

export type EffectivePricingBomTreeNode = {
  level: number;
  parentCode: string;
  componentCode: string;
  description: string | null;
  directQuantity: number | null;
  accumulatedQuantity: number | null;
  includedForPricing: boolean;
  decision: EffectivePricingBomDecision;
  source: EffectivePricingBomSource;
  children: EffectivePricingBomTreeNode[];
  resolution?: "PRODUCT" | "MATERIAL" | "BOTH" | "UNRESOLVED_COMPONENT";
};

export type EffectivePricingBomSummary = {
  includedLinesCount: number;
  excludedLinesCount: number;
  reviewLinesCount: number;
  blockedLinesCount: number;
  requiredIncludedCount: number;
  optionalSelectedCount: number;
  optionalExcludedCount: number;
  unresolvedComponentsCount: number;
  recursiveNodesCount: number;
  localReviewPendingCount: number;
  localReviewResolvedCount: number;
  localIncludedByReviewCount: number;
  localExcludedByReviewCount: number;
  operationalRoutingReviewCount: number;
};

export type ReviewDecisionView = {
  id: string;
  parentCode: string;
  parentProductId: string | null;
  productBomLineId: string | null;
  componentCode: string;
  componentDescription: string | null;
  quantitySnapshot: number | null;
  decision: NomusBomReviewDecisionType;
  includeForPricing: boolean;
  relatedNomusComponentCode: string | null;
  reason: string | null;
  notes: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

export type LocalReviewCatalogItem = {
  componentCode: string;
  componentDescription: string | null;
  quantity: number | null;
  productBomLineId: string;
  savedDecision: ReviewDecisionView | null;
  placement: "pending_review" | "included" | "excluded" | "engineering_review";
};

export type EffectivePricingBomResult = {
  generatedAt: string;
  parentCode: string;
  parentDescription?: string | null;
  indusProductId?: string | null;
  selectedList: NomusListSummary | null;
  optionalPricingStatus: PricingOptionalStatus;
  status: EffectivePricingBomStatus;
  summary: EffectivePricingBomSummary;
  directLines: EffectivePricingBomLine[];
  excludedLines: EffectivePricingBomLine[];
  reviewLines: EffectivePricingBomLine[];
  localReviewCatalog: LocalReviewCatalogItem[];
  recursiveTree?: EffectivePricingBomTreeNode[];
  warnings: string[];
};

export const REVIEW_DECISION_OPTIONS = [
  { value: "PENDING" as const, label: "Pendente" },
  {
    value: "INCLUDE_AS_LOCAL_EXCEPTION" as const,
    label: "Incluir como exceção local na precificação",
  },
  { value: "EXCLUDE_FROM_PRICING" as const, label: "Não considerar na precificação" },
  {
    value: "DUPLICATED_BY_NOMUS_COMPONENT" as const,
    label: "Duplicado/absorvido por componente Nomus",
  },
  {
    value: "OPERATIONAL_ROUTING_COST" as const,
    label: "Tratar como custo de roteiro/processo (opcional; não é o padrão para 800.xx)",
  },
  {
    value: "NEEDS_ENGINEERING_REVIEW" as const,
    label: "Precisa revisão de engenharia",
  },
];

export const REVIEW_DECISION_LABELS: Record<NomusBomReviewDecisionType, string> = {
  PENDING: "Pendente",
  INCLUDE_AS_LOCAL_EXCEPTION: "Incluir como exceção local na precificação",
  EXCLUDE_FROM_PRICING: "Não considerar na precificação",
  DUPLICATED_BY_NOMUS_COMPONENT: "Duplicado/absorvido por componente Nomus",
  OPERATIONAL_ROUTING_COST: "Tratar como custo de roteiro/processo (não padrão para montagem 800.xx)",
  NEEDS_ENGINEERING_REVIEW: "Precisa revisão de engenharia",
};

export const REVIEW_DECISION_BADGE: Record<NomusBomReviewDecisionType, string> = {
  PENDING: "Pendente",
  INCLUDE_AS_LOCAL_EXCEPTION: "Incluído localmente",
  EXCLUDE_FROM_PRICING: "Excluído",
  DUPLICATED_BY_NOMUS_COMPONENT: "Resolvido",
  OPERATIONAL_ROUTING_COST: "Processo/roteiro",
  NEEDS_ENGINEERING_REVIEW: "Engenharia",
};
