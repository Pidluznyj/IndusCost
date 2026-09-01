import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildFinanceBillingDashboard } from "@/src/lib/financeBillingDashboard.js";
import { buildFinanceBillingNfeComparison } from "@/src/lib/financeBillingNfeComparison.js";
import { buildFinanceBillingNfeList } from "@/src/lib/financeBillingNfeList.js";
import { buildFinanceBillingHorizonDrilldown } from "@/src/lib/financeBillingHorizonDrilldown.js";
import { FinanceBillingDetailQueryError } from "@/src/lib/finance/financeBillingDetailOrders.js";
import { loadFinanceBillingDetailOrders } from "@/src/lib/finance/financeBillingDetailOrders.server.js";
import { buildBillingAuditDataset } from "@/src/lib/financeBillingAuditDataset.js";
import {
  billingAuditWorkbookToBytes,
  buildBillingAuditWorkbook,
  financeBillingAuditExportFilename,
} from "@/src/lib/financeBillingAuditExport.js";
import {
  buildFinanceBillingNfeExportCsv,
  financeBillingNfeExportFilename,
} from "@/src/lib/financeBillingNfeExport.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import {
  getNomusNfesSyncStatus,
  NomusNfesSyncConflictError,
  startNomusNfesSyncApply,
} from "@/src/lib/nomusNfesSyncRunner.js";
import { financeApiErrorJson } from "@/src/lib/financeTabLoadError.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinanceBillingRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const viewGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.billing, FINANCE_MODULE_ACTIONS.view),
  ] as const;
  const exportGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.billing, FINANCE_MODULE_ACTIONS.export),
  ] as const;
  const executeGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.billing, FINANCE_MODULE_ACTIONS.execute),
  ] as const;

  app.get("/api/finance/billing/dashboard", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const payload = await buildFinanceBillingDashboard(req.query as Record<string, unknown>);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/dashboard", error);
      return res.status(500).json(
        financeApiErrorJson("Não foi possível carregar o faturamento. Tente novamente.", error)
      );
    }
  });

  app.get("/api/finance/billing/nfes", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingNfeList(req.query as Record<string, unknown>);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/nfes", error);
      return res.status(500).json(
        financeApiErrorJson("Não foi possível listar NF-e sincronizadas.", error)
      );
    }
  });

  app.get("/api/finance/billing/horizon/orders", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingHorizonDrilldown(
        req.query as Record<string, unknown>
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/horizon/orders", error);
      const message =
        error instanceof Error && error.message.includes("Faixa de horizonte inválida")
          ? error.message
          : "Não foi possível listar pedidos do horizonte de faturamento.";
      return res.status(error instanceof Error && error.message.includes("inválida") ? 400 : 500).json(
        financeApiErrorJson(message, error)
      );
    }
  });

  /**
   * Subaba Detalhamento — pedidos de venda faturados na competência.
   * Read-only, 1 linha lógica por SalesOrder, mesma permissão da tela.
   */
  app.get("/api/finance/billing/detail/orders", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await loadFinanceBillingDetailOrders(
        req.query as Record<string, unknown>
      );
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceBillingDetailQueryError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/billing/detail/orders", error);
      return res.status(500).json(
        financeApiErrorJson(
          "Não foi possível listar os pedidos faturados. Tente novamente.",
          error
        )
      );
    }
  });

  app.get("/api/finance/billing/export", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingNfeList({
        ...req.query,
        format: "csv",
        limit: "10000",
      });
      const csv = buildFinanceBillingNfeExportCsv(payload.items);
      const filename = financeBillingNfeExportFilename(payload.filters.year);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error("GET /api/finance/billing/export", error);
      return res.status(500).json({ error: "Não foi possível exportar NF-e do faturamento." });
    }
  });

  app.get("/api/finance/billing/audit", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildBillingAuditDataset(
        req.query as Record<string, unknown>,
        user.email ?? user.name ?? null
      );
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/audit", error);
      return res.status(500).json(
        financeApiErrorJson("Não foi possível gerar auditoria do faturamento.", error)
      );
    }
  });

  app.get("/api/finance/billing/audit/export", ...exportGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildBillingAuditDataset(
        req.query as Record<string, unknown>,
        user.email ?? user.name ?? null
      );
      const workbook = buildBillingAuditWorkbook(payload);
      const bytes = billingAuditWorkbookToBytes(workbook);
      const filename = financeBillingAuditExportFilename(payload.filters.year);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(Buffer.from(bytes));
    } catch (error) {
      console.error("GET /api/finance/billing/audit/export", error);
      return res.status(500).json({ error: "Não foi possível exportar auditoria do faturamento." });
    }
  });

  app.get("/api/finance/billing/comparison", ...viewGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceBillingNfeComparison(req.query.year);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/comparison", error);
      return res.status(500).json(
        financeApiErrorJson("Não foi possível gerar comparativo de faturamento.", error)
      );
    }
  });

  app.get("/api/finance/billing/sync-status", ...viewGuard, async (_req, res) => {
    try {
      const status = await getNomusNfesSyncStatus();
      return res.json(status);
    } catch (error) {
      console.error("GET /api/finance/billing/sync-status", error);
      return res.status(500).json({ error: "Erro ao consultar status da sincronização de NF-e." });
    }
  });

  app.post("/api/finance/billing/sync", ...executeGuard, async (_req, res) => {
    try {
      const projectRoot = process.env.INDUSCOST_APP_DIR || process.cwd();
      const result = await startNomusNfesSyncApply(projectRoot);
      return res.status(202).json(result);
    } catch (error) {
      if (error instanceof NomusNfesSyncConflictError) {
        return res.status(409).json({
          error: error.message,
          message: "Já existe uma sincronização de NF-e em andamento. Aguarde finalizar.",
        });
      }
      console.error("POST /api/finance/billing/sync", error);
      return res.status(500).json({
        error: "Não foi possível iniciar a sincronização de NF-e. Verifique logs do servidor.",
      });
    }
  });
}
