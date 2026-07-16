/**
 * Constrói o DTO público a partir de `resolveEffectiveAccess` (P04).
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";
import {
  EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
  type EffectiveAccessAdminDto,
  type EffectiveAccessDtoAction,
  type EffectiveAccessDtoCapability,
  type EffectiveAccessDtoDenyEntry,
  type EffectiveAccessDtoWarning,
  type EffectiveAccessMeDto,
} from "@/src/lib/effectiveAccessDtoTypes.js";
import type { EffectiveAccessResult } from "@/src/lib/security/effectiveAccess/types.js";

const ACTION_ORDER: EffectiveAccessDtoAction[] = [
  "view",
  "create",
  "update",
  "delete",
  "export",
  "execute",
  "approve",
  "close",
  "reopen",
  "reprocess",
  "manage",
];

function asDtoAction(a: string): EffectiveAccessDtoAction | null {
  return (ACTION_ORDER as string[]).includes(a) ? (a as EffectiveAccessDtoAction) : null;
}

function sortActions(actions: Iterable<EffectiveAccessDtoAction>): EffectiveAccessDtoAction[] {
  const set = new Set(actions);
  return ACTION_ORDER.filter((a) => set.has(a));
}

export type BuildEffectiveAccessDtoOptions = {
  result: EffectiveAccessResult;
  /** Default: placeholder 0 até migration. */
  permissionsVersion?: number | null;
  /** Bag ainda presente no usuário (compat). */
  legacyPermissionsPresent?: boolean;
  /**
   * Se false, o DTO é a autoridade de decisão (PERM-30).
   * Default true só para builders legados que ainda projetam bag.
   */
  legacyBagAuthoritative?: boolean;
  /**
   * session = /me (sem denies/warnings).
   * admin = auditoria (denies explícitos + warnings sanitizados).
   */
  audience?: "session" | "admin";
};

function buildCapabilities(
  result: EffectiveAccessResult,
  allowedResources: string[]
): Record<string, EffectiveAccessDtoCapability> {
  const out: Record<string, EffectiveAccessDtoCapability> = {};
  for (const rk of allowedResources) {
    const axis = result.byResource[rk];
    if (!axis) continue;
    out[rk] = {
      canView: axis.canView,
      canExecute: axis.canExecute,
      canManage: axis.canManage,
    };
  }
  return out;
}

function buildDenies(result: EffectiveAccessResult): EffectiveAccessDtoDenyEntry[] {
  const byResource = new Map<string, { actions: Set<EffectiveAccessDtoAction>; reason: EffectiveAccessDtoDenyEntry["reason"] }>();

  for (const entry of result.denied) {
    if (entry.source !== "OVERRIDE_DENY" && entry.source !== "ANCESTOR_VIEW_DENY") {
      continue;
    }
    const action = asDtoAction(entry.action);
    if (!action) continue;
    const cur = byResource.get(entry.resourceKey) ?? {
      actions: new Set<EffectiveAccessDtoAction>(),
      reason: entry.source,
    };
    cur.actions.add(action);
    // ANCESTOR wins as reason if mixed
    if (entry.source === "ANCESTOR_VIEW_DENY") cur.reason = "ANCESTOR_VIEW_DENY";
    byResource.set(entry.resourceKey, cur);
  }

  return [...byResource.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resourceKey, v]) => ({
      resourceKey,
      actions: sortActions(v.actions),
      reason: v.reason,
    }));
}

function sanitizeWarnings(result: EffectiveAccessResult): EffectiveAccessDtoWarning[] {
  return result.warnings.map((w) => ({
    code: w.code,
    // Mensagens já são curtas; não incluir subjects com PII
    message: w.message.slice(0, 200),
  }));
}

/**
 * Converte resultado do resolvedor no DTO público compacto.
 * SUPER_ADMIN: listas vazias + isSuperAdmin=true (payload pequeno).
 */
export function buildEffectiveAccessDto(
  options: BuildEffectiveAccessDtoOptions
): EffectiveAccessMeDto | EffectiveAccessAdminDto {
  const result = options.result;
  const audience = options.audience ?? "session";
  const permissionsVersion =
    options.permissionsVersion ??
    result.permissionsVersion ??
    EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER;

  const isSuperAdmin = result.role === "SUPER_ADMIN";

  let allowedResources: string[] = [];
  let actionsByResource: Record<string, EffectiveAccessDtoAction[]> = {};
  let navigationReveal: string[] = [];
  let capabilities: Record<string, EffectiveAccessDtoCapability> = {};

  if (!isSuperAdmin) {
    const actionMap = new Map<string, Set<EffectiveAccessDtoAction>>();
    for (const entry of result.allowed) {
      const action = asDtoAction(entry.action as PermissionContractAction);
      if (!action) continue;
      if (!actionMap.has(entry.resourceKey)) actionMap.set(entry.resourceKey, new Set());
      actionMap.get(entry.resourceKey)!.add(action);
    }
    allowedResources = [...actionMap.keys()].sort();
    for (const rk of allowedResources) {
      actionsByResource[rk] = sortActions(actionMap.get(rk)!);
    }
    navigationReveal = [...result.navigationReveal].sort();
    capabilities = buildCapabilities(result, allowedResources);
  }

  const base: EffectiveAccessMeDto = {
    permissionsVersion:
      typeof permissionsVersion === "number" && Number.isFinite(permissionsVersion)
        ? permissionsVersion
        : EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
    role: result.role,
    isSuperAdmin,
    allowedResources,
    actionsByResource,
    navigationReveal,
    capabilities,
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: options.legacyBagAuthoritative !== false,
      legacyPermissionsPresent: options.legacyPermissionsPresent === true,
      legacyCompatApplied: result.legacyCompatApplied,
    },
  };

  if (audience === "admin") {
    const admin: EffectiveAccessAdminDto = {
      ...base,
      denies: buildDenies(result),
      warnings: sanitizeWarnings(result),
    };
    return admin;
  }

  return base;
}
