/**
 * Checks puros de consistência (P02).
 */

import {
  classifyLegacyAliasStatus,
  detectCrossResourceLegacyKeys,
  isHardMegaKey,
  listPermissionParentCycles,
  PERMISSION_HARD_MEGA_KEYS,
} from "@/src/lib/security/permissionContract/index.js";
import type { PermissionConsistencySources } from "./collectSources.ts";
import type { PermissionConsistencyFinding } from "./types.ts";

/** Heurística: rota/aba financeira mapeada de forma aproximada. */
const FINANCE_SECTION_MAP: Record<string, string> = {
  "finance.cash-flow": "finance.cash_flow",
  "finance.accounts-receivable": "finance.accounts_receivable",
  "finance.accounts-payable": "finance.accounts_payable",
  "finance.billing": "finance.billing",
  "finance.sales-orders": "finance.sales_orders",
  "finance.cost-centers": "finance.cost_centers",
  "finance.taxes": "finance.taxes",
  "finance.suppliers": "finance.suppliers",
  "finance.dre": "finance.dre",
  "finance.executive-report": "finance.executive_report",
  "finance.presidential-report": "finance.presidential_report",
};

function mapFinanceSectionResource(tabId: string, fallback: string): string {
  return FINANCE_SECTION_MAP[tabId] ?? fallback;
}

function push(
  findings: PermissionConsistencyFinding[],
  finding: PermissionConsistencyFinding
): void {
  findings.push(finding);
}

export function runStructuralChecks(
  sources: PermissionConsistencySources
): PermissionConsistencyFinding[] {
  const findings: PermissionConsistencyFinding[] = [];

  for (const issue of sources.contractIssues) {
    const code =
      issue.code === "MISSING_PARENT"
        ? ("CONTRACT_INVALID_PARENT" as const)
        : issue.code === "CYCLE"
          ? ("CONTRACT_CYCLE" as const)
          : issue.code === "UNKNOWN_ACTION"
            ? ("CONTRACT_INVALID_ACTION" as const)
            : ("CONTRACT_ISSUE" as const);
    push(findings, {
      code,
      severity: "error",
      message: issue.message,
      subject: issue.resourceKey ?? issue.code,
    });
  }

  for (const issue of sources.seedIssues) {
    push(findings, {
      code: "CONTRACT_ISSUE",
      severity: "error",
      message: `seed: ${issue.message}`,
      subject: `seed:${issue.code}:${issue.message.slice(0, 80)}`,
    });
  }

  for (const key of listPermissionParentCycles()) {
    push(findings, {
      code: "CONTRACT_CYCLE",
      severity: "error",
      message: `Ciclo na hierarquia do contrato: ${key}`,
      subject: key,
    });
  }

  return findings;
}

export function runCrossCatalogChecks(
  sources: PermissionConsistencySources
): PermissionConsistencyFinding[] {
  const findings: PermissionConsistencyFinding[] = [];
  const {
    seedKeys,
    frontendKeys,
    contractIdentityKeys,
    sidebarModuleKeys,
    sidebarGroupKeys,
    tabEntries,
    privateModulePaths,
    frontendResources,
    contractResources,
  } = sources;

  // FE presente, ausente no seed
  for (const key of [...frontendKeys].sort()) {
    if (!seedKeys.has(key)) {
      push(findings, {
        code: "FE_RESOURCE_MISSING_FROM_SEED",
        severity: "error",
        message: `Recurso no frontend ausente do seed relacional: ${key}`,
        subject: key,
      });
    }
  }

  // FE presente, ausente do contrato E do seed (sem registro em nenhuma fonte canônica/relacional)
  for (const key of [...frontendKeys].sort()) {
    if (!contractIdentityKeys.has(key) && !seedKeys.has(key)) {
      push(findings, {
        code: "FE_RESOURCE_MISSING_FROM_CONTRACT",
        severity: "error",
        message: `Recurso no frontend sem ponte no contrato nem no seed: ${key}`,
        subject: key,
      });
    }
  }

  // Seed sem ponte no contrato
  for (const key of [...seedKeys].sort()) {
    if (!contractIdentityKeys.has(key)) {
      push(findings, {
        code: "SEED_RESOURCE_MISSING_FROM_CONTRACT",
        severity: "warn",
        message: `Recurso no seed sem ponte no contrato: ${key}`,
        subject: key,
      });
    }
  }

  // Relational do contrato ausente do seed
  for (const r of contractResources) {
    for (const rel of r.relationalResourceKeys) {
      if (!seedKeys.has(rel)) {
        push(findings, {
          code: "CONTRACT_RELATIONAL_MISSING_FROM_SEED",
          severity: "error",
          message: `relationalResourceKey do contrato ausente do seed: ${rel}`,
          subject: rel,
          evidence: [r.resourceKey],
        });
      }
    }
  }

  // Sidebar
  for (const [moduleId, key] of sidebarModuleKeys) {
    if (!seedKeys.has(key)) {
      push(findings, {
        code: "SIDEBAR_RESOURCE_MISSING_FROM_SEED",
        severity: "error",
        message: `Sidebar module ${moduleId} → ${key} ausente do seed`,
        subject: `${moduleId}:${key}`,
      });
    }
    if (!contractIdentityKeys.has(key)) {
      push(findings, {
        code: "SIDEBAR_RESOURCE_MISSING_FROM_CONTRACT",
        severity: "error",
        message: `Sidebar module ${moduleId} → ${key} ausente do contrato`,
        subject: `${moduleId}:${key}`,
      });
    }
  }
  for (const [groupId, key] of sidebarGroupKeys) {
    if (!seedKeys.has(key)) {
      push(findings, {
        code: "SIDEBAR_RESOURCE_MISSING_FROM_SEED",
        severity: "warn",
        message: `Sidebar group ${groupId} → ${key} ausente do seed`,
        subject: `group:${groupId}:${key}`,
      });
    }
    if (!contractIdentityKeys.has(key)) {
      push(findings, {
        code: "SIDEBAR_RESOURCE_MISSING_FROM_CONTRACT",
        severity: "warn",
        message: `Sidebar group ${groupId} → ${key} ausente do contrato`,
        subject: `group:${groupId}:${key}`,
      });
    }
  }

  for (const mod of privateModulePaths) {
    if (!mod.resourceKey) {
      push(findings, {
        code: "SIDEBAR_MODULE_WITHOUT_RESOURCE",
        severity: "warn",
        message: `Módulo sidebar sem resourceKey mapeado: ${mod.moduleId}`,
        subject: mod.moduleId,
        evidence: [mod.path],
      });
      push(findings, {
        code: "PRIVATE_ROUTE_WITHOUT_RESOURCE",
        severity: "warn",
        message: `Rota de módulo privada sem resourceKey: ${mod.path}`,
        subject: mod.path,
        evidence: [mod.moduleId],
      });
    }
  }

  // Abas / seções com resourceKey explícito
  for (const tab of tabEntries) {
    if (tab.id.startsWith("finance.")) {
      // Seções financeiras: mapear ids conhecidos; demais ficam baseline se sem contrato
      const mapped = mapFinanceSectionResource(tab.id, tab.resourceKey);
      const ok =
        contractIdentityKeys.has(mapped) ||
        seedKeys.has(mapped) ||
        contractResources.some(
          (r) =>
            r.resourceKey === mapped ||
            r.relationalResourceKeys.includes(mapped) ||
            r.route?.includes(tab.id.replace("finance.", ""))
        );
      if (!ok) {
        push(findings, {
          code: "TAB_WITHOUT_RESOURCE",
          severity: "warn",
          message: `Seção financeira sem recurso contrato/seed: ${tab.label}`,
          subject: mapped,
          evidence: [tab.id],
        });
      }
      continue;
    }

    const ok =
      contractIdentityKeys.has(tab.resourceKey) || seedKeys.has(tab.resourceKey);
    if (!ok) {
      push(findings, {
        code: "TAB_WITHOUT_RESOURCE",
        severity: "warn",
        message: `Aba sem recurso contrato/seed: ${tab.label}`,
        subject: tab.resourceKey,
        evidence: [tab.id],
      });
    }
  }

  // FE resource registered in FRONTEND catalog but never referenced in ResourceKeys?
  // "registered never used" — contract resources with no FE/seed bridge and no sidebar
  const usedIdentity = new Set<string>([
    ...frontendKeys,
    ...seedKeys,
    ...sidebarModuleKeys.values(),
    ...sidebarGroupKeys.values(),
    ...tabEntries.map((t) => t.resourceKey),
  ]);
  for (const r of contractResources) {
    const bridged =
      usedIdentity.has(r.resourceKey) ||
      r.relationalResourceKeys.some((rel) => usedIdentity.has(rel)) ||
      Boolean(r.moduleId);
    if (!bridged) {
      push(findings, {
        code: "RESOURCE_REGISTERED_NEVER_USED",
        severity: "info",
        message: `Recurso no contrato sem uso FE/seed/sidebar detectado: ${r.resourceKey}`,
        subject: r.resourceKey,
      });
    }
  }

  // FE vs BE style: configuracoes vs admin.settings
  const feHasConfig = frontendKeys.has("configuracoes");
  const contractHasAdminSettings = contractResources.some(
    (r) => r.resourceKey === "admin.settings"
  );
  if (feHasConfig && contractHasAdminSettings) {
    push(findings, {
      code: "FE_BE_KEY_MISMATCH",
      severity: "warn",
      message:
        "Frontend usa resourceKey `configuracoes`; contrato canônico usa `admin.settings`.",
      subject: "configuracoes|admin.settings",
    });
  }

  // Wide / duplicate / mega aliases on FE catalog
  const feAliasOwners = new Map<string, string[]>();
  for (const r of frontendResources) {
    for (const alias of r.legacyAliasKeys) {
      const owners = feAliasOwners.get(alias) ?? [];
      owners.push(r.key);
      feAliasOwners.set(alias, owners);
    }
  }
  for (const [alias, owners] of [...feAliasOwners.entries()].sort()) {
    const uniqueOwners = [...new Set(owners)];
    if (uniqueOwners.length >= 2) {
      push(findings, {
        code: "ALIAS_WIDE",
        severity: "warn",
        message: `Alias amplo no FE: ${alias} → ${uniqueOwners.length} recursos`,
        subject: alias,
        evidence: uniqueOwners.slice(0, 8),
      });
    }
  }

  // Contract: duplicate alias owners + mega as final (index 0 on wrong resource)
  const cross = detectCrossResourceLegacyKeys(contractResources);
  for (const [alias, owners] of cross) {
    if (owners.length >= 2) {
      push(findings, {
        code: "ALIAS_DUPLICATE",
        severity: "warn",
        message: `Alias legado em múltiplos recursos do contrato: ${alias}`,
        subject: `contract:${alias}`,
        evidence: owners,
      });
    }
  }

  for (const r of contractResources) {
    for (const binding of r.actions) {
      binding.legacyPermissionKeys.forEach((legacy, index) => {
        if (isHardMegaKey(legacy) && index === 0) {
          // hard mega as preferred alias on non-opex resources
          if (r.resourceKey !== "finance.opex") {
            push(findings, {
              code: "MEGA_KEY_AS_FINAL_ALIAS",
              severity: "error",
              message: `Mega-key ${legacy} como alias preferencial (índice 0) em ${r.resourceKey}.${binding.action}`,
              subject: `${r.resourceKey}:${binding.action}:${legacy}`,
            });
          }
        }
        const status = classifyLegacyAliasStatus(
          legacy,
          r.resourceKey,
          index,
          contractResources
        );
        if (
          status === "mega_key_temporary" &&
          index === 0 &&
          PERMISSION_HARD_MEGA_KEYS.has(legacy) &&
          r.resourceKey !== "finance.opex"
        ) {
          // already covered above
        }
      });
    }
  }

  // FE: mega-key as only/first alias on employees etc.
  for (const r of frontendResources) {
    const first = r.legacyAliasKeys[0];
    if (first && isHardMegaKey(first) && r.key !== "finance.opex") {
      push(findings, {
        code: "MEGA_KEY_AS_FINAL_ALIAS",
        severity: "error",
        message: `Mega-key ${first} como primeiro alias FE de ${r.key}`,
        subject: `fe:${r.key}:${first}`,
      });
    }
  }

  return findings;
}

/**
 * Fallbacks permissivos documentados no código FE (não remove — só detecta).
 */
export function runPermissiveFallbackChecks(): PermissionConsistencyFinding[] {
  const findings: PermissionConsistencyFinding[] = [];

  // P07: ROLE_MATRIX empty-bag overlay removido de permissionsClient.resolveRawFlags.

  push(findings, {
    code: "PERMISSIVE_FALLBACK",
    severity: "warn",
    message:
      "resourceNavigationAccess: path sem mapeamento de módulo não bloqueia (unmapped pass-through).",
    subject: "resourceNavigationAccess.UNMAPPED_PATH_ALLOW",
    evidence: ["src/lib/resourceNavigationAccess.ts"],
  });

  return findings;
}
