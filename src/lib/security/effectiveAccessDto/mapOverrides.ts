/**
 * Mapeia overrides do seed PT → overrides do contrato canônico.
 */

import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import type { EffectiveAccessOverrideMap } from "@/src/lib/security/effectiveAccess/types.js";
import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";

export type SeedAxisOverride = {
  resourceKey: string;
  canView?: boolean | null;
  canExecute?: boolean | null;
  canManage?: boolean | null;
};

function axisToActions(
  resourceKey: string,
  axis: "view" | "execute" | "manage",
  decision: "allow" | "deny",
  into: EffectiveAccessOverrideMap
): void {
  const resource = PERMISSION_CONTRACT_RESOURCES.find((r) => r.resourceKey === resourceKey);
  if (!resource) return;
  const supported = new Set(resource.actions.map((a) => a.action));
  const targets: PermissionContractAction[] =
    axis === "view"
      ? (["view"] as const).filter((a) => supported.has(a))
      : axis === "execute"
        ? (
            [
              "execute",
              "create",
              "export",
              "approve",
              "close",
              "reopen",
              "reprocess",
            ] as const
          ).filter((a) => supported.has(a))
        : (["manage", "update", "delete"] as const).filter((a) => supported.has(a));

  const bucket = {
    ...(into[resourceKey] ?? {}),
  } as Record<PermissionContractAction, "allow" | "deny">;
  for (const a of targets) {
    bucket[a] = decision;
  }
  (into as Record<string, typeof bucket>)[resourceKey] = bucket;
}

/** Resolve seed/contract key → resourceKeys canônicos. */
export function resolveContractKeysForSeedOrCanonical(key: string): string[] {
  const direct = PERMISSION_CONTRACT_RESOURCES.filter((r) => r.resourceKey === key);
  if (direct.length) return [key];
  return PERMISSION_CONTRACT_RESOURCES.filter((r) =>
    r.relationalResourceKeys.includes(key)
  ).map((r) => r.resourceKey);
}

/**
 * Converte overrides DB (chaves seed ou canônicas, eixos null/bool)
 * para mapa allow/deny do resolvedor.
 */
export function mapSeedAxisOverridesToContract(
  overrides: readonly SeedAxisOverride[]
): EffectiveAccessOverrideMap {
  const out: EffectiveAccessOverrideMap = {};

  for (const ov of overrides) {
    const contractKeys = resolveContractKeysForSeedOrCanonical(ov.resourceKey);
    for (const ck of contractKeys) {
      if (ov.canView === true) axisToActions(ck, "view", "allow", out);
      if (ov.canView === false) axisToActions(ck, "view", "deny", out);
      if (ov.canExecute === true) axisToActions(ck, "execute", "allow", out);
      if (ov.canExecute === false) axisToActions(ck, "execute", "deny", out);
      if (ov.canManage === true) axisToActions(ck, "manage", "allow", out);
      if (ov.canManage === false) axisToActions(ck, "manage", "deny", out);
    }
  }

  return out;
}
