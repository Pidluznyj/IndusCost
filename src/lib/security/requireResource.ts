/**
 * P14 — Guard backend oficial `requireResource(resourceKey, action)`.
 *
 * Autoridade: `resolveEffectiveAccess` (contrato + deny + SUPER_ADMIN).
 * Não confia no frontend. 403 consistente. Log só metadados seguros.
 */

import type { Request, RequestHandler, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
  type EffectiveAccessInput,
  type EffectiveAccessOverrideMap,
  type EffectiveAccessSource,
} from "@/src/lib/security/effectiveAccess/index.js";
import {
  mapSeedAxisOverridesToContract,
  resolveContractKeysForSeedOrCanonical,
  type SeedAxisOverride,
} from "@/src/lib/security/effectiveAccessDto/mapOverrides.js";
import { parseEnvFlag } from "@/src/lib/security/effectiveAccessDto/flags.js";
import {
  PERMISSION_CONTRACT_ACTIONS,
  supportsPermissionAction,
  type PermissionContractAction,
} from "@/src/lib/security/permissionContract/index.js";

export type RequireResourceAction =
  | PermissionContractAction
  | "read"
  | "admin"
  | "cancel"
  | "reverse"
  | "publish"
  | "synchronize";

export type ReadAppUserFn = (req: Request) => Promise<AppAuthContext | null>;

export type RequireResourceAuthInput = {
  id: string;
  role: string;
  isActive?: boolean;
  permissions?: readonly string[];
  effectivePermissions?: readonly string[];
};

export type AuthorizeRequireResourceOptions = {
  /** Overrides seed/contrato (deny vence). */
  overrides?: readonly SeedAxisOverride[] | EffectiveAccessOverrideMap;
  /** Default: true na transição (bag → contrato 1:1). */
  legacyCompatMode?: boolean;
  permissionsVersion?: number | null;
};

export type RequireResourceDecision =
  | {
      ok: true;
      resourceKey: string;
      action: PermissionContractAction;
      source: EffectiveAccessSource;
    }
  | {
      ok: false;
      status: 401 | 403;
      body: Record<string, unknown>;
      resourceKey?: string;
      action?: string;
      source?: EffectiveAccessSource;
    };

const ACTION_ALIASES: Record<string, PermissionContractAction> = {
  view: "view",
  read: "view",
  create: "create",
  update: "update",
  delete: "delete",
  export: "export",
  execute: "execute",
  approve: "approve",
  close: "close",
  reopen: "reopen",
  reprocess: "reprocess",
  manage: "manage",
  admin: "manage",
  cancel: "manage",
  publish: "manage",
  reverse: "execute",
  synchronize: "execute",
};

const CONTRACT_ACTION_SET = new Set<string>(PERMISSION_CONTRACT_ACTIONS);

export function normalizeRequireResourceAction(
  action: RequireResourceAction | string
): PermissionContractAction | null {
  const raw = String(action ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (ACTION_ALIASES[raw]) return ACTION_ALIASES[raw]!;
  if (CONTRACT_ACTION_SET.has(raw)) return raw as PermissionContractAction;
  return null;
}

/** Legacy bag projection on by default until module cutovers complete. */
export function isRequireResourceLegacyCompatEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.REQUIRE_RESOURCE_LEGACY_COMPAT == null || env.REQUIRE_RESOURCE_LEGACY_COMPAT === "") {
    return true;
  }
  return parseEnvFlag(env.REQUIRE_RESOURCE_LEGACY_COMPAT);
}

function friendlyDeniedMessage(resourceKey: string, action: string): string {
  return `Você não tem permissão para acessar este recurso (${resourceKey}:${action}).`;
}

export function resolveRequireResourceContractKey(resourceKey: string): string | null {
  const key = resourceKey.trim();
  if (!key) return null;
  const keys = resolveContractKeysForSeedOrCanonical(key);
  return keys[0] ?? null;
}

function asOverrideMap(
  overrides: AuthorizeRequireResourceOptions["overrides"]
): EffectiveAccessOverrideMap {
  if (!overrides) return {};
  if (Array.isArray(overrides)) {
    return mapSeedAxisOverridesToContract(overrides as SeedAxisOverride[]);
  }
  return overrides as EffectiveAccessOverrideMap;
}

export function buildRequireResourceInput(
  auth: RequireResourceAuthInput,
  options?: AuthorizeRequireResourceOptions
): EffectiveAccessInput {
  const legacy = auth.effectivePermissions ?? auth.permissions ?? [];
  return {
    userId: auth.id,
    role: auth.role,
    permissionsVersion: options?.permissionsVersion ?? null,
    overrides: asOverrideMap(options?.overrides),
    legacyPermissions: [...legacy],
    legacyCompatMode:
      options?.legacyCompatMode ?? isRequireResourceLegacyCompatEnabled(),
    legacySkipMegaKeys: true,
  };
}

/**
 * Decisão pura — testes e middleware.
 * Autentica (401) → resolve recurso/action → resolveEffectiveAccess → allow/deny.
 */
export function authorizeRequireResource(
  auth: RequireResourceAuthInput | null | undefined,
  resourceKey: string,
  action: RequireResourceAction | string = "view",
  options?: AuthorizeRequireResourceOptions
): RequireResourceDecision {
  if (!auth?.id || !auth.role) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "UNAUTHORIZED",
        message: "Autenticação necessária.",
      },
    };
  }

  if (auth.isActive === false && auth.role !== "SUPER_ADMIN") {
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        code: "USER_INACTIVE",
        message: "Usuário inativo.",
      },
    };
  }

  const normalizedAction = normalizeRequireResourceAction(action);
  const contractKey = resolveRequireResourceContractKey(resourceKey);

  if (!contractKey) {
    const rk = resourceKey.trim() || "unknown";
    const act = normalizedAction ?? String(action);
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        code: "UNKNOWN_RESOURCE",
        message: friendlyDeniedMessage(rk, act),
        resourceKey: rk,
        action: act,
      },
      resourceKey: rk,
      action: act,
      source: "UNKNOWN_RESOURCE",
    };
  }

  if (!normalizedAction || !supportsPermissionAction(contractKey, normalizedAction)) {
    const act = normalizedAction ?? String(action);
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        code: "UNSUPPORTED_ACTION",
        message: friendlyDeniedMessage(contractKey, act),
        resourceKey: contractKey,
        action: act,
      },
      resourceKey: contractKey,
      action: act,
      source: "UNSUPPORTED_ACTION",
    };
  }

  const input = buildRequireResourceInput(auth, options);
  const result = resolveEffectiveAccess(input);
  const cell = result.byResourceAction[contractKey]?.[normalizedAction];
  const allowed = canEffectiveAccess(result, contractKey, normalizedAction);

  if (allowed) {
    return {
      ok: true,
      resourceKey: contractKey,
      action: normalizedAction,
      source: cell?.source ?? (auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "DENY_DEFAULT"),
    };
  }

  const source = cell?.source ?? "DENY_DEFAULT";
  return {
    ok: false,
    status: 403,
    body: {
      error: "FORBIDDEN",
      code: "PERMISSION_DENIED",
      message: friendlyDeniedMessage(contractKey, normalizedAction),
      resourceKey: contractKey,
      action: normalizedAction,
    },
    resourceKey: contractKey,
    action: normalizedAction,
    source,
  };
}

export function logRequireResourceDenied(args: {
  userId?: string;
  role?: string;
  resourceKey: string;
  action: string;
  source?: string;
  path?: string;
}): void {
  console.warn(
    `[requireResource] DENIED resourceKey=${args.resourceKey} action=${args.action}` +
      ` source=${args.source ?? "?"}` +
      ` userId=${args.userId ?? "?"}` +
      ` role=${args.role ?? "?"}` +
      (args.path ? ` path=${args.path}` : "")
  );
}

function shouldBypassInTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.REQUIRE_RESOURCE_STRICT !== "1" &&
    process.env.PERMISSION_GUARD_STRICT !== "1"
  );
}

export type RequireResourceGuardOptions = AuthorizeRequireResourceOptions & {
  /** Carrega overrides do usuário (ex.: DB) antes de decidir. */
  loadOverrides?: (userId: string) => Promise<readonly SeedAxisOverride[] | null | undefined>;
};

/**
 * Middleware: `requireResource(resourceKey, action)`.
 * Autentica via `req.appAuth` ou `getCurrentAppUser`.
 */
export function requireResource(
  resourceKey: string,
  action: RequireResourceAction | string = "view",
  getCurrentAppUser?: ReadAppUserFn,
  guardOptions?: RequireResourceGuardOptions
): RequestHandler {
  return async (req, res, next) => {
    if (shouldBypassInTestEnv()) {
      return next();
    }

    try {
      let auth = (req as { appAuth?: AppAuthContext }).appAuth ?? null;
      if (!auth && getCurrentAppUser) {
        auth = await getCurrentAppUser(req);
        if (auth) (req as { appAuth?: AppAuthContext }).appAuth = auth;
      }

      let overrides = guardOptions?.overrides;
      if (!overrides && guardOptions?.loadOverrides && auth?.id) {
        overrides = (await guardOptions.loadOverrides(auth.id)) ?? undefined;
      }

      const decision = authorizeRequireResource(auth, resourceKey, action, {
        ...guardOptions,
        overrides,
      });

      if (!decision.ok) {
        if (decision.status === 403 && decision.resourceKey) {
          logRequireResourceDenied({
            userId: auth?.id,
            role: auth?.role,
            resourceKey: decision.resourceKey,
            action: decision.action ?? String(action),
            source: decision.source,
            path: req.originalUrl ?? req.path,
          });
        }
        return res.status(decision.status).json(decision.body);
      }

      (req as { requireResourceDecision?: RequireResourceDecision }).requireResourceDecision =
        decision;
      return next();
    } catch (err) {
      console.error(
        "[requireResource] guard error",
        err instanceof Error ? err.message : "unknown"
      );
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Erro ao verificar permissão.",
      });
    }
  };
}

export function sendRequireResourceDenied(
  res: Response,
  decision: Extract<RequireResourceDecision, { ok: false }>
): Response {
  return res.status(decision.status).json(decision.body);
}

export function createRequireResourceGuards(
  getCurrentAppUser: ReadAppUserFn,
  defaults?: RequireResourceGuardOptions
) {
  return {
    requireResource: (
      resourceKey: string,
      action: RequireResourceAction | string = "view",
      options?: RequireResourceGuardOptions
    ): RequestHandler =>
      requireResource(resourceKey, action, getCurrentAppUser, {
        ...defaults,
        ...options,
      }),

    requireBootstrapOrResource: (
      isBootstrap: (req: Request) => boolean,
      resourceKey: string,
      action: RequireResourceAction | string = "view",
      options?: RequireResourceGuardOptions
    ): RequestHandler => {
      return async (req, res, next) => {
        if (shouldBypassInTestEnv()) return next();
        if (isBootstrap(req)) return next();
        return requireResource(resourceKey, action, getCurrentAppUser, {
          ...defaults,
          ...options,
        })(req, res, next);
      };
    },

    authorizeRequireResource,
  };
}

/** Recursos canônicos da infra admin migrada em P14. */
export const REQUIRE_RESOURCE_ADMIN_KEYS = {
  security: "admin.settings.security",
  settings: "admin.settings",
} as const;

/**
 * Endpoints ainda em lista legada / seed guard — fila para prompts de módulo (P15+).
 * Não migrar em massa neste prompt.
 */
export const REQUIRE_RESOURCE_LEGACY_BACKLOG = [
  { area: "employees", prompt: "P15", note: "GET/POST /api/employees* — lista costs.view / employees.*" },
  { area: "machines", prompt: "P16", note: "GET/POST /api/machines* — machines.view/edit legado" },
  { area: "materials", prompt: "P17+", note: "materiais — materials.view/edit" },
  { area: "products", prompt: "P17+", note: "produtos/BOM — products.*" },
  {
    area: "finance-ar",
    prompt: "P18+",
    note: "Contas a Receber ainda bag OR — espelhar piloto AP",
  },
  { area: "commissions", prompt: "P18+", note: "receipt-closing apply/reprocess; reprocess panel" },
  { area: "sales-orders", prompt: "P18+", note: "export pedidos; sales_orders.view" },
  { area: "nomus-sync-other", prompt: "P18+", note: "daily/AR/NFe sync ainda settings bags" },
  {
    area: "portfolio",
    prompt: "P18+",
    note: "ainda requireResourcePermission (seed) em financePortfolioReconciliationRoutes",
  },
  { area: "dashboard", prompt: "P18+", note: "requirePermission(dashboard.view) bag" },
] as const;

export function listRequireResourceLegacyBacklog(): readonly {
  area: string;
  prompt: string;
  note: string;
}[] {
  return REQUIRE_RESOURCE_LEGACY_BACKLOG;
}
