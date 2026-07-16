/**
 * Avaliação legada: bag OR (requireAnyPermission) sobre chaves do contrato.
 */

import type { AppUserRole } from "@prisma/client";
import { getEffectivePermissions } from "@/src/lib/appAuth.js";
import {
  getPermissionContractResource,
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractAction,
} from "@/src/lib/security/permissionContract/index.js";
import { isLegacyBleedGrant, listMigrationBleedKeysForResource } from "./bleedDetection.ts";
import type { LegacyBagEvaluation } from "./types.ts";

export function evaluateLegacyBagOr(args: {
  role: string;
  legacyPermissions: readonly string[];
  resourceKey: string;
  action: PermissionContractAction;
}): LegacyBagEvaluation {
  if (args.role === "SUPER_ADMIN") {
    return { allow: true, grantingKeys: [], bleedKeys: [], dedicatedKeys: [] };
  }

  const resource = getPermissionContractResource(
    args.resourceKey,
    PERMISSION_CONTRACT_RESOURCES
  );
  if (!resource) {
    return { allow: false, grantingKeys: [], bleedKeys: [], dedicatedKeys: [] };
  }

  const binding = resource.actions.find((a) => a.action === args.action);
  if (!binding || binding.legacyPermissionKeys.length === 0) {
    return { allow: false, grantingKeys: [], bleedKeys: [], dedicatedKeys: [] };
  }

  const eff = getEffectivePermissions({
    role: args.role as AppUserRole,
    permissions: [...args.legacyPermissions],
  });
  const effSet = new Set(eff);

  const grantingKeys = binding.legacyPermissionKeys.filter((k) => effSet.has(k));
  const migrationBleedKeys = listMigrationBleedKeysForResource(
    args.resourceKey,
    args.action,
    effSet
  );
  for (const k of migrationBleedKeys) {
    if (!grantingKeys.includes(k)) grantingKeys.push(k);
  }

  const bleedKeys = grantingKeys.filter((k) =>
    isLegacyBleedGrant(k, args.resourceKey, args.action)
  );
  const dedicatedKeys = grantingKeys.filter(
    (k) => !isLegacyBleedGrant(k, args.resourceKey, args.action)
  );

  return {
    allow: grantingKeys.length > 0,
    grantingKeys,
    bleedKeys,
    dedicatedKeys,
  };
}
