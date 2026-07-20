import type { Prisma } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";
import { hasPermission } from "@/src/lib/auth/appAuth.shared.js";

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

/**
 * Escopo de dados de comissões.
 * - own = vendedor Nomus do pedido (`externalSellerId` / CommissionPerson SELLER)
 * - global = admin, commissions.seller.all ou role COMMERCIAL_MANAGER
 * Não usar carteira CRM (Responsável Comercial) como filtro de comissão.
 */
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

  if (hasPermission(auth, "commissions.seller.all") || auth.role === "COMMERCIAL_MANAGER") {
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
        blockedMessage:
          "Seu usuário não está vinculado a um vendedor Nomus. Peça ao administrador o vínculo em Usuários (nome + ID Nomus).",
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

  // Sem seller.own / seller.all: ter só commissions.view no menu NÃO abre visão global.
  return {
    dataScope: "none",
    sellerLocked: false,
    nomusSellerId: null,
    sellerResponsibleName: null,
    blockedReason: "FORBIDDEN",
    blockedMessage: "Sem permissão de escopo de comissões (próprias ou de todos).",
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
            scope.blockedMessage ??
            "Seu usuário não está vinculado a um vendedor Nomus.",
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

export function mergePrismaWhere<T extends Record<string, unknown>>(
  base: T,
  extra: T
): T {
  if (!base || Object.keys(base).length === 0) return extra;
  if (!extra || Object.keys(extra).length === 0) return base;
  return { AND: [base, extra] } as T;
}

export function applyCommissionPaymentBatchScope(
  scope: CommissionAccessScope
): Prisma.CommissionPaymentBatchWhereInput {
  if (scope.dataScope !== "own") return {};
  if (scope.nomusSellerId == null) return { id: { in: [] } };
  return {
    commissionPerson: {
      nomusPersonId: scope.nomusSellerId,
      type: "SELLER",
    },
  };
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
    and.push({ commissionPersonId: query.commissionPersonId });
  }

  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}
