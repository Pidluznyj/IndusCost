import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildSalesProductRanking, buildSoldProductsFilterOptions } from "@/src/lib/salesProductRanking.js";
import {
  SoldProductsFilterParseError,
  parseSalesProductRankingFilters,
} from "@/src/lib/salesProductRankingFilters.js";
import {
  buildSalesProductRankingExportWorkbook,
  soldProductsRankingExportFilename,
  soldProductsRankingWorkbookToBytes,
} from "@/src/lib/salesProductRankingExport.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const SOLD_PRODUCTS_VIEW_PERMISSIONS = [
  "sales_orders.view",
  "crm.view",
  "crm.general.view",
  "crm.seller.view",
  "crm.seller.own",
  "crm.seller.all",
  "reports.view",
  "dashboard.view",
] as const;

function resolveSellerScope(user: AppAuthContext) {
  const canSeeAll =
    user.effectivePermissions.includes("crm.seller.all") ||
    user.effectivePermissions.includes("crm.general.view") ||
    user.effectivePermissions.includes("sales_orders.view") ||
    user.effectivePermissions.includes("reports.view") ||
    user.effectivePermissions.includes("dashboard.view");

  if (canSeeAll) return undefined;

  if (user.effectivePermissions.includes("crm.seller.own")) {
    return {
      externalSellerId: user.externalSellerId,
      responsible: user.sellerResponsibleName,
    };
  }

  return undefined;
}

function parseFiltersOrRespond(res: express.Response, query: Record<string, unknown>) {
  try {
    return parseSalesProductRankingFilters(query);
  } catch (error) {
    if (error instanceof SoldProductsFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export function registerSalesProductRankingRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...SOLD_PRODUCTS_VIEW_PERMISSIONS])] as const;

  app.get("/api/commercial/sold-products/filter-options", ...guard, async (_req, res) => {
    try {
      const payload = await buildSoldProductsFilterOptions();
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commercial/sold-products/filter-options", error);
      return res.status(500).json({ error: "Não foi possível carregar opções de filtro." });
    }
  });

  app.get("/api/commercial/sold-products", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const parsed = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!parsed) return;

      const payload = await buildSalesProductRanking(req.query as Record<string, unknown>, {
        sellerScope: resolveSellerScope(user),
      });
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/commercial/sold-products", error);
      return res.status(500).json({ error: "Não foi possível carregar o relatório de produtos vendidos." });
    }
  });

  app.get("/api/commercial/sold-products/export.xlsx", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });

      const parsed = parseFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!parsed) return;

      const exportQuery = {
        ...(req.query as Record<string, unknown>),
        includeAllDetailRows: "true",
      };
      const payload = await buildSalesProductRanking(exportQuery, {
        sellerScope: resolveSellerScope(user),
      });
      const workbook = buildSalesProductRankingExportWorkbook(payload);
      const bytes = soldProductsRankingWorkbookToBytes(workbook);
      const filename = soldProductsRankingExportFilename();
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(bytes));
    } catch (error) {
      console.error("GET /api/commercial/sold-products/export.xlsx", error);
      return res.status(500).json({ error: "Não foi possível exportar o relatório." });
    }
  });
}
