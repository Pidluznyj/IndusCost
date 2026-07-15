/**
 * Fixtures fictícias + presets de role para validação de dual-write (Prompt 06).
 */

import type { AppUserRole } from "@prisma/client";
import { buildEffectiveFlagsMap, materializeLegacyPermissionsFromFlags } from "@/src/lib/security/permissionRolePresets.js";
import type { DualWriteCompatibilityFixture } from "./plan.ts";

/** Chaves de catálogo tipicamente sem alias estrutural (confirmadas no relatório). */
export const SAMPLE_UNMAPPED_CATALOG_KEYS = [
  "pricing.view",
  "fleet.view",
  "products.view",
] as const;

export function buildRolePresetFixtures(): DualWriteCompatibilityFixture[] {
  const roles: AppUserRole[] = ["VIEWER", "SELLER", "COMMERCIAL_MANAGER", "ADMIN"];
  return roles.map((role) => {
    const effective = buildEffectiveFlagsMap(role, []);
    const legacy = materializeLegacyPermissionsFromFlags(effective, []);
    return {
      id: `role-preset-${role}`,
      role,
      legacyPermissions: legacy,
      effectiveByResourceKey: effective,
    };
  });
}

export function buildFictionalUserFixtures(): DualWriteCompatibilityFixture[] {
  return [
    {
      id: "fic-viewer-minimal",
      role: "VIEWER",
      legacyPermissions: ["dashboard.view"],
    },
    {
      id: "fic-seller-crm",
      role: "SELLER",
      legacyPermissions: ["dashboard.view", "crm.view", "sales_orders.view"],
    },
    {
      id: "fic-with-unmapped-catalog",
      role: "VIEWER",
      legacyPermissions: ["dashboard.view", "pricing.view", "fleet.view"],
    },
    {
      id: "fic-admin-users-manage",
      role: "ADMIN",
      legacyPermissions: ["dashboard.view", "users.manage", "finance.view"],
    },
    {
      id: "fic-empty",
      role: "VIEWER",
      legacyPermissions: [],
    },
  ];
}

export function buildAllDualWriteFixtures(): DualWriteCompatibilityFixture[] {
  return [...buildRolePresetFixtures(), ...buildFictionalUserFixtures()];
}
