/**
 * Bridge Usuário × PermissionsTree (PERM-35).
 * Exceção: Herdar | Permitir | Negar vs baseline (perfil/role).
 * Persistência continua via matrix draft → buildSaveOverridesFromMatrix.
 */

import {
  permissionMatrixActionLabel,
  type PermissionMatrixDraft,
  type PermissionMatrixRow,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import type {
  PermissionTreeDecision,
  PermissionTreeDecisions,
  PermissionTreeEffective,
  PermissionTreeNode,
  PermissionTreeNodeKind,
} from "@/src/lib/security/permissionsTreeUi/index.ts";
import {
  applyAllowOnResource,
  applyDenyOnResource,
  buildUserPermissionMatrixModel,
  clearMatrixOverrideForResource,
  type UserPermissionMatrixModel,
} from "@/src/lib/userPermissionsMatrix";
import type {
  EditableTreeNodeDto,
  PermissionFlagsDto,
} from "@/src/lib/userPermissionsAdminClient";

export const USER_PERMISSION_TREE_ACTION_SEP = "::";

export function userPermissionActionNodeId(
  resourceKey: string,
  action: string
): string {
  return `${resourceKey}${USER_PERMISSION_TREE_ACTION_SEP}${action}`;
}

export function parseUserPermissionActionNodeId(
  id: string
): { resourceKey: string; action: string } | null {
  const i = id.indexOf(USER_PERMISSION_TREE_ACTION_SEP);
  if (i <= 0) return null;
  return {
    resourceKey: id.slice(0, i),
    action: id.slice(i + USER_PERMISSION_TREE_ACTION_SEP.length),
  };
}

function mapSeedTypeToKind(type: string): PermissionTreeNodeKind {
  const t = type.toUpperCase();
  if (t === "MENU") return "module";
  if (t === "SUBMENU") return "page";
  if (t === "TAB") return "tab";
  if (t === "ACTION") return "action";
  return "page";
}

function baselineFromBool(allowed: boolean): PermissionTreeEffective {
  return allowed ? "allowed" : "denied";
}

function profileValueLabel(allowed: boolean): string {
  return allowed ? "Permitido no perfil" : "Negado no perfil";
}

function rowToTreeNode(
  row: PermissionMatrixRow,
  baseline: PermissionMatrixDraft
): PermissionTreeNode {
  const kind = mapSeedTypeToKind(row.type);
  const actionChildren: PermissionTreeNode[] = row.supportedActions
    .filter((action) => row.cells[action]?.supported)
    .map((action) => {
      const baseAllowed = Boolean(baseline[row.resourceKey]?.[String(action)]);
      return {
        id: userPermissionActionNodeId(row.resourceKey, String(action)),
        resourceKey: row.resourceKey,
        label: permissionMatrixActionLabel(action),
        kind: "action" as const,
        originLabel: profileValueLabel(baseAllowed),
        baselineEffective: baselineFromBool(baseAllowed),
        children: [],
      };
    });

  const nested = row.children.map((child) => rowToTreeNode(child, baseline));
  const viewAllowed = Boolean(baseline[row.resourceKey]?.view);

  return {
    id: row.resourceKey,
    resourceKey: row.resourceKey,
    label: row.label,
    kind,
    originLabel: profileValueLabel(viewAllowed),
    baselineEffective: baselineFromBool(viewAllowed),
    children: [...actionChildren, ...nested],
  };
}

function draftActionValue(
  draft: PermissionMatrixDraft,
  resourceKey: string,
  action: string
): boolean {
  return Boolean(draft[resourceKey]?.[action]);
}

/** Decisões = exceções vs baseline (perfil/role). */
export function decisionsFromUserDraft(
  nodes: readonly PermissionTreeNode[],
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): PermissionTreeDecisions {
  const decisions: PermissionTreeDecisions = {};
  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      const parsed = parseUserPermissionActionNodeId(n.id);
      const resourceKey = parsed?.resourceKey ?? n.resourceKey;
      const action = parsed?.action ?? "view";
      const current = draftActionValue(draft, resourceKey, action);
      const base = draftActionValue(baseline, resourceKey, action);
      if (current !== base) {
        decisions[n.id] = current ? "allow" : "deny";
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return decisions;
}

export function draftFromUserDecisions(
  nodes: readonly PermissionTreeNode[],
  decisions: PermissionTreeDecisions,
  baseline: PermissionMatrixDraft,
  previousDraft: PermissionMatrixDraft
): PermissionMatrixDraft {
  let next: PermissionMatrixDraft = structuredClone(previousDraft);

  const ensure = (resourceKey: string) => {
    if (!next[resourceKey]) next[resourceKey] = {};
    return next[resourceKey]!;
  };

  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      const decision = decisions[n.id] ?? "inherit";
      const parsed = parseUserPermissionActionNodeId(n.id);
      const resourceKey = parsed?.resourceKey ?? n.resourceKey;

      if (parsed) {
        const slot = ensure(resourceKey);
        if (decision === "inherit") {
          slot[parsed.action] = draftActionValue(
            baseline,
            resourceKey,
            parsed.action
          );
        } else {
          slot[parsed.action] = decision === "allow";
        }
      } else if (n.kind !== "action") {
        if (decision === "inherit") {
          next = clearMatrixOverrideForResource(next, baseline, resourceKey);
        } else if (decision === "allow") {
          next = applyAllowOnResource(next, resourceKey);
        } else {
          next = applyDenyOnResource(next, resourceKey);
        }
      }

      walk(n.children);
    }
  };
  walk(nodes);
  return next;
}

export type UserPermissionTreeModel = {
  nodes: PermissionTreeNode[];
  decisions: PermissionTreeDecisions;
  draft: PermissionMatrixDraft;
  baseline: PermissionMatrixDraft;
  matrix: UserPermissionMatrixModel;
};

export function buildUserPermissionTreeModel(
  tree: readonly EditableTreeNodeDto[],
  options?: {
    profileFlagsByKey?: Record<string, PermissionFlagsDto>;
  }
): UserPermissionTreeModel {
  const matrix = buildUserPermissionMatrixModel(tree, options);
  const nodes = matrix.rows.map((row) => rowToTreeNode(row, matrix.baseline));
  const decisions = decisionsFromUserDraft(
    nodes,
    matrix.draft,
    matrix.baseline
  );
  return {
    nodes,
    decisions,
    draft: matrix.draft,
    baseline: matrix.baseline,
    matrix,
  };
}

export function countUserPermissionTreeChanges(
  decisions: PermissionTreeDecisions,
  baselineDecisions: PermissionTreeDecisions
): number {
  const keys = new Set([
    ...Object.keys(decisions),
    ...Object.keys(baselineDecisions),
  ]);
  let n = 0;
  for (const key of keys) {
    const a = decisions[key] ?? "inherit";
    const b = baselineDecisions[key] ?? "inherit";
    if (a !== b) n += 1;
  }
  return n;
}

export function userPermissionTreeDecisionsDirty(
  decisions: PermissionTreeDecisions,
  baselineDecisions: PermissionTreeDecisions
): boolean {
  return countUserPermissionTreeChanges(decisions, baselineDecisions) > 0;
}

/** Contadores de exceções (ALLOW/DENY) vs herança. */
export function countUserPermissionExceptions(
  decisions: PermissionTreeDecisions
): { allow: number; deny: number; inheritHints: number } {
  let allow = 0;
  let deny = 0;
  for (const d of Object.values(decisions)) {
    if (d === "allow") allow += 1;
    else if (d === "deny") deny += 1;
  }
  return { allow, deny, inheritHints: 0 };
}

/**
 * Detecta possível drift: bag legado do usuário ≠ snapshot atual do perfil,
 * sem exceções individuais (perfil editado após aplicação).
 */
export function detectAccessProfileSnapshotDrift(args: {
  hasAccessProfile: boolean;
  hasCustomPermissions: boolean;
  userPermissions: readonly string[];
  profilePermissions: readonly string[] | null | undefined;
}): boolean {
  if (!args.hasAccessProfile || args.hasCustomPermissions) return false;
  const profile = args.profilePermissions;
  if (!profile || profile.length === 0) return false;
  const a = new Set(args.userPermissions);
  const b = new Set(profile);
  if (a.size !== b.size) return true;
  for (const k of a) {
    if (!b.has(k)) return true;
  }
  return false;
}

export type UserExceptionHighlight =
  | "deny-over-profile"
  | "allow-over-profile"
  | "inheriting"
  | null;

export function userExceptionHighlight(
  decision: PermissionTreeDecision,
  baselineEffective: PermissionTreeEffective
): UserExceptionHighlight {
  if (decision === "deny" && baselineEffective === "allowed") {
    return "deny-over-profile";
  }
  if (decision === "allow" && baselineEffective === "denied") {
    return "allow-over-profile";
  }
  if (decision === "inherit") return "inheriting";
  return null;
}

export function userExceptionHighlightLabel(
  kind: UserExceptionHighlight
): string | null {
  if (kind === "deny-over-profile") return "DENY sobrepõe perfil";
  if (kind === "allow-over-profile") return "ALLOW sobrepõe perfil";
  if (kind === "inheriting") return "Herdando";
  return null;
}
