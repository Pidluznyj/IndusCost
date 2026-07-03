import type express from "express";
import type { RequestHandler } from "express";
import { civilDateToLocalDate, toCivilDateKey } from "./financeCivilDate.js";
import { PRODUCTION_COST_TABLE_VIEW_PERMISSIONS } from "./productionCostTablesUi.js";
import { buildCostPriceMarginIntegratedAudit } from "./costPriceMarginIntegratedAudit.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

function parseOptionalInt(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePeriodFromQuery(query: express.Request["query"]): {
  from: Date;
  to: Date;
  label: string;
} {
  const fromArg = typeof query.from === "string" ? query.from.trim() : "";
  const toArg = typeof query.to === "string" ? query.to.trim() : "";
  const yearArg = parseOptionalInt(query.year);
  const monthArg = parseOptionalInt(query.month);

  if (fromArg && toArg) {
    const from = civilDateToLocalDate(fromArg);
    const to = new Date(`${toArg}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new Error("Datas inválidas — use from/to como YYYY-MM-DD.");
    }
    return { from, to, label: `${fromArg} a ${toArg}` };
  }

  const year = yearArg ?? new Date().getFullYear();
  if (year < 2000 || year > 2100) throw new Error("Ano inválido.");

  if (monthArg != null) {
    if (monthArg < 1 || monthArg > 12) throw new Error("Mês inválido (1-12).");
    const from = new Date(year, monthArg - 1, 1);
    const to = new Date(year, monthArg, 0, 23, 59, 59, 999);
    const mm = String(monthArg).padStart(2, "0");
    return { from, to, label: `${mm}/${year}` };
  }

  const from = new Date(year, 0, 1);
  const to = new Date(year, 11, 31, 23, 59, 59, 999);
  return { from, to, label: `ano ${year}` };
}

export function registerCostPriceMarginAuditRoutes(
  app: express.Express,
  deps: AuthGuards & { prisma: import("@prisma/client").PrismaClient }
): void {
  const { requireAppAuth, requireAnyPermission, prisma } = deps;

  app.get(
    "/api/cost-price-margin/audit",
    requireAppAuth,
    requireAnyPermission([
      ...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
      "pricing.view",
      "settings.price_tables.view",
    ]),
    async (req, res) => {
      try {
        const period = parsePeriodFromQuery(req.query);
        const seller =
          typeof req.query.seller === "string" && req.query.seller.trim()
            ? req.query.seller.trim()
            : undefined;
        const customer =
          typeof req.query.customer === "string" && req.query.customer.trim()
            ? req.query.customer.trim()
            : undefined;
        const sku =
          typeof req.query.sku === "string" && req.query.sku.trim()
            ? req.query.sku.trim()
            : undefined;
        const top = parseOptionalInt(req.query.top) ?? 10;

        const payload = await buildCostPriceMarginIntegratedAudit(prisma, {
          ...period,
          seller,
          customer,
          sku,
          top,
        });

        res.json({
          ...payload,
          period: {
            ...payload.period,
            from: toCivilDateKey(period.from) ?? payload.period.from,
            to: toCivilDateKey(period.to) ?? payload.period.to,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Erro na auditoria integrada.";
        console.error("GET /api/cost-price-margin/audit", error);
        res.status(400).json({ error: message });
      }
    }
  );
}
