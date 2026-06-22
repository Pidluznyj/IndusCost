/**
 * Escopo de acesso do CRM Comercial — fonte única para backend e helpers de UI.
 * Base de carteira por vendedor: SalesOrder (não Proposal).
 */
import { Prisma } from "@prisma/client";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { buildCrmSellerFilterSql } from "@/src/lib/crmSellerMatchSql.js";

export type CrmCommercialDataScope = "global" | "own" | "none";

export type CrmCommercialAccessScope = {
  canViewCommercialGeneral: boolean;
  canViewAllSellers: boolean;
  canViewOwnSellerData: boolean;
  dataScope: CrmCommercialDataScope;
  sellerLocked: boolean;
  externalSellerId: number | null;
  responsible: string | null;
  /** Filtro consolidado por nome normalizado (prioridade sobre ID quando há nome no vínculo). */
  sellerIdentityKey: string | null;
  sellerLinked: boolean;
  /** Quando own sem vínculo Nomus no usuário. */
  blockedReason: "SELLER_NOT_LINKED" | "FORBIDDEN" | null;
  blockedMessage: string | null;
};

export type CrmCommercialAccessScopeResult =
  | { ok: true; scope: CrmCommercialAccessScope }
  | { ok: false; status: number; body: Record<string, unknown> };

export function isCrmSellerUserLinked(user: {
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
}): boolean {
  return user.externalSellerId != null || Boolean(user.sellerResponsibleName?.trim());
}

/**
 * Filtro SQL/Prisma para vendedor.
 * Prioridade: sellerIdentityKey explícito → nome normalizado → ID único (legado sem nome).
 */
export function crmCommercialSellerMatchFilters(
  externalSellerId: number | null,
  responsible: string | null,
  sellerIdentityKey?: string | null
): {
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
} {
  if (sellerIdentityKey?.trim()) {
    return { externalSellerId: null, responsible: null, sellerIdentityKey: sellerIdentityKey.trim() };
  }
  const resp = responsible?.trim() || null;
  if (resp) {
    return {
      externalSellerId: null,
      responsible: null,
      sellerIdentityKey: normalizeSellerIdentityName(resp),
    };
  }
  if (externalSellerId !== null) {
    return { externalSellerId, responsible: null, sellerIdentityKey: null };
  }
  return { externalSellerId: null, responsible: null, sellerIdentityKey: null };
}

export function resolveSellerIdentityKeyForAuth(auth: {
  sellerIdentityKey?: string | null;
  sellerResponsibleName?: string | null;
}): string | null {
  if (auth.sellerIdentityKey?.trim()) return auth.sellerIdentityKey.trim();
  const name = auth.sellerResponsibleName?.trim();
  return name ? normalizeSellerIdentityName(name) : null;
}

export function resolveCrmCommercialAccessScope(auth: AppAuthContext): CrmCommercialAccessScope {
  const canViewCommercialGeneral = hasPermission(auth, "crm.general.view");
  const canViewAllSellers = hasPermission(auth, "crm.seller.all");
  const canViewOwnSellerData = hasPermission(auth, "crm.seller.own");

  const externalSellerId = auth.externalSellerId;
  const responsible = auth.sellerResponsibleName?.trim() || null;
  const sellerLinked = isCrmSellerUserLinked(auth);

  let dataScope: CrmCommercialDataScope = "none";
  let blockedReason: CrmCommercialAccessScope["blockedReason"] = null;
  let blockedMessage: string | null = null;

  if (canViewAllSellers || canViewCommercialGeneral) {
    dataScope = "global";
  } else if (canViewOwnSellerData) {
    if (sellerLinked) {
      dataScope = "own";
    } else {
      blockedReason = "SELLER_NOT_LINKED";
      blockedMessage = "Seu usuário não está vinculado a um vendedor Nomus.";
    }
  } else {
    blockedReason = "FORBIDDEN";
    blockedMessage = "Você não tem permissão para consultar dados comerciais por vendedor.";
  }

  const sellerLocked = dataScope === "own";
  const ownName = dataScope === "own" ? responsible : null;
  const ownIdentityKey = dataScope === "own" ? resolveSellerIdentityKeyForAuth(auth) : null;
  const match = crmCommercialSellerMatchFilters(
    dataScope === "own" ? externalSellerId : null,
    dataScope === "own" ? ownName : null,
    ownIdentityKey
  );

  return {
    canViewCommercialGeneral,
    canViewAllSellers,
    canViewOwnSellerData,
    dataScope,
    sellerLocked,
    externalSellerId: match.externalSellerId,
    responsible: match.responsible,
    sellerIdentityKey: match.sellerIdentityKey,
    sellerLinked,
    blockedReason,
    blockedMessage,
  };
}

export function requireCrmCommercialDataScope(
  auth: AppAuthContext
): CrmCommercialAccessScopeResult {
  const scope = resolveCrmCommercialAccessScope(auth);
  if (scope.dataScope === "none") {
    if (scope.blockedReason === "SELLER_NOT_LINKED") {
      return {
        ok: false,
        status: 403,
        body: {
          error: "SELLER_NOT_LINKED",
          message: scope.blockedMessage ?? "Seu usuário não está vinculado a um vendedor Nomus.",
        },
      };
    }
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: scope.blockedMessage ?? "Permissão insuficiente para dados comerciais.",
        requiredPermissions: ["crm.seller.own", "crm.seller.all", "crm.general.view"],
      },
    };
  }
  return { ok: true, scope };
}

export type SellerDashboardQueryScope = {
  scopeMode: "all" | "own";
  externalSellerId: number | null;
  responsible: string | null;
  sellerIdentityKey: string | null;
};

/**
 * Escopo efetivo do seller-dashboard.
 * Vendedor (own): ignora query e força vínculo do usuário.
 * Com nome no vínculo, usa sellerIdentityKey para incluir todos os IDs Nomus com mesmo nome normalizado.
 */
export function resolveCrmSellerDashboardQueryScope(
  auth: AppAuthContext,
  queryExternalSellerId: unknown,
  queryResponsible: unknown,
  parseExternalSellerId: (raw: unknown) => number | null,
  parseResponsible: (raw: unknown) => string | null,
  querySellerIdentityKey?: unknown
): CrmCommercialAccessScopeResult & { sellerScope?: SellerDashboardQueryScope } {
  const base = resolveCrmCommercialAccessScope(auth);

  if (!hasPermission(auth, "crm.seller.all") && !hasPermission(auth, "crm.seller.own")) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message:
          "Permissão insuficiente: é necessário crm.seller.own ou crm.seller.all para consultar o dashboard por vendedor.",
        requiredPermissions: ["crm.seller.own", "crm.seller.all"],
      },
    };
  }

  if (hasPermission(auth, "crm.seller.all")) {
    const externalSellerId = parseExternalSellerId(queryExternalSellerId);
    const responsible = parseResponsible(queryResponsible);
    const sellerIdentityKey =
      typeof querySellerIdentityKey === "string" && querySellerIdentityKey.trim()
        ? normalizeSellerIdentityName(querySellerIdentityKey)
        : null;
    return {
      ok: true,
      scope: base,
      sellerScope: {
        scopeMode: "all",
        ...crmCommercialSellerMatchFilters(externalSellerId, responsible, sellerIdentityKey),
      },
    };
  }

  if (!base.sellerLinked) {
    return {
      ok: false,
      status: 403,
      body: {
        error: "SELLER_NOT_LINKED",
        message: base.blockedMessage ?? "Seu usuário não está vinculado a um vendedor Nomus.",
      },
    };
  }

  const ownName = auth.sellerResponsibleName?.trim() || null;
  const ownIdentityKey = resolveSellerIdentityKeyForAuth(auth);
  const ownMatch = crmCommercialSellerMatchFilters(
    base.externalSellerId,
    ownName,
    ownIdentityKey
  );

  return {
    ok: true,
    scope: base,
    sellerScope: {
      scopeMode: "own",
      ...ownMatch,
    },
  };
}

/** SQL: pedido pertence ao vendedor (alias da tabela SalesOrder). */
export function buildCrmSalesOrderSellerMatchSql(
  alias: string,
  externalSellerId: number | null,
  responsible: string | null,
  sellerIdentityKey?: string | null
): Prisma.Sql {
  return buildCrmSellerFilterSql(alias, {
    externalSellerId,
    responsible,
    sellerIdentityKey: sellerIdentityKey ?? null,
  });
}

/** Cliente na carteira do vendedor (pelo menos um SalesOrder válido). */
export function buildCrmSellerCustomerExistsSql(
  customerAlias: string,
  externalSellerId: number | null,
  responsible: string | null,
  sellerIdentityKey?: string | null
): Prisma.Sql {
  const sellerMatch = buildCrmSalesOrderSellerMatchSql(
    "so",
    externalSellerId,
    responsible,
    sellerIdentityKey
  );
  return Prisma.sql`
    EXISTS (
      SELECT 1
      FROM "SalesOrder" so
      WHERE so."customerId" = ${Prisma.raw(`${customerAlias}."id"`)}
        AND so.status::text NOT IN ('CANCELLED', 'ERROR')
        AND ${sellerMatch}
    )
  `;
}

export async function isCustomerInCrmCommercialScope(
  customerId: string,
  scope: CrmCommercialAccessScope
): Promise<boolean> {
  if (scope.dataScope === "global") return true;
  if (scope.dataScope !== "own") return false;

  const rows = await prisma.$queryRaw<{ ok: number }[]>(
    Prisma.sql`
      SELECT 1::int AS ok
      FROM "Customer" c
      WHERE c."id" = ${customerId}::uuid
        AND ${buildCrmSellerCustomerExistsSql(
          "c",
          scope.externalSellerId,
          scope.responsible,
          scope.sellerIdentityKey
        )}
      LIMIT 1
    `
  );
  return (rows?.length ?? 0) > 0;
}
