/**
 * Resolvedor oficial backend `resolveEffectiveAccess` (P03).
 *
 * Precedência: SUPER_ADMIN → unknown/unsupported DENY → override deny →
 * override allow → baseline (profile|role + structured + legacyCompat) → DENY.
 * Ancestral com view DENY explícito bloqueia filho.
 * Bag legada só com legacyCompatMode.
 *
 * Não conecta login, sidebar nem APIs — consumidores atuais intactos.
 */

import {
  listPermissionAncestors,
  listPermissionDescendants,
  listSupportedActions,
  PERMISSION_CONTRACT_RESOURCES,
  supportsPermissionAction,
  type PermissionContractAction,
  type PermissionContractResource,
} from "@/src/lib/security/permissionContract/index.js";
import { projectLegacyBagToBaseline } from "./legacyCompat.ts";
import { buildRoleBaselineFromSeed, mergeBaselines } from "./roleBaseline.ts";
import type {
  EffectiveAccessAxisFlags,
  EffectiveAccessBaselineMap,
  EffectiveAccessCell,
  EffectiveAccessInput,
  EffectiveAccessResult,
  EffectiveAccessSource,
  EffectiveAccessWarning,
} from "./types.ts";

type Local = "allow" | "deny" | "none";

function localDecision(
  resourceKey: string,
  action: PermissionContractAction,
  baseline: EffectiveAccessBaselineMap,
  overrides: EffectiveAccessInput["overrides"],
  baselineSources: Map<string, EffectiveAccessSource>
): { local: Local; source: EffectiveAccessSource } {
  const ov = overrides?.[resourceKey]?.[action];
  if (ov === "deny") return { local: "deny", source: "OVERRIDE_DENY" };
  if (ov === "allow") return { local: "allow", source: "OVERRIDE_ALLOW" };
  if (baseline[resourceKey]?.[action] === true) {
    return {
      local: "allow",
      source: baselineSources.get(`${resourceKey}:${action}`) ?? "ROLE",
    };
  }
  return { local: "none", source: "DENY_DEFAULT" };
}

function markBaselineSources(
  map: EffectiveAccessBaselineMap,
  source: EffectiveAccessSource,
  into: Map<string, EffectiveAccessSource>
): void {
  for (const [rk, actions] of Object.entries(map)) {
    for (const [action, v] of Object.entries(actions)) {
      if (!v) continue;
      const key = `${rk}:${action}`;
      // structured/legacy can overlay role; last writer wins for attribution
      into.set(key, source);
    }
  }
}

function axisFromActions(
  cells: Partial<Record<PermissionContractAction, EffectiveAccessCell>>
): EffectiveAccessAxisFlags {
  const view = cells.view ?? { decision: "deny" as const, source: "DENY_DEFAULT" as const };
  const execute =
    cells.execute ??
    cells.create ??
    cells.export ??
    ({ decision: "deny" as const, source: "DENY_DEFAULT" as const });
  const manage =
    cells.manage ??
    cells.update ??
    cells.delete ??
    ({ decision: "deny" as const, source: "DENY_DEFAULT" as const });
  return {
    canView: view.decision === "allow",
    canExecute: execute.decision === "allow",
    canManage: manage.decision === "allow",
    sourceView: view.source,
    sourceExecute: execute.source,
    sourceManage: manage.source,
  };
}

export function resolveEffectiveAccess(
  input: EffectiveAccessInput,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): EffectiveAccessResult {
  const warnings: EffectiveAccessWarning[] = [];
  const baselineSources = new Map<string, EffectiveAccessSource>();
  let legacyCompatApplied = false;

  if (input.role === "SUPER_ADMIN") {
    const byResourceAction: EffectiveAccessResult["byResourceAction"] = {};
    const byResource: EffectiveAccessResult["byResource"] = {};
    const allowed: EffectiveAccessResult["allowed"] = [];
    const navigationReveal: string[] = [];

    for (const r of resources) {
      const cells: Partial<Record<PermissionContractAction, EffectiveAccessCell>> = {};
      for (const a of r.actions) {
        cells[a.action] = { decision: "allow", source: "SUPER_ADMIN" };
        allowed.push({
          resourceKey: r.resourceKey,
          action: a.action,
          source: "SUPER_ADMIN",
        });
      }
      byResourceAction[r.resourceKey] = cells;
      byResource[r.resourceKey] = axisFromActions(cells);
      if (supportsPermissionAction(r.resourceKey, "view", resources)) {
        navigationReveal.push(r.resourceKey);
      }
    }

    return {
      userId: input.userId,
      role: input.role,
      permissionsVersion: input.permissionsVersion ?? null,
      byResourceAction,
      byResource,
      allowed,
      denied: [],
      blockedByParent: [],
      navigationReveal,
      warnings,
      legacyCompatApplied: false,
      baselineUsed: {},
    };
  }

  // --- Baseline: profile substitui role; senão role preset ---
  let baseline: EffectiveAccessBaselineMap;
  if (input.profileSnapshot !== undefined && input.profileSnapshot !== null) {
    baseline = { ...input.profileSnapshot };
    markBaselineSources(baseline, "PROFILE", baselineSources);
    warnings.push({
      code: "PROFILE_REPLACES_ROLE",
      message: "profileSnapshot definido — preset da role não é usado como baseline.",
    });
  } else if (input.profileSnapshot === null) {
    baseline = {};
    warnings.push({
      code: "PROFILE_REPLACES_ROLE",
      message: "profileSnapshot=null — baseline vazio (sem role preset).",
    });
  } else {
    baseline = buildRoleBaselineFromSeed(input.role, resources);
    markBaselineSources(baseline, "ROLE", baselineSources);
  }

  if (input.structuredGrants) {
    baseline = mergeBaselines(baseline, input.structuredGrants);
    markBaselineSources(input.structuredGrants, "STRUCTURED_GRANT", baselineSources);
  }

  if (input.legacyPermissions && input.legacyPermissions.length > 0) {
    if (!input.legacyCompatMode) {
      warnings.push({
        code: "LEGACY_COMPAT_DISABLED_BAG_IGNORED",
        message: `Bag legada com ${input.legacyPermissions.length} chave(s) ignorada (legacyCompatMode=false).`,
      });
    } else {
      const projected = projectLegacyBagToBaseline({
        legacyPermissions: input.legacyPermissions,
        skipMegaKeys: input.legacySkipMegaKeys !== false,
        resources,
      });
      warnings.push(...projected.warnings);
      baseline = mergeBaselines(baseline, projected.grants);
      markBaselineSources(projected.grants, "LEGACY_PROJECTED", baselineSources);
      legacyCompatApplied = true;
    }
  }

  const byResourceAction: EffectiveAccessResult["byResourceAction"] = {};
  const byResource: EffectiveAccessResult["byResource"] = {};
  const allowed: EffectiveAccessResult["allowed"] = [];
  const denied: EffectiveAccessResult["denied"] = [];
  const blockedByParent: string[] = [];
  const resourceKeySet = new Set(resources.map((r) => r.resourceKey));

  const resolveOne = (
    resourceKey: string,
    action: PermissionContractAction
  ): EffectiveAccessCell => {
    if (!resourceKeySet.has(resourceKey)) {
      return { decision: "deny", source: "UNKNOWN_RESOURCE" };
    }
    if (!supportsPermissionAction(resourceKey, action, resources)) {
      return { decision: "deny", source: "UNSUPPORTED_ACTION" };
    }

    for (const ancestor of listPermissionAncestors(resourceKey, resources)) {
      const anc = localDecision(
        ancestor,
        "view",
        baseline,
        input.overrides,
        baselineSources
      );
      if (anc.local === "deny") {
        return { decision: "deny", source: "ANCESTOR_VIEW_DENY" };
      }
    }

    const { local, source } = localDecision(
      resourceKey,
      action,
      baseline,
      input.overrides,
      baselineSources
    );
    if (local === "deny") return { decision: "deny", source };
    if (local === "allow") return { decision: "allow", source };
    return { decision: "deny", source: "DENY_DEFAULT" };
  };

  for (const r of resources) {
    const cells: Partial<Record<PermissionContractAction, EffectiveAccessCell>> = {};
    for (const binding of r.actions) {
      const cell = resolveOne(r.resourceKey, binding.action);
      cells[binding.action] = cell;
      const entry = {
        resourceKey: r.resourceKey,
        action: binding.action,
        source: cell.source,
      };
      if (cell.decision === "allow") allowed.push(entry);
      else denied.push(entry);

      if (cell.source === "ANCESTOR_VIEW_DENY" && binding.action === "view") {
        const hadLocalAllow =
          localDecision(
            r.resourceKey,
            "view",
            baseline,
            input.overrides,
            baselineSources
          ).local === "allow";
        if (hadLocalAllow && !blockedByParent.includes(r.resourceKey)) {
          blockedByParent.push(r.resourceKey);
          warnings.push({
            code: "PARENT_DENY_BLOCKS_CHILD",
            message: `Parent view deny bloqueia ${r.resourceKey}`,
            subject: r.resourceKey,
          });
        }
      }
    }
    byResourceAction[r.resourceKey] = cells;
    byResource[r.resourceKey] = axisFromActions(cells);
  }

  // Navigation reveal: view allow OU ancestral virtual de descendente allow
  const navigationReveal: string[] = [];
  for (const r of resources) {
    if (!supportsPermissionAction(r.resourceKey, "view", resources)) continue;
    const viewCell = byResourceAction[r.resourceKey]?.view;
    if (viewCell?.decision === "allow") {
      navigationReveal.push(r.resourceKey);
      continue;
    }
    // ancestral deny blocks reveal
    let ancestorDenied = false;
    for (const ancestor of listPermissionAncestors(r.resourceKey, resources)) {
      if (
        localDecision(ancestor, "view", baseline, input.overrides, baselineSources)
          .local === "deny"
      ) {
        ancestorDenied = true;
        break;
      }
    }
    if (ancestorDenied) continue;
    if (
      localDecision(r.resourceKey, "view", baseline, input.overrides, baselineSources)
        .local === "deny"
    ) {
      continue;
    }
    const hasDescAllow = listPermissionDescendants(r.resourceKey, resources).some(
      (d) => byResourceAction[d]?.view?.decision === "allow"
    );
    if (hasDescAllow) navigationReveal.push(r.resourceKey);
  }

  return {
    userId: input.userId,
    role: input.role,
    permissionsVersion: input.permissionsVersion ?? null,
    byResourceAction,
    byResource,
    allowed,
    denied,
    blockedByParent,
    navigationReveal,
    warnings,
    legacyCompatApplied,
    baselineUsed: baseline,
  };
}

/** Atalho: pode executar ação? */
export function canEffectiveAccess(
  result: EffectiveAccessResult,
  resourceKey: string,
  action: PermissionContractAction | string
): boolean {
  const cell = result.byResourceAction[resourceKey]?.[action as PermissionContractAction];
  return cell?.decision === "allow";
}

export function canRevealNavigation(
  result: EffectiveAccessResult,
  resourceKey: string
): boolean {
  return result.navigationReveal.includes(resourceKey);
}

/** Lista ações suportadas (reexport útil para testes). */
export function listEffectiveSupportedActions(
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionContractAction[] {
  return listSupportedActions(resourceKey, resources);
}
