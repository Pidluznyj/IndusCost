/**
 * Rotas do painel "Pedidos de Compra Nomus" (Configurações › Sincronização Nomus).
 *
 * Permissões (recurso admin.settings.nomus_sync):
 *   - view    → status, execuções, detalhe de execução, pedidos ausentes;
 *   - execute → incremental manual e prévia de reconciliação (sem escrita de presença);
 *   - autorizar ausências → execute + Super Admin + frase de confirmação (grava presença).
 * Sem sessão: 401; sem permissão: 403 (requireBootstrapOrResource / checagem de papel).
 */
import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import { ADMIN_SETTINGS_ACTIONS, ADMIN_SETTINGS_RESOURCE_KEYS } from "./adminSettingsAccess.js";
import { NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE } from "./nomus/nomusPurchaseOrderSyncHealth.js";
import {
  NomusPurchaseOrdersSyncConflictError,
  getNomusPurchaseOrderSyncRun,
  getNomusPurchaseOrdersSyncStatus,
  listNomusPurchaseOrderSyncRuns,
  listNomusPurchaseOrdersMissing,
  startNomusPurchaseOrdersSync,
  type NomusPurchaseOrdersSyncStartKind,
} from "./nomusPurchaseOrdersSyncRunner.js";

export const NOMUS_PO_ADMIN_ROUTES = {
  status: "/api/settings/nomus-sync/purchase-orders-status",
  runs: "/api/settings/nomus-sync/purchase-orders-runs",
  runDetail: "/api/settings/nomus-sync/purchase-orders-runs/:id",
  missing: "/api/settings/nomus-sync/purchase-orders-missing",
  run: "/api/settings/nomus-sync/purchase-orders-run",
  reconcilePreview: "/api/settings/nomus-sync/purchase-orders-reconcile-preview",
  reconcileApply: "/api/settings/nomus-sync/purchase-orders-reconcile-apply",
} as const;

type Guards = {
  requireBootstrapOrResource: (
    isBootstrap: (req: express.Request) => boolean,
    resourceKey: string,
    action?: string
  ) => RequestHandler;
  isBootstrapAdminRequest?: (req: express.Request) => boolean;
};

type RequestWithAuth = express.Request & { appAuth?: { id?: string; email?: string; role?: string } | null };

function requestedByOf(req: express.Request): string | null {
  const auth = (req as RequestWithAuth).appAuth;
  return auth?.email ?? auth?.id ?? null;
}

/** Autorizar ausências: Super Admin (ou bootstrap). Roda depois do guard de execute. */
export function createPurchaseOrderAuthorizeGuard(isBootstrap: (req: express.Request) => boolean): RequestHandler {
  return (req, res, next) => {
    if (process.env.NODE_ENV === "test" && process.env.REQUIRE_RESOURCE_STRICT !== "1") return next();
    if (isBootstrap(req)) return next();
    const auth = (req as RequestWithAuth).appAuth;
    if (!auth) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
    }
    if (String(auth.role ?? "").toUpperCase() !== "SUPER_ADMIN") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Somente Super Admin pode autorizar a gravação de ausências de Pedidos de Compra.",
      });
    }
    return next();
  };
}

export function registerNomusPurchaseOrdersSyncAdminRoutes(
  app: express.Express,
  guards: Guards,
  deps: { prisma: PrismaClient; projectRoot?: () => string }
) {
  const isBootstrap = guards.isBootstrapAdminRequest ?? (() => false);
  const view = guards.requireBootstrapOrResource(
    isBootstrap,
    ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
    ADMIN_SETTINGS_ACTIONS.view
  );
  const execute = guards.requireBootstrapOrResource(
    isBootstrap,
    ADMIN_SETTINGS_RESOURCE_KEYS.nomusSync,
    ADMIN_SETTINGS_ACTIONS.execute
  );
  const authorize = createPurchaseOrderAuthorizeGuard(isBootstrap);
  const projectRoot = deps.projectRoot ?? (() => process.env.INDUSCOST_APP_DIR || process.cwd());

  app.get(NOMUS_PO_ADMIN_ROUTES.status, view, async (_req, res) => {
    try {
      return res.json(await getNomusPurchaseOrdersSyncStatus(deps.prisma));
    } catch (error) {
      console.error(`GET ${NOMUS_PO_ADMIN_ROUTES.status}:`, error);
      return res.status(500).json({ error: "Erro ao consultar status de Pedidos de Compra Nomus." });
    }
  });

  app.get(NOMUS_PO_ADMIN_ROUTES.runs, view, async (req, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? "50"), 10) || 50;
      const statusRaw = String(req.query.status ?? "").trim().toUpperCase();
      const status = ["RUNNING", "SUCCESS", "FAILED", "INCONCLUSIVE", "SKIPPED"].includes(statusRaw) ? statusRaw : null;
      return res.json({ runs: await listNomusPurchaseOrderSyncRuns(deps.prisma, { limit, status }) });
    } catch (error) {
      console.error(`GET ${NOMUS_PO_ADMIN_ROUTES.runs}:`, error);
      return res.status(500).json({ error: "Erro ao listar execuções de Pedidos de Compra Nomus." });
    }
  });

  app.get(NOMUS_PO_ADMIN_ROUTES.runDetail, view, async (req, res) => {
    try {
      const id = String(req.params.id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Identificador de execução inválido." });
      const detail = await getNomusPurchaseOrderSyncRun(deps.prisma, id);
      if (!detail) return res.status(404).json({ error: "Execução não encontrada." });
      return res.json(detail);
    } catch (error) {
      console.error(`GET ${NOMUS_PO_ADMIN_ROUTES.runDetail}:`, error);
      return res.status(500).json({ error: "Erro ao consultar execução de Pedidos de Compra Nomus." });
    }
  });

  app.get(NOMUS_PO_ADMIN_ROUTES.missing, view, async (req, res) => {
    try {
      const raw = String(req.query.status ?? "").trim().toUpperCase();
      const status = raw === "MISSING_CANDIDATE" || raw === "MISSING_CONFIRMED" ? raw : null;
      return res.json({ orders: await listNomusPurchaseOrdersMissing(deps.prisma, { status }) });
    } catch (error) {
      console.error(`GET ${NOMUS_PO_ADMIN_ROUTES.missing}:`, error);
      return res.status(500).json({ error: "Erro ao listar pedidos ausentes no Nomus." });
    }
  });

  const start =
    (kind: NomusPurchaseOrdersSyncStartKind): RequestHandler =>
    async (req, res) => {
      try {
        const result = await startNomusPurchaseOrdersSync(projectRoot(), { kind, requestedBy: requestedByOf(req) });
        return res.status(202).json(result);
      } catch (error) {
        if (error instanceof NomusPurchaseOrdersSyncConflictError) {
          return res.status(409).json({
            error: error.message,
            message: "Já existe uma sincronização de Pedidos de Compra em andamento. Aguarde finalizar.",
          });
        }
        console.error(`POST pedidos de compra (${kind}):`, error);
        return res.status(500).json({
          error: "Não foi possível iniciar a sincronização de Pedidos de Compra. Verifique logs do servidor.",
        });
      }
    };

  app.post(NOMUS_PO_ADMIN_ROUTES.run, execute, start("incremental"));
  app.post(NOMUS_PO_ADMIN_ROUTES.reconcilePreview, execute, start("reconcile-preview"));
  app.post(
    NOMUS_PO_ADMIN_ROUTES.reconcileApply,
    execute,
    authorize,
    (req, res, next) => {
      const phrase = String((req.body as { confirmPhrase?: unknown } | undefined)?.confirmPhrase ?? "").trim();
      if (phrase !== NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE) {
        return res.status(400).json({
          error: "CONFIRMATION_REQUIRED",
          message: `Digite exatamente "${NOMUS_PO_RECONCILE_AUTHORIZE_PHRASE}" para autorizar.`,
        });
      }
      return next();
    },
    start("reconcile-apply")
  );
}
