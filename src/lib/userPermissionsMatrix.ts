/**
 * Bridge Usuário × PermissionMatrix (Prompt 10).
 * Precedência: deny explícito (false) > allow explícito (true) > baseline da role.
 * Persistência continua via overrides + dual-write (AppUser.permissions[]).
 */

import {
  buildPermissionMatrixRowsFromAdminTree,
  draftFromAdminTree,
  legacyFlagsFromMatrixDraftValues,
  summarizeMatrixImpact,
  type PermissionMatrixDraft,
  type PermissionMatrixImpactSummary,
  type PermissionMatrixRow,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import type {
  EditableTreeNodeDto,
  PermissionFlagsDto,
  UserPermissionsPayload,
} from "@/src/lib/userPermissionsAdminClient";
import type { DraftOverrideMap } from "@/src/lib/userPermissionsAdminUi";
import {
  overridesPayloadFromDraft,
  wouldRemoveOwnUsersManage,
} from "@/src/lib/userPermissionsAdminUi";
import type { AppUserRole } from "@/src/lib/appAuthClient";

export const USER_PERMISSION_PRECEDENCE_NOTICE =
  "Ordem de precedência: 1) Deny explícito · 2) Allow explícito · 3) Baseline da role. Negar pai bloqueia filhos no acesso efetivo.";

export type UserPermissionMatrixModel = {
  rows: PermissionMatrixRow[];
  /** Efetivo atual (role ⊕ override). */
  draft: PermissionMatrixDraft;
  /** Somente baseline da role (sem override). */
  baseline: PermissionMatrixDraft;
};

function emptyFlags(): PermissionFlagsDto {
  return { canView: false, canExecute: false, canManage: false };
}

function flagsToActionValues(flags: PermissionFlagsDto): Record<string, boolean> {
  return {
    view: flags.canView,
    execute: flags.canExecute || flags.canManage,
    manage: flags.canManage,
    create: flags.canExecute || flags.canManage,
    update: flags.canExecute || flags.canManage,
    delete: flags.canExecute || flags.canManage,
    export: flags.canExecute || flags.canManage,
  };
}

/** Baseline da role (para badge Herdado / Allow / Deny). */
export function draftBaselineFromRoleTree(
  tree: readonly EditableTreeNodeDto[]
): PermissionMatrixDraft {
  const out: PermissionMatrixDraft = {};
  const walk = (nodes: readonly EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      out[n.key] = flagsToActionValues(n.roleFlags ?? emptyFlags());
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export function buildUserPermissionMatrixModel(
  tree: readonly EditableTreeNodeDto[],
  options?: {
    profileFlagsByKey?: Record<
      string,
      { canView: boolean; canExecute: boolean; canManage: boolean }
    >;
  }
): UserPermissionMatrixModel {
  const rows = buildPermissionMatrixRowsFromAdminTree([...tree], {
    profileFlagsByKey: options?.profileFlagsByKey,
  });
  return {
    rows,
    draft: draftFromAdminTree([...tree]),
    baseline: draftBaselineFromRoleTree(tree),
  };
}

/** Matriz → DraftOverrideMap (3 eixos) para saveUserPermissionOverrides. */
export function draftOverrideMapFromMatrixDraft(
  matrixDraft: PermissionMatrixDraft
): DraftOverrideMap {
  const out: DraftOverrideMap = {};
  for (const [resourceKey, values] of Object.entries(matrixDraft)) {
    out[resourceKey] = legacyFlagsFromMatrixDraftValues(values);
  }
  return out;
}

/** Limpa override de um recurso: volta ao baseline da role. */
export function clearMatrixOverrideForResource(
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft,
  resourceKey: string
): PermissionMatrixDraft {
  return {
    ...draft,
    [resourceKey]: { ...(baseline[resourceKey] ?? {}) },
  };
}

/** Limpa todos os overrides (volta ao baseline da role). */
export function resetMatrixDraftToBaseline(
  baseline: PermissionMatrixDraft
): PermissionMatrixDraft {
  const out: PermissionMatrixDraft = {};
  for (const [k, v] of Object.entries(baseline)) {
    out[k] = { ...v };
  }
  return out;
}

export function applyAllowOnResource(
  draft: PermissionMatrixDraft,
  resourceKey: string,
  axes: Partial<Record<"view" | "execute" | "manage", boolean>> = {
    view: true,
    execute: true,
    manage: true,
  }
): PermissionMatrixDraft {
  return {
    ...draft,
    [resourceKey]: {
      ...(draft[resourceKey] ?? {}),
      ...axes,
    },
  };
}

export function applyDenyOnResource(
  draft: PermissionMatrixDraft,
  resourceKey: string
): PermissionMatrixDraft {
  return {
    ...draft,
    [resourceKey]: {
      ...(draft[resourceKey] ?? {}),
      view: false,
      execute: false,
      manage: false,
      create: false,
      update: false,
      delete: false,
      export: false,
    },
  };
}

export type UserPermissionOriginRow = {
  resourceKey: string;
  label: string;
  axis: "view" | "execute" | "manage";
  origin: "baseline" | "allow" | "deny";
  effective: boolean;
};

export function listUserPermissionOrigins(
  tree: readonly EditableTreeNodeDto[],
  matrixDraft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): UserPermissionOriginRow[] {
  const out: UserPermissionOriginRow[] = [];
  const walk = (nodes: readonly EditableTreeNodeDto[]) => {
    for (const n of nodes) {
      for (const axis of ["view", "execute", "manage"] as const) {
        const effective = Boolean(matrixDraft[n.key]?.[axis]);
        const base = Boolean(baseline[n.key]?.[axis]);
        let origin: UserPermissionOriginRow["origin"] = "baseline";
        if (effective !== base) {
          origin = effective ? "allow" : "deny";
        }
        if (origin === "baseline" && !effective && !base) continue;
        out.push({
          resourceKey: n.key,
          label: n.label,
          axis,
          origin,
          effective,
        });
      }
      walk(n.children);
    }
  };
  walk(tree);
  return out;
}

export type UserEffectivePreview = {
  menusAllowed: string[];
  menusBlocked: string[];
  tabsAllowed: string[];
  tabsBlocked: string[];
  allowCount: number;
  denyCount: number;
  baselineOnlyCount: number;
};

export function buildUserEffectivePreview(
  tree: readonly EditableTreeNodeDto[],
  matrixDraft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): UserEffectivePreview {
  const menusAllowed: string[] = [];
  const menusBlocked: string[] = [];
  const tabsAllowed: string[] = [];
  const tabsBlocked: string[] = [];
  let allowCount = 0;
  let denyCount = 0;
  let baselineOnlyCount = 0;

  const parentBlocked = new Map<string, boolean>();

  const walk = (nodes: readonly EditableTreeNodeDto[], ancestorBlocked: boolean) => {
    for (const n of nodes) {
      const view = Boolean(matrixDraft[n.key]?.view);
      const base = Boolean(baseline[n.key]?.view);
      if (view !== base) {
        if (view) allowCount += 1;
        else denyCount += 1;
      } else if (view) {
        baselineOnlyCount += 1;
      }
      const blocked = ancestorBlocked || !view;
      parentBlocked.set(n.key, blocked);
      if (n.type === "MENU" || n.type === "SUBMENU") {
        (view && !ancestorBlocked ? menusAllowed : menusBlocked).push(n.label);
      }
      if (n.type === "TAB") {
        (view && !ancestorBlocked ? tabsAllowed : tabsBlocked).push(n.label);
      }
      walk(n.children, blocked);
    }
  };
  walk(tree, false);

  return {
    menusAllowed,
    menusBlocked,
    tabsAllowed,
    tabsBlocked,
    allowCount,
    denyCount,
    baselineOnlyCount,
  };
}

export function userMatrixImpact(
  rows: readonly PermissionMatrixRow[],
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): PermissionMatrixImpactSummary {
  return summarizeMatrixImpact(rows, draft, baseline);
}

const CRITICAL_RESOURCE_KEYS = new Set([
  "admin.usuarios",
  "admin",
  "admin.permissoes",
  "admin.permissoes.action.manage",
]);

export function hasCriticalPermissionChanges(
  draft: PermissionMatrixDraft,
  baseline: PermissionMatrixDraft
): boolean {
  for (const key of CRITICAL_RESOURCE_KEYS) {
    const d = draft[key];
    const b = baseline[key];
    if (!d && !b) continue;
    for (const axis of ["view", "execute", "manage"] as const) {
      if (Boolean(d?.[axis]) !== Boolean(b?.[axis])) return true;
    }
  }
  return false;
}

export function buildSaveOverridesFromMatrix(
  matrixDraft: PermissionMatrixDraft,
  roleDefaults: UserPermissionsPayload["roleDefaults"],
  mode: "differential" | "absolute" = "differential"
) {
  const flagDraft = draftOverrideMapFromMatrixDraft(matrixDraft);
  return overridesPayloadFromDraft(flagDraft, roleDefaults, mode);
}

export function wouldMatrixRemoveOwnUsersManage(args: {
  isEditingSelf: boolean;
  existingRole: AppUserRole;
  matrixDraft: PermissionMatrixDraft;
  roleDefaults: UserPermissionsPayload["roleDefaults"];
}): boolean {
  return wouldRemoveOwnUsersManage({
    isEditingSelf: args.isEditingSelf,
    existingRole: args.existingRole,
    draft: draftOverrideMapFromMatrixDraft(args.matrixDraft),
    roleDefaults: args.roleDefaults,
  });
}

/** Liberar primeiro menu (e filhos) — allow amplo. */
export function liberateFirstMenuInMatrixDraft(
  tree: readonly EditableTreeNodeDto[],
  draft: PermissionMatrixDraft
): PermissionMatrixDraft {
  const root = tree[0];
  if (!root) return draft;
  let next = { ...draft };
  const walk = (node: EditableTreeNodeDto) => {
    next = applyAllowOnResource(next, node.key);
    for (const c of node.children) walk(c);
  };
  walk(root);
  return next;
}

export type DenyWinsCase = {
  roleAllows: boolean;
  override: boolean | null;
  effective: boolean;
};

/** Documenta: deny explícito vence allow/baseline. */
export function resolveAxisWithPrecedence(args: {
  roleValue: boolean;
  override: boolean | null;
}): DenyWinsCase {
  if (args.override === null) {
    return {
      roleAllows: args.roleValue,
      override: null,
      effective: args.roleValue,
    };
  }
  return {
    roleAllows: args.roleValue,
    override: args.override,
    effective: args.override,
  };
}

/** Limite de recursos alterados para exigir confirmação ampliada (P22). */
export const BROAD_PERMISSION_CHANGE_RESOURCE_THRESHOLD = 5;

export type MatrixSaveDiffEntry = {
  resourceKey: string;
  label: string;
  action: string;
  before: boolean;
  after: boolean;
  kind: "grant" | "revoke";
};

/** Diff antes/depois do draft (para confirmação de save). */
export function buildMatrixSaveDiff(
  rows: readonly PermissionMatrixRow[],
  before: PermissionMatrixDraft,
  after: PermissionMatrixDraft
): MatrixSaveDiffEntry[] {
  const out: MatrixSaveDiffEntry[] = [];
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const row of list) {
      for (const action of row.supportedActions) {
        const b = Boolean(before[row.resourceKey]?.[action]);
        const a = Boolean(after[row.resourceKey]?.[action]);
        if (b === a) continue;
        out.push({
          resourceKey: row.resourceKey,
          label: row.label,
          action,
          before: b,
          after: a,
          kind: a ? "grant" : "revoke",
        });
      }
      walk(row.children);
    }
  };
  walk(rows);
  return out;
}

export function hasBroadPermissionChanges(
  impact: PermissionMatrixImpactSummary | null
): boolean {
  return (impact?.dirtyResourceCount ?? 0) >= BROAD_PERMISSION_CHANGE_RESOURCE_THRESHOLD;
}

export function sessionAffectedMessage(args: {
  isEditingSelf: boolean;
  targetName: string;
}): string {
  if (args.isEditingSelf) {
    return "Sua sessão será atualizada automaticamente após salvar.";
  }
  return `As sessões ativas de ${args.targetName} serão encerradas. O usuário precisará recarregar ou aguardar a sincronização automática de permissões.`;
}
