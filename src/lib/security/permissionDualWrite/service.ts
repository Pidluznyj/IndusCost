/**
 * Serviço central de materialização dual-write (P06).
 * Estruturado = fonte futura; bag = materialização temporária determinística.
 */

import { filterKnownPermissions } from "@/src/lib/appAuth.js";
import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";
import { getDualWriteAliasIndex } from "./aliasIndex.ts";
import { materializeStructuredToLegacy } from "./materialize.ts";
import { planStructuredToLegacy } from "./plan.ts";
import type {
  DualWritePlan,
  DualWriteUnmappedEntry,
  MaterializeToLegacyResult,
  StructuredGrantMap,
} from "./types.ts";

export type MaterializeUserBagOptions = {
  /** Flags efetivas (role∪overrides ou snapshot absoluto) — fonte. */
  effectiveByResourceKey: StructuredGrantMap;
  /** Bag atual do usuário. */
  previousLegacyPermissions?: readonly string[];
  /** Default true — não grava; só plano before/after. */
  dryRun?: boolean;
  preserveOutsideCatalog?: boolean;
  /** Default true (P06). */
  oneToOneAliases?: boolean;
  /** Se true, passa por filterKnownPermissions (drop fora do catálogo). */
  filterKnown?: boolean;
};

export type MaterializeUserBagResult = {
  plan: DualWritePlan;
  materialize: MaterializeToLegacyResult;
  /** Bag pronta para AppUser.permissions[] (já filtrada se filterKnown). */
  legacyPermissions: string[];
  unknownKeysReport: DualWriteUnmappedEntry[];
  unchanged: boolean;
};

/**
 * Materializa bag a partir do mapa estruturado.
 * Idempotente e determinístico (ordenação lexicográfica).
 * Deny (flag falsa no recurso canônico) remove a chave mapeada correspondente.
 * Não injeta baseline de role — o caller passa o mapa efetivo desejado.
 */
export function materializeUserLegacyBag(
  options: MaterializeUserBagOptions
): MaterializeUserBagResult {
  const previous = options.previousLegacyPermissions ?? [];
  const oneToOne = options.oneToOneAliases !== false;
  const materialize = materializeStructuredToLegacy({
    effectiveByResourceKey: options.effectiveByResourceKey,
    previousLegacyPermissions: previous,
    preserveOutsideCatalog: options.preserveOutsideCatalog,
    oneToOneAliases: oneToOne,
  });

  let legacyPermissions = materialize.legacyPermissions;
  if (options.filterKnown !== false) {
    legacyPermissions = filterKnownPermissions(legacyPermissions);
  }

  const plan = planStructuredToLegacy({
    effectiveByResourceKey: options.effectiveByResourceKey,
    previousLegacyPermissions: previous,
    dryRun: options.dryRun !== false,
    preserveOutsideCatalog: options.preserveOutsideCatalog,
    oneToOneAliases: oneToOne,
  });

  // Alinha after do plano ao filtro conhecido (quando aplicável)
  if (options.filterKnown !== false) {
    plan.afterLegacy = legacyPermissions;
    const beforeSet = new Set(plan.beforeLegacy);
    const afterSet = new Set(legacyPermissions);
    plan.gainedLegacy = legacyPermissions.filter((k) => !beforeSet.has(k));
    plan.lostLegacy = plan.beforeLegacy.filter((k) => !afterSet.has(k));
    plan.unchanged =
      plan.beforeLegacy.length === legacyPermissions.length &&
      plan.beforeLegacy.every((k, i) => k === legacyPermissions[i]);
  }

  return {
    plan,
    materialize,
    legacyPermissions,
    unknownKeysReport: materialize.unmappedReport,
    unchanged: plan.unchanged,
  };
}

/**
 * Helper: materializa a partir de flags efetivas (wrapper usado pelo admin).
 * Não adiciona baseline VIEWER — usa exatamente o mapa fornecido.
 */
export function materializeLegacyBagFromEffectiveFlags(
  effectiveByResourceKey: Record<string, PermissionFlags>,
  previousLegacyPermissions: readonly string[] = [],
  options?: { dryRun?: boolean; oneToOneAliases?: boolean }
): string[] {
  return materializeUserLegacyBag({
    effectiveByResourceKey,
    previousLegacyPermissions,
    dryRun: options?.dryRun ?? true,
    oneToOneAliases: options?.oneToOneAliases,
    filterKnown: true,
  }).legacyPermissions;
}

/** Comparação before/after para dry-run de UI/API. */
export function compareLegacyBags(
  before: readonly string[],
  after: readonly string[]
): { gained: string[]; lost: string[]; unchanged: boolean } {
  const b = [...new Set(before.map((k) => k.trim()).filter(Boolean))].sort();
  const a = [...new Set(after.map((k) => k.trim()).filter(Boolean))].sort();
  const bSet = new Set(b);
  const aSet = new Set(a);
  return {
    gained: a.filter((k) => !bSet.has(k)),
    lost: b.filter((k) => !aSet.has(k)),
    unchanged: b.length === a.length && b.every((k, i) => k === a[i]),
  };
}

/** Índice 1:1 — útil para relatórios. */
export function listOneToOneAliasPairs(): Array<{
  legacyKey: string;
  resourceKey: string;
  axis: string;
}> {
  const index = getDualWriteAliasIndex();
  return [...index.canonicalByLegacy.entries()]
    .map(([legacyKey, b]) => ({
      legacyKey,
      resourceKey: b.resourceKey,
      axis: b.axis,
    }))
    .sort((x, y) => x.legacyKey.localeCompare(y.legacyKey));
}
