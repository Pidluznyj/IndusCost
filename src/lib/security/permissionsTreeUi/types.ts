/**
 * Tipos da árvore de permissões reutilizável (PERM-33).
 * UI de decisão Herdar | Permitir | Negar — não altera autorização runtime.
 */

export type PermissionTreeNodeKind = "module" | "page" | "tab" | "action";

/** Decisão individual do usuário/editor. */
export type PermissionTreeDecision = "inherit" | "allow" | "deny";

/** Resultado efetivo após herança / pai. */
export type PermissionTreeEffective = "allowed" | "denied" | "inherited";

export type PermissionTreeNode = {
  id: string;
  resourceKey: string;
  label: string;
  kind: PermissionTreeNodeKind;
  /** Origem do perfil / role (coluna Origem/perfil). */
  originLabel: string;
  /**
   * Efetivo quando a decisão é Herdar e o pai não bloqueia
   * (ex.: valor do perfil/role).
   */
  baselineEffective: PermissionTreeEffective;
  children: PermissionTreeNode[];
};

export type PermissionTreeDecisions = Record<string, PermissionTreeDecision>;

export type PermissionTreeCounters = {
  allowed: number;
  denied: number;
  inherited: number;
  total: number;
};

export type PermissionTreeFilterState = {
  search: string;
};
