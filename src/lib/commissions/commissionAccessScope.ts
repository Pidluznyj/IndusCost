import type { Prisma } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { hasPermission } from "@/src/lib/appAuth.js";

export type CommissionDataScope = "global" | "own" | "none";

export type CommissionAccessScope = {
  dataScope: CommissionDataScope;
  sellerLocked: boolean;
  nomusSellerId: number | null;
  sellerResponsibleName: string | null;
  blockedReason: "SELLER_NOT_LINKED" | "FORBIDDEN" | null;
  blockedMessage: string | null;
};

export type CommissionAccessScopeResult =
  | { ok: true; scope: CommissionAccessScope }
  | {
      ok: false;
      status: 403;
      body: { error: string; message: string; requiredPermissions?: string[] };
    };

function isAdminRole(auth: AppAuthContext): boolean {
  return auth.role === "SUPER_ADMIN" || auth.role === "ADMIN";
}

function isSellerLinked(auth: AppAuthContext): boolean {
  return auth.externalSellerId != null || Boolean(auth.sellerResponsibleName?.trim());
}

export function resolveCommissionAccessScope(auth: AppAuthContext): CommissionAccessScope {
  if (isAdminRole(auth)) {
    return {
      dataScope: "global",
      sellerLocked: false,
      nomusSellerId: null,
      sellerResponsibleName: null,
      blockedReason: null,
      blockedMessage: null,
    };
  }

  if (hasPermission(auth, "commissions.seller.all")) {
    return {
      dataScope: "global",
      sellerLocked: false,
      nomusSellerId: null,
      sellerResponsibleName: null,
      blockedReason: null,
      blockedMessage: null,
    };
  }

  const canViewOwn =
    hasPermission(auth, "commissions.seller.own") || auth.role === "SELLER";

  if (canViewOwn) {
    if (!isSellerLinked(auth)) {
      return {
        dataScope: "none",
        sellerLocked: true,
        nomusSellerId: null,
        sellerResponsibleName: null,
        blockedReason: "SELLER_NOT_LINKED",
        blockedMessage: "Seu usuário não está vinculado a um vendedor Nomus.",
      };
    }
    return {
      dataScope: "own",
      sellerLocked: true,
      nomusSellerId: auth.externalSellerId,
      sellerResponsibleName: auth.sellerResponsibleName?.trim() || null,
      blockedReason: null,
      blockedMessage: null,
    };
  }

  const canViewGlobalAnalysis =
    hasPermission(auth, "commissions.view") ||
    hasPermission(auth, "commissions.dashboard.view") ||
    hasPermission(auth, "commissions.forecast.view") ||
    hasPermission(auth, "commissions.confirmed.view") ||
    hasPermission(auth, "commissions.release.view") ||
    hasPermission(auth, "commissions.payments.view") ||
    hasPermission(auth, "commissions.audit.view");

  if (canViewGlobalAnalysis) {
    return {
      dataScope: "global",
      sellerLocked: false,
      nomusSellerId: null,
      sellerResponsibleName: null,
      blockedReason: null,
      blockedMessage: null,
    };
  }

  return {
    dataScope: "none",
    sellerLocked: false,
    nomusSellerId: null,
    sellerResponsibleName: null,
    blockedReason: "FORBIDDEN",
    blockedMessage: "Permissão insuficiente para consultar comissões.",
  };
}

export function requireCommissionDataScope(
  auth: AppAuthContext
): CommissionAccessScopeResult {
  const scope = resolveCommissionAccessScope(auth);
  if (scope.dataScope === "none") {
    if (scope.blockedReason === "SELLER_NOT_LINKED") {
      return {
        ok: false,
        status: 403,
        body: {
          error: "SELLER_NOT_LINKED",
          message:
            scope.blockedMessage ?? "Seu usuário não está vinculado a um vendedor Nomus.",
        },
      };
    }
    return {
      ok: false,
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: scope.blockedMessage ?? "Permissão insuficiente para comissões.",
        requiredPermissions: [
          "commissions.view",
          "commissions.seller.own",
          "commissions.seller.all",
        ],
      },
    };
  }
  return { ok: true, scope };
}

export function parseOptionalInt(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

export function parseOptionalUuid(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  ) {
    return null;
  }
  return v;
}

export function applyCommissionRecordScope(
  scope: CommissionAccessScope,
  query: {
    sellerId?: number | null;
    representativeId?: number | null;
    commissionPersonId?: string | null;
  }
): Prisma.CommissionRecordWhereInput {
  const and: Prisma.CommissionRecordWhereInput[] = [];

  if (scope.dataScope === "own") {
    const sellerFilters: Prisma.CommissionRecordWhereInput[] = [];
    if (scope.nomusSellerId != null) {
      sellerFilters.push({ nomusSellerId: scope.nomusSellerId });
      sellerFilters.push({
        commissionPerson: { nomusPersonId: scope.nomusSellerId, type: "SELLER" },
      });
    }
    if (sellerFilters.length === 0) {
      and.push({ id: { in: [] } });
    } else {
      and.push({ OR: sellerFilters });
    }
  } else if (query.sellerId != null) {
    and.push({ nomusSellerId: query.sellerId });
  }

  if (query.representativeId != null) {
    and.push({ nomusRepresentativeId: query.representativeId });
  }

  if (query.commissionPersonId) {
    if (scope.dataScope === "own") {
      and.push({ commissionPersonId: query.commissionPersonId });
    } else {
      and.push({ commissionPersonId: query.commissionPersonId });
    }
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}
