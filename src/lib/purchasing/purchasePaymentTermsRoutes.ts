/**
 * Compras → Performance → Condições de compra (PMP desde a emissão do pedido).
 *
 * Leitura: mesmo guard da aba Performance (`operations.purchases` view).
 * Meta gerencial: `operations.purchases` approve (ação gerencial já existente no catálogo;
 * nenhuma permission key nova). Sem writeback Nomus; a meta não altera pedidos.
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildPaymentTermsAnalysisResponse,
  buildSupplierPaymentTermsDetailResponse,
  loadPaymentTermsSettings,
  parsePaymentTermsPeriod,
  parsePaymentTermsScope,
  parsePaymentTermsTargetInput,
  updatePaymentTermsTarget,
} from "./purchasePaymentTermsAnalysis.server.js";

export const PURCHASE_PAYMENT_TERMS_API_PATH = "/api/purchases/performance/payment-terms";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerPurchasePaymentTermsRoutes(
  app: express.Express,
  auth: AuthGuards,
  options: { db?: Parameters<typeof buildPaymentTermsAnalysisResponse>[0] } = {},
): void {
  const db = options.db ?? prisma;
  const view = [auth.requireAppAuth, auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view)] as const;
  const manage = [auth.requireAppAuth, auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve)] as const;

  app.get(PURCHASE_PAYMENT_TERMS_API_PATH, ...view, async (req, res) => {
    try {
      const period = parsePaymentTermsPeriod(req.query as Record<string, unknown>);
      if ("error" in period) return res.status(400).json({ error: period.error });
      res.json(await buildPaymentTermsAnalysisResponse(db, period, parsePaymentTermsScope(req.query as Record<string, unknown>)));
    } catch (e) {
      console.error(`GET ${PURCHASE_PAYMENT_TERMS_API_PATH}`, e);
      res.status(500).json({ error: "Erro ao calcular a qualidade das condições de compra." });
    }
  });

  app.get(`${PURCHASE_PAYMENT_TERMS_API_PATH}/suppliers/:supplierExternalId`, ...view, async (req, res) => {
    try {
      const period = parsePaymentTermsPeriod(req.query as Record<string, unknown>);
      if ("error" in period) return res.status(400).json({ error: period.error });
      const id = Number.parseInt(String(req.params.supplierExternalId), 10);
      if (!Number.isInteger(id)) return res.status(400).json({ error: "Fornecedor inválido." });
      res.json(await buildSupplierPaymentTermsDetailResponse(db, period, id));
    } catch (e) {
      console.error(`GET ${PURCHASE_PAYMENT_TERMS_API_PATH}/suppliers/:id`, e);
      res.status(500).json({ error: "Erro ao carregar o detalhe do fornecedor." });
    }
  });

  app.get(`${PURCHASE_PAYMENT_TERMS_API_PATH}/settings`, ...view, async (_req, res) => {
    try {
      res.json(await loadPaymentTermsSettings(db));
    } catch (e) {
      console.error(`GET ${PURCHASE_PAYMENT_TERMS_API_PATH}/settings`, e);
      res.status(500).json({ error: "Erro ao carregar a meta de PMP." });
    }
  });

  app.put(`${PURCHASE_PAYMENT_TERMS_API_PATH}/settings`, ...manage, async (req, res) => {
    try {
      const parsed = parsePaymentTermsTargetInput((req.body ?? {}).targetPmpDays);
      if (parsed.ok === false) return res.status(400).json({ error: parsed.error });
      const user = await auth.getCurrentAppUser(req);
      const actor = { userId: user?.id ?? null, name: user?.name?.trim() || user?.email || "Usuário não identificado" };
      res.json(await updatePaymentTermsTarget(db, actor, parsed.value));
    } catch (e) {
      console.error(`PUT ${PURCHASE_PAYMENT_TERMS_API_PATH}/settings`, e);
      res.status(500).json({ error: "Erro ao salvar a meta de PMP." });
    }
  });
}
