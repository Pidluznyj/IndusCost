/**
 * Fixtures fictícias + presets de role para validação de dual-write (P06).
 */

import type { AppUserRole } from "@prisma/client";
import {
  buildEffectiveFlagsMap,
  materializeLegacyPermissionsFromFlags,
} from "@/src/lib/security/permissionRolePresets.js";
import type { DualWriteCompatibilityFixture } from "./plan.ts";
import type { StructuredGrantMap } from "./types.ts";

/** Chaves de catálogo tipicamente sem alias estrutural (P08: pricing.view passou a mapear commercial.pricing). */
export const SAMPLE_UNMAPPED_CATALOG_KEYS = [
  "reports.material_demand.view",
  "purchases.create",
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
      legacyPermissions: [
        "dashboard.view",
        "reports.material_demand.view",
        "purchases.create",
      ],
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

/** Leticia: só Contas a Pagar (absoluto) — sem bleed comercial/dashboard. */
export function buildLeticiaStructuredFlags(): StructuredGrantMap {
  const base = buildEffectiveFlagsMap("VIEWER", []);
  const out: StructuredGrantMap = {};
  for (const [key, flags] of Object.entries(base)) {
    out[key] = { canView: false, canExecute: false, canManage: false };
    void flags;
  }
  out["financeiro.contas_pagar"] = {
    canView: true,
    canExecute: false,
    canManage: false,
  };
  return out;
}

export function buildLeticiaFixture(): DualWriteCompatibilityFixture {
  const effective = buildLeticiaStructuredFlags();
  return {
    id: "leticia-ap-only",
    role: "VIEWER",
    legacyPermissions: materializeLegacyPermissionsFromFlags(effective, [
      "reports.material_demand.view",
    ]),
    effectiveByResourceKey: effective,
  };
}

export function buildAllDualWriteFixtures(): DualWriteCompatibilityFixture[] {
  return [
    ...buildRolePresetFixtures(),
    ...buildFictionalUserFixtures(),
    buildLeticiaFixture(),
  ];
}
