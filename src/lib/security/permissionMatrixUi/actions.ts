/**
 * Colunas e rótulos da matriz (PT).
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.ts";
import {
  PERMISSION_MATRIX_STANDARD_ACTIONS,
  type PermissionMatrixActionId,
  type PermissionMatrixRow,
  type PermissionMatrixStandardAction,
} from "./types.ts";

export const PERMISSION_MATRIX_ACTION_LABELS: Record<
  PermissionMatrixStandardAction,
  string
> = {
  view: "Ver",
  create: "Criar",
  update: "Editar",
  delete: "Excluir",
  export: "Exportar",
  execute: "Executar",
  manage: "Gerenciar",
};

const EXTRA_LABELS: Record<string, string> = {
  approve: "Aprovar",
  close: "Fechar",
  reopen: "Reabrir",
  reprocess: "Reprocessar",
};

export function permissionMatrixActionLabel(
  action: PermissionMatrixActionId
): string {
  if (action in PERMISSION_MATRIX_ACTION_LABELS) {
    return PERMISSION_MATRIX_ACTION_LABELS[
      action as PermissionMatrixStandardAction
    ];
  }
  return EXTRA_LABELS[action] ?? String(action);
}

/**
 * Mapeia ação canônica → eixo persistido hoje (canView/canExecute/canManage).
 * Bridge até grants por ação fina existirem no runtime — não muda auth.
 */
export function matrixActionToLegacyAxis(
  action: PermissionMatrixActionId
): "view" | "execute" | "manage" | null {
  if (action === "view") return "view";
  if (action === "manage") return "manage";
  if (
    action === "execute" ||
    action === "create" ||
    action === "update" ||
    action === "delete" ||
    action === "export" ||
    action === "approve" ||
    action === "close" ||
    action === "reopen" ||
    action === "reprocess"
  ) {
    return "execute";
  }
  return "execute";
}

export function listMatrixColumns(
  rows: readonly PermissionMatrixRow[]
): PermissionMatrixActionId[] {
  const extras = new Set<PermissionMatrixActionId>();
  const walk = (list: readonly PermissionMatrixRow[]) => {
    for (const r of list) {
      for (const a of r.supportedActions) {
        if (
          !(PERMISSION_MATRIX_STANDARD_ACTIONS as readonly string[]).includes(a)
        ) {
          extras.add(a);
        }
      }
      walk(r.children);
    }
  };
  walk(rows);
  return [
    ...PERMISSION_MATRIX_STANDARD_ACTIONS,
    ...[...extras].sort((a, b) => String(a).localeCompare(String(b))),
  ];
}

export function isStandardMatrixAction(
  action: string
): action is PermissionMatrixStandardAction {
  return (PERMISSION_MATRIX_STANDARD_ACTIONS as readonly string[]).includes(
    action
  );
}

export type { PermissionContractAction };
