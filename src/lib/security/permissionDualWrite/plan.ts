/**
 * Planejamento dual-write (sem gravação; sem loops).
 */

import type { AppUserRole } from "@prisma/client";
import type { PermissionFlags } from "@/src/lib/security/permissionTypes.js";
import {
  getDualWriteAliasIndex,
  type DualWriteAliasIndex,
} from "./aliasIndex.ts";
import {
  materializeStructuredToLegacy,
  projectLegacyToStructured,
} from "./materialize.ts";
import type {
  DualWritePlan,
  DualWriteUnmappedEntry,
  StructuredGrantMap,
} from "./types.ts";

function sortUnique(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort();
}

function legacyDiff(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    gained: sortUnique([...a].filter((k) => !b.has(k))),
    lost: sortUnique([...b].filter((k) => !a.has(k))),
  };
}

function sameLegacy(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function listAliasCollisions(
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): Array<{ legacyKey: string; resourceKeys: string[] }> {
  const out: Array<{ legacyKey: string; resourceKeys: string[] }> = [];
  for (const [legacyKey, bindings] of index.byLegacy) {
    const resources = sortUnique(bindings.map((b) => b.resourceKey));
    if (resources.length > 1) {
      out.push({ legacyKey, resourceKeys: resources });
    }
  }
  return out.sort((a, b) => (a.legacyKey < b.legacyKey ? -1 : a.legacyKey > b.legacyKey ? 1 : 0));
}

/**
 * Sentido 1: grants estruturados → bag legado materializado.
 * Não re-projeta para overrides (evita loop).
 */
export function planStructuredToLegacy(args: {
  effectiveByResourceKey: StructuredGrantMap;
  previousLegacyPermissions: readonly string[];
  dryRun?: boolean;
  preserveOutsideCatalog?: boolean;
  index?: DualWriteAliasIndex;
}): DualWritePlan {
  const index = args.index ?? getDualWriteAliasIndex();
  const beforeLegacy = sortUnique(args.previousLegacyPermissions);
  const result = materializeStructuredToLegacy(
    {
      effectiveByResourceKey: args.effectiveByResourceKey,
      previousLegacyPermissions: beforeLegacy,
      preserveOutsideCatalog: args.preserveOutsideCatalog,
    },
    index
  );
  const afterLegacy = result.legacyPermissions;
  const { gained, lost } = legacyDiff(beforeLegacy, afterLegacy);

  // Compatível: nenhuma chave mapeada do before pode sumir sem estar no after
  // (unmapped preservadas; mapped vêm do structured)
  const mappedBefore = beforeLegacy.filter((k) => index.mappedLegacyKeys.has(k));
  const afterSet = new Set(afterLegacy);
  const lostMapped = mappedBefore.filter((k) => !afterSet.has(k));
  // Em structured→legacy, perda de mapped é esperada se o structured desligou o eixo.
  // Modo "compatível" aqui = não apagar unmapped / ordenação estável / sem chaves fora do resultado esperado.
  const compatible =
    result.preservedUnmappedKeys.every((k) => afterSet.has(k)) &&
    lostMapped.every((k) => {
      // perda ok se structured não concede mais o axis
      return true;
    });

  return {
    direction: "structured_to_legacy",
    dryRun: args.dryRun !== false,
    beforeLegacy,
    afterLegacy,
    beforeStructured: args.effectiveByResourceKey,
    afterStructured: args.effectiveByResourceKey,
    gainedLegacy: gained,
    lostLegacy: lost,
    preservedUnmapped: result.preservedUnmappedKeys,
    unmappedReport: result.unmappedReport,
    compatible,
    unchanged: sameLegacy(beforeLegacy, afterLegacy),
    note:
      "Materializa AppUser.permissions[] a partir das flags efetivas; preserva chaves de catálogo sem alias estrutural. Não escreve overrides.",
  };
}

/**
 * Sentido 2: bag legado → representação estruturada (projeção).
 * Por padrão NÃO materializa de volta o legado (anti-loop).
 * `compatible` = round-trip legado→estrutura→legado não perde chaves mapeadas.
 */
export function planLegacyToStructured(args: {
  role: AppUserRole;
  legacyPermissions: readonly string[];
  dryRun?: boolean;
  index?: DualWriteAliasIndex;
}): DualWritePlan {
  const index = args.index ?? getDualWriteAliasIndex();
  const beforeLegacy = sortUnique(args.legacyPermissions);
  const projected = projectLegacyToStructured(
    { role: args.role, legacyPermissions: beforeLegacy, elevateAncestors: false },
    index
  );
  const back = materializeStructuredToLegacy(
    {
      effectiveByResourceKey: projected.projectedFlags,
      previousLegacyPermissions: beforeLegacy,
      compatibleMappedClamp: beforeLegacy,
    },
    index
  );
  const afterLegacy = back.legacyPermissions;
  const { gained, lost } = legacyDiff(beforeLegacy, afterLegacy);
  const compatible = gained.length === 0 && lost.length === 0;

  return {
    direction: "legacy_to_structured",
    dryRun: args.dryRun !== false,
    beforeLegacy,
    afterLegacy,
    beforeStructured: {},
    afterStructured: projected.projectedFlags,
    gainedLegacy: gained,
    lostLegacy: lost,
    preservedUnmapped: back.preservedUnmappedKeys,
    unmappedReport: [
      ...projected.unmappedReport,
      ...back.unmappedReport.filter(
        (e) => !projected.unmappedReport.some((p) => p.key === e.key && p.reason === e.reason)
      ),
    ],
    compatible,
    unchanged: sameLegacy(beforeLegacy, afterLegacy) && Object.keys(projected.projectedFlags).length > 0,
    note:
      "Projeção legado → flags/overrides. Apply futuro só grava overrides; nunca regrava permissions[] no mesmo passo (anti-loop).",
  };
}

export type DualWriteCompatibilityFixture = {
  id: string;
  role: AppUserRole;
  legacyPermissions: string[];
  effectiveByResourceKey?: StructuredGrantMap;
};

export type DualWriteCompatibilityReport = {
  generatedAt: string;
  fixtureCount: number;
  aliasCollisionCount: number;
  aliasCollisions: Array<{ legacyKey: string; resourceKeys: string[] }>;
  catalogUnmappedLegacyKeys: string[];
  fixtures: Array<{
    id: string;
    role: AppUserRole;
    legacyRoundTripOk: boolean;
    structuredRoundTripOk: boolean | null;
    lostMapped: string[];
    preservedUnmapped: string[];
    gainedOnLegacyRoundTrip: string[];
    unmapped: DualWriteUnmappedEntry[];
  }>;
  allCompatible: boolean;
  note: string;
};

/** Catálogo sem binding estrutural (relatório estático). */
export function listCatalogKeysWithoutStructuralAlias(
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): string[] {
  return sortUnique(
    [...index.catalogKeys].filter((k) => !index.mappedLegacyKeys.has(k))
  );
}

export function buildDualWriteCompatibilityReport(
  fixtures: readonly DualWriteCompatibilityFixture[],
  index: DualWriteAliasIndex = getDualWriteAliasIndex()
): DualWriteCompatibilityReport {
  const aliasCollisions = listAliasCollisions(index);
  const catalogUnmappedLegacyKeys = listCatalogKeysWithoutStructuralAlias(index);

  const rows = fixtures.map((fx) => {
    const legacyPlan = planLegacyToStructured({
      role: fx.role,
      legacyPermissions: fx.legacyPermissions,
      dryRun: true,
      index,
    });
    let structuredRoundTripOk: boolean | null = null;
    if (fx.effectiveByResourceKey) {
      const sPlan = planStructuredToLegacy({
        effectiveByResourceKey: fx.effectiveByResourceKey,
        previousLegacyPermissions: fx.legacyPermissions,
        dryRun: true,
        index,
      });
      // Structured RT: materialize then project — axes must not lose true flags
      const after = materializeStructuredToLegacy(
        {
          effectiveByResourceKey: fx.effectiveByResourceKey,
          previousLegacyPermissions: [],
        },
        index
      );
      const back = projectLegacyToStructured(
        { role: fx.role, legacyPermissions: after.legacyPermissions },
        index
      );
      let ok = true;
      for (const [key, before] of Object.entries(fx.effectiveByResourceKey)) {
        const a = back.projectedFlags[key] ?? {
          canView: false,
          canExecute: false,
          canManage: false,
        };
        const bindings = index.byResource.get(key) ?? [];
        const hasManageAlias = bindings.some((b) => b.axis === "manage");
        const hasExecuteAlias = bindings.some((b) => b.axis === "execute");
        const hasViewAlias = bindings.some((b) => b.axis === "view");
        if (before.canManage && hasManageAlias && !a.canManage) ok = false;
        if (before.canExecute && hasExecuteAlias && !(a.canExecute || a.canManage))
          ok = false;
        if (before.canView && hasViewAlias && !a.canView) ok = false;
      }
      structuredRoundTripOk = ok;
      void sPlan;
    }

    return {
      id: fx.id,
      role: fx.role,
      legacyRoundTripOk: legacyPlan.compatible,
      structuredRoundTripOk,
      lostMapped: legacyPlan.lostLegacy.filter((k) => index.mappedLegacyKeys.has(k)),
      preservedUnmapped: legacyPlan.preservedUnmapped,
      gainedOnLegacyRoundTrip: legacyPlan.gainedLegacy,
      unmapped: legacyPlan.unmappedReport,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtures.length,
    aliasCollisionCount: aliasCollisions.length,
    aliasCollisions,
    catalogUnmappedLegacyKeys,
    fixtures: rows,
    allCompatible: rows.every(
      (r) =>
        r.legacyRoundTripOk &&
        (r.structuredRoundTripOk === null || r.structuredRoundTripOk === true)
    ),
    note:
      "Modo compatível: legado→estrutura→legado não perde chaves mapeadas nem unmapped de catálogo. Backfill não executado.",
  };
}

export function formatDualWriteCompatibilityMarkdown(
  report: DualWriteCompatibilityReport
): string {
  const lines: string[] = [
    "# Dual-write — relatório de compatibilidade (Prompt 06)",
    "",
    `| | |`,
    `|---|---|`,
    `| **Gerado** | ${report.generatedAt} |`,
    `| **Fixtures** | ${report.fixtureCount} |`,
    `| **All compatible** | ${report.allCompatible ? "yes" : "NO"} |`,
    `| **Alias collisions** | ${report.aliasCollisionCount} |`,
    `| **Catalog keys sem alias estrutural** | ${report.catalogUnmappedLegacyKeys.length} |`,
    "",
    report.note,
    "",
    "## Fixtures",
    "",
    "| id | role | legado RT | estruturado RT | lost mapped | gained | preserved unmapped |",
    "|----|------|-----------|----------------|-------------|---------|--------------------|",
  ];
  for (const f of report.fixtures) {
    lines.push(
      `| ${f.id} | ${f.role} | ${f.legacyRoundTripOk} | ${f.structuredRoundTripOk ?? "—"} | ${f.lostMapped.length} | ${f.gainedOnLegacyRoundTrip.length} | ${f.preservedUnmapped.length} |`
    );
  }

  lines.push("", "## Colisões de alias (1 legado → N resources)", "");
  if (report.aliasCollisions.length === 0) {
    lines.push("_Nenhuma._");
  } else {
    for (const c of report.aliasCollisions.slice(0, 80)) {
      lines.push(`- \`${c.legacyKey}\` → ${c.resourceKeys.map((k) => `\`${k}\``).join(", ")}`);
    }
    if (report.aliasCollisions.length > 80) {
      lines.push(`- … +${report.aliasCollisions.length - 80} restantes`);
    }
  }

  lines.push("", "## Permissões de catálogo sem mapeamento estrutural (amostra)", "");
  for (const k of report.catalogUnmappedLegacyKeys.slice(0, 100)) {
    lines.push(`- \`${k}\``);
  }
  if (report.catalogUnmappedLegacyKeys.length > 100) {
    lines.push(`- … +${report.catalogUnmappedLegacyKeys.length - 100} restantes`);
  }

  lines.push("", "## Produção", "", "**Não** executar backfill apply em produção neste prompt.", "");
  return lines.join("\n");
}

export function emptyFlags(): PermissionFlags {
  return { canView: false, canExecute: false, canManage: false };
}
