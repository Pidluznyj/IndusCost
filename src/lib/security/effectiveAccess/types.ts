/**
 * Tipos do resolvedor oficial `resolveEffectiveAccess` (P03).
 * Ainda não substitui login/sidebar/APIs — shadow / testes apenas.
 */

import type { PermissionContractAction } from "@/src/lib/security/permissionContract/types.js";

export type EffectiveAccessSource =
  | "SUPER_ADMIN"
  | "ROLE"
  | "PROFILE"
  | "STRUCTURED_GRANT"
  | "OVERRIDE_ALLOW"
  | "OVERRIDE_DENY"
  | "LEGACY_PROJECTED"
  | "DENY_DEFAULT"
  | "ANCESTOR_VIEW_DENY"
  | "UNKNOWN_RESOURCE"
  | "UNSUPPORTED_ACTION";

export type EffectiveAccessOverride = "allow" | "deny";

/** Baseline: resourceKey → ações concedidas (true = allow no baseline). */
export type EffectiveAccessBaselineMap = {
  readonly [resourceKey: string]: {
    readonly [A in PermissionContractAction]?: true;
  };
};

/** Overrides explícitos deny > allow > herança. */
export type EffectiveAccessOverrideMap = {
  readonly [resourceKey: string]: {
    readonly [A in PermissionContractAction]?: EffectiveAccessOverride;
  };
};

/**
 * Entrada do resolvedor.
 * - `profileSnapshot !== undefined` → substitui o role preset (mesmo se {}).
 * - `legacyPermissions` só entram com `legacyCompatMode: true`.
 */
export type EffectiveAccessInput = {
  userId: string;
  role: string;
  /** Versão futura de invalidação de sessão (pass-through). */
  permissionsVersion?: number | null;
  /**
   * Snapshot de AccessProfile (flags já materializadas em resourceKey canônico).
   * Se definido, **substitui** o preset da role.
   */
  profileSnapshot?: EffectiveAccessBaselineMap | null;
  /** Permissões diretas estruturadas (OR sobre o baseline). */
  structuredGrants?: EffectiveAccessBaselineMap;
  overrides?: EffectiveAccessOverrideMap;
  /** Bag `AppUser.permissions[]` — compat temporária. */
  legacyPermissions?: readonly string[];
  /** Default false: bag ignorada. */
  legacyCompatMode?: boolean;
  /** Em modo legado, não projetar mega-keys (default true). */
  legacySkipMegaKeys?: boolean;
};

export type EffectiveAccessCell = {
  decision: "allow" | "deny";
  source: EffectiveAccessSource;
};

export type EffectiveAccessAxisFlags = {
  canView: boolean;
  canExecute: boolean;
  canManage: boolean;
  sourceView: EffectiveAccessSource;
  sourceExecute: EffectiveAccessSource;
  sourceManage: EffectiveAccessSource;
};

export type EffectiveAccessWarning = {
  code:
    | "LEGACY_MEGA_KEY_SKIPPED"
    | "LEGACY_UNMAPPED_KEY"
    | "LEGACY_MULTI_RESOURCE_ALIAS"
    | "LEGACY_COMPAT_DISABLED_BAG_IGNORED"
    | "PARENT_DENY_BLOCKS_CHILD"
    | "PROFILE_REPLACES_ROLE";
  message: string;
  subject?: string;
};

export type EffectiveAccessAllowedEntry = {
  resourceKey: string;
  action: PermissionContractAction;
  source: EffectiveAccessSource;
};

export type EffectiveAccessResult = {
  userId: string;
  role: string;
  permissionsVersion: number | null;
  /** Decisão por resourceKey × ação canônica do contrato. */
  byResourceAction: Record<
    string,
    Partial<Record<PermissionContractAction, EffectiveAccessCell>>
  >;
  /** Compacto 3 eixos (DTO futuro /me). */
  byResource: Record<string, EffectiveAccessAxisFlags>;
  allowed: EffectiveAccessAllowedEntry[];
  denied: EffectiveAccessAllowedEntry[];
  /** Recursos com allow local bloqueados por ancestral view deny. */
  blockedByParent: string[];
  /** Recursos reveláveis na navegação (inclui parent virtual). */
  navigationReveal: string[];
  warnings: EffectiveAccessWarning[];
  legacyCompatApplied: boolean;
  /** Baseline efetivo usado (após profile/role + structured + legacy). */
  baselineUsed: EffectiveAccessBaselineMap;
};

/** Diff shadow vs modelo atual (bag / seed service). */
export type EffectiveAccessShadowDiff = {
  resourceKey: string;
  action: string;
  /** Decisão do resolveEffectiveAccess. */
  next: "allow" | "deny";
  nextSource: EffectiveAccessSource;
  /** Interpretação do modelo atual no fixture. */
  current: "allow" | "deny" | "n/a";
  currentNote: string;
  kind: "aligned" | "next_stricter" | "next_looser" | "incomparable";
};

export type EffectiveAccessShadowReport = {
  fixtureId: string;
  description: string;
  diffs: EffectiveAccessShadowDiff[];
  alignedCount: number;
  nextStricterCount: number;
  nextLooserCount: number;
  incomparableCount: number;
};
