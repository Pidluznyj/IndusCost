import type express from "express";
import type { RequestHandler } from "express";
import {
  buildFinanceArOverdueExportWorkbook,
  financeArOverdueExportFilename,
  financeArOverdueWorkbookToBytes,
} from "./financeAccountsReceivableOverdueExport.js";
import {
  buildOfficialAccountsReceivableOverduePayload,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  FinanceArOverdueFilterParseError,
  parseFinanceArOverdueFilters,
} from "./financeAccountsReceivableOverdue.js";
import { loadFinanceArManagementRowsFromPrisma } from "./financeAccountsReceivableManagement.js";
import type { FinanceArDashboardFilters } from "./financeAccountsReceivableDashboard.js";
import { prisma } from "./prisma.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "./financeModulesAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

async function loadFinanceArOverdueRows(filters: FinanceArDashboardFilters) {
  return loadFinanceArManagementRowsFromPrisma(prisma, { ...filters, status: "all" });
}

function parseOverdueFiltersOrRespond(res: express.Response, query: Record<string, unknown>) {
  try {
    return parseFinanceArOverdueFilters(query);
  } catch (error) {
    if (error instanceof FinanceArOverdueFilterParseError) {
      res.status(400).json({ error: error.message });
      return null;
    }
    throw error;
  }
}

export function registerFinanceAccountsReceivableOverdueRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const guard = [
    auth.requireAppAuth,
    auth.requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
      FINANCE_MODULE_ACTIONS.view
    ),
  ] as const;
  const exportGuard = [
    auth.requireAppAuth,
    auth.requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
      FINANCE_MODULE_ACTIONS.export
    ),
  ] as const;

  app.get("/api/finance/accounts-receivable/overdue", ...guard, async (req, res) => {
    try {
      const filters = parseOverdueFiltersOrRespond(res, req.query as Record<string, unknown>);
      if (!filters) return;
      const { rows, syncCutoff } = await loadFinanceArOverdueRows(filters);
      const payload = buildOfficialAccountsReceivableOverduePayload(rows, filters, new Date(), syncCutoff);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/accounts-receivable/overdue", error);
      return res.status(500).json({ error: "Erro ao montar relatório de atrasados." });
    }
  });

  app.get(
    "/api/finance/accounts-receivable/overdue/export.xlsx",
    ...exportGuard,
    async (req, res) => {
      try {
        const filters = parseOverdueFiltersOrRespond(res, req.query as Record<string, unknown>);
        if (!filters) return;
        const { rows, syncCutoff } = await loadFinanceArOverdueRows(filters);
        const fullPayload = buildOfficialAccountsReceivableOverduePayload(
          rows,
          { ...filters, page: 1, limit: 5000 },
          new Date(),
          syncCutoff,
          { paginate: false }
        );
        const workbook = buildFinanceArOverdueExportWorkbook(fullPayload, fullPayload.overdueTitles);
        const bytes = financeArOverdueWorkbookToBytes(workbook);
        const filename = financeArOverdueExportFilename();
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.send(Buffer.from(bytes));
      } catch (error) {
        console.error("GET /api/finance/accounts-receivable/overdue/export.xlsx", error);
        return res.status(500).json({ error: "Erro ao exportar atrasados." });
      }
    }
  );
}
