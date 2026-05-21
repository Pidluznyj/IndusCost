/**
 * Tipos compartilhados (sem Prisma) da Central de Atualização Nomus.
 *
 * Fase: NOMUS-ENGINEERING-OPERATIONS-COCKPIT-A (read-only).
 * - Não altera ProductBOM, custo, preço, propostas ou pedidos.
 * - Mapeia a classificação técnica existente para linguagem operacional.
 */

import type {
  NomusBomActionClass,
  NomusBomRiskLevel,
} from "@/src/lib/nomusBomClassification";

export type CockpitMode = "READ_ONLY";

export type CockpitScope = "ALL" | "CHANGED_ONLY" | "ONE_PRODUCT";

/** Status operacional curto, em linguagem de negócio (não usar enums técnicos crus na UI). */
export type CockpitOperatorStatus =
  | "OK"
  | "READY"
  | "REVIEW"
  | "BLOCKED"
  | "NEW"
  | "LOCAL"
  | "OPTIONAL"
  | "AMBIGUOUS";

export type CockpitSeverity = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";

export type CockpitSituationKind =
  | "NO_CHANGES"
  | "READY_TO_REVIEW"
  | "NEW_PRODUCT"
  | "BOM_CHANGED"
  | "QUANTITY_CHANGED"
  | "LOCAL_ITEM_PRESERVED"
  | "ASSEMBLY_LOCAL_PRESERVED"
  | "OPTIONAL_PENDING"
  | "AMBIGUOUS_CODE"
  | "MISSING_MATERIAL"
  | "MISSING_CHILD_PRODUCT"
  | "BLOCKED_GENERIC";

export type CockpitSituationLabel = {
  kind: CockpitSituationKind;
  label: string;
};

export type CockpitTechnicalRef = {
  /** Aba da Manutenção Nomus onde o detalhe técnico mora. */
  tab:
    | "overview"
    | "pending"
    | "effective-pricing-bom"
    | "cost-impact"
    | "apply-plan"
    | "diagnostic"
    | "product-import"
    | "engineering-sync";
  label: string;
  /** Quando true, é a ação técnica primária para este caso (atalho destacado). */
  primary?: boolean;
};

export type CockpitRow = {
  parentCode: string;
  parentDescription: string | null;
  productId: string | null;
  productName: string | null;

  operatorStatus: CockpitOperatorStatus;
  operatorStatusLabel: string;
  severity: CockpitSeverity;

  situationLabels: CockpitSituationLabel[];
  whatChangedSummary: string;
  nextRecommendedAction: string;

  hasStructuralChanges: boolean;
  hasLocalException: boolean;
  hasAssemblyLocalException: boolean;
  hasOptionalPending: boolean;
  hasBlockingIssues: boolean;
  hasAmbiguity: boolean;
  hasMissingMaterials: boolean;
  hasMissingChildProducts: boolean;

  blockingDetails: string[];
  warnings: string[];

  technicalRefs: CockpitTechnicalRef[];

  /**
   * Campos técnicos para auditoria e modo avançado — não exibir crus na UI operacional.
   * Mantemos para permitir filtros e expansões futuras sem outra chamada de API.
   */
  technicalMeta: {
    actionClass: NomusBomActionClass | null;
    riskLevel: NomusBomRiskLevel | null;
    quantityDiffs: number;
    onlyInNomus: number;
    onlyInIndusCost: number;
    missingProductInIndusCost: boolean;
    noNomusBom: boolean;
    noIndusBom: boolean;
    reasons: string[];
  };
};

export type CockpitTotals = {
  total: number;
  noChanges: number;
  ready: number;
  needsReview: number;
  blocked: number;
  newProducts: number;
  bomChanged: number;
  optionalPending: number;
  localExceptions: number;
  assemblyLocalExceptions: number;
  ambiguous: number;
  missingMaterials: number;
  missingProducts: number;
};

export type CockpitResult = {
  generatedAt: string;
  mode: CockpitMode;
  scope: CockpitScope;
  parentCode: string | null;
  /** Total real de produtos com parentCode distinto no stage Nomus (independente do limit). */
  totalParentsInStage: number;
  /** Quantidade efetivamente analisada nesta chamada. */
  comparedCount: number;
  /** Limite aplicado (pode ter sido clampado pelo servidor). */
  limitApplied: number;
  totals: CockpitTotals;
  rows: CockpitRow[];
  warnings: string[];
};
