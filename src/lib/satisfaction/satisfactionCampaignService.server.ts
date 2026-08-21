/**
 * Satisfação — serviço de campanhas (camada com I/O).
 *
 * Regras que este serviço garante:
 *  - Publicar CONGELA o questionário: as perguntas viram snapshot na campanha e
 *    nenhuma edição semântica é aceita depois (o template pode evoluir à parte).
 *  - Audiência é idempotente: o UNIQUE (campaignId, customerId) faz republicar
 *    ou clicar duas vezes não duplicar convite.
 *  - Customer é a única fonte de cadastro; a campanha só guarda snapshots do
 *    contexto da época (nome, CNPJ, responsável comercial).
 *  - Campanha com histórico nunca é apagada fisicamente — só DRAFT virgem.
 *  - Listagem é paginada e agregada no banco: nada de N+1 nem de trazer
 *    resposta para o Node só para contar.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertCampaignTransition,
  canDeleteCampaign,
  isCampaignSemanticallyLocked,
  SATISFACTION_TEMPLATE_V1_CODE,
  type SatisfactionCampaignCreateInput,
  type SatisfactionCampaignStatusValue,
  type SatisfactionCampaignUpdateInput,
} from "./satisfactionContracts.js";
import {
  averageFromTotals,
  calculateResponseRate,
  roundTo,
} from "./satisfactionMetrics.js";
import { generateSatisfactionToken } from "./satisfactionToken.js";
import {
  recordSatisfactionAudit,
  SATISFACTION_AUDIT_ENTITIES,
} from "./satisfactionAudit.server.js";

export class SatisfactionDomainError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT" | "LOCKED" | "INVALID_STATE" | "FORBIDDEN";

  constructor(
    message: string,
    code: SatisfactionDomainError["code"] = "INVALID_STATE"
  ) {
    super(message);
    this.name = "SatisfactionDomainError";
    this.code = code;
  }
}

export type SatisfactionCampaignListFilters = {
  page: number;
  pageSize: number;
  status: SatisfactionCampaignStatusValue | null;
  search: string | null;
  /** null = sem restrição; array = apenas estes clientes (escopo do vendedor). */
  allowedCustomerIds: string[] | null;
};

export type SatisfactionCampaignListRow = {
  id: string;
  code: string;
  name: string;
  status: SatisfactionCampaignStatusValue;
  referenceStart: Date;
  referenceEnd: Date;
  opensAt: Date | null;
  closesAt: Date | null;
  publishedAt: Date | null;
  invitedCount: number;
  activeInvitationCount: number;
  responseCount: number;
  responseRate: number | null;
  averageRating: number | null;
  positiveCount: number;
  criticalCount: number;
};

const MAX_PAGE_SIZE = 100;

function clampPageSize(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 20;
  return Math.min(Math.trunc(raw), MAX_PAGE_SIZE);
}

export function createSatisfactionCampaignService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  /** Template histórico V1 com as perguntas — base de toda campanha nova. */
  async function loadTemplateV1() {
    const template = await prisma.satisfactionSurveyTemplate.findUnique({
      where: { code: SATISFACTION_TEMPLATE_V1_CODE },
      include: { questions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!template) {
      throw new SatisfactionDomainError(
        "Questionário oficial não encontrado. A migration do módulo de Satisfação não foi aplicada.",
        "NOT_FOUND"
      );
    }
    return template;
  }

  /**
   * Agregados por campanha em consultas fixas (3 no total), independentemente
   * do tamanho da página — nunca uma consulta por linha.
   */
  async function loadCampaignAggregates(campaignIds: string[]) {
    if (campaignIds.length === 0) {
      return {
        invitations: new Map<string, { invited: number; active: number; completed: number }>(),
        responses: new Map<string, number>(),
        ratings: new Map<
          string,
          { sum: number; count: number; positive: number; critical: number }
        >(),
      };
    }

    const [invitationRows, responseRows, ratingRows] = await Promise.all([
      prisma.satisfactionSurveyInvitation.findMany({
        where: { campaignId: { in: campaignIds } },
        select: { campaignId: true, revokedAt: true, completedAt: true },
      }),
      prisma.satisfactionSurveyResponse.groupBy({
        by: ["campaignId"],
        where: { campaignId: { in: campaignIds }, status: "SUBMITTED" },
        _count: { _all: true },
      }),
      // Média/positivas/críticas agregadas no banco: as respostas não vêm para cá.
      prisma.$queryRaw<
        Array<{
          campaignId: string;
          sum: bigint | number | null;
          count: bigint | number;
          positive: bigint | number;
          critical: bigint | number;
        }>
      >`
        SELECT r."campaignId"                                                   AS "campaignId",
               SUM(a."ratingValue")                                             AS "sum",
               COUNT(a."ratingValue")                                           AS "count",
               COUNT(*) FILTER (WHERE a."ratingValue" >= 4)                     AS "positive",
               COUNT(*) FILTER (WHERE a."ratingValue" <= 2)                     AS "critical"
          FROM "SatisfactionSurveyAnswer" a
          JOIN "SatisfactionSurveyResponse" r ON r."id" = a."responseId"
         WHERE r."campaignId" = ANY(${campaignIds}::uuid[])
           AND r."status" = 'SUBMITTED'
           AND a."ratingValue" IS NOT NULL
         GROUP BY r."campaignId"
      `,
    ]);

    const invitations = new Map<string, { invited: number; active: number; completed: number }>();
    for (const row of invitationRows) {
      const current = invitations.get(row.campaignId) ?? { invited: 0, active: 0, completed: 0 };
      current.invited += 1;
      if (!row.revokedAt) {
        current.active += 1;
        if (row.completedAt) current.completed += 1;
      }
      invitations.set(row.campaignId, current);
    }

    const responses = new Map<string, number>();
    for (const row of responseRows) {
      responses.set(row.campaignId, row._count._all);
    }

    const ratings = new Map<
      string,
      { sum: number; count: number; positive: number; critical: number }
    >();
    for (const row of ratingRows) {
      ratings.set(row.campaignId, {
        sum: Number(row.sum ?? 0),
        count: Number(row.count ?? 0),
        positive: Number(row.positive ?? 0),
        critical: Number(row.critical ?? 0),
      });
    }

    return { invitations, responses, ratings };
  }

  return {
    loadTemplateV1,

    async listCampaigns(filters: SatisfactionCampaignListFilters): Promise<{
      rows: SatisfactionCampaignListRow[];
      total: number;
      page: number;
      pageSize: number;
    }> {
      const pageSize = clampPageSize(filters.pageSize);
      const page = Math.max(1, Math.trunc(filters.page) || 1);

      const where: Prisma.SatisfactionSurveyCampaignWhereInput = {};
      if (filters.status) where.status = filters.status;
      if (filters.search) {
        where.OR = [
          { name: { contains: filters.search, mode: "insensitive" } },
          { code: { contains: filters.search, mode: "insensitive" } },
        ];
      }
      // Escopo do vendedor: só campanhas que tocam a carteira dele.
      if (filters.allowedCustomerIds) {
        where.invitations = { some: { customerId: { in: filters.allowedCustomerIds } } };
      }

      const [total, campaigns] = await Promise.all([
        prisma.satisfactionSurveyCampaign.count({ where }),
        prisma.satisfactionSurveyCampaign.findMany({
          where,
          orderBy: [{ referenceStart: "desc" }, { createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            referenceStart: true,
            referenceEnd: true,
            opensAt: true,
            closesAt: true,
            publishedAt: true,
          },
        }),
      ]);

      const aggregates = await loadCampaignAggregates(campaigns.map((c) => c.id));

      const rows = campaigns.map((campaign): SatisfactionCampaignListRow => {
        const inv = aggregates.invitations.get(campaign.id) ?? {
          invited: 0,
          active: 0,
          completed: 0,
        };
        const ratings = aggregates.ratings.get(campaign.id);
        return {
          ...campaign,
          status: campaign.status as SatisfactionCampaignStatusValue,
          invitedCount: inv.invited,
          activeInvitationCount: inv.active,
          responseCount: aggregates.responses.get(campaign.id) ?? 0,
          responseRate: calculateResponseRate({
            activeInvitations: inv.active,
            completedInvitations: inv.completed,
          }),
          averageRating: ratings ? averageFromTotals(ratings.sum, ratings.count) : null,
          positiveCount: ratings?.positive ?? 0,
          criticalCount: ratings?.critical ?? 0,
        };
      });

      return { rows, total, page, pageSize };
    },

    async getCampaign(id: string) {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id },
        include: {
          template: { select: { id: true, code: true, name: true, version: true } },
          questions: { orderBy: { sortOrder: "asc" } },
          _count: { select: { invitations: true, responses: true } },
        },
      });
      if (!campaign) {
        throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      }
      return campaign;
    },

    async createCampaign(input: SatisfactionCampaignCreateInput, userId: string | null) {
      const template = await loadTemplateV1();

      const existing = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { code: input.code },
        select: { id: true },
      });
      if (existing) {
        throw new SatisfactionDomainError(
          `Já existe uma pesquisa com o código ${input.code}.`,
          "CONFLICT"
        );
      }

      const campaign = await prisma.satisfactionSurveyCampaign.create({
        data: {
          code: input.code,
          name: input.name,
          description: input.description,
          templateId: template.id,
          referenceStart: input.referenceStart,
          referenceEnd: input.referenceEnd,
          opensAt: input.opensAt,
          closesAt: input.closesAt,
          allowGeneralLink: input.allowGeneralLink,
          createdByUserId: userId,
          status: "DRAFT",
        },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: campaign.id,
        action: "CREATED",
        newValue: { code: campaign.code, name: campaign.name },
        performedBy: userId,
      });

      return campaign;
    },

    async updateCampaign(
      id: string,
      input: SatisfactionCampaignUpdateInput,
      userId: string | null
    ) {
      const current = await prisma.satisfactionSurveyCampaign.findUnique({ where: { id } });
      if (!current) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");

      const locked = isCampaignSemanticallyLocked(
        current.status as SatisfactionCampaignStatusValue,
        current.publishedAt
      );

      // Depois de publicada, período avaliado e questionário estão congelados.
      // Só a janela de resposta e textos de apoio continuam ajustáveis.
      if (locked) {
        const semanticChange =
          input.referenceStart !== undefined || input.referenceEnd !== undefined;
        if (semanticChange) {
          throw new SatisfactionDomainError(
            "Pesquisa já publicada: o período avaliado e o questionário não podem mais ser alterados.",
            "LOCKED"
          );
        }
      }

      const updated = await prisma.satisfactionSurveyCampaign.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.referenceStart !== undefined
            ? { referenceStart: input.referenceStart }
            : {}),
          ...(input.referenceEnd !== undefined ? { referenceEnd: input.referenceEnd } : {}),
          ...(input.opensAt !== undefined ? { opensAt: input.opensAt } : {}),
          ...(input.closesAt !== undefined ? { closesAt: input.closesAt } : {}),
          ...(input.allowGeneralLink !== undefined
            ? { allowGeneralLink: input.allowGeneralLink }
            : {}),
        },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: id,
        action: "UPDATED",
        newValue: Object.keys(input).join(","),
        performedBy: userId,
      });

      return updated;
    },

    /**
     * Define a audiência enquanto a campanha é rascunho.
     *
     * Idempotente: `createMany` com `skipDuplicates` apoiado no UNIQUE
     * (campaignId, customerId). Remoções só afetam convites SEM resposta.
     */
    async setCampaignAudience(
      campaignId: string,
      customerIds: readonly string[],
      userId: string | null
    ): Promise<{ added: number; removed: number; total: number }> {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, publishedAt: true },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      if (campaign.status !== "DRAFT") {
        throw new SatisfactionDomainError(
          "A audiência só pode ser alterada enquanto a pesquisa é um rascunho.",
          "LOCKED"
        );
      }

      const uniqueIds = [...new Set(customerIds)];

      const customers = await prisma.customer.findMany({
        where: { id: { in: uniqueIds } },
        select: {
          id: true,
          companyName: true,
          taxId: true,
          CrmCustomerCommercialOwner: {
            select: { sellerExternalId: true, sellerCanonicalName: true },
          },
        },
      });

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.satisfactionSurveyInvitation.findMany({
          where: { campaignId },
          select: { id: true, customerId: true, response: { select: { id: true } } },
        });
        const existingByCustomer = new Map(existing.map((e) => [e.customerId, e]));
        const keep = new Set(uniqueIds);

        const removableIds = existing
          .filter((e) => !keep.has(e.customerId) && !e.response)
          .map((e) => e.id);

        if (removableIds.length > 0) {
          await tx.satisfactionSurveyAccessToken.deleteMany({
            where: { invitationId: { in: removableIds } },
          });
          await tx.satisfactionSurveyInvitation.deleteMany({
            where: { id: { in: removableIds } },
          });
        }

        const toCreate = customers
          .filter((customer) => !existingByCustomer.has(customer.id))
          .map((customer) => ({
            campaignId,
            customerId: customer.id,
            customerNameSnapshot: customer.companyName,
            customerTaxIdSnapshot: customer.taxId,
            responsibleCommercialIdSnapshot:
              customer.CrmCustomerCommercialOwner?.sellerExternalId ?? null,
            responsibleCommercialNameSnapshot:
              customer.CrmCustomerCommercialOwner?.sellerCanonicalName ?? null,
          }));

        let added = 0;
        if (toCreate.length > 0) {
          const created = await tx.satisfactionSurveyInvitation.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
          added = created.count;
        }

        const total = await tx.satisfactionSurveyInvitation.count({ where: { campaignId } });
        return { added, removed: removableIds.length, total };
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: campaignId,
        action: "AUDIENCE_CHANGED",
        newValue: `+${result.added} / -${result.removed} / total ${result.total}`,
        performedBy: userId,
      });

      return result;
    },

    /**
     * Publica: congela o questionário em snapshot, emite os tokens individuais
     * e abre a campanha. Tudo numa transação — nunca fica meio publicada.
     *
     * Idempotente por construção: snapshot e convites usam `skipDuplicates`, e
     * o token só é emitido para convite que ainda não tem um ativo.
     */
    async publishCampaign(
      id: string,
      userId: string | null
    ): Promise<{ campaignId: string; questionCount: number; invitationCount: number }> {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id },
        include: { template: { include: { questions: { orderBy: { sortOrder: "asc" } } } } },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");

      assertCampaignTransition(campaign.status as SatisfactionCampaignStatusValue, "OPEN");

      const invitationCount = await prisma.satisfactionSurveyInvitation.count({
        where: { campaignId: id },
      });
      if (invitationCount === 0 && !campaign.allowGeneralLink) {
        throw new SatisfactionDomainError(
          "Selecione ao menos um cliente ou habilite o link geral antes de publicar.",
          "INVALID_STATE"
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        // 1. Snapshot imutável do questionário.
        await tx.satisfactionSurveyCampaignQuestion.createMany({
          data: campaign.template.questions.map((question) => ({
            campaignId: id,
            sourceQuestionId: question.id,
            code: question.code,
            label: question.label,
            helpText: question.helpText,
            type: question.type,
            sortOrder: question.sortOrder,
            required: question.required,
            scaleMin: question.scaleMin,
            scaleMax: question.scaleMax,
          })),
          skipDuplicates: true,
        });

        // 2. Token individual para quem ainda não tem um ativo.
        const invitations = await tx.satisfactionSurveyInvitation.findMany({
          where: { campaignId: id, revokedAt: null },
          select: {
            id: true,
            accessTokens: { where: { status: "ACTIVE" }, select: { id: true } },
          },
        });
        const needToken = invitations.filter((inv) => inv.accessTokens.length === 0);
        if (needToken.length > 0) {
          await tx.satisfactionSurveyAccessToken.createMany({
            data: needToken.map((inv) => {
              const generated = generateSatisfactionToken();
              return {
                campaignId: id,
                invitationId: inv.id,
                kind: "INDIVIDUAL" as const,
                tokenHash: generated.tokenHash,
                tokenPrefix: generated.tokenPrefix,
                createdByUserId: userId,
              };
            }),
          });
        }

        // 3. Link geral opcional (um único ativo por campanha).
        if (campaign.allowGeneralLink) {
          const generalExists = await tx.satisfactionSurveyAccessToken.count({
            where: { campaignId: id, kind: "GENERAL", status: "ACTIVE" },
          });
          if (generalExists === 0) {
            const generated = generateSatisfactionToken();
            await tx.satisfactionSurveyAccessToken.create({
              data: {
                campaignId: id,
                kind: "GENERAL",
                tokenHash: generated.tokenHash,
                tokenPrefix: generated.tokenPrefix,
                createdByUserId: userId,
              },
            });
          }
        }

        const questionCount = await tx.satisfactionSurveyCampaignQuestion.count({
          where: { campaignId: id },
        });

        await tx.satisfactionSurveyCampaign.update({
          where: { id },
          data: {
            status: "OPEN",
            publishedAt: campaign.publishedAt ?? new Date(),
            publishedByUserId: campaign.publishedByUserId ?? userId,
            opensAt: campaign.opensAt ?? new Date(),
          },
        });

        return { campaignId: id, questionCount, invitationCount: invitations.length };
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: id,
        action: "PUBLISHED",
        newValue: `perguntas ${result.questionCount} / convites ${result.invitationCount}`,
        performedBy: userId,
      });

      return result;
    },

    async closeCampaign(id: string, userId: string | null) {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      assertCampaignTransition(campaign.status as SatisfactionCampaignStatusValue, "CLOSED");

      const updated = await prisma.satisfactionSurveyCampaign.update({
        where: { id },
        data: { status: "CLOSED", closedAt: new Date() },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: id,
        action: "CLOSED",
        performedBy: userId,
      });
      return updated;
    },

    async archiveCampaign(id: string, userId: string | null) {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id },
        select: { id: true, status: true },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      assertCampaignTransition(campaign.status as SatisfactionCampaignStatusValue, "ARCHIVED");

      const updated = await prisma.satisfactionSurveyCampaign.update({
        where: { id },
        data: { status: "ARCHIVED", archivedAt: new Date() },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: id,
        action: "ARCHIVED",
        performedBy: userId,
      });
      return updated;
    },

    /** Exclusão física só de rascunho virgem — histórico nunca some. */
    async deleteCampaign(id: string, userId: string | null): Promise<void> {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          publishedAt: true,
          _count: { select: { invitations: true, responses: true } },
        },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");

      const deletable = canDeleteCampaign({
        status: campaign.status as SatisfactionCampaignStatusValue,
        publishedAt: campaign.publishedAt,
        invitationCount: campaign._count.invitations,
        responseCount: campaign._count.responses,
      });
      if (!deletable) {
        throw new SatisfactionDomainError(
          "Só um rascunho sem convites e sem respostas pode ser excluído. Use Encerrar/Arquivar para preservar o histórico.",
          "CONFLICT"
        );
      }

      await prisma.satisfactionSurveyCampaign.delete({ where: { id } });
      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: id,
        action: "DELETED",
        performedBy: userId,
      });
    },

    /** Duplica como novo rascunho: mesma configuração, audiência e história zeradas. */
    async duplicateCampaign(id: string, userId: string | null) {
      const source = await prisma.satisfactionSurveyCampaign.findUnique({ where: { id } });
      if (!source) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");

      const baseCode = `${source.code}_COPIA`;
      let code = baseCode;
      for (let attempt = 2; attempt <= 50; attempt += 1) {
        const clash = await prisma.satisfactionSurveyCampaign.findUnique({
          where: { code },
          select: { id: true },
        });
        if (!clash) break;
        code = `${baseCode}_${attempt}`;
      }

      const created = await prisma.satisfactionSurveyCampaign.create({
        data: {
          code,
          name: `${source.name} (cópia)`,
          description: source.description,
          templateId: source.templateId,
          referenceStart: source.referenceStart,
          referenceEnd: source.referenceEnd,
          allowGeneralLink: source.allowGeneralLink,
          createdByUserId: userId,
          status: "DRAFT",
        },
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: created.id,
        action: "CREATED",
        newValue: `duplicada de ${source.code}`,
        performedBy: userId,
      });

      return created;
    },
  };
}

export type SatisfactionCampaignService = ReturnType<
  typeof createSatisfactionCampaignService
>;

/** Reexportado para as rotas montarem DTO sem reimplementar arredondamento. */
export { roundTo };
