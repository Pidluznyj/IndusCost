/**
 * Tipos da matriz de permissões reutilizável (Prompt 08).
 * Consome árvore admin / contrato de ações — não altera autorização runtime.
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.ts";

/** Colunas padrão + ações específicas do contrato. */
export type PermissionMatrixActionId = PermissionContractAction | (string & {});

export const PERMISSION_MATRIX_STANDARD_ACTIONS = [
  "view",
  "create",
  "update",
  "delete",
  "export",
  "execute",
  "manage",
] as const satisfies readonly PermissionContractAction[];

export type PermissionMatrixStandardAction =
  (typeof PERMISSION_MATRIX_STANDARD_ACTIONS)[number];

export type PermissionMatrixGrantSource =
  | "inherited"
  | "granted"
  | "denied"
  | "unsupported";

export type PermissionMatrixCell = {
  action: PermissionMatrixActionId;
  /** false → célula é traço "—", não checkbox. */
  supported: boolean;
  allowed: boolean;
  source: PermissionMatrixGrantSource;
  /** Tooltip da origem (perfil, override, legado…). */
  originLabel: string;
  /** Indeterminate (filhos mistos) — tipicamente só view/execute. */
  partial?: boolean;
};

export type PermissionMatrixRow = {
  resourceKey: string;
  label: string;
  description: string;
  type: string;
  groupId: string;
  parentKey: string | null;
  depth: number;
  /** Ações existentes neste recurso (demais → —). */
  supportedActions: readonly PermissionMatrixActionId[];
  cells: Record<string, PermissionMatrixCell>;
  /** Valores atuais editáveis (só supported). */
  values: Record<string, boolean>;
  /** Baseline herdada (role/perfil). */
  inherited: Record<string, boolean>;
  children: PermissionMatrixRow[];
};

export type PermissionMatrixDraft = Record<
  string,
  Record<string, boolean>
>;

export type PermissionMatrixImpactSummary = {
  dirtyResourceCount: number;
  grantedCount: number;
  deniedCount: number;
  unchangedCount: number;
  parentBlockedCount: number;
  unsupportedCellCount: number;
  changedLabels: string[];
};

export type PermissionMatrixFilterState = {
  search: string;
  groupId: string | "ALL";
};

export type PermissionMatrixViewState = {
  expanded: Set<string>;
  selected: Set<string>;
  filter: PermissionMatrixFilterState;
};
