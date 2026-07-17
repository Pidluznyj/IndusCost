/**
 * DS-04.4 — Escopo comercial oficial para Documentos de Saída.
 * Reutiliza `getCommercialAccessScope` / carteira CRM — não inventa regra de vendedor.
 * SUPER_ADMIN / ADMIN → global (bypass).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  getCommercialAccessScope,
  loadCommercialCrmScope,
  type CommercialAccessScope,
} from "@/src/lib/commercial/commercialAccessScopeService.js";

type PrismaLike = Pick<
  PrismaClient,
  "salesOrderNfeLink" | "orderToCashAuditFact" | "salesOrder"
>;

export type OutputDocumentsScopeDecision =
  | { ok: true; mode: "unrestricted"; scope: CommercialAccessScope }
  | {
      ok: true;
      mode: "own_portfolio";
      scope: CommercialAccessScope;
      allowedCustomerIds: string[];
    }
  | {
      ok: false;
      status: 403;
      body: { error: string; code: string };
      scope: CommercialAccessScope;
    };

/**
 * Resolve escopo para listagem/detalhe de Documentos de Saída.
 */
export async function resolveOutputDocumentsAccessScope(
  user: AppAuthContext,
  _prisma: PrismaLike
): Promise<OutputDocumentsScopeDecision> {
  const scope = getCommercialAccessScope(user);

  if (scope.mode === "unrestricted") {
    return { ok: true, mode: "unrestricted", scope };
  }

  if (scope.mode === "none") {
    return {
      ok: false,
      status: 403,
      body: {
        error: scope.blockedMessage ?? "Acesso comercial negado.",
        code: "OUTPUT_DOCUMENTS_SCOPE_DENIED",
      },
      scope,
    };
  }

  const crm = await loadCommercialCrmScope(user);
  if (crm.denied) {
    return {
      ok: false,
      status: 403,
      body: {
        error: crm.reason ?? "Acesso comercial negado.",
        code: "OUTPUT_DOCUMENTS_SCOPE_DENIED",
      },
      scope,
    };
  }

  return {
    ok: true,
    mode: "own_portfolio",
    scope,
    allowedCustomerIds: [...crm.allowedCustomerIds],
  };
}

export type OutputDocumentsPortfolioKeys = {
  nfeIds: number[];
  externalIds: number[];
};

/**
 * Chaves de documentos ligados a pedidos da carteira (NFe link + O2C).
 */
export async function loadOutputDocumentsPortfolioKeys(
  prisma: PrismaLike,
  allowedCustomerIds: readonly string[]
): Promise<OutputDocumentsPortfolioKeys> {
  if (allowedCustomerIds.length === 0) {
    return { nfeIds: [], externalIds: [] };
  }

  const orders = await prisma.salesOrder.findMany({
    where: { customerId: { in: [...allowedCustomerIds] } },
    select: { id: true },
    take: 10_000,
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) {
    return { nfeIds: [], externalIds: [] };
  }

  const [links, o2cByOrder, o2cByCustomer] = await Promise.all([
    prisma.salesOrderNfeLink.findMany({
      where: { salesOrderId: { in: orderIds } },
      select: { nfeExternalId: true },
      take: 20_000,
    }),
    prisma.orderToCashAuditFact.findMany({
      where: {
        salesOrderId: { in: orderIds },
        stockDocumentExternalId: { not: null },
      },
      select: { stockDocumentExternalId: true },
      take: 20_000,
    }),
    prisma.orderToCashAuditFact.findMany({
      where: {
        customerId: { in: [...allowedCustomerIds] },
        stockDocumentExternalId: { not: null },
      },
      select: { stockDocumentExternalId: true },
      take: 20_000,
    }),
  ]);

  const externalIds = new Set<number>();
  for (const row of [...o2cByOrder, ...o2cByCustomer]) {
    if (row.stockDocumentExternalId != null && row.stockDocumentExternalId > 0) {
      externalIds.add(row.stockDocumentExternalId);
    }
  }

  return {
    nfeIds: [...new Set(links.map((l) => l.nfeExternalId))],
    externalIds: [...externalIds],
  };
}

export function portfolioKeysToDocumentWhere(
  keys: OutputDocumentsPortfolioKeys
): Prisma.NomusStockDocumentWhereInput {
  if (keys.nfeIds.length === 0 && keys.externalIds.length === 0) {
    return { id: { in: [] } };
  }
  return {
    OR: [
      ...(keys.externalIds.length
        ? [{ externalId: { in: keys.externalIds } }]
        : []),
      ...(keys.nfeIds.length ? [{ idNfe: { in: keys.nfeIds } }] : []),
    ],
  };
}

/**
 * Verifica se um documento (já resolvido) está na carteira do usuário.
 */
export async function isOutputDocumentInPortfolio(
  prisma: PrismaLike,
  args: {
    allowedCustomerIds: readonly string[];
    idNfe: number | null;
    externalId: number;
    linkedSalesOrderIds: readonly string[];
  }
): Promise<boolean> {
  if (args.allowedCustomerIds.length === 0) return false;

  const orderIds = [...new Set(args.linkedSalesOrderIds.filter(Boolean))];
  if (orderIds.length > 0) {
    const hit = await prisma.salesOrder.count({
      where: {
        id: { in: orderIds },
        customerId: { in: [...args.allowedCustomerIds] },
      },
    });
    if (hit > 0) return true;
  }

  if (args.idNfe != null) {
    const linkHit = await prisma.salesOrderNfeLink.count({
      where: {
        nfeExternalId: args.idNfe,
        SalesOrder: { customerId: { in: [...args.allowedCustomerIds] } },
      },
    });
    if (linkHit > 0) return true;
  }

  const o2cRows = await prisma.orderToCashAuditFact.findMany({
    where: {
      stockDocumentExternalId: args.externalId,
      salesOrderId: { not: null },
    },
    select: { salesOrderId: true },
    take: 500,
  });
  const o2cOrderIds = [
    ...new Set(
      o2cRows
        .map((r) => r.salesOrderId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (o2cOrderIds.length === 0) return false;

  const o2cHit = await prisma.salesOrder.count({
    where: {
      id: { in: o2cOrderIds },
      customerId: { in: [...args.allowedCustomerIds] },
    },
  });
  return o2cHit > 0;
}
