/**
 * Rotas de workflow / evidências / refs oficiais para solicitações de compra (OP-14).
 * CRUD legado permanece em server.ts; aqui só ações de ciclo de vida.
 */
import type express from "express";
import type { RequestHandler } from "express";
import multer from "multer";
import { prisma } from "@/src/lib/prisma.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import {
  approvePurchaseRequest,
  cancelPurchaseRequest,
  forwardPurchaseRequestToQuotation,
  getPurchaseRequestDetail,
  listPurchaseRequestHistory,
  rejectPurchaseRequest,
  reopenPurchaseRequestDraft,
  submitPurchaseRequest,
} from "@/src/lib/purchasing/purchaseRequestService.server.js";
import { PurchaseRequestWorkflowError } from "@/src/lib/purchasing/purchaseRequestWorkflow.js";
import {
  downloadPurchaseEvidence,
  mapEvidenceError,
  uploadPurchaseEvidence,
} from "@/src/lib/purchasing/purchaseEvidenceService.server.js";
import { PURCHASE_EVIDENCE_MAX_BYTES } from "@/src/lib/purchasing/purchaseEvidenceRules.js";
import { safePurchasingLogError } from "@/src/lib/purchasing/purchasingSecurity.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{
    id: string;
    name?: string | null;
    email?: string | null;
    effectivePermissions?: string[];
    permissions?: string[];
  } | null>;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function handleWorkflowError(res: express.Response, e: unknown) {
  if (e instanceof PurchaseRequestWorkflowError) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return res.status(status).json({ error: e.message, code: e.code });
  }
  safePurchasingLogError("purchase-request-workflow", e);
  return res.status(500).json({ error: "Erro no workflow da solicitação." });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PURCHASE_EVIDENCE_MAX_BYTES },
});

export function registerPurchaseRequestWorkflowRoutes(app: express.Express, auth: AuthGuards) {
  const view = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.view),
  ] as const;
  const create = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.create),
  ] as const;
  const update = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.update),
  ] as const;
  const approve = [
    auth.requireAppAuth,
    auth.requireResource(OPERATIONS_RESOURCE_KEYS.purchases, OPERATIONS_ACTIONS.approve),
  ] as const;

  async function actorFromReq(req: express.Request) {
    const user = await auth.getCurrentAppUser(req);
    if (!user) return null;
    return { userId: user.id, userName: user.name ?? user.email ?? null };
  }

  app.get("/api/purchase-requests/official-refs/materials", ...view, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const reads = createOfficialDataProviders(prisma);
      const rows = await reads.materials.list({ q: q || undefined, limit: 50 });
      res.json({ rows });
    } catch (e) {
      console.error("official materials list error:", e);
      res.status(500).json({ error: "Erro ao listar matérias-primas oficiais." });
    }
  });

  app.get("/api/purchase-requests/official-refs/projects", ...view, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const reads = createOfficialDataProviders(prisma);
      const rows = await reads.projects.list({ q: q || undefined, limit: 50 });
      res.json({ rows });
    } catch (e) {
      console.error("official projects list error:", e);
      res.status(500).json({ error: "Erro ao listar projetos oficiais." });
    }
  });

  app.get("/api/purchase-requests/official-refs/cost-centers", ...view, async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      const reads = createOfficialDataProviders(prisma);
      const rows = await reads.opsCostCenters.list({ q: q || undefined, limit: 100 });
      res.json({ rows: rows.filter((r) => r.isActive) });
    } catch (e) {
      console.error("official cost centers list error:", e);
      res.status(500).json({ error: "Erro ao listar centros de custo." });
    }
  });

  app.get("/api/purchase-requests/:id/history", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.purchaseRequest.findUnique({ where: { id }, select: { id: true } });
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      const events = await listPurchaseRequestHistory(prisma, id);
      res.json({ rows: events });
    } catch (e) {
      console.error("purchase-request history error:", e);
      res.status(500).json({ error: "Erro ao carregar histórico." });
    }
  });

  app.get("/api/purchase-requests/:id/evidences", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await prisma.purchaseRequest.findUnique({ where: { id }, select: { id: true } });
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      const rows = await prisma.purchaseEvidence.findMany({
        where: { entityType: "REQUEST", entityId: id },
        orderBy: { uploadedAt: "desc" },
      });
      res.json({ rows });
    } catch (e) {
      console.error("purchase-request evidences list error:", e);
      res.status(500).json({ error: "Erro ao listar evidências." });
    }
  });

  app.post(
    "/api/purchase-requests/:id/evidences",
    ...update,
    upload.single("file"),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const file = req.file;
        if (!file?.buffer?.length) return res.status(400).json({ error: "Arquivo obrigatório." });

        const actor = await actorFromReq(req);
        const evidence = await uploadPurchaseEvidence(prisma, {
          entityType: "REQUEST",
          entityId: id,
          buffer: file.buffer,
          originalName: file.originalname || "anexo",
          mimeType: file.mimetype || "application/octet-stream",
          notes: req.body?.notes ? String(req.body.notes) : null,
          evidenceType: req.body?.evidenceType ?? null,
          actor,
        });
        res.status(201).json({ evidence });
      } catch (e) {
        const mapped = mapEvidenceError(e);
        return res.status(mapped.status).json(mapped.body);
      }
    }
  );

  app.get("/api/purchase-requests/:id/evidences/:evidenceId/download", ...view, async (req, res) => {
    try {
      const { id, evidenceId } = req.params;
      if (!isUuid(id) || !isUuid(evidenceId)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      const { evidence, buffer } = await downloadPurchaseEvidence(prisma, evidenceId, actor);
      if (evidence.entityType !== "REQUEST" || evidence.entityId !== id) {
        return res.status(404).json({ error: "Evidência não encontrada." });
      }
      res.setHeader("Content-Type", evidence.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(evidence.originalFileName)}"`
      );
      res.send(buffer);
    } catch (e) {
      const mapped = mapEvidenceError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.post("/api/purchase-requests/:id/submit", ...create, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await submitPurchaseRequest(prisma, id, actor);
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.post("/api/purchase-requests/:id/approve", ...approve, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await approvePurchaseRequest(prisma, id, actor, req.body?.notes ?? null);
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.post("/api/purchase-requests/:id/reject", ...approve, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await rejectPurchaseRequest(prisma, id, actor, String(req.body?.reason ?? ""));
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.post("/api/purchase-requests/:id/cancel", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await cancelPurchaseRequest(prisma, id, actor, String(req.body?.reason ?? ""));
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.post("/api/purchase-requests/:id/reopen-draft", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await reopenPurchaseRequestDraft(prisma, id, actor);
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.post("/api/purchase-requests/:id/forward-to-quotation", ...update, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const actor = await actorFromReq(req);
      if (!actor) return res.status(401).json({ error: "Autenticação necessária." });
      const row = await forwardPurchaseRequestToQuotation(
        prisma,
        id,
        actor,
        req.body?.notes ?? null
      );
      res.json(row);
    } catch (e) {
      return handleWorkflowError(res, e);
    }
  });

  app.get("/api/purchase-requests/:id/detail", ...view, async (req, res) => {
    try {
      const { id } = req.params;
      if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
      const row = await getPurchaseRequestDetail(prisma, id);
      if (!row) return res.status(404).json({ error: "Solicitação não encontrada." });
      res.json(row);
    } catch (e) {
      console.error("purchase-request detail error:", e);
      res.status(500).json({ error: "Erro ao carregar detalhe." });
    }
  });
}
