/**
 * CRM > Relatórios — rotas HTTP. Nenhuma escreve nada.
 *
 *   POST /api/crm/reports/operational         universo, cards e 3 listas paginadas
 *   POST /api/crm/reports/operational/export  lista inteira (CSV/XLSX), mesmo spec
 *   GET  /api/crm/reports/filter-options      metadados leves dos filtros
 *   GET  /api/crm/reports/customer-options    busca/rotulagem de clientes do escopo
 *   POST /api/crm/reports/custom              relatório personalizado (só ao "Gerar")
 *   POST /api/crm/reports/custom/export       relatório personalizado inteiro (CSV/XLSX)
 *
 * Leitura via POST onde `customerIds` pode ser grande.
 *
 * Guardas (nesta ordem): sessão → recurso oficial da aba Relatórios
 * (`commercial.crm.reports:view`, relacional `comercial.crm.tab.relatorios`)
 * → escopo comercial do CRM (`requireCrmCommercialDataScope`: global | own;
 * none → 403). O relatório só mostra dados já visíveis na carteira do
 * usuário — nunca amplia acesso.
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  requireCrmCommercialDataScope,
  type CrmCommercialAccessScope,
} from "@/src/lib/crmCommercialAccessScope.js";
import { COMMERCIAL_ACTIONS, COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import {
  parseCrmReportsCustomerOptionsQuery,
  parseCrmReportsOperationalRequest,
} from "@/src/lib/commercial/crmReportsOperationalCore.js";
import {
  CrmReportsCapacityError,
  CrmReportsForbiddenError,
  createPrismaCrmReportsDataSource,
  loadCrmReportsFilterOptions,
  loadCrmReportsOperational,
  searchCrmReportsCustomerOptions,
  type CrmReportsDataSource,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";
import {
  CrmCustomReportTooLargeError,
  parseCrmCustomReportRequest,
} from "@/src/lib/commercial/crmCustomReportCore.js";
import { loadCrmCustomReport } from "@/src/lib/commercial/crmCustomReportService.server.js";
import {
  exportCrmCustomReport,
  exportCrmReportsOperationalList,
  type CrmReportsExportFile,
} from "@/src/lib/commercial/crmReportsExportService.server.js";
import { isCrmReportsExportFormat } from "@/src/lib/commercial/crmReportsExport.js";
import { CRM_REPORTS_LIST_KEYS, type CrmReportsListKey } from "@/src/lib/commercial/crmReportsTypes.js";

export const CRM_REPORTS_OPERATIONAL_PATH = "/api/crm/reports/operational";
export const CRM_REPORTS_OPERATIONAL_EXPORT_PATH = "/api/crm/reports/operational/export";
export const CRM_REPORTS_FILTER_OPTIONS_PATH = "/api/crm/reports/filter-options";
export const CRM_REPORTS_CUSTOMER_OPTIONS_PATH = "/api/crm/reports/customer-options";
export const CRM_REPORTS_CUSTOM_PATH = "/api/crm/reports/custom";
export const CRM_REPORTS_CUSTOM_EXPORT_PATH = "/api/crm/reports/custom/export";

function sendExportFile(res: express.Response, file: CrmReportsExportFile): void {
  res.setHeader("Content-Type", file.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Export-Row-Count", String(file.rowCount));
  res.send(typeof file.body === "string" ? file.body : Buffer.from(file.body));
}

function readBodyField(body: unknown, field: string): unknown {
  return body != null && typeof body === "object" ? (body as Record<string, unknown>)[field] : undefined;
}

export type CrmReportsRoutesDeps = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
  prisma: PrismaClient;
  /** Injeção para testes; default = Prisma. */
  createDataSource?: (prisma: PrismaClient) => CrmReportsDataSource;
  /** Injeção para testes; default = relógio do servidor. */
  now?: () => Date;
};

type ScopedContext = {
  req: express.Request;
  res: express.Response;
  auth: AppAuthContext;
  scope: CrmCommercialAccessScope;
  dataSource: CrmReportsDataSource;
  now: Date | undefined;
};

export function registerCrmReportsRoutes(app: express.Application, deps: CrmReportsRoutesDeps): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = deps;
  const reportsGuard = () =>
    requireResource(COMMERCIAL_RESOURCE_KEYS.crmReports, COMMERCIAL_ACTIONS.view);

  /** Sessão → escopo CRM → handler; mapeia os erros conhecidos. */
  const scoped =
    (label: string, handler: (ctx: ScopedContext) => Promise<void>): RequestHandler =>
    async (req, res) => {
      try {
        const authUser = await getCurrentAppUser(req);
        if (!authUser) {
          res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
          return;
        }
        const scopeResult = requireCrmCommercialDataScope(authUser);
        if (scopeResult.ok === false) {
          res.status(scopeResult.status).json(scopeResult.body);
          return;
        }
        await handler({
          req,
          res,
          auth: authUser,
          scope: scopeResult.scope,
          dataSource: (deps.createDataSource ?? createPrismaCrmReportsDataSource)(deps.prisma),
          now: deps.now?.(),
        });
      } catch (error) {
        if (error instanceof CrmReportsForbiddenError) {
          res.status(403).json({ error: "FORBIDDEN", message: error.message });
          return;
        }
        if (error instanceof CrmReportsCapacityError) {
          res.status(422).json({
            error: "REPORT_UNIVERSE_TOO_LARGE",
            message: error.message,
            ordersLoaded: error.ordersLoaded,
            limit: error.limit,
          });
          return;
        }
        if (error instanceof CrmCustomReportTooLargeError) {
          res.status(422).json({ error: "REPORT_TOO_LARGE", message: error.message, limit: error.limit });
          return;
        }
        console.error(label, error);
        res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "Erro ao montar os relatórios do CRM.",
        });
      }
    };

  app.post(
    CRM_REPORTS_OPERATIONAL_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`POST ${CRM_REPORTS_OPERATIONAL_PATH}`, async ({ req, res, scope, dataSource, now }) => {
      const parsed = parseCrmReportsOperationalRequest(req.body);
      if (parsed.ok === false) {
        res.status(400).json({ error: "VALIDATION", message: parsed.errors.join(" "), details: parsed.errors });
        return;
      }
      res.json(await loadCrmReportsOperational(dataSource, scope, parsed.request, { now }));
    })
  );

  app.post(
    CRM_REPORTS_OPERATIONAL_EXPORT_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`POST ${CRM_REPORTS_OPERATIONAL_EXPORT_PATH}`, async ({ req, res, auth, scope, dataSource, now }) => {
      const list = readBodyField(req.body, "list");
      const format = readBodyField(req.body, "format");
      if (typeof list !== "string" || !(CRM_REPORTS_LIST_KEYS as readonly string[]).includes(list)) {
        res.status(400).json({ error: "VALIDATION", message: "list inválida: use recent, cadence ou overdue." });
        return;
      }
      if (!isCrmReportsExportFormat(format)) {
        res.status(400).json({ error: "VALIDATION", message: "format inválido: use csv ou xlsx." });
        return;
      }
      const parsed = parseCrmReportsOperationalRequest(req.body);
      if (parsed.ok === false) {
        res.status(400).json({ error: "VALIDATION", message: parsed.errors.join(" "), details: parsed.errors });
        return;
      }
      const file = await exportCrmReportsOperationalList({
        ds: dataSource,
        scope,
        auth,
        request: parsed.request,
        list: list as CrmReportsListKey,
        format,
        options: { now },
      });
      sendExportFile(res, file);
    })
  );

  app.post(
    CRM_REPORTS_CUSTOM_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`POST ${CRM_REPORTS_CUSTOM_PATH}`, async ({ req, res, scope, dataSource, now }) => {
      const parsed = parseCrmCustomReportRequest(req.body);
      if (parsed.ok === false) {
        res.status(400).json({ error: "VALIDATION", message: parsed.errors.join(" "), details: parsed.errors });
        return;
      }
      res.json(await loadCrmCustomReport(dataSource, scope, parsed.spec, { now }));
    })
  );

  app.post(
    CRM_REPORTS_CUSTOM_EXPORT_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`POST ${CRM_REPORTS_CUSTOM_EXPORT_PATH}`, async ({ req, res, auth, scope, dataSource, now }) => {
      const format = readBodyField(req.body, "format");
      if (!isCrmReportsExportFormat(format)) {
        res.status(400).json({ error: "VALIDATION", message: "format inválido: use csv ou xlsx." });
        return;
      }
      const parsed = parseCrmCustomReportRequest(req.body);
      if (parsed.ok === false) {
        res.status(400).json({ error: "VALIDATION", message: parsed.errors.join(" "), details: parsed.errors });
        return;
      }
      const file = await exportCrmCustomReport({ ds: dataSource, scope, auth, spec: parsed.spec, format, options: { now } });
      sendExportFile(res, file);
    })
  );

  app.get(
    CRM_REPORTS_FILTER_OPTIONS_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`GET ${CRM_REPORTS_FILTER_OPTIONS_PATH}`, async ({ res, scope, dataSource }) => {
      res.json(await loadCrmReportsFilterOptions(dataSource, scope));
    })
  );

  app.get(
    CRM_REPORTS_CUSTOMER_OPTIONS_PATH,
    requireAppAuth,
    reportsGuard(),
    scoped(`GET ${CRM_REPORTS_CUSTOMER_OPTIONS_PATH}`, async ({ req, res, scope, dataSource }) => {
      const parsed = parseCrmReportsCustomerOptionsQuery(req.query as Record<string, unknown>);
      if (parsed.ok === false) {
        res.status(400).json({ error: "VALIDATION", message: parsed.error });
        return;
      }
      res.json(await searchCrmReportsCustomerOptions(dataSource, scope, parsed));
    })
  );
}
