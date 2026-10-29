/**
 * Rotas HTTP — Inteligência Fiscal 360° (Financeiro › Tributos).
 *
 * Leitura (somente tabelas materializadas):
 *   GET  /api/finance/fiscal-360/overview | payments | payments/detail | reconciliation | ap-titles
 *        | documents | documents/:nomusNfeId | intercompany | forecast | processing | issues | audit
 *        | decisions | rules
 *   GET  /api/finance/fiscal-360/export?dataset=payments|documents|reconciliation|issues|ap-titles&format=xlsx|csv
 * Escrita (enfileira processamento; nunca altera Nomus):
 *   POST /api/finance/fiscal-360/decisions               (approve = conciliar | update = reclassificar)
 *   POST /api/finance/fiscal-360/decisions/:id/revoke
 *   POST /api/finance/fiscal-360/reprocess               (reprocess)
 *   POST /api/finance/fiscal-360/jobs/:id/retry|cancel   (execute = administrar jobs)
 *   POST /api/finance/fiscal-360/rules | rules/:id/activate | rules/:id/retire (manage = premissas)
 *   POST /api/finance/fiscal-360/forecast/preview | forecast/scenarios | forecast/scenarios/:id/archive (manage)
 * O botão "Atualizar" da UI só chama GETs: consulta o estado, não recalcula o histórico.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  buildFiscal360ExportSheet,
  FISCAL360_EXPORT_DATASETS,
  fiscal360SheetToCsv,
  fiscal360SheetToXlsx,
  type Fiscal360ExportDataset,
} from "./fiscal360Export.server.js";
import {
  getFiscal360DocumentDetail,
  getFiscal360Forecast,
  getFiscal360Intercompany,
  getFiscal360Overview,
  getFiscal360PaymentDetail,
  getFiscal360Processing,
  listFiscal360ApTitles,
  listFiscal360Audit,
  listFiscal360Decisions,
  listFiscal360Documents,
  listFiscal360Issues,
  listFiscal360Payments,
  listFiscal360Reconciliation,
  parseFiscal360Filters,
  parseFiscal360Page,
} from "./fiscal360QueryService.server.js";
import { FISCAL360_DECISION_PERMISSION, FISCAL360_DECISION_TYPES, type Fiscal360DecisionType } from "./fiscal360Types.js";
import {
  activateFiscal360RuleVersion,
  archiveFiscal360Scenario,
  cancelFiscal360Job,
  createFiscal360Decision,
  createFiscal360RuleVersion,
  listFiscal360RuleVersions,
  previewFiscal360Scenario,
  requestFiscal360Reprocess,
  retireFiscal360RuleVersion,
  retryFiscal360Job,
  revokeFiscal360Decision,
  saveFiscal360Scenario,
  type Fiscal360Actor,
} from "./fiscal360WriteService.server.js";

export const FISCAL360_RESOURCE_KEY = "finance.fiscal360" as const;

/** Ação do contrato por capacidade (ver permissionContract/resources.ts). */
export const FISCAL360_ACTIONS = {
  view: "view",
  export: "export",
  reconcile: "approve",
  reclassify: "update",
  assumptions: "manage",
  reprocess: "reprocess",
  jobs: "execute",
} as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

type RequestWithAuth = express.Request & {
  appAuth?: { userId?: string; name?: string; email?: string; role?: string; permissions?: string[] };
};

function actorFromReq(req: express.Request): Fiscal360Actor {
  const auth = (req as RequestWithAuth).appAuth;
  return { userId: auth?.userId ?? null, userName: auth?.name ?? auth?.email ?? null };
}

function sendError(res: express.Response, error: unknown, label: string): void {
  const status =
    typeof error === "object" && error && "status" in error && typeof (error as { status: unknown }).status === "number"
      ? (error as { status: number }).status
      : 500;
  if (status >= 500) console.error(`[fiscal-360] ${label}`, error instanceof Error ? error.message : error);
  const message = status >= 500 ? "Erro interno na Inteligência Fiscal 360°." : error instanceof Error ? error.message : "Requisição inválida.";
  res.status(status).json({ ok: false, error: message, message });
}

function q(req: express.Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

export function registerFiscal360Routes(app: express.Express, auth: AuthGuards): void {
  const guard = (action: string) => [auth.requireAppAuth, auth.requireResource(FISCAL360_RESOURCE_KEY, action)];
  const read = (path: string, handler: (req: express.Request) => Promise<unknown>) =>
    app.get(path, ...guard(FISCAL360_ACTIONS.view), async (req, res) => {
      try {
        const data = await handler(req);
        if (data == null) {
          res.status(404).json({ ok: false, error: "Registro não encontrado." });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, data });
      } catch (error) {
        sendError(res, error, `GET ${path}`);
      }
    });

  read("/api/finance/fiscal-360/overview", (req) => getFiscal360Overview(prisma, parseFiscal360Filters(q(req))));
  read("/api/finance/fiscal-360/payments", (req) => listFiscal360Payments(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req))));
  read("/api/finance/fiscal-360/payments/detail", (req) => getFiscal360PaymentDetail(prisma, String(req.query.anchorKey ?? "")));
  read("/api/finance/fiscal-360/reconciliation", (req) =>
    listFiscal360Reconciliation(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req)), typeof req.query.checkType === "string" && req.query.checkType ? req.query.checkType.toUpperCase() : null)
  );
  read("/api/finance/fiscal-360/ap-titles", (req) =>
    listFiscal360ApTitles(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req)), typeof req.query.classification === "string" && req.query.classification ? req.query.classification.toUpperCase() : null)
  );
  read("/api/finance/fiscal-360/documents", (req) => listFiscal360Documents(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req))));
  read("/api/finance/fiscal-360/documents/:nomusNfeId", (req) => getFiscal360DocumentDetail(prisma, req.params.nomusNfeId ?? ""));
  read("/api/finance/fiscal-360/intercompany", (req) => getFiscal360Intercompany(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req))));
  read("/api/finance/fiscal-360/forecast", (req) =>
    getFiscal360Forecast(prisma, parseFiscal360Filters(q(req)), typeof req.query.scenarioId === "string" && /^[\w-]{1,64}$/.test(req.query.scenarioId) ? req.query.scenarioId : null)
  );
  read("/api/finance/fiscal-360/processing", () => getFiscal360Processing(prisma));
  read("/api/finance/fiscal-360/issues", (req) =>
    listFiscal360Issues(prisma, parseFiscal360Filters(q(req)), parseFiscal360Page(q(req)), {
      issueType: typeof req.query.issueType === "string" && req.query.issueType ? req.query.issueType.toUpperCase() : null,
      issueStatus: typeof req.query.issueStatus === "string" ? req.query.issueStatus.toUpperCase() : null,
    })
  );
  read("/api/finance/fiscal-360/audit", (req) => listFiscal360Audit(prisma, parseFiscal360Page(q(req)), typeof req.query.entityType === "string" ? req.query.entityType : null));
  read("/api/finance/fiscal-360/decisions", (req) => listFiscal360Decisions(prisma, parseFiscal360Page(q(req)), req.query.active !== "0"));
  read("/api/finance/fiscal-360/rules", (req) => listFiscal360RuleVersions(prisma, typeof req.query.ruleKey === "string" ? req.query.ruleKey : null));

  app.get("/api/finance/fiscal-360/export", ...guard(FISCAL360_ACTIONS.export), async (req, res) => {
    try {
      const dataset = String(req.query.dataset ?? "payments") as Fiscal360ExportDataset;
      if (!FISCAL360_EXPORT_DATASETS.includes(dataset)) {
        res.status(400).json({ ok: false, error: "Conjunto de exportação inválido." });
        return;
      }
      const format = req.query.format === "csv" ? "csv" : "xlsx";
      const filters = parseFiscal360Filters(q(req));
      const sheet = await buildFiscal360ExportSheet(prisma, dataset, filters);
      const filename = `inteligencia-fiscal-360-${dataset}-${filters.fromMonth}-${filters.toMonth}.${format}`;
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.send(fiscal360SheetToCsv(sheet));
      } else {
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.send(fiscal360SheetToXlsx(sheet, filters, dataset));
      }
    } catch (error) {
      sendError(res, error, "GET export");
    }
  });

  const write = (method: "post", path: string, action: string, handler: (req: express.Request, actor: Fiscal360Actor) => Promise<unknown>) =>
    app[method](path, ...guard(action), async (req, res) => {
      try {
        const data = await handler(req, actorFromReq(req));
        res.json({ ok: true, data });
      } catch (error) {
        sendError(res, error, `${method.toUpperCase()} ${path}`);
      }
    });

  // Decisões: o guard de entrada exige "approve" OU "update"; a ação exata do tipo é conferida abaixo.
  const decisionGuards: Record<"reconcile" | "reclassify", RequestHandler> = {
    reconcile: auth.requireResource(FISCAL360_RESOURCE_KEY, FISCAL360_ACTIONS.reconcile),
    reclassify: auth.requireResource(FISCAL360_RESOURCE_KEY, FISCAL360_ACTIONS.reclassify),
  };
  app.post("/api/finance/fiscal-360/decisions", auth.requireAppAuth, (req, res, next) => {
    const type = String((req.body as Record<string, unknown> | undefined)?.decisionType ?? "") as Fiscal360DecisionType;
    if (!FISCAL360_DECISION_TYPES.includes(type)) {
      res.status(400).json({ ok: false, error: "Tipo de decisão inválido." });
      return;
    }
    decisionGuards[FISCAL360_DECISION_PERMISSION[type]](req, res, next);
  }, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const data = await createFiscal360Decision(
        prisma,
        {
          decisionType: body.decisionType as Fiscal360DecisionType,
          apExternalId: body.apExternalId == null ? null : Number(body.apExternalId),
          guideId: typeof body.guideId === "string" ? body.guideId : null,
          itemKey: typeof body.itemKey === "string" ? body.itemKey : null,
          payload: (body.payload ?? {}) as Record<string, unknown>,
          reason: String(body.reason ?? ""),
          evidence: (body.evidence ?? null) as Record<string, unknown> | null,
        },
        actorFromReq(req)
      );
      res.json({ ok: true, data });
    } catch (error) {
      sendError(res, error, "POST decisions");
    }
  });
  app.post("/api/finance/fiscal-360/decisions/:id/revoke", auth.requireAppAuth, async (req, res, next) => {
    try {
      const decision = await prisma.fiscalReconciliationDecision.findUnique({ where: { id: String(req.params.id) }, select: { decisionType: true } });
      if (!decision) {
        res.status(404).json({ ok: false, error: "Decisão não encontrada." });
        return;
      }
      decisionGuards[FISCAL360_DECISION_PERMISSION[decision.decisionType as Fiscal360DecisionType] ?? "reconcile"](req, res, next);
    } catch (error) {
      sendError(res, error, "POST revoke guard");
    }
  }, async (req, res) => {
    try {
      res.json({ ok: true, data: await revokeFiscal360Decision(prisma, String(req.params.id), (req.body as Record<string, unknown> | undefined)?.reason, actorFromReq(req)) });
    } catch (error) {
      sendError(res, error, "POST revoke");
    }
  });

  write("post", "/api/finance/fiscal-360/reprocess", FISCAL360_ACTIONS.reprocess, (req, actor) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return requestFiscal360Reprocess(
      prisma,
      {
        scope: String(body.scope ?? "") as never,
        companyCnpj: typeof body.companyCnpj === "string" ? body.companyCnpj : null,
        fromMonth: typeof body.fromMonth === "string" ? body.fromMonth : null,
        toMonth: typeof body.toMonth === "string" ? body.toMonth : null,
        ids: Array.isArray(body.ids) ? (body.ids as Array<string | number>) : [],
        reason: String(body.reason ?? ""),
      },
      actor
    );
  });
  write("post", "/api/finance/fiscal-360/jobs/:id/retry", FISCAL360_ACTIONS.jobs, (req, actor) => retryFiscal360Job(prisma, String(req.params.id), actor));
  write("post", "/api/finance/fiscal-360/jobs/:id/cancel", FISCAL360_ACTIONS.jobs, (req, actor) => cancelFiscal360Job(prisma, String(req.params.id), actor));
  write("post", "/api/finance/fiscal-360/rules", FISCAL360_ACTIONS.assumptions, (req, actor) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return createFiscal360RuleVersion(
      prisma,
      {
        ruleKey: String(body.ruleKey ?? ""),
        parameters: body.parameters,
        effectiveFrom: typeof body.effectiveFrom === "string" ? body.effectiveFrom : null,
        effectiveTo: typeof body.effectiveTo === "string" ? body.effectiveTo : null,
        normativeSource: typeof body.normativeSource === "string" ? body.normativeSource : null,
        description: typeof body.description === "string" ? body.description : null,
      },
      actor
    );
  });
  write("post", "/api/finance/fiscal-360/rules/:id/activate", FISCAL360_ACTIONS.assumptions, (req, actor) => activateFiscal360RuleVersion(prisma, String(req.params.id), actor));
  write("post", "/api/finance/fiscal-360/rules/:id/retire", FISCAL360_ACTIONS.assumptions, (req, actor) => retireFiscal360RuleVersion(prisma, String(req.params.id), actor));
  // Pré-visualização: leitura sobre agregados persistidos; exige "view" (não grava nada).
  write("post", "/api/finance/fiscal-360/forecast/preview", FISCAL360_ACTIONS.view, (req) => previewFiscal360Scenario(prisma, (req.body as Record<string, unknown> | undefined)?.assumptions));
  write("post", "/api/finance/fiscal-360/forecast/scenarios", FISCAL360_ACTIONS.assumptions, (req, actor) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    return saveFiscal360Scenario(prisma, { name: body.name, description: body.description, assumptions: body.assumptions }, actor);
  });
  write("post", "/api/finance/fiscal-360/forecast/scenarios/:id/archive", FISCAL360_ACTIONS.assumptions, (req, actor) => archiveFiscal360Scenario(prisma, String(req.params.id), actor));
}
