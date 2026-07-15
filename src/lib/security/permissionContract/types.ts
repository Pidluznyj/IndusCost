/**
 * Contrato canônico de recursos/ações (Prompt 02).
 * Fonte de verdade documental + tipada — **não** conectada ao runtime de autorização.
 */

/** Ações canônicas permitidas no contrato. */
export const PERMISSION_CONTRACT_ACTIONS = [
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
] as const;

export type PermissionContractAction = (typeof PERMISSION_CONTRACT_ACTIONS)[number];

/** Grupos alinhados à sidebar (labels PT no UI; ids canônicos EN). */
export const PERMISSION_CONTRACT_GROUP_IDS = [
  "dashboard",
  "engineering",
  "commercial",
  "finance",
  "operations",
  "admin",
] as const;

export type PermissionContractGroupId = (typeof PERMISSION_CONTRACT_GROUP_IDS)[number];

export type PermissionContractSensitivity = "low" | "medium" | "high" | "critical";

/** Binding ação → chaves legadas já usadas em produção (PERMISSION_CATALOG). */
export type PermissionContractActionBinding = {
  action: PermissionContractAction;
  /** Uma ou mais chaves legadas que hoje representam esta capacidade. */
  legacyPermissionKeys: readonly string[];
  /** Nota quando a ação canônica é aproximada (ex.: edit legado ≈ update). */
  notes?: string;
};

export type PermissionContractResource = {
  resourceKey: string;
  label: string;
  parentKey: string | null;
  groupId: PermissionContractGroupId;
  /** Rota SPA principal; null se for grupo estrutural ou ação sem path. */
  route: string | null;
  sortOrder: number;
  actions: readonly PermissionContractActionBinding[];
  /** Prefixos/padrões de endpoint relacionados (documentação). */
  relatedEndpoints: readonly string[];
  sensitivity: PermissionContractSensitivity;
  appearsInSidebar: boolean;
  isTab: boolean;
  isInternalAction: boolean;
  isDetailScreen: boolean;
  /**
   * Chaves do seed relacional PT atual (Stack B), quando existir ponte.
   * Não são a chave canônica do contrato.
   */
  relationalResourceKeys: readonly string[];
  /** AppModuleId legado quando 1:1 com sidebar. */
  moduleId?: string | null;
  notes?: string;
};

export type PermissionContractIssue = {
  code:
    | "DUPLICATE_RESOURCE_KEY"
    | "MISSING_PARENT"
    | "CYCLE"
    | "UNKNOWN_ACTION"
    | "EMPTY_ACTIONS"
    | "EMPTY_LEGACY_KEYS"
    | "UNKNOWN_LEGACY_KEY"
    | "FORBIDDEN_DELETE"
    | "CONFLICTING_RELATIONAL_ALIAS"
    | "DUPLICATE_SORT_ORDER_SIBLING"
    | "INVALID_RESOURCE_KEY_FORMAT";
  message: string;
  resourceKey?: string;
};
