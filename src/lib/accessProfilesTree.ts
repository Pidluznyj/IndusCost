/**
 * Bridge Perfis de Acesso ↔ PermissionsTree (PERM-34).
 * Snapshot continua em permissions[]; edição NÃO propaga a usuários.
 */

import type { AppUserRole } from "@/src/lib/appAuthClient";
import {
  buildAccessProfileMatrixModel,
  materializeAccessProfilePermissionsFromDraft,
} from "@/src/lib/accessProfilesMatrix";
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

export const ACCESS_PROFILE_TREE_ACTION_SEP = "::";

export function accessProfileActionNodeId(
  resourceKey: string,
  action: string
): string {
  return `${resourceKey}${ACCESS_PROFILE_TREE_ACTION_SEP}${action}`;
}

export function parseAccessProfileActionNodeId(
  id: string
): { resourceKey: string; action: string } | null {
  const i = id.indexOf(ACCESS_PROFILE_TREE_ACTION_SEP);
  if (i <= 0) return null;
  return {
    resourceKey: id.slice(0, i),
    action: id.slice(i + ACCESS_PROFILE_TREE_ACTION_SEP.length),
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

function rowToTreeNode(
  row: PermissionMatrixRow,
  originLabel: string
): PermissionTreeNode {
  const kind = mapSeedTypeToKind(row.type);
  const actionChildren: PermissionTreeNode[] = row.supportedActions
    .filter((action) => row.cells[action]?.supported)
    .map((action) => {
      const cell = row.cells[action]!;
      return {
        id: accessProfileActionNodeId(row.resourceKey, String(action)),
        resourceKey: row.resourceKey,
        label: permissionMatrixActionLabel(action),
        kind: "action" as const,
        originLabel,
        baselineEffective: baselineFromBool(cell.allowed),
        children: [],
      };
    });

  const nested = row.children.map((child) => rowToTreeNode(child, originLabel));
  const viewAllowed = Boolean(row.values.view);

  return {
    id: row.resourceKey,
    resourceKey: row.resourceKey,
    label: row.label,
    kind,
    originLabel,
    baselineEffective: baselineFromBool(viewAllowed),
    children: [...actionChildren, ...nested],
  };
}

export function decisionsFromAccessProfileDraft(
  nodes: readonly PermissionTreeNode[],
  draft: PermissionMatrixDraft
): PermissionTreeDecisions {
  const decisions: PermissionTreeDecisions = {};
  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      const parsed = parseAccessProfileActionNodeId(n.id);
      if (parsed) {
        const allowed = Boolean(draft[parsed.resourceKey]?.[parsed.action]);
        if (allowed) decisions[n.id] = "allow";
      } else {
        const allowed = Boolean(draft[n.resourceKey]?.view);
        if (allowed) decisions[n.id] = "allow";
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return decisions;
}

export function draftFromAccessProfileDecisions(
  nodes: readonly PermissionTreeNode[],
  decisions: PermissionTreeDecisions,
  previousDraft: PermissionMatrixDraft
): PermissionMatrixDraft {
  const next: PermissionMatrixDraft = structuredClone(previousDraft);

  const ensure = (resourceKey: string) => {
    if (!next[resourceKey]) next[resourceKey] = {};
    return next[resourceKey]!;
  };

  const walk = (list: readonly PermissionTreeNode[]) => {
    for (const n of list) {
      const decision = decisions[n.id] ?? "inherit";
      const allowed = decision === "allow";
      const parsed = parseAccessProfileActionNodeId(n.id);
      if (parsed) {
        ensure(parsed.resourceKey)[parsed.action] = allowed;
      } else if (n.kind !== "module" || decision !== "inherit") {
        // módulo/página/aba: view espelha permitir explícito
        if (decision === "allow") ensure(n.resourceKey).view = true;
        else if (decision === "deny") ensure(n.resourceKey).view = false;
        else if (!(n.resourceKey in next) || next[n.resourceKey]?.view == null) {
          ensure(n.resourceKey).view = Boolean(previousDraft[n.resourceKey]?.view);
        }
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return next;
}

export type AccessProfileTreeModel = {
  nodes: PermissionTreeNode[];
  decisions: PermissionTreeDecisions;
  baselineDecisions: PermissionTreeDecisions;
  draft: PermissionMatrixDraft;
  baseline: PermissionMatrixDraft;
};

export function buildAccessProfileTreeModel(
  permissions: readonly string[],
  roleBase: AppUserRole | "" | null | undefined,
  originLabel = "Snapshot do perfil"
): AccessProfileTreeModel {
  const matrix = buildAccessProfileMatrixModel(permissions, roleBase);
  const nodes = matrix.rows.map((row) => rowToTreeNode(row, originLabel));
  const decisions = decisionsFromAccessProfileDraft(nodes, matrix.draft);
  const baselineDecisions = decisionsFromAccessProfileDraft(
    nodes,
    matrix.baseline
  );
  return {
    nodes,
    decisions,
    baselineDecisions,
    draft: matrix.draft,
    baseline: matrix.baseline,
  };
}

export function materializeAccessProfilePermissionsFromTreeDecisions(
  nodes: readonly PermissionTreeNode[],
  decisions: PermissionTreeDecisions,
  previousDraft: PermissionMatrixDraft,
  previousPermissions: readonly string[],
  options?: { compatibleClamp?: boolean }
): string[] {
  const draft = draftFromAccessProfileDecisions(
    nodes,
    decisions,
    previousDraft
  );
  return materializeAccessProfilePermissionsFromDraft(
    draft,
    previousPermissions,
    options
  );
}

export function accessProfileTreeDecisionsDirty(
  decisions: PermissionTreeDecisions,
  baseline: PermissionTreeDecisions
): boolean {
  const keys = new Set([
    ...Object.keys(decisions),
    ...Object.keys(baseline),
  ]);
  for (const key of keys) {
    const a = decisions[key] ?? "inherit";
    const b = baseline[key] ?? "inherit";
    if (a !== b) return true;
  }
  return false;
}

export function countAccessProfileTreeDecisionChanges(
  decisions: PermissionTreeDecisions,
  baseline: PermissionTreeDecisions
): number {
  const keys = new Set([
    ...Object.keys(decisions),
    ...Object.keys(baseline),
  ]);
  let n = 0;
  for (const key of keys) {
    const a = decisions[key] ?? "inherit";
    const b = baseline[key] ?? "inherit";
    if (a !== b) n += 1;
  }
  return n;
}

export function applyDecisionToAccessProfileBranch(
  nodes: readonly PermissionTreeNode[],
  branchId: string,
  decision: PermissionTreeDecision,
  current: PermissionTreeDecisions
): PermissionTreeDecisions {
  const ids: string[] = [];
  const find = (
    list: readonly PermissionTreeNode[]
  ): PermissionTreeNode | null => {
    for (const n of list) {
      if (n.id === branchId) return n;
      const hit = find(n.children);
      if (hit) return hit;
    }
    return null;
  };
  const root = find(nodes);
  if (!root) return current;
  const walk = (n: PermissionTreeNode) => {
    ids.push(n.id);
    for (const c of n.children) walk(c);
  };
  walk(root);
  const next = { ...current };
  for (const id of ids) {
    if (decision === "inherit") delete next[id];
    else next[id] = decision;
  }
  return next;
}
