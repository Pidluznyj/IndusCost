/**
 * Satisfação — rotas administrativas. Guard: recurso `commercial.satisfaction`
 * (contrato canônico), com ação por operação:
 *   view   → dashboard, listas, resultados, resposta individual
 *   create → criar pesquisa / duplicar
 *   update → editar rascunho, audiência, gerar/revogar link
 *   manage → publicar, encerrar, arquivar, excluir rascunho
 *   export → exportação sob demanda
 *   execute→ importação histórica
 *
 * O escopo de carteira do vendedor é resolvido no BACKEND (nunca escondendo
 * dado no frontend): quando o usuário não tem visão global, as consultas são
 * restritas aos clientes da carteira dele.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { getAllowedCustomerIds } from "@/src/lib/commercial/commercialAccessScopeService.js";
import {
  parseCampaignCreateInput,
  parseCampaignUpdateInput,
  resolveInvitationStatus,
  SatisfactionContractError,
  SATISFACTION_CAMPAIGN_STATUSES,
  SATISFACTION_INVITATION_STATUSES,
  type SatisfactionCampaignStatusValue,
  type SatisfactionInvitationStatusValue,
} from "./satisfactionContracts.js";
import {
  createSatisfactionCampaignService,
  SatisfactionDomainError,
  type SatisfactionCampaignService,
} from "./satisfactionCampaignService.server.js";
import {
  createSatisfactionInvitationService,
  type SatisfactionInvitationService,
} from "./satisfactionInvitationService.server.js";
import {
  createSatisfactionAnalyticsService,
  type SatisfactionAnalyticsService,
} from "./satisfactionAnalytics.server.js";
import {
  createSatisfactionImportService,
  type SatisfactionImportService,
} from "./satisfactionImportService.server.js";
import {
  recordSatisfactionAudit,
  SATISFACTION_AUDIT_ENTITIES,
} from "./satisfactionAudit.server.js";
import { summarizeRatings, resolveAlertLevel } from "./satisfactionMetrics.js";

export const SATISFACTION_RESOURCE_KEY = "commercial.satisfaction" as const;
export const SATISFACTION_RESPONSES_RESOURCE_KEY = "commercial.satisfaction.responses" as const;
export const SATISFACTION_IMPORT_RESOURCE_KEY = "commercial.satisfaction.import" as const;

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (
    req: express.Request
  ) => Promise<AppAuthContext | null> | AppAuthContext | null;
  services?: {
    campaigns?: SatisfactionCampaignService;
    invitations?: SatisfactionInvitationService;
    analytics?: SatisfactionAnalyticsService;
    imports?: SatisfactionImportService;
  };
};

function sendSatisfactionError(res: express.Response, err: unknown): void {
  if (err instanceof SatisfactionContractError) {
    res.status(400).json({ error: err.message, field: err.field, code: err.code });
    return;
  }
  if (err instanceof SatisfactionDomainError) {
    const status =
      err.code === "NOT_FOUND"
        ? 404
        : err.code === "CONFLICT"
          ? 409
          : err.code === "LOCKED"
            ? 423
            : err.code === "FORBIDDEN"
              ? 403
              : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  // Log sem payload: a mensagem pode carregar comentário/telefone do cliente.
  console.error("[satisfaction] erro na rota administrativa:", err);
  res.status(500).json({ error: "Erro interno no módulo de Satisfação." });
}

function parseIntParam(raw: unknown, fallback: number): number {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseDateParam(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseStatusParam(raw: unknown): SatisfactionCampaignStatusValue | null {
  const value = String(raw ?? "").trim().toUpperCase();
  return (SATISFACTION_CAMPAIGN_STATUSES as readonly string[]).includes(value)
    ? (value as SatisfactionCampaignStatusValue)
    : null;
}

function parseInvitationStatusParam(raw: unknown): SatisfactionInvitationStatusValue | null {
  const value = String(raw ?? "").trim().toUpperCase();
  return (SATISFACTION_INVITATION_STATUSES as readonly string[]).includes(value)
    ? (value as SatisfactionInvitationStatusValue)
    : null;
}

/** Base para montar o link público (host público, não o administrativo). */
function resolvePublicBaseUrl(): string | null {
  const configured = (process.env.SATISFACTION_PUBLIC_BASE_URL ?? "").trim();
  return configured || null;
}

export function registerSatisfactionRoutes(app: express.Express, guards: AuthGuards): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;

  const campaigns =
    guards.services?.campaigns ?? createSatisfactionCampaignService({ prisma });
  const invitations =
    guards.services?.invitations ?? createSatisfactionInvitationService({ prisma });
  const analytics =
    guards.services?.analytics ?? createSatisfactionAnalyticsService({ prisma });
  const imports = guards.services?.imports ?? createSatisfactionImportService({ prisma });

  const view = requireResource(SATISFACTION_RESOURCE_KEY, "view");
  const create = requireResource(SATISFACTION_RESOURCE_KEY, "create");
  const update = requireResource(SATISFACTION_RESOURCE_KEY, "update");
  const manage = requireResource(SATISFACTION_RESOURCE_KEY, "manage");
  const exportAction = requireResource(SATISFACTION_RESOURCE_KEY, "export");
  const viewResponses = requireResource(SATISFACTION_RESPONSES_RESOURCE_KEY, "view");
  const runImport = requireResource(SATISFACTION_IMPORT_RESOURCE_KEY, "execute");

  /** null = sem restrição; array = carteira do vendedor. */
  async function resolveScope(req: express.Request): Promise<string[] | null> {
    const user = await getCurrentAppUser(req);
    if (!user) return [];
    const scope = await getAllowedCustomerIds(user);
    return scope.unrestricted ? null : scope.customerIds;
  }

  async function currentUserId(req: express.Request): Promise<string | null> {
    const user = await getCurrentAppUser(req);
    return user?.id ?? null;
  }

  // ─── Dashboard ────────────────────────────────────────────────────────────

  app.get(
    "/api/commercial/satisfaction/dashboard",
    requireAppAuth,
    view,
    async (req, res) => {
      try {
        const campaignIdsRaw = String(req.query.campaignIds ?? "").trim();
        const dashboard = await analytics.getDashboard({
          campaignIds: campaignIdsRaw ? campaignIdsRaw.split(",").filter(Boolean) : null,
          from: parseDateParam(req.query.from),
          to: parseDateParam(req.query.to),
          customerId: String(req.query.customerId ?? "").trim() || null,
          responsibleExternalId: req.query.responsibleExternalId
            ? Number.parseInt(String(req.query.responsibleExternalId), 10)
            : null,
          allowedCustomerIds: await resolveScope(req),
        });
        res.json(dashboard);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  // ─── Campanhas ────────────────────────────────────────────────────────────

  app.get("/api/commercial/satisfaction/campaigns", requireAppAuth, view, async (req, res) => {
    try {
      const result = await campaigns.listCampaigns({
        page: parseIntParam(req.query.page, 1),
        pageSize: parseIntParam(req.query.pageSize, 20),
        status: parseStatusParam(req.query.status),
        search: String(req.query.search ?? "").trim() || null,
        allowedCustomerIds: await resolveScope(req),
      });
      res.json(result);
    } catch (err) {
      sendSatisfactionError(res, err);
    }
  });

  app.post("/api/commercial/satisfaction/campaigns", requireAppAuth, create, async (req, res) => {
    try {
      const input = parseCampaignCreateInput(req.body);
      const campaign = await campaigns.createCampaign(input, await currentUserId(req));
      res.status(201).json({ campaign });
    } catch (err) {
      sendSatisfactionError(res, err);
    }
  });

  app.get("/api/commercial/satisfaction/campaigns/:id", requireAppAuth, view, async (req, res) => {
    try {
      const campaign = await campaigns.getCampaign(String(req.params.id));
      res.json({ campaign });
    } catch (err) {
      sendSatisfactionError(res, err);
    }
  });

  app.patch(
    "/api/commercial/satisfaction/campaigns/:id",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const input = parseCampaignUpdateInput(req.body);
        const campaign = await campaigns.updateCampaign(
          String(req.params.id),
          input,
          await currentUserId(req)
        );
        res.json({ campaign });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.put(
    "/api/commercial/satisfaction/campaigns/:id/audience",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const raw = (req.body ?? {}) as { customerIds?: unknown };
        const customerIds = Array.isArray(raw.customerIds)
          ? raw.customerIds.filter((id): id is string => typeof id === "string")
          : [];
        const result = await campaigns.setCampaignAudience(
          String(req.params.id),
          customerIds,
          await currentUserId(req)
        );
        res.json(result);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/publish",
    requireAppAuth,
    manage,
    async (req, res) => {
      try {
        const result = await campaigns.publishCampaign(
          String(req.params.id),
          await currentUserId(req)
        );
        res.json(result);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/close",
    requireAppAuth,
    manage,
    async (req, res) => {
      try {
        const campaign = await campaigns.closeCampaign(
          String(req.params.id),
          await currentUserId(req)
        );
        res.json({ campaign });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/archive",
    requireAppAuth,
    manage,
    async (req, res) => {
      try {
        const campaign = await campaigns.archiveCampaign(
          String(req.params.id),
          await currentUserId(req)
        );
        res.json({ campaign });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/duplicate",
    requireAppAuth,
    create,
    async (req, res) => {
      try {
        const campaign = await campaigns.duplicateCampaign(
          String(req.params.id),
          await currentUserId(req)
        );
        res.status(201).json({ campaign });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.delete(
    "/api/commercial/satisfaction/campaigns/:id",
    requireAppAuth,
    manage,
    async (req, res) => {
      try {
        await campaigns.deleteCampaign(String(req.params.id), await currentUserId(req));
        res.json({ success: true });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  // ─── Seleção de audiência (clientes) ──────────────────────────────────────

  app.get("/api/commercial/satisfaction/customers", requireAppAuth, view, async (req, res) => {
    try {
      const search = String(req.query.search ?? "").trim();
      const onlyWithOrders = req.query.onlyWithOrders === "true";
      const from = parseDateParam(req.query.from);
      const to = parseDateParam(req.query.to);
      const allowed = await resolveScope(req);

      const where: Record<string, unknown> = { status: "ACTIVE" };
      if (allowed) where.id = { in: allowed };
      if (search) {
        where.OR = [
          { companyName: { contains: search, mode: "insensitive" } },
          { taxId: { contains: search.replace(/\D+/g, "") } },
        ];
      }
      // Compra no período vem do SalesOrder — fonte oficial, sem coluna espelho.
      if (onlyWithOrders) {
        where.salesOrders = {
          some: {
            ...(from || to
              ? {
                  issueDate: {
                    ...(from ? { gte: from } : {}),
                    ...(to ? { lte: to } : {}),
                  },
                }
              : {}),
          },
        };
      }

      const customers = await prisma.customer.findMany({
        where: where as never,
        orderBy: { companyName: "asc" },
        take: 200,
        select: {
          id: true,
          companyName: true,
          taxId: true,
          CrmCustomerCommercialOwner: { select: { sellerCanonicalName: true } },
        },
      });

      res.json({
        customers: customers.map((customer) => ({
          id: customer.id,
          companyName: customer.companyName,
          taxId: customer.taxId,
          responsibleCommercialName:
            customer.CrmCustomerCommercialOwner?.sellerCanonicalName ?? null,
        })),
      });
    } catch (err) {
      sendSatisfactionError(res, err);
    }
  });

  // ─── Convites e links ─────────────────────────────────────────────────────

  app.get(
    "/api/commercial/satisfaction/campaigns/:id/invitations",
    requireAppAuth,
    view,
    async (req, res) => {
      try {
        const result = await invitations.listInvitations(String(req.params.id), {
          page: parseIntParam(req.query.page, 1),
          pageSize: parseIntParam(req.query.pageSize, 25),
          status: parseInvitationStatusParam(req.query.status),
          search: String(req.query.search ?? "").trim() || null,
          allowedCustomerIds: await resolveScope(req),
        });
        res.json(result);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/invitations/:invitationId/link",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const link = await invitations.issueInvitationLink(
          String(req.params.invitationId),
          resolvePublicBaseUrl(),
          await currentUserId(req)
        );
        // O token em claro existe SÓ nesta resposta. Não é relido do banco.
        res.json(link);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/invitations/:invitationId/revoke",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        await invitations.revokeInvitation(
          String(req.params.invitationId),
          await currentUserId(req)
        );
        res.json({ success: true });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/general-link",
    requireAppAuth,
    update,
    async (req, res) => {
      try {
        const link = await invitations.issueGeneralLink(
          String(req.params.id),
          resolvePublicBaseUrl(),
          await currentUserId(req)
        );
        res.json(link);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  // ─── Resultados e respostas ───────────────────────────────────────────────

  app.get(
    "/api/commercial/satisfaction/campaigns/:id/results",
    requireAppAuth,
    view,
    async (req, res) => {
      try {
        const campaignId = String(req.params.id);
        const [campaign, dashboard] = await Promise.all([
          campaigns.getCampaign(campaignId),
          analytics.getDashboard({
            campaignIds: [campaignId],
            from: null,
            to: null,
            customerId: null,
            responsibleExternalId: null,
            allowedCustomerIds: await resolveScope(req),
          }),
        ]);
        res.json({
          campaign: {
            id: campaign.id,
            code: campaign.code,
            name: campaign.name,
            status: campaign.status,
            referenceStart: campaign.referenceStart,
            referenceEnd: campaign.referenceEnd,
            publishedAt: campaign.publishedAt,
          },
          ...dashboard,
        });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.get(
    "/api/commercial/satisfaction/campaigns/:id/responses",
    requireAppAuth,
    viewResponses,
    async (req, res) => {
      try {
        const campaignId = String(req.params.id);
        const page = parseIntParam(req.query.page, 1);
        const pageSize = Math.min(parseIntParam(req.query.pageSize, 25), 100);
        const allowed = await resolveScope(req);

        const where: Record<string, unknown> = { campaignId, status: "SUBMITTED" };
        if (allowed) where.customerId = { in: allowed };
        if (req.query.onlyCritical === "true") {
          where.answers = { some: { ratingValue: { lte: 2 } } };
        }

        const [total, responses] = await Promise.all([
          prisma.satisfactionSurveyResponse.count({ where: where as never }),
          prisma.satisfactionSurveyResponse.findMany({
            where: where as never,
            orderBy: [{ submittedAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              respondentName: true,
              submittedAt: true,
              originalSubmittedAt: true,
              declaredCompanyName: true,
              customerMatchStatus: true,
              source: true,
              invitation: { select: { customerNameSnapshot: true } },
              answers: { select: { ratingValue: true } },
            },
          }),
        ]);

        res.json({
          total,
          page,
          pageSize,
          rows: responses.map((response) => {
            const ratings = response.answers.map((a) => a.ratingValue);
            const stats = summarizeRatings(ratings);
            return {
              id: response.id,
              customerName:
                response.invitation?.customerNameSnapshot ??
                response.declaredCompanyName ??
                "Cliente não identificado",
              respondentName: response.respondentName,
              submittedAt: response.originalSubmittedAt ?? response.submittedAt,
              averageRating: stats.average,
              lowestRating: stats.lowestRating,
              alertLevel: resolveAlertLevel(ratings),
              matchStatus: response.customerMatchStatus,
              source: response.source,
            };
          }),
        });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.get(
    "/api/commercial/satisfaction/responses/:id",
    requireAppAuth,
    viewResponses,
    async (req, res) => {
      try {
        const response = await prisma.satisfactionSurveyResponse.findUnique({
          where: { id: String(req.params.id) },
          select: {
            id: true,
            customerId: true,
            respondentName: true,
            respondentPhone: true,
            declaredCompanyName: true,
            declaredDate: true,
            submittedAt: true,
            originalSubmittedAt: true,
            source: true,
            customerMatchStatus: true,
            campaign: { select: { id: true, name: true, code: true } },
            invitation: {
              select: {
                customerNameSnapshot: true,
                responsibleCommercialNameSnapshot: true,
              },
            },
            answers: {
              select: {
                ratingValue: true,
                textValue: true,
                dateValue: true,
                question: { select: { code: true, label: true, type: true, sortOrder: true } },
              },
            },
          },
        });
        if (!response) {
          res.status(404).json({ error: "Resposta não encontrada." });
          return;
        }

        const allowed = await resolveScope(req);
        if (allowed && response.customerId && !allowed.includes(response.customerId)) {
          res.status(403).json({
            error: "FORBIDDEN",
            message: "Cliente fora da sua carteira comercial.",
          });
          return;
        }

        const ratings = response.answers.map((a) => a.ratingValue);
        const stats = summarizeRatings(ratings);
        const history = response.customerId
          ? await analytics.getCustomerHistory(response.customerId)
          : [];

        res.json({
          response: {
            id: response.id,
            campaign: response.campaign,
            customerName:
              response.invitation?.customerNameSnapshot ??
              response.declaredCompanyName ??
              "Cliente não identificado",
            responsibleCommercialName:
              response.invitation?.responsibleCommercialNameSnapshot ?? null,
            respondentName: response.respondentName,
            respondentPhone: response.respondentPhone,
            declaredDate: response.declaredDate,
            submittedAt: response.submittedAt,
            originalSubmittedAt: response.originalSubmittedAt,
            source: response.source,
            matchStatus: response.customerMatchStatus,
            averageRating: stats.average,
            lowestRating: stats.lowestRating,
            alertLevel: resolveAlertLevel(ratings),
            answers: response.answers
              .slice()
              .sort((a, b) => a.question.sortOrder - b.question.sortOrder)
              .map((answer) => ({
                questionCode: answer.question.code,
                label: answer.question.label,
                type: answer.question.type,
                ratingValue: answer.ratingValue,
                textValue: answer.textValue,
                dateValue: answer.dateValue,
              })),
          },
          // Comparação SEMPRE por question.code — nunca por posição.
          history,
        });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  // ─── Exportação (sob demanda) ─────────────────────────────────────────────

  app.get(
    "/api/commercial/satisfaction/campaigns/:id/export",
    requireAppAuth,
    exportAction,
    async (req, res) => {
      try {
        const campaignId = String(req.params.id);
        const allowed = await resolveScope(req);
        const where: Record<string, unknown> = { campaignId, status: "SUBMITTED" };
        if (allowed) where.customerId = { in: allowed };

        const responses = await prisma.satisfactionSurveyResponse.findMany({
          where: where as never,
          orderBy: [{ submittedAt: "desc" }],
          // Teto explícito: exportação é operação pontual, não carrega a base.
          take: 5000,
          select: {
            id: true,
            respondentName: true,
            submittedAt: true,
            originalSubmittedAt: true,
            declaredCompanyName: true,
            source: true,
            invitation: { select: { customerNameSnapshot: true } },
            answers: {
              select: {
                ratingValue: true,
                textValue: true,
                question: { select: { code: true, sortOrder: true } },
              },
            },
          },
        });

        await recordSatisfactionAudit(prisma, {
          entityType: SATISFACTION_AUDIT_ENTITIES.export,
          entityId: campaignId,
          action: "EXPORTED",
          newValue: `${responses.length} respostas`,
          performedBy: await currentUserId(req),
        });

        res.json({
          rows: responses.map((response) => {
            const byCode: Record<string, unknown> = {};
            for (const answer of response.answers) {
              byCode[answer.question.code] = answer.ratingValue ?? answer.textValue;
            }
            return {
              cliente:
                response.invitation?.customerNameSnapshot ??
                response.declaredCompanyName ??
                "",
              respondente: response.respondentName ?? "",
              data: response.originalSubmittedAt ?? response.submittedAt,
              origem: response.source,
              ...byCode,
            };
          }),
        });
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  // ─── Importação histórica ─────────────────────────────────────────────────

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/import/preview",
    requireAppAuth,
    runImport,
    async (req, res) => {
      try {
        const file = (req as express.Request & { file?: { buffer: Buffer; originalname: string } })
          .file;
        if (!file) {
          res.status(400).json({ error: "Envie o arquivo exportado do Google Forms." });
          return;
        }
        const preview = await imports.previewImport(
          String(req.params.id),
          file.buffer,
          file.originalname
        );
        await recordSatisfactionAudit(prisma, {
          entityType: SATISFACTION_AUDIT_ENTITIES.import,
          entityId: String(req.params.id),
          action: "IMPORT_PREVIEWED",
          newValue: `${preview.fileName} / ${preview.rowsTotal} linhas`,
          performedBy: await currentUserId(req),
        });
        res.json(preview);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );

  app.post(
    "/api/commercial/satisfaction/campaigns/:id/import/apply",
    requireAppAuth,
    runImport,
    async (req, res) => {
      try {
        const file = (req as express.Request & { file?: { buffer: Buffer; originalname: string } })
          .file;
        if (!file) {
          res.status(400).json({ error: "Envie o arquivo exportado do Google Forms." });
          return;
        }
        const result = await imports.applyImport(
          String(req.params.id),
          file.buffer,
          file.originalname,
          await currentUserId(req)
        );
        res.json(result);
      } catch (err) {
        sendSatisfactionError(res, err);
      }
    }
  );
}

/** Reexport para os testes de wiring. */
export { resolveInvitationStatus };
