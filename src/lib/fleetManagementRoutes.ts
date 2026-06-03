import type express from "express";
import { hasPermission, type AppAuthContext } from "@/src/lib/appAuth.js";
import { FleetValidationError } from "@/src/lib/fleetValidation.js";
import { writeFleetAuditLog } from "@/src/lib/fleetService.js";
import { buildFleetFinancialDashboard, maskFinancialData } from "@/src/lib/fleetFinancialOps.js";
import { getFleetAlerts } from "@/src/lib/fleetAlertsService.js";
import {
  buildFleetDashboardCards,
  FLEET_EDITABLE_SETTINGS_KEYS,
  fleetReportToCsv,
  parseFleetReportFilters,
  reportCosts,
  reportDocuments,
  reportFleet,
  reportMaintenance,
  reportUsage,
} from "@/src/lib/fleetManagementOps.js";
import { loadFleetSettings } from "@/src/lib/fleetService.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildFleetListResponse,
  fleetListMeta,
  paginateInMemory,
  parseFleetListQuery,
} from "@/src/lib/fleetListQuery.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (p: string) => express.RequestHandler;
  requireAnyPermission: (ps: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function fleetError(res: express.Response, e: unknown, label: string) {
  if (e instanceof FleetValidationError) return res.status(400).json({ error: e.message });
  console.error(label, e);
  return res.status(500).json({ error: e instanceof Error ? e.message : "Erro interno." });
}

async function showFinancial(req: express.Request, getUser: AuthGuards["getCurrentAppUser"]) {
  const u = await getUser(req);
  return u ? hasPermission(u, "fleet.financial.view") || hasPermission(u, "fleet.manage") : false;
}

function sendReport(
  res: express.Response,
  name: string,
  rows: Record<string, unknown>[],
  format: string,
  list?: ReturnType<typeof parseFleetListQuery>
) {
  if (format === "csv") {
    const csv = fleetReportToCsv(name, rows);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${name}-${Date.now()}.csv`);
    return res.send(csv);
  }
  if (list) {
    const { items, meta } = paginateInMemory(rows, list.page, list.limit);
    return res.json({
      ...buildFleetListResponse("rows", items, meta),
      count: meta.total,
    });
  }
  return res.json({ rows, items: rows, count: rows.length });
}

export function registerFleetManagementRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, getCurrentAppUser } = auth;
  const fleetView = [requireAppAuth, requirePermission("fleet.view")] as express.RequestHandler[];
  const fleetSettingsManage = [requireAppAuth, requirePermission("fleet.settings.manage")] as express.RequestHandler[];

  app.get("/api/fleet/alerts", ...fleetView, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      const showFinancial =
        user != null &&
        (hasPermission(user, "fleet.financial.view") || hasPermission(user, "fleet.manage"));
      const level = String(req.query.level ?? "").trim();
      const result = await getFleetAlerts({ showFinancial, level: level || undefined });
      res.json(result);
    } catch (e) {
      fleetError(res, e, "GET /api/fleet/alerts");
    }
  });

  const reportHandler =
    (
      name: string,
      load: (filters: ReturnType<typeof parseFleetReportFilters>, fin: boolean) => Promise<Record<string, unknown>[]>
    ) =>
    async (req: express.Request, res: express.Response) => {
      try {
        const filters = parseFleetReportFilters(req.query as Record<string, unknown>);
        const format = String(req.query.format ?? "").trim().toLowerCase();
        const list = parseFleetListQuery(req.query as Record<string, unknown>);
        const fin = await showFinancial(req, getCurrentAppUser);
        const rows = await load(filters, fin);
        sendReport(res, name, rows, format, format === "csv" ? undefined : list);
      } catch (e) {
        fleetError(res, e, `GET /api/fleet/reports/${name}`);
      }
    };

  app.get("/api/fleet/reports/fleet", ...fleetView, reportHandler("fleet", async (f) => reportFleet(f)));
  app.get("/api/fleet/reports/usage", ...fleetView, reportHandler("usage", async (f) => reportUsage(f)));
  app.get(
    "/api/fleet/reports/costs",
    ...fleetView,
    reportHandler("costs", async (f, fin) => reportCosts(f, fin) as Promise<Record<string, unknown>[]>)
  );
  app.get(
    "/api/fleet/reports/maintenance",
    ...fleetView,
    reportHandler("maintenance", async (f, fin) => reportMaintenance(f, fin))
  );
  app.get(
    "/api/fleet/reports/documents",
    ...fleetView,
    reportHandler("documents", async (f) => reportDocuments(f))
  );
}

export async function saveFleetSettingsWithAudit(
  items: { key: string; value: string; description?: string | null }[],
  userId: string | null
) {
  for (const item of items) {
    const key = item.key.trim();
    if (!key || !FLEET_EDITABLE_SETTINGS_KEYS.includes(key as (typeof FLEET_EDITABLE_SETTINGS_KEYS)[number])) {
      continue;
    }
    const existing = await prisma.fleetSettings.findUnique({ where: { key } });
    const value = typeof item.value === "string" ? item.value : String(item.value ?? "");
    if (existing && existing.value === value) continue;

    const row = await prisma.fleetSettings.upsert({
      where: { key },
      create: { key, value, description: item.description ?? null, updatedBy: userId },
      update: { value, updatedBy: userId },
    });

    await writeFleetAuditLog({
      entityType: "FleetSettings",
      entityId: row.id,
      action: "UPDATE",
      oldValue: existing?.value ?? null,
      newValue: value,
      userId,
    });
  }

  return prisma.fleetSettings.findMany({ orderBy: { key: "asc" } });
}

export async function getFleetDashboardPayload(showFinancial: boolean) {
  const settings = await loadFleetSettings();
  const [cards, { alerts }, financial] = await Promise.all([
    buildFleetDashboardCards(settings),
    getFleetAlerts({ showFinancial, settings }),
    buildFleetFinancialDashboard(),
  ]);
  return {
    cards,
    alerts,
    financial: maskFinancialData(financial, showFinancial),
  };
}
