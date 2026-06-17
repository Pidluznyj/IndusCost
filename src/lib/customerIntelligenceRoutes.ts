import type express from "express";
import type { RequestHandler } from "express";
import { buildCustomerIntelligenceReport } from "@/src/lib/customerIntelligence.js";
import {
  CustomerIntelligenceFilterParseError,
  parseCustomerIntelligenceFilters,
} from "@/src/lib/customerIntelligenceUtils.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.js";
import {
  normalizeCustomerDocument,
  salesOrderHasInvoicing,
  salesOrderMatchesCustomer,
} from "@/src/lib/customerCommercialSalesOrderView.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

export const CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS = [
  "crm.customer_cockpit.view",
  "customers.commercial360.view",
  "customers.view",
] as const;

function isUuidParam(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function parseFiltersOrRespond(res: express.Response, query: Record<string, unknown>) {
  try {
    return parseCustomerIntelligenceFilters(query);
  } catch (error) {
    if (error instanceof CustomerIntelligenceFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export async function loadCustomerIntelligenceData(customerId: string) {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      companyName: true,
      tradeName: true,
      taxId: true,
      city: true,
      state: true,
      accountOwner: true,
      createdAt: true,
    },
  });

  if (!customer) return null;

  const customerDoc = normalizeCustomerDocument(customer.taxId);

  const [salesOrdersRaw, activities, arLoadResult] = await Promise.all([
    prisma.salesOrder.findMany({
      where: customer.taxId
        ? {
            OR: [{ customerId }, { Customer: { taxId: customer.taxId } }],
          }
        : { customerId },
      include: {
        Customer: { select: { taxId: true } },
        items: {
          include: {
            Product: {
              select: { id: true, sku: true, name: true, type: true },
            },
          },
        },
      },
      orderBy: { issueDate: "desc" },
    }),
    prisma.commercialActivity.findMany({
      where: { customerId },
      select: {
        contactDate: true,
        createdAt: true,
        status: true,
        nextActionAt: true,
        description: true,
        subject: true,
        outcome: true,
      },
      orderBy: [{ contactDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    customerDoc
      ? loadFinanceArManagementRowsFromPrisma(prisma, { status: "all" })
      : Promise.resolve({ rows: [], syncCutoff: null }),
  ]);

  const orders = salesOrdersRaw
    .filter((order) =>
      salesOrderMatchesCustomer(order.customerId, customer, order.Customer?.taxId)
    )
    .map((order) => ({
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      issueDate: order.issueDate,
      updatedAt: order.updatedAt,
      responsible: order.responsible,
      totalNetValue: order.totalNetValue,
      totalMarginValue: order.totalMarginValue,
      totalMarginPerc: order.totalMarginPerc,
      hasInvoicing: salesOrderHasInvoicing(order.nomusRawResponse),
      items: order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        totalNetValue: item.totalNetValue,
        marginValue: item.marginValue,
        marginPerc: item.marginPerc,
        Product: item.Product,
      })),
    }));

  const arLinkedByCnpj = customerDoc.length > 0;

  return {
    customer,
    orders,
    activities,
    arRows: arLoadResult.rows,
    arSyncCutoff: arLoadResult.syncCutoff,
    arLinkedByCnpj,
  };
}

export function registerCustomerIntelligenceRoutes(app: express.Express, auth: AuthGuards) {
  const guard = [
    auth.requireAppAuth,
    auth.requireAnyPermission([...CUSTOMER_INTELLIGENCE_VIEW_PERMISSIONS]),
  ] as const;

  app.get("/api/crm/customers/:customerId/intelligence", ...guard, async (req, res) => {
    const { customerId } = req.params;
    if (!isUuidParam(customerId)) {
      return res.status(400).json({ error: "customerId inválido." });
    }

    const filters = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
    if (!filters) return;

    try {
      const loaded = await loadCustomerIntelligenceData(customerId);
      if (!loaded) {
        return res.status(404).json({ error: "Cliente não encontrado." });
      }

      const payload = buildCustomerIntelligenceReport({
        customer: loaded.customer,
        orders: loaded.orders,
        activities: loaded.activities,
        arRows: loaded.arRows,
        arSyncCutoff: loaded.arSyncCutoff,
        arLinkedByCnpj: loaded.arLinkedByCnpj,
        filters,
      });

      return res.json(payload);
    } catch (error) {
      console.error("GET /api/crm/customers/:customerId/intelligence", error);
      return res.status(500).json({ error: "Erro ao montar inteligência do cliente." });
    }
  });
}
