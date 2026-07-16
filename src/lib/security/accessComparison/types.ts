/**
 * Tipos — comparação legado (bag OR) × resolvedor novo (requireResource).
 * Dry-run only; sem PII na exportação.
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";
import type {
  EffectiveAccessInput,
  EffectiveAccessSource,
} from "@/src/lib/security/effectiveAccess/types.js";

/** Categorias de diff — bleed histórico nunca é "preservado intencional". */
export type AccessDiffCategory =
  | "preserved_intentional"
  | "new_legitimate_access"
  | "removed_by_deny"
  | "mega_key_bleed"
  | "permissive_fallback"
  | "unmapped_resource"
  | "conflict"
  | "lockout_risk"
  | "both_denied";

export type AccessComparisonSubject = {
  /** Identificador interno (fixture id ou user uuid) — hasheado na saída. */
  subjectId: string;
  role: string;
  accessProfileId?: string | null;
  accessProfileLabel?: string | null;
  /** Tag opcional (ex.: "leticia-ap-only"). */
  scenarioTag?: string | null;
  input: EffectiveAccessInput;
};

export type LegacyBagEvaluation = {
  allow: boolean;
  grantingKeys: string[];
  /** Chaves cujo grant neste recurso é bleed / mega-key (não intencional). */
  bleedKeys: string[];
  /** Chaves 1:1 / dedicadas neste recurso. */
  dedicatedKeys: string[];
};

export type AccessComparisonCell = {
  resourceKey: string;
  action: PermissionContractAction;
  legacyAllow: boolean;
  newAllow: boolean;
  newSource: EffectiveAccessSource;
  category: AccessDiffCategory;
  legacyGrantingKeys: string[];
  legacyBleedKeys: string[];
  legacyDedicatedKeys: string[];
  note?: string;
};

export type AccessComparisonUserReport = {
  subjectRef: string;
  role: string;
  accessProfileRef: string | null;
  scenarioTag: string | null;
  legacyCompatMode: boolean;
  legacyPermissionCount: number;
  overrideResourceCount: number;
  probeCount: number;
  categoryCounts: Record<AccessDiffCategory, number>;
  /** Células com diferença material (exclui both_denied). */
  diffs: AccessComparisonCell[];
  lockoutRiskCount: number;
  megaKeyBleedCount: number;
};

export type AccessComparisonProfileSummary = {
  accessProfileRef: string;
  accessProfileLabel: string | null;
  subjectCount: number;
  categoryCounts: Record<AccessDiffCategory, number>;
  lockoutRiskCount: number;
  megaKeyBleedCount: number;
};

export type AccessComparisonGlobalReport = {
  dryRun: true;
  generatedAt: string;
  migratedModuleScope: string[];
  probeCount: number;
  subjectCount: number;
  categoryCounts: Record<AccessDiffCategory, number>;
  lockoutRiskCount: number;
  megaKeyBleedCount: number;
  unmappedResourceCount: number;
  conflictCount: number;
  users: AccessComparisonUserReport[];
  byProfile: AccessComparisonProfileSummary[];
  note: string;
};
