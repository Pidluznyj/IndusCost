/**
 * Probes dos recursos migrados (P15–P19) — actions do contrato apenas.
 */

import { FINANCE_AP_RESOURCE_KEY } from "@/src/lib/financeAccountsPayableAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { ADMIN_SETTINGS_RESOURCE_KEYS } from "@/src/lib/adminSettingsAccess.js";
import { EMPLOYEES_RESOURCE_KEYS } from "@/src/lib/employeesAccess.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import {
  getPermissionContractResource,
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractAction,
} from "@/src/lib/security/permissionContract/index.js";

export type MigratedAccessProbe = {
  resourceKey: string;
  action: PermissionContractAction;
};

/** Domínios cobertos pelo comparador. */
export const MIGRATED_MODULE_SCOPE = [
  "finance (P17+P18 AP)",
  "commercial (P19)",
  "engineering (P19)",
  "admin.settings (P19)",
  "admin.employees (P15)",
  "operations (P16)",
  "admin.settings.security (P14)",
] as const;

function collectMigratedResourceKeys(): string[] {
  const keys = new Set<string>([
    ...Object.values(FINANCE_MODULE_RESOURCE_KEYS),
    FINANCE_AP_RESOURCE_KEY,
    ...Object.values(COMMERCIAL_RESOURCE_KEYS),
    ...Object.values(ENGINEERING_RESOURCE_KEYS),
    ...Object.values(ADMIN_SETTINGS_RESOURCE_KEYS),
    ...Object.values(EMPLOYEES_RESOURCE_KEYS),
    ...Object.values(OPERATIONS_RESOURCE_KEYS),
    "admin.settings.security",
  ]);
  return [...keys].sort();
}

let cachedProbes: MigratedAccessProbe[] | null = null;

/** Lista resourceKey × action para todos os módulos migrados. */
export function buildMigratedAccessProbes(): MigratedAccessProbe[] {
  if (cachedProbes) return cachedProbes;

  const probes: MigratedAccessProbe[] = [];
  for (const resourceKey of collectMigratedResourceKeys()) {
    const r = getPermissionContractResource(resourceKey, PERMISSION_CONTRACT_RESOURCES);
    if (!r) continue;
    for (const binding of r.actions) {
      probes.push({ resourceKey, action: binding.action });
    }
  }

  cachedProbes = probes;
  return probes;
}

export function countMigratedResourceKeys(): number {
  return collectMigratedResourceKeys().length;
}
