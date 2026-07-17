/**
 * Escopo de acesso do CRM Comercial — fonte única para backend e helpers de UI.
 *
 * Carteira = Responsável Comercial do Cliente (`CrmCustomerCommercialOwner`).
 * Vendedor Nomus do pedido = auditoria/comissão (não define escopo de acesso).
 */
import { Prisma } from "@prisma/client";
import {
  canViewCanonicalResource,
  hasPermission,
  type AppAuthContext,
} from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import { resolveCrmCommercialPersona } from "@/src/lib/crmCommercialPersona.js";
import { normalizeSellerIdentityName } from "@/src/lib/crmSellerIdentityConsolidation.js";
import { buildCrmSellerFilterSql } from "@/src/lib/crmSellerMatchSql.js";
import {
  manualCommercialOwnerMatchesSellerScope,
} from "@/src/lib/crmCustomerCommercialOwner.js";

export const CRM_NO_COMMERCIAL_ACCESS_MESSAGE =
  "Você não possui carteira comercial vinculada ou permissão para acessar esta visão.";

export const CRM_SELLER_NOT_LINKED_MESSAGE =
  "Seu usuário não está vinculado a um responsável comercial da carteira. Solicite o vínculo ao administrador.";

/** Fallback enquanto não houver hierarquia gestor → equipe. */
export const COMMERCIAL_MANAGER_TEAM_HIERARCHY_TODO =
  "TODO(commercial-hierarchy): restringir COMMERCIAL_MANAGER aos responsáveis da equipe. Fallback: unrestricted commercial.";

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
  /** Quando own sem vínculo comercial no usuário. */
  blockedReason: "SELLER_NOT_LINKED" | "FORBIDDEN" | null;
  blockedMessage: string | null;
  /** True quando COMMERCIAL_MANAGER usa fallback sem hierarquia de equipe. */
  commercialManagerUsesTeamFallback?: boolean;
};

export type CrmCommercialAccessScopeResult =
  | { ok: true; scope: CrmCommercialAccessScope }
  | { ok: false; status: number; body: Record<string, unknown> };

export function isCrmSellerUserLinked(user: {
  externalSellerId: number | null;
  externalSellerIds?: number[] | null;
  sellerResponsibleName: string | null;
}): boolean {
  if (user.externalSellerId != null) return true;
  if ((user.externalSellerIds?.length ?? 0) > 0) return true;
  return Boolean(user.sellerResponsibleName?.trim());
}

/**
 * Filtro SQL/Prisma para responsável comercial (identidade do vínculo).
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
  const grant = (legacyPermission: string, resourceKey: string): boolean =>
    canViewCanonicalResource(auth, resourceKey) ?? hasPermission(auth, legacyPermission);
  const canViewShell = grant("crm.view", "commercial.crm");
  const canViewCommercialGeneralPerm = grant(
    "crm.general.view",
    "commercial.crm.general"
  );
  const canViewSellerTab = grant("crm.seller.view", "commercial.crm.seller");
  const canViewPortfolio = grant(
    "crm.customer_cockpit.view",
    "commercial.crm.portfolio"
  );
  const canViewCustomer360 = grant(
    "customers.commercial360.view",
    "commercial.crm.customer_360"
  );
  const canViewOwnSellerData = grant("crm.seller.own", "commercial.crm.scope.own");
  const canViewAllSellersPerm = grant("crm.seller.all", "commercial.crm.scope.all");
  const persona = resolveCrmCommercialPersona({
    role: auth.role,
    canViewShell,
    canViewGeneral: canViewCommercialGeneralPerm,
    canViewSellerTab,
    canViewPortfolio,
    canViewCustomer360,
    canViewOwn: canViewOwnSellerData,
    canViewAll: canViewAllSellersPerm,
  });

  const externalSellerId = auth.externalSellerId;
  const responsible = auth.sellerResponsibleName?.trim() || null;
  const sellerLinked = isCrmSellerUserLinked(auth);

  let dataScope: CrmCommercialDataScope = "none";
  let blockedReason: CrmCommercialAccessScope["blockedReason"] = null;
  let blockedMessage: string | null = null;
  let commercialManagerUsesTeamFallback = false;

  dataScope = persona.dataScope;
  commercialManagerUsesTeamFallback =
    auth.role === "COMMERCIAL_MANAGER" && dataScope === "global";

  if (dataScope === "own") {
    // Carteira própria: com ou sem vínculo. Sem vínculo → carteira vazia
    // (nunca 500; UI trata mensagem amigável via blockedReason).
    if (!sellerLinked) {
      blockedReason = "SELLER_NOT_LINKED";
      blockedMessage = CRM_SELLER_NOT_LINKED_MESSAGE;
    }
  } else if (dataScope === "none") {
    blockedReason = "FORBIDDEN";
    blockedMessage = CRM_NO_COMMERCIAL_ACCESS_MESSAGE;
  }

  const canViewCommercialGeneral = dataScope === "global";
  const canViewAllSellers = persona.canFilterAllSellers;

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
    canViewOwnSellerData: dataScope === "own" || dataScope === "global",
    dataScope,
    sellerLocked,
    externalSellerId: match.externalSellerId,
    responsible: match.responsible,
    sellerIdentityKey: match.sellerIdentityKey,
    sellerLinked,
    blockedReason,
    blockedMessage,
    commercialManagerUsesTeamFallback,
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
          message: scope.blockedMessage ?? CRM_SELLER_NOT_LINKED_MESSAGE,
        },
      };
    }
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: scope.blockedMessage ?? CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
        requiredPermissions: ["crm.seller.own", "crm.seller.all", "crm.general.view"],
      },
    };
  }
  return { ok: true, scope };
}

/** Gestão Geral: somente escopo global (admin/gestor). Seller → 403. */
export function requireCrmCommercialGeneralScope(
  auth: AppAuthContext
): CrmCommercialAccessScopeResult {
  const scope = resolveCrmCommercialAccessScope(auth);
  if (scope.dataScope !== "global") {
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message:
          scope.dataScope === "own"
            ? "Gestão Geral é restrita a administradores e gestores comerciais. Use Gestão por Responsável ou Carteira de Clientes."
            : scope.blockedMessage ?? CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
      },
    };
  }
  return { ok: true, scope };
}

export type SellerDashboardQueryScope = {
  scopeMode: "all" | "own";
  externalSellerId: number | null;
  externalSellerIds: number[];
  responsible: string | null;
  sellerIdentityKey: string | null;
};

/**
 * Escopo efetivo do seller-dashboard.
 * SELLER (own): ignora query e força vínculo do usuário (responsável comercial).
 * Admin/gestor: honra filtro de responsável solicitado.
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

  if (base.dataScope === "none") {
    return {
      ok: false,
      status: 403,
      body: {
        error: base.blockedReason === "SELLER_NOT_LINKED" ? "SELLER_NOT_LINKED" : "FORBIDDEN",
        message: base.blockedMessage ?? CRM_NO_COMMERCIAL_ACCESS_MESSAGE,
        requiredPermissions: ["crm.seller.own", "crm.seller.all"],
      },
    };
  }

  if (base.dataScope === "global") {
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
        externalSellerIds: [],
        ...crmCommercialSellerMatchFilters(externalSellerId, responsible, sellerIdentityKey),
      },
    };
  }

  // Sem vínculo / sem carteira: liberar payload vazio (scope own sem match).
  // O service NÃO pode consultar o universo global quando o filtro fica vazio.
  if (!base.sellerLinked) {
    return {
      ok: true,
      scope: base,
      sellerScope: {
        scopeMode: "own",
        externalSellerId: null,
        externalSellerIds: [],
        responsible: null,
        sellerIdentityKey: null,
      },
    };
  }

  const ownName = auth.sellerResponsibleName?.trim() || null;
  const ownIdentityKey = resolveSellerIdentityKeyForAuth(auth);
  const ownMatch = crmCommercialSellerMatchFilters(
    auth.externalSellerId,
    ownName,
    ownIdentityKey
  );
  const ownIds = [
    ...new Set(
      [
        ...(Array.isArray(auth.externalSellerIds) ? auth.externalSellerIds : []),
        auth.externalSellerId,
      ].filter((id): id is number => id != null && Number.isFinite(id) && id > 0)
    ),
  ].sort((a, b) => a - b);

  return {
    ok: true,
    scope: base,
    sellerScope: {
      scopeMode: "own",
      externalSellerIds: ownIds,
      ...ownMatch,
    },
  };
}

/** SQL legado: match por vendedor Nomus do pedido (auditoria — não usar para escopo de carteira). */
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

/** @deprecated Preferir eixo CrmCustomerCommercialOwner. Mantido para scripts legados. */
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

/**
 * Cliente na carteira CRM = responsável comercial ativo.
 * Não inclui cliente só porque há pedido com vendedor Nomus do usuário.
 */
export async function isCustomerInCrmCommercialScope(
  customerId: string,
  scope: CrmCommercialAccessScope
): Promise<boolean> {
  if (scope.dataScope === "global") return true;
  if (scope.dataScope !== "own") return false;

  const manualRow = await prisma.crmCustomerCommercialOwner.findUnique({
    where: { customerId },
  });
  if (!manualRow?.isActive) return false;

  return manualCommercialOwnerMatchesSellerScope(
    {
      sellerIdentityKey: manualRow.sellerIdentityKey,
      sellerExternalId: manualRow.sellerExternalId,
      sellerResponsibleName: manualRow.sellerResponsibleName,
      sellerAliasExternalIds: Array.isArray(manualRow.sellerAliasExternalIds)
        ? (manualRow.sellerAliasExternalIds as number[])
        : [],
    },
    scope
  );
}
