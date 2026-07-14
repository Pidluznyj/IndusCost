/**
 * Service central de escopo comercial do CRM.
 * Delega a regra canônica em `crmCommercialAccessScope` e expõe APIs de carteira.
 *
 * Carteira = Responsável Comercial (`CrmCustomerCommercialOwner`).
 * Comissão / vendedor Nomus do pedido = fora deste service.
 *
 * TODO(commercial-hierarchy): restringir COMMERCIAL_MANAGER à equipe quando houver modelo.
 */

import type { Prisma } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { buildManualCommercialOwnerPortfolioWhere } from "@/src/lib/crmCustomerCommercialOwner.js";
import {
  COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO,
  CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
  CRM_SELLER_NOT_LINKED_MESSAGE,
  isCustomerInCrmCommercialScope,
  requireCrmCommercialDataScope,
  requireCrmCommercialGeneralScope,
  resolveCrmCommercialAccessScope,
  resolveCrmSellerDashboardQueryScope,
  type CrmCommercialAccessScope,
  type CrmCommercialAccessScopeResult,
} from "@/src/lib/crmCommercialAccessScope.js";

export {
  COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO,
  CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
  CRM_SELLER_NOT_LINKED_MESSAGE,
};

export type CommercialAccessScopeMode = "unrestricted" | "own_portfolio" | "none";

/**
 * DTO canônico de escopo comercial (sempre definido — nunca `undefined`).
 * Consumido por rotas, QA e diagnósticos.
 */
export type CommercialCrmScopeDto = {
  canViewAll: boolean;
  allowedCustomerIds: string[];
  allowedResponsibleIds: string[];
  denied: boolean;
  reason?: string;
};

export type CommercialAccessScope = {
  mode: CommercialAccessScopeMode;
  dataScope: CrmCommercialAccessScope["dataScope"];
  canViewAllCommercialCrm: boolean;
  canViewCommercialGeneral: boolean;
  canFilterAnyResponsible: boolean;
  sellerLocked: boolean;
  sellerLinked: boolean;
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
  role: AppAuthContext["role"];
  commercialManagerUsesTeamFallback: boolean;
  blockedReason: CrmCommercialAccessScope["blockedReason"];
  blockedMessage: string | null;
  hierarchyTodo: string | null;
  legacy: CrmCommercialAccessScope;
};

/**
 * Monta o DTO canônico de forma síncrona (IDs de cliente ficam vazios até
 * `loadCommercialCrmScope` preencher com a carteira).
 * Nunca retorna `undefined`.
 */
export function resolveCommercialCrmScopeDto(user: AppAuthContext): CommercialCrmScopeDto {
  const scope = getCommercialAccessScope(user);
  if (scope.mode === "unrestricted") {
    return {
      canViewAll: true,
      allowedCustomerIds: [],
      allowedResponsibleIds: [],
      denied: false,
    };
  }
  if (scope.mode === "none") {
    return {
      canViewAll: false,
      allowedCustomerIds: [],
      allowedResponsibleIds: [],
      denied: true,
      reason: scope.blockedMessage ?? CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
    };
  }
  // own_portfolio — com ou sem vínculo/carteira (denied=false; vazio é OK)
  const responsibles = getAllowedResponsibleIds(user);
  return {
    canViewAll: false,
    allowedCustomerIds: [],
    allowedResponsibleIds: [
      ...responsibles.sellerIdentityKeys,
      ...responsibles.externalSellerIds.map(String),
    ],
    denied: false,
    reason: scope.blockedReason === "SELLER_NOT_LINKED"
      ? scope.blockedMessage ?? CRM_SELLER_NOT_LINKED_MESSAGE
      : undefined,
  };
}

/** DTO canônico assíncrono com `allowedCustomerIds` da carteira. */
export async function loadCommercialCrmScope(
  user: AppAuthContext
): Promise<CommercialCrmScopeDto> {
  const dto = resolveCommercialCrmScopeDto(user);
  if (dto.canViewAll || dto.denied) return dto;
  const customers = await getAllowedCustomerIds(user);
  return {
    ...dto,
    allowedCustomerIds: customers.customerIds,
  };
}

export function getCommercialAccessScope(user: AppAuthContext): CommercialAccessScope {
  const legacy = resolveCrmCommercialAccessScope(user);
  const mode: CommercialAccessScopeMode =
    legacy.dataScope === "global"
      ? "unrestricted"
      : legacy.dataScope === "own"
        ? "own_portfolio"
        : "none";
  return {
    mode,
    dataScope: legacy.dataScope,
    canViewAllCommercialCrm: legacy.dataScope === "global",
    canViewCommercialGeneral: legacy.canViewCommercialGeneral,
    canFilterAnyResponsible: legacy.canViewAllSellers,
    sellerLocked: legacy.sellerLocked,
    sellerLinked: legacy.sellerLinked,
    externalSellerId: legacy.externalSellerId,
    responsible: legacy.responsible,
    sellerIdentityKey: legacy.sellerIdentityKey,
    role: user.role,
    commercialManagerUsesTeamFallback: Boolean(legacy.commercialManagerUsesTeamFallback),
    blockedReason: legacy.blockedReason,
    blockedMessage: legacy.blockedMessage,
    hierarchyTodo: legacy.commercialManagerUsesTeamFallback
      ? COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO
      : null,
    legacy,
  };
}

export function canViewAllCommercialCrm(user: AppAuthContext): boolean {
  return getCommercialAccessScope(user).canViewAllCommercialCrm;
}

export function requireCommercialAccessScope(
  user: AppAuthContext
): CrmCommercialAccessScopeResult {
  return requireCrmCommercialDataScope(user);
}

export function requireCommercialGeneralAccess(
  user: AppAuthContext
): CrmCommercialAccessScopeResult {
  return requireCrmCommercialGeneralScope(user);
}

export function getAllowedResponsibleIds(user: AppAuthContext): {
  unrestricted: boolean;
  sellerIdentityKeys: string[];
  externalSellerIds: number[];
} {
  const scope = getCommercialAccessScope(user);
  if (scope.mode === "unrestricted") {
    return { unrestricted: true, sellerIdentityKeys: [], externalSellerIds: [] };
  }
  if (scope.mode !== "own_portfolio") {
    return { unrestricted: false, sellerIdentityKeys: [], externalSellerIds: [] };
  }
  const keys: string[] = [];
  const ids: number[] = [];
  if (scope.sellerIdentityKey) keys.push(scope.sellerIdentityKey);
  if (scope.externalSellerId != null) ids.push(scope.externalSellerId);
  return { unrestricted: false, sellerIdentityKeys: keys, externalSellerIds: ids };
}

export async function getAllowedCustomerIds(user: AppAuthContext): Promise<{
  unrestricted: boolean;
  customerIds: string[];
}> {
  const scope = getCommercialAccessScope(user);
  if (scope.mode === "unrestricted") {
    return { unrestricted: true, customerIds: [] };
  }
  if (scope.mode !== "own_portfolio") {
    return { unrestricted: false, customerIds: [] };
  }
  const where = buildManualCommercialOwnerPortfolioWhere(scope.legacy);
  if (!where) return { unrestricted: false, customerIds: [] };
  const rows = await prisma.crmCustomerCommercialOwner.findMany({
    where,
    select: { customerId: true },
  });
  return { unrestricted: false, customerIds: rows.map((r) => r.customerId) };
}

export async function assertCanAccessCrmCustomer(
  user: AppAuthContext,
  customerId: string
): Promise<{ ok: true } | { ok: false; status: number; body: Record<string, unknown> }> {
  const scope = getCommercialAccessScope(user);
  if (scope.mode === "unrestricted") return { ok: true };
  if (scope.mode === "none") {
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: scope.blockedMessage ?? CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
      },
    };
  }
  const allowed = await isCustomerInCrmCommercialScope(customerId, scope.legacy);
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      body: { error: "FORBIDDEN", message: "Cliente fora da sua carteira comercial." },
    };
  }
  return { ok: true };
}

export function applyCommercialCustomerScope(
  where: Prisma.CustomerWhereInput | undefined,
  user: AppAuthContext
): Prisma.CustomerWhereInput | undefined {
  const scope = getCommercialAccessScope(user);
  if (scope.mode === "unrestricted") return where;
  if (scope.mode === "none") {
    return { ...(where ?? {}), id: { in: [] } };
  }
  const ownerWhere = buildManualCommercialOwnerPortfolioWhere(scope.legacy);
  if (!ownerWhere) {
    return { ...(where ?? {}), id: { in: [] } };
  }
  return {
    ...(where ?? {}),
    CrmCustomerCommercialOwner: { is: ownerWhere },
  };
}

function defaultParseExternalSellerId(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function defaultParseResponsible(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function resolveRequestedResponsibleFilter(
  user: AppAuthContext,
  requested: {
    externalSellerId?: unknown;
    responsible?: unknown;
    sellerIdentityKey?: unknown;
  },
  parseExternalSellerId: (raw: unknown) => number | null = defaultParseExternalSellerId,
  parseResponsible: (raw: unknown) => string | null = defaultParseResponsible
) {
  return resolveCrmSellerDashboardQueryScope(
    user,
    requested.externalSellerId,
    requested.responsible,
    parseExternalSellerId,
    parseResponsible,
    requested.sellerIdentityKey
  );
}
