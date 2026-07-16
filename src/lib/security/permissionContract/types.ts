/**
 * Contrato canônico de recursos/ações (P01).
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

/**
 * Status de migração de um alias legado.
 * Alvo final: somente `canonical_1_1`. Demais = incompatibilidade temporária.
 */
export type PermissionAliasMigrationStatus =
  | "canonical_1_1"
  | "mega_key_temporary"
  | "cross_resource_bleed_temporary"
  | "deprecated";

/** Status de migração do recurso no contrato. */
export type PermissionResourceMigrationStatus =
  | "active"
  | "deprecated"
  | "pending_split"
  | "legacy_compat";

/** Binding ação → chaves legadas já usadas em produção (PERMISSION_CATALOG). */
export type PermissionContractActionBinding = {
  action: PermissionContractAction;
  /**
   * Chaves legadas que hoje representam esta capacidade.
   * Índice 0 = preferencial/canônica quando o alias for 1:1.
   * Índices seguintes / mega-keys = incompatibilidade temporária (documentada).
   */
  legacyPermissionKeys: readonly string[];
  /** Nota quando a ação canônica é aproximada (ex.: edit legado ≈ update). */
  notes?: string;
};

/** Metadados de UI / rota / detalhe (sidebar, tab, detail). */
export type PermissionContractUiMetadata = {
  route: string | null;
  appearsInSidebar: boolean;
  isTab: boolean;
  isInternalAction: boolean;
  isDetailScreen: boolean;
  relatedEndpoints: readonly string[];
  /** AppModuleId legado quando 1:1 com sidebar. */
  moduleId?: string | null;
  /**
   * Chaves do seed relacional PT atual (Stack B), quando existir ponte.
   * Não são a chave canônica do contrato.
   */
  relationalResourceKeys: readonly string[];
};

/**
 * Recurso na fonte editável (`resources.ts`).
 * Campos opcionais de migração têm default no catálogo normalizado.
 */
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
  relationalResourceKeys: readonly string[];
  moduleId?: string | null;
  notes?: string;
  /** Se true, recurso depreciado (ainda listado para migração). */
  deprecated?: boolean;
  /** Recursos canônicos que substituem este (quando deprecated / pending_split). */
  replacementKeys?: readonly string[];
  migrationStatus?: PermissionResourceMigrationStatus;
};

/** Entrada tipada definitiva (única visão normalizada do contrato). */
export type PermissionContractCatalogEntry = {
  resourceKey: string;
  label: string;
  group: PermissionContractGroupId;
  parentKey: string | null;
  order: number;
  /** Hierarquia oficial MODULE | PAGE | TAB | ACTION (PERM-26). */
  hierarchyType: "MODULE" | "PAGE" | "TAB" | "ACTION";
  /** Ativo quando não deprecated. */
  isActive: boolean;
  supportedActions: readonly PermissionContractAction[];
  sensitivity: PermissionContractSensitivity;
  metadata: PermissionContractUiMetadata;
  legacyAliases: readonly PermissionContractLegacyAlias[];
  deprecated: boolean;
  replacementKeys: readonly string[];
  migrationStatus: PermissionResourceMigrationStatus;
  notes?: string;
};

export type PermissionContractLegacyAlias = {
  action: PermissionContractAction;
  legacyKey: string;
  /** Posição na lista do binding (0 = preferencial). */
  index: number;
  aliasStatus: PermissionAliasMigrationStatus;
};

/** Registro explícito de mega-key / bleed temporário. */
export type PermissionMegaKeyRecord = {
  legacyKey: string;
  kind: "mega_key" | "cross_resource_bleed";
  /** Recursos do contrato onde a chave ainda aparece como alias. */
  resourceKeys: readonly string[];
  /** Recursos canônicos pretendidos após migração (pode ser lista de split). */
  replacementKeys: readonly string[];
  migrationStatus: "mega_key_temporary" | "cross_resource_bleed_temporary";
  notes: string;
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
    | "INVALID_RESOURCE_KEY_FORMAT"
    | "INVALID_REPLACEMENT_KEY"
    | "DEPRECATED_WITHOUT_REPLACEMENT";
  message: string;
  resourceKey?: string;
};

/** Decisão de override no modelo alvo (tabela-verdade). */
export type PermissionTruthOverride = "allow" | "deny";

/**
 * Sujeito abstrato para a tabela-verdade do modelo alvo.
 * Não lê AppUser.permissions[] (bag = compat temporária fora deste resolvedor).
 */
export type PermissionTruthSubject = {
  role: string;
  /**
   * Snapshot de perfil / role preset: grants explícitos resourceKey → ações.
   * VIEWER com bag/perfil vazio = objeto vazio → sem acesso.
   */
  baseline?: {
    readonly [resourceKey: string]: {
      readonly [A in PermissionContractAction]?: true;
    };
  };
  /** Overrides allow/deny por resourceKey × ação. Ausência = herdar baseline. */
  overrides?: {
    readonly [resourceKey: string]: {
      readonly [A in PermissionContractAction]?: PermissionTruthOverride;
    };
  };
};

export type PermissionTruthDecision = "allow" | "deny";

export type PermissionTruthResolveResult = {
  decision: PermissionTruthDecision;
  reason:
    | "SUPER_ADMIN_BYPASS"
    | "UNKNOWN_RESOURCE"
    | "UNSUPPORTED_ACTION"
    | "OVERRIDE_DENY"
    | "OVERRIDE_ALLOW"
    | "BASELINE_ALLOW"
    | "ANCESTOR_VIEW_DENY"
    | "DEFAULT_DENY";
};
