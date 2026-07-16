/**
 * Contrato público do DTO de acesso efetivo (P04).
 * Seguro para import no frontend — sem Prisma / resolvedor.
 */

/** Ações compactas no DTO (subconjunto estável do contrato). */
export const EFFECTIVE_ACCESS_DTO_ACTIONS = [
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

export type EffectiveAccessDtoAction = (typeof EFFECTIVE_ACCESS_DTO_ACTIONS)[number];

export type EffectiveAccessDtoCapability = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
};

/**
 * Compatibilidade com a bag legada (`user.permissions` / `effectivePermissions`).
 * Enquanto `legacyBagAuthoritative` for true, o runtime de sessão continua na bag.
 */
export type EffectiveAccessDtoCompatibility = {
  /** Sempre "shadow" até o cutover (P07+). */
  mode: "shadow";
  /** true = FE/BE ainda devem usar permissions[] para auth efetiva. */
  legacyBagAuthoritative: boolean;
  /** Bag não vazia no usuário. */
  legacyPermissionsPresent: boolean;
  /** Se o builder aplicou projeção 1:1 da bag neste DTO. */
  legacyCompatApplied: boolean;
};

/** Deny explícito seguro para auditoria admin (não lista DENY_DEFAULT). */
export type EffectiveAccessDtoDenyEntry = {
  resourceKey: string;
  actions: EffectiveAccessDtoAction[];
  /** Código curto, sem aliases nem dados sensíveis. */
  reason: "OVERRIDE_DENY" | "ANCESTOR_VIEW_DENY";
};

/** Warning sanitizado (admin audit only). */
export type EffectiveAccessDtoWarning = {
  code: string;
  message: string;
};

/**
 * Bloco `effectiveAccess` em `/api/auth/me` (audiência sessão).
 * Compacto: só allows + capabilities + nav; sem denies/warnings/sources.
 */
export type EffectiveAccessMeDto = {
  permissionsVersion: number;
  role: string;
  isSuperAdmin: boolean;
  /**
   * Recursos com ≥1 ação allow.
   * SUPER_ADMIN: lista vazia — use `isSuperAdmin` (payload enxuto).
   */
  allowedResources: string[];
  /** resourceKey → ações permitidas (ordenadas). Ausente/vazio se SUPER_ADMIN. */
  actionsByResource: Record<string, EffectiveAccessDtoAction[]>;
  /** Recursos reveláveis na navegação (inclui parent virtual). */
  navigationReveal: string[];
  /** Flags 3 eixos só para recursos em allowedResources (ou vazio se SUPER_ADMIN). */
  capabilities: Record<string, EffectiveAccessDtoCapability>;
  compatibility: EffectiveAccessDtoCompatibility;
};

/**
 * Variante admin (não vai no /me por default).
 * Inclui denies explícitos e warnings sanitizados.
 */
export type EffectiveAccessAdminDto = EffectiveAccessMeDto & {
  denies: EffectiveAccessDtoDenyEntry[];
  warnings: EffectiveAccessDtoWarning[];
};

export type EffectiveAccessDtoAudience = "session" | "admin";

/** Versão placeholder até migration `AppUser.permissionsVersion`. */
export const EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER = 0;
