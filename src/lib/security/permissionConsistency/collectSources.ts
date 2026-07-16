/**
 * Coleta conjuntos tipados das fontes de permissão (P02).
 * Importa apenas módulos de dados — sem side effects de servidor.
 */

import { ALL_PERMISSION_KEYS } from "@/src/lib/permissionCatalog.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  PRODUCT_UI_TABS,
  TabResourceKeys,
} from "@/src/lib/moduleTabResources.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";
import {
  FRONTEND_PERMISSION_RESOURCES,
  PORTFOLIO_RECONCILIATION_UI_TABS,
  ResourceKeys,
} from "@/src/lib/permissionsClient.js";
import {
  listPermissionResourceKeys,
  PERMISSION_RESOURCE_SEEDS,
  validatePermissionResourceCatalog,
} from "@/src/lib/permissionResourceSeedData.js";
import {
  SIDEBAR_GROUP_RESOURCE_KEYS,
  SIDEBAR_MODULE_RESOURCE_KEYS,
} from "@/src/lib/sidebarMenuResources.js";
import {
  listPermissionContractResourceKeys,
  PERMISSION_CONTRACT_RESOURCES,
  validatePermissionContract,
} from "@/src/lib/security/permissionContract/index.js";
import { FINANCE_SECTIONS } from "@/src/lib/financeNavigation.js";

export type PermissionConsistencySources = {
  contractKeys: ReadonlySet<string>;
  seedKeys: ReadonlySet<string>;
  frontendKeys: ReadonlySet<string>;
  catalogLegacyKeys: ReadonlySet<string>;
  /** resourceKey canônico + relational keys do contrato. */
  contractIdentityKeys: ReadonlySet<string>;
  sidebarModuleKeys: ReadonlyMap<string, string>;
  sidebarGroupKeys: ReadonlyMap<string, string>;
  tabEntries: readonly { id: string; resourceKey: string; label: string }[];
  privateModulePaths: readonly { moduleId: string; path: string; resourceKey: string | null }[];
  contractIssues: ReturnType<typeof validatePermissionContract>;
  seedIssues: ReturnType<typeof validatePermissionResourceCatalog>;
  frontendResources: typeof FRONTEND_PERMISSION_RESOURCES;
  contractResources: typeof PERMISSION_CONTRACT_RESOURCES;
};

function listFrontendKeys(): string[] {
  const keys = new Set<string>();
  for (const v of Object.values(ResourceKeys)) keys.add(v);
  for (const r of FRONTEND_PERMISSION_RESOURCES) keys.add(r.key);
  return [...keys].sort();
}

function listTabEntries(): { id: string; resourceKey: string; label: string }[] {
  const out: { id: string; resourceKey: string; label: string }[] = [];
  for (const t of CRM_UI_TABS) {
    out.push({ id: `crm.${t.id}`, resourceKey: t.resourceKey, label: t.label });
  }
  for (const t of COMMISSIONS_LIVE_UI_TABS) {
    out.push({
      id: `commissions.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    });
  }
  for (const t of PRODUCT_UI_TABS) {
    out.push({
      id: `products.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    });
  }
  for (const t of PORTFOLIO_RECONCILIATION_UI_TABS) {
    out.push({
      id: `portfolio.${t.id}`,
      resourceKey: t.resourceKey,
      label: t.label,
    });
  }
  for (const key of Object.values(TabResourceKeys)) {
    if (!out.some((e) => e.resourceKey === key)) {
      out.push({ id: `tabResourceKeys.${key}`, resourceKey: key, label: key });
    }
  }
  for (const s of FINANCE_SECTIONS) {
    out.push({
      id: `finance.${s.id}`,
      resourceKey: `finance.${String(s.id).replace(/-/g, "_")}`,
      label: s.label,
    });
  }
  return out;
}

export function collectPermissionConsistencySources(): PermissionConsistencySources {
  const contractKeys = new Set(listPermissionContractResourceKeys());
  const seedKeys = new Set(listPermissionResourceKeys());
  const frontendKeys = new Set(listFrontendKeys());
  const catalogLegacyKeys = new Set(ALL_PERMISSION_KEYS);

  const contractIdentityKeys = new Set<string>();
  for (const r of PERMISSION_CONTRACT_RESOURCES) {
    contractIdentityKeys.add(r.resourceKey);
    for (const rel of r.relationalResourceKeys) contractIdentityKeys.add(rel);
  }

  const sidebarModuleKeys = new Map<string, string>();
  for (const [moduleId, key] of Object.entries(SIDEBAR_MODULE_RESOURCE_KEYS)) {
    if (key) sidebarModuleKeys.set(moduleId, key);
  }
  const sidebarGroupKeys = new Map<string, string>();
  for (const [groupId, key] of Object.entries(SIDEBAR_GROUP_RESOURCE_KEYS)) {
    if (key) sidebarGroupKeys.set(groupId, key);
  }

  const privateModulePaths = SIDEBAR_MODULE_ORDER.map((moduleId) => ({
    moduleId,
    path: getModulePath(moduleId),
    resourceKey: SIDEBAR_MODULE_RESOURCE_KEYS[moduleId] ?? null,
  }));

  return {
    contractKeys,
    seedKeys,
    frontendKeys,
    catalogLegacyKeys,
    contractIdentityKeys,
    sidebarModuleKeys,
    sidebarGroupKeys,
    tabEntries: listTabEntries(),
    privateModulePaths,
    contractIssues: validatePermissionContract(),
    seedIssues: validatePermissionResourceCatalog(PERMISSION_RESOURCE_SEEDS),
    frontendResources: FRONTEND_PERMISSION_RESOURCES,
    contractResources: PERMISSION_CONTRACT_RESOURCES,
  };
}
