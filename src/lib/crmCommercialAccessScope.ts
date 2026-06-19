/**
 * Escopo de acesso do CRM Comercial — fonte única para backend e helpers de UI.
 * Base de carteira por vendedor: SalesOrder (não Proposal).
 */
import { Prisma } from "@prisma/client";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";

export type CrmCommercialDataScope = "global" | "own" | "none";

export type CrmCommercialAccessScope = {
  canViewCommercialGeneral: boolean;
  canViewAllSellers: boolean;
  canViewOwnSellerData: boolean;
  dataScope: CrmCommercialDataScope;
  sellerLocked: boolean;
  externalSellerId: number | null;
  responsible: string | null;
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

/** ID Nomus tem prioridade; responsible só quando ID ausente (paridade com seller-dashboard). */
export function crmCommercialSellerMatchFilters(
  externalSellerId: number | null,
  responsible: string | null
): { externalSellerId: number | null; responsible: string | null } {
  if (externalSellerId !== null) {
    return { externalSellerId, responsible: null };
  }
  const resp = responsible?.trim() || null;
  return { externalSellerId: null, responsible: resp };
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
  const match = crmCommercialSellerMatchFilters(
    dataScope === "own" ? externalSellerId : null,
    dataScope === "own" ? responsible : null
  );

  return {
    canViewCommercialGeneral,
    canViewAllSellers,
    canViewOwnSellerData,
    dataScope,
    sellerLocked,
    externalSellerId: match.externalSellerId,
    responsible: match.responsible,
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
};

/**
 * Escopo efetivo do seller-dashboard.
 * Vendedor (own): ignora query e força vínculo do usuário — opção mais segura contra tampering.
 */
export function resolveCrmSellerDashboardQueryScope(
  auth: AppAuthContext,
  queryExternalSellerId: unknown,
  queryResponsible: unknown,
  parseExternalSellerId: (raw: unknown) => number | null,
  parseResponsible: (raw: unknown) => string | null
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
    return {
      ok: true,
      scope: base,
      sellerScope: {
        scopeMode: "all",
        ...crmCommercialSellerMatchFilters(externalSellerId, responsible),
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

  return {
    ok: true,
    scope: base,
    sellerScope: {
      scopeMode: "own",
      externalSellerId: base.externalSellerId,
      responsible: base.responsible,
    },
  };
}

/** SQL: pedido pertence ao vendedor (alias da tabela SalesOrder). */
export function buildCrmSalesOrderSellerMatchSql(
  alias: string,
  externalSellerId: number | null,
  responsible: string | null
): Prisma.Sql {
  const col = (field: string) => Prisma.raw(`${alias}."${field}"`);
  if (externalSellerId !== null && responsible !== null) {
    return Prisma.sql`(
      ${col("externalSellerId")} = ${externalSellerId}
      OR (
        ${col("externalSellerId")} IS NULL
        AND ${col("responsible")} IS NOT NULL
        AND LOWER(TRIM(${col("responsible")})) = LOWER(TRIM(${responsible}))
      )
    )`;
  }
  if (externalSellerId !== null) {
    return Prisma.sql`${col("externalSellerId")} = ${externalSellerId}`;
  }
  if (responsible !== null) {
    return Prisma.sql`LOWER(TRIM(${col("responsible")})) = LOWER(TRIM(${responsible}))`;
  }
  return Prisma.sql`TRUE`;
}

/** Cliente na carteira do vendedor (pelo menos um SalesOrder válido). */
export function buildCrmSellerCustomerExistsSql(
  customerAlias: string,
  externalSellerId: number | null,
  responsible: string | null
): Prisma.Sql {
  const sellerMatch = buildCrmSalesOrderSellerMatchSql("so", externalSellerId, responsible);
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
        AND ${buildCrmSellerCustomerExistsSql("c", scope.externalSellerId, scope.responsible)}
      LIMIT 1
    `
  );
  return (rows?.length ?? 0) > 0;
}
