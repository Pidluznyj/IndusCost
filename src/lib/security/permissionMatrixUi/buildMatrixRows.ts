/**
 * Constrói linhas da matriz a partir da árvore admin (APIs structured) + contrato.
 */

import {
  PERMISSION_CONTRACT_RESOURCES,
  type PermissionContractResource,
} from "@/src/lib/security/permissionContract/index.ts";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";
import { matrixActionToLegacyAxis } from "./actions.ts";
import {
  PERMISSION_MATRIX_STANDARD_ACTIONS,
  type PermissionMatrixActionId,
  type PermissionMatrixCell,
  type PermissionMatrixDraft,
  type PermissionMatrixGrantSource,
  type PermissionMatrixRow,
} from "./types.ts";

function contractByRelationalKey(
  resources: readonly PermissionContractResource[]
): Map<string, PermissionContractResource> {
  const map = new Map<string, PermissionContractResource>();
  for (const r of resources) {
    map.set(r.resourceKey, r);
    for (const rel of r.relationalResourceKeys) {
      if (!map.has(rel)) map.set(rel, r);
    }
  }
  return map;
}

function supportedActionsForNode(
  node: EditableTreeNodeDto,
  contractMap: Map<string, PermissionContractResource>
): PermissionMatrixActionId[] {
  const hit = contractMap.get(node.key);
  if (hit && hit.actions.length > 0) {
    return hit.actions.map((a) => a.action);
  }
  // Fallback 3 eixos do seed admin (sem contrato 1:1).
  return ["view", "execute", "manage"];
}

function valueFromFlags(
  action: PermissionMatrixActionId,
  flags: { canView: boolean; canExecute: boolean; canManage: boolean }
): boolean {
  const axis = matrixActionToLegacyAxis(action);
  if (axis === "view") return flags.canView;
  if (axis === "manage") return flags.canManage;
  if (axis === "execute") return flags.canExecute || flags.canManage;
  return false;
}

function cellSource(args: {
  action: PermissionMatrixActionId;
  supported: boolean;
  allowed: boolean;
  inherited: boolean;
  hasOverride: boolean;
  overrideValue: boolean | null | undefined;
}): { source: PermissionMatrixGrantSource; originLabel: string } {
  if (!args.supported) {
    return { source: "unsupported", originLabel: "Ação não aplicável a este recurso" };
  }
  if (!args.hasOverride || args.overrideValue === null || args.overrideValue === undefined) {
    return {
      source: "inherited",
      originLabel: args.allowed
        ? "Herdado do perfil / role (permitido)"
        : "Herdado do perfil / role (negado)",
    };
  }
  if (args.overrideValue === true) {
    return { source: "granted", originLabel: "Concedido por override explícito" };
  }
  return { source: "denied", originLabel: "Negado por override explícito" };
}

function overrideAxisValue(
  action: PermissionMatrixActionId,
  override: EditableTreeNodeDto["override"]
): boolean | null | undefined {
  if (!override) return null;
  const axis = matrixActionToLegacyAxis(action);
  if (axis === "view") return override.canView;
  if (axis === "manage") return override.canManage;
  if (axis === "execute") return override.canExecute;
  return null;
}

function buildCells(
  node: EditableTreeNodeDto,
  supported: readonly PermissionMatrixActionId[],
  draftValues: Record<string, boolean> | undefined
): {
  cells: Record<string, PermissionMatrixCell>;
  values: Record<string, boolean>;
  inherited: Record<string, boolean>;
} {
  const cells: Record<string, PermissionMatrixCell> = {};
  const values: Record<string, boolean> = {};
  const inherited: Record<string, boolean> = {};
  const supportedSet = new Set(supported);

  for (const action of PERMISSION_MATRIX_STANDARD_ACTIONS) {
    const isSupported = supportedSet.has(action);
    const inheritedAllowed = valueFromFlags(action, node.roleFlags);
    inherited[action] = inheritedAllowed;
    const allowed = draftValues?.[action] ?? valueFromFlags(action, node.effectiveFlags);
    values[action] = allowed;
    const ov = overrideAxisValue(action, node.override);
    const { source, originLabel } = cellSource({
      action,
      supported: isSupported,
      allowed,
      inherited: inheritedAllowed,
      hasOverride: Boolean(node.override),
      overrideValue: ov,
    });
    cells[action] = {
      action,
      supported: isSupported,
      allowed: isSupported ? allowed : false,
      source,
      originLabel,
    };
  }

  // Ações específicas fora da lista padrão.
  for (const action of supported) {
    if ((PERMISSION_MATRIX_STANDARD_ACTIONS as readonly string[]).includes(action)) {
      continue;
    }
    const inheritedAllowed = valueFromFlags(action, node.roleFlags);
    inherited[action] = inheritedAllowed;
    const allowed = draftValues?.[action] ?? valueFromFlags(action, node.effectiveFlags);
    values[action] = allowed;
    const ov = overrideAxisValue(action, node.override);
    const { source, originLabel } = cellSource({
      action,
      supported: true,
      allowed,
      inherited: inheritedAllowed,
      hasOverride: Boolean(node.override),
      overrideValue: ov,
    });
    cells[action] = {
      action,
      supported: true,
      allowed,
      source,
      originLabel,
    };
  }

  return { cells, values, inherited };
}

function mapNode(
  node: EditableTreeNodeDto,
  depth: number,
  contractMap: Map<string, PermissionContractResource>,
  draft: PermissionMatrixDraft | undefined
): PermissionMatrixRow {
  const supported = supportedActionsForNode(node, contractMap);
  const { cells, values, inherited } = buildCells(
    node,
    supported,
    draft?.[node.key]
  );
  const groupId = node.module || "other";
  return {
    resourceKey: node.key,
    label: node.label,
    description: node.description ?? "",
    type: node.type,
    groupId,
    parentKey: node.parentKey,
    depth,
    supportedActions: supported,
    cells,
    values,
    inherited,
    children: node.children.map((c) =>
      mapNode(c, depth + 1, contractMap, draft)
    ),
  };
}

/** Adapta payload da API admin de permissões → linhas da matriz. */
export function buildPermissionMatrixRowsFromAdminTree(
  tree: readonly EditableTreeNodeDto[],
  options?: {
    draft?: PermissionMatrixDraft;
    contractResources?: readonly PermissionContractResource[];
  }
): PermissionMatrixRow[] {
  const contractMap = contractByRelationalKey(
    options?.contractResources ?? PERMISSION_CONTRACT_RESOURCES
  );
  return tree.map((n) => mapNode(n, 0, contractMap, options?.draft));
}

/** Draft inicial a partir da árvore (valores efetivos por ação suportada). */
export function draftFromAdminTree(
  tree: readonly EditableTreeNodeDto[],
  contractResources?: readonly PermissionContractResource[]
): PermissionMatrixDraft {
  const rows = buildPermissionMatrixRowsFromAdminTree(tree, {
    contractResources,
  });
  const draft: PermissionMatrixDraft = {};
  const walk = (list: PermissionMatrixRow[]) => {
    for (const r of list) {
      draft[r.resourceKey] = { ...r.values };
      walk(r.children);
    }
  };
  walk(rows);
  return draft;
}

/** Converte draft da matriz → flags 3 eixos para saveUserPermissionOverrides. */
export function legacyFlagsFromMatrixDraftValues(
  values: Record<string, boolean>
): { canView: boolean; canExecute: boolean; canManage: boolean } {
  const canView = Boolean(values.view);
  const canManage = Boolean(values.manage);
  const canExecute =
    Boolean(values.execute) ||
    Boolean(values.create) ||
    Boolean(values.update) ||
    Boolean(values.delete) ||
    Boolean(values.export) ||
    Boolean(values.approve) ||
    Boolean(values.close) ||
    Boolean(values.reopen) ||
    Boolean(values.reprocess) ||
    canManage;
  return {
    canView: canView || canExecute || canManage,
    canExecute: canExecute && !canManage ? true : canExecute || canManage,
    canManage,
  };
}
