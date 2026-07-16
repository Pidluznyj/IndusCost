/**
 * Comparação: acesso legado (canAccessModule) → acesso efetivo (canViewModule).
 *
 * Critério de sucesso: zero **revogação involuntária** —
 * se o legado liberava o módulo e o efetivo nega, é falha.
 * Ganhos via ROLE_MATRIX são reportados como `expected_role_overlay` (não falham).
 *
 * Uso:
 *   npx tsx scripts/compareLegacyVsResourceNavAccess.ts
 *   npm run permissions:compare:legacy-vs-resource
 */

import {
  SIDEBAR_MODULE_ORDER,
  canAccessModule,
  type AppModuleId,
  type PermissionChecker,
} from "../src/lib/modulePermissions.ts";
import type { AuthUser } from "../src/lib/appAuthClient.ts";
import { canViewModule } from "../src/lib/resourceNavigationAccess.ts";
import { resolveSidebarModuleResourceKey } from "../src/lib/sidebarMenuResources.ts";
import {
  PERMISSION_PERSONA_MATRIX,
  type PersonaSpec,
} from "../src/lib/security/permissionPersonaMatrix.ts";

export type ModuleCompareRow = {
  personaId: string;
  moduleId: AppModuleId;
  resourceKey: string | null;
  legacy: boolean;
  effective: boolean;
  status:
    | "match"
    | "expected_role_overlay"
    | "involuntary_revocation"
    | "intentional_bleed_removal"
    | "both_denied";
};

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: perms },
  };
}

function user(role: AuthUser["role"], permissions: string[]): AuthUser {
  return {
    id: `cmp-${role}`,
    name: "Compare",
    email: "cmp@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function classify(
  spec: PersonaSpec,
  moduleId: AppModuleId,
  legacy: boolean,
  effective: boolean
): ModuleCompareRow["status"] {
  if (spec.role === "SUPER_ADMIN") {
    return legacy === effective
      ? legacy
        ? "match"
        : "both_denied"
      : "expected_role_overlay";
  }
  if (legacy === effective) {
    return legacy ? "match" : "both_denied";
  }
  if (!legacy && effective) {
    return "expected_role_overlay";
  }
  // legacy true, effective false — bleed removido pelo DTO (P10+) é intencional.
  if (
    spec.expectDenyModules.includes(moduleId) ||
    !spec.expectViewModules.includes(moduleId)
  ) {
    return "intentional_bleed_removal";
  }
  return "involuntary_revocation";
}

export function comparePersonaModules(spec: PersonaSpec): ModuleCompareRow[] {
  const perms = spec.permissions;
  const check = checker(perms);
  const u = user(spec.role, perms);
  const ctx = { user: u, checker: check };
  const rows: ModuleCompareRow[] = [];

  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    const legacy = canAccessModule(moduleId, check);
    const effective = canViewModule(moduleId, ctx);
    const resourceKey = resolveSidebarModuleResourceKey(moduleId);
    rows.push({
      personaId: spec.id,
      moduleId,
      resourceKey,
      legacy,
      effective,
      status: classify(spec, moduleId, legacy, effective),
    });
  }
  return rows;
}

export function runLegacyVsResourceComparison(personas = PERMISSION_PERSONA_MATRIX) {
  const allRows = personas.flatMap(comparePersonaModules);
  const involuntary = allRows.filter((r) => r.status === "involuntary_revocation");
  const overlays = allRows.filter((r) => r.status === "expected_role_overlay");
  const matches = allRows.filter((r) => r.status === "match" || r.status === "both_denied");

  return {
    ok: involuntary.length === 0,
    summary: {
      personas: personas.length,
      modulesCompared: allRows.length,
      matches: matches.length,
      expectedRoleOverlays: overlays.length,
      involuntaryRevocations: involuntary.length,
    },
    involuntary,
    overlays,
    allRows,
  };
}

export function formatComparisonMarkdown(
  result: ReturnType<typeof runLegacyVsResourceComparison>
): string {
  const lines: string[] = [
    "# Comparação legado → recurso (navegação)",
    "",
    `| Personas | ${result.summary.personas} |`,
    `| Células comparadas | ${result.summary.modulesCompared} |`,
    `| Match / ambos negados | ${result.summary.matches} |`,
    `| Overlay ROLE_MATRIX (esperado) | ${result.summary.expectedRoleOverlays} |`,
    `| Revogações involuntárias | ${result.summary.involuntaryRevocations} |`,
    `| Resultado | ${result.ok ? "PASS — zero mudança involuntária de revogação" : "FAIL"} |`,
    "",
  ];

  if (result.involuntary.length) {
    lines.push("## Revogações involuntárias", "");
    for (const r of result.involuntary) {
      lines.push(
        `- \`${r.personaId}\` / \`${r.moduleId}\` (resourceKey=${r.resourceKey ?? "—"}): legado=${r.legacy} efetivo=${r.effective}`
      );
    }
    lines.push("");
  }

  if (result.overlays.length) {
    lines.push("## Overlays de role (informativo)", "");
    const byPersona = new Map<string, ModuleCompareRow[]>();
    for (const r of result.overlays) {
      const list = byPersona.get(r.personaId) ?? [];
      list.push(r);
      byPersona.set(r.personaId, list);
    }
    for (const [pid, list] of byPersona) {
      lines.push(`### ${pid}`);
      for (const r of list) {
        lines.push(`- \`${r.moduleId}\` ← ROLE_MATRIX / aliases (\`${r.resourceKey}\`)`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function main() {
  const result = runLegacyVsResourceComparison();
  const md = formatComparisonMarkdown(result);
  console.log(md);
  if (!result.ok) {
    console.error(
      `\nFAIL: ${result.summary.involuntaryRevocations} revogação(ões) involuntária(s).`
    );
    process.exit(1);
  }
  console.error("\nPASS: zero revogação involuntária (legado → efetivo).");
}

const isDirect =
  process.argv[1]?.replace(/\\/g, "/").endsWith("compareLegacyVsResourceNavAccess.ts") ===
  true;

if (isDirect) {
  main();
}
