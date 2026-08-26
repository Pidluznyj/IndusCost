/**
 * Satisfação — analytics (dashboard e resultados da campanha).
 *
 * O backend é dono da semântica: o React recebe DTO pronto e só desenha.
 * Nenhuma consulta traz respostas para o Node só para contar — tudo é
 * agregação SQL com filtro no banco.
 */

import type { PrismaClient } from "@prisma/client";
import {
  averageFromTotals,
  calculateAbandonmentRate,
  calculateFunnelRate,
  calculateResponseRate,
  emptyDistribution,
  resolveTrend,
  roundTo,
  type SatisfactionRatingDistribution,
  type SatisfactionTrend,
} from "./satisfactionMetrics.js";
import { SATISFACTION_RATING_CODE_SHORT_LABELS } from "./satisfactionContracts.js";
import { resolveSatisfactionResponsibleNames } from "./satisfactionSellerDisplay.server.js";

export type SatisfactionAnalyticsFilters = {
  campaignIds: string[] | null;
  from: Date | null;
  to: Date | null;
  customerId: string | null;
  responsibleExternalId: number | null;
  /** Escopo de carteira do vendedor; null = sem restrição. */
  allowedCustomerIds: string[] | null;
};

export type SatisfactionCriterionDto = {
  questionCode: string;
  label: string;
  average: number | null;
  count: number;
  positivePercent: number | null;
  criticalPercent: number | null;
  distribution: SatisfactionRatingDistribution;
  trend: SatisfactionTrend;
  trendDelta: number | null;
};

export type SatisfactionDashboardDto = {
  kpis: {
    responseCount: number;
    averageRating: number | null;
    positiveCount: number;
    positivePercent: number | null;
    criticalCount: number;
    criticalPercent: number | null;
    responseRate: number | null;
    alertCustomerCount: number;
  };
  funnel: {
    invited: number;
    opened: number;
    started: number;
    completed: number;
    openRate: number | null;
    startRate: number | null;
    completionRate: number | null;
    abandonmentRate: number | null;
  };
  criteria: SatisfactionCriterionDto[];
  distribution: SatisfactionRatingDistribution;
  evolution: Array<{
    campaignId: string;
    campaignName: string;
    referenceStart: string;
    averageRating: number | null;
    responseCount: number;
  }>;
  attentionPoints: Array<{
    responseId: string;
    customerName: string;
    questionCode: string;
    criterion: string;
    rating: number;
    submittedAt: string | null;
    responsibleCommercialName: string | null;
  }>;
};

type RatingAggregateRow = {
  questionCode: string;
  label: string;
  sum: bigint | number | null;
  count: bigint | number;
  positive: bigint | number;
  critical: bigint | number;
  r1: bigint | number;
  r2: bigint | number;
  r3: bigint | number;
  r4: bigint | number;
  r5: bigint | number;
};

const n = (value: bigint | number | null | undefined): number => Number(value ?? 0);

export function createSatisfactionAnalyticsService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  /**
   * Filtro comum das respostas consideradas. Só SUBMITTED entra — DRAFT nunca
   * participa de métrica de satisfação.
   */
  function buildResponseWhere(filters: SatisfactionAnalyticsFilters) {
    // Pesquisa excluída logicamente não entra em métrica nenhuma.
    const where: Record<string, unknown> = {
      status: "SUBMITTED",
      campaign: { deletedAt: null },
    };
    if (filters.campaignIds?.length) where.campaignId = { in: filters.campaignIds };
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.allowedCustomerIds) {
      where.customerId = filters.customerId
        ? filters.customerId
        : { in: filters.allowedCustomerIds };
    }
    if (filters.from || filters.to) {
      where.submittedAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }
    if (filters.responsibleExternalId != null) {
      where.invitation = {
        responsibleCommercialIdSnapshot: filters.responsibleExternalId,
      };
    }
    return where;
  }

  /** Ids das respostas no recorte — base de todas as agregações de nota. */
  async function selectResponseIds(filters: SatisfactionAnalyticsFilters): Promise<string[]> {
    const rows = await prisma.satisfactionSurveyResponse.findMany({
      where: buildResponseWhere(filters) as never,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async function aggregateByCriterion(responseIds: string[]): Promise<RatingAggregateRow[]> {
    if (responseIds.length === 0) return [];
    return prisma.$queryRaw<RatingAggregateRow[]>`
      SELECT q."code"                                        AS "questionCode",
             MIN(q."label")                                  AS "label",
             SUM(a."ratingValue")                            AS "sum",
             COUNT(a."ratingValue")                          AS "count",
             COUNT(*) FILTER (WHERE a."ratingValue" >= 4)    AS "positive",
             COUNT(*) FILTER (WHERE a."ratingValue" <= 2)    AS "critical",
             COUNT(*) FILTER (WHERE a."ratingValue" = 1)     AS "r1",
             COUNT(*) FILTER (WHERE a."ratingValue" = 2)     AS "r2",
             COUNT(*) FILTER (WHERE a."ratingValue" = 3)     AS "r3",
             COUNT(*) FILTER (WHERE a."ratingValue" = 4)     AS "r4",
             COUNT(*) FILTER (WHERE a."ratingValue" = 5)     AS "r5"
        FROM "SatisfactionSurveyAnswer" a
        JOIN "SatisfactionSurveyCampaignQuestion" q ON q."id" = a."questionId"
       WHERE a."responseId" = ANY(${responseIds}::uuid[])
         AND a."ratingValue" IS NOT NULL
       GROUP BY q."code"
    `;
  }

  function toCriterionDto(
    row: RatingAggregateRow,
    previous: Map<string, number | null>
  ): SatisfactionCriterionDto {
    const count = n(row.count);
    const average = averageFromTotals(n(row.sum), count);
    const { trend, delta } = resolveTrend(average, previous.get(row.questionCode) ?? null);
    return {
      questionCode: row.questionCode,
      label:
        SATISFACTION_RATING_CODE_SHORT_LABELS[
          row.questionCode as keyof typeof SATISFACTION_RATING_CODE_SHORT_LABELS
        ] ?? row.label,
      average,
      count,
      positivePercent: count > 0 ? roundTo((n(row.positive) / count) * 100, 1) : null,
      criticalPercent: count > 0 ? roundTo((n(row.critical) / count) * 100, 1) : null,
      distribution: {
        1: n(row.r1),
        2: n(row.r2),
        3: n(row.r3),
        4: n(row.r4),
        5: n(row.r5),
      },
      trend,
      trendDelta: delta,
    };
  }

  return {
    buildResponseWhere,

    async getDashboard(
      filters: SatisfactionAnalyticsFilters
    ): Promise<SatisfactionDashboardDto> {
      const responseIds = await selectResponseIds(filters);

      const invitationWhere: Record<string, unknown> = {
        revokedAt: null,
        campaign: { deletedAt: null },
      };
      if (filters.campaignIds?.length) invitationWhere.campaignId = { in: filters.campaignIds };
      if (filters.allowedCustomerIds) {
        invitationWhere.customerId = { in: filters.allowedCustomerIds };
      }
      if (filters.responsibleExternalId != null) {
        invitationWhere.responsibleCommercialIdSnapshot = filters.responsibleExternalId;
      }

      const [criterionRows, invitations, alertRows, evolutionRows, attentionRows] =
        await Promise.all([
          aggregateByCriterion(responseIds),
          prisma.satisfactionSurveyInvitation.findMany({
            where: invitationWhere as never,
            select: {
              firstOpenedAt: true,
              startedAt: true,
              completedAt: true,
            },
          }),
          responseIds.length === 0
            ? Promise.resolve([] as Array<{ customerId: string | null }>)
            : prisma.$queryRaw<Array<{ customerId: string | null }>>`
                SELECT DISTINCT r."customerId" AS "customerId"
                  FROM "SatisfactionSurveyAnswer" a
                  JOIN "SatisfactionSurveyResponse" r ON r."id" = a."responseId"
                 WHERE a."responseId" = ANY(${responseIds}::uuid[])
                   AND a."ratingValue" <= 2
              `,
          prisma.$queryRaw<
            Array<{
              campaignId: string;
              campaignName: string;
              referenceStart: Date;
              sum: bigint | number | null;
              count: bigint | number;
              responses: bigint | number;
            }>
          >`
            SELECT c."id"                    AS "campaignId",
                   c."name"                  AS "campaignName",
                   c."referenceStart"        AS "referenceStart",
                   SUM(a."ratingValue")      AS "sum",
                   COUNT(a."ratingValue")    AS "count",
                   COUNT(DISTINCT r."id")    AS "responses"
              FROM "SatisfactionSurveyCampaign" c
              JOIN "SatisfactionSurveyResponse" r
                ON r."campaignId" = c."id" AND r."status" = 'SUBMITTED'
              LEFT JOIN "SatisfactionSurveyAnswer" a
                ON a."responseId" = r."id" AND a."ratingValue" IS NOT NULL
             WHERE c."deletedAt" IS NULL
             GROUP BY c."id", c."name", c."referenceStart"
             ORDER BY c."referenceStart" ASC
             LIMIT 24
          `,
          responseIds.length === 0
            ? Promise.resolve(
                [] as Array<{
                  responseId: string;
                  customerName: string | null;
                  questionCode: string;
                  label: string;
                  rating: number;
                  submittedAt: Date | null;
                  responsible: string | null;
                  responsibleId: number | null;
                }>
              )
            : prisma.$queryRaw<
                Array<{
                  responseId: string;
                  customerName: string | null;
                  questionCode: string;
                  label: string;
                  rating: number;
                  submittedAt: Date | null;
                  responsible: string | null;
                  responsibleId: number | null;
                }>
              >`
                SELECT r."id"                                             AS "responseId",
                       COALESCE(i."customerNameSnapshot",
                                r."declaredCompanyName")                 AS "customerName",
                       q."code"                                          AS "questionCode",
                       q."label"                                         AS "label",
                       a."ratingValue"                                   AS "rating",
                       r."submittedAt"                                   AS "submittedAt",
                       i."responsibleCommercialNameSnapshot"             AS "responsible",
                       i."responsibleCommercialIdSnapshot"               AS "responsibleId"
                  FROM "SatisfactionSurveyAnswer" a
                  JOIN "SatisfactionSurveyResponse" r ON r."id" = a."responseId"
                  JOIN "SatisfactionSurveyCampaignQuestion" q ON q."id" = a."questionId"
                  LEFT JOIN "SatisfactionSurveyInvitation" i ON i."id" = r."invitationId"
                 WHERE a."responseId" = ANY(${responseIds}::uuid[])
                   AND a."ratingValue" <= 2
                 ORDER BY a."ratingValue" ASC, r."submittedAt" DESC NULLS LAST
                 LIMIT 100
              `,
        ]);

      // Comparativo com a campanha imediatamente anterior, por critério.
      const previousByCriterion = new Map<string, number | null>();
      if (filters.campaignIds?.length === 1) {
        const current = evolutionRows.findIndex((r) => r.campaignId === filters.campaignIds![0]);
        const previousCampaign = current > 0 ? evolutionRows[current - 1] : null;
        if (previousCampaign) {
          const previousIds = await prisma.satisfactionSurveyResponse.findMany({
            where: { campaignId: previousCampaign.campaignId, status: "SUBMITTED" },
            select: { id: true },
          });
          for (const row of await aggregateByCriterion(previousIds.map((r) => r.id))) {
            previousByCriterion.set(
              row.questionCode,
              averageFromTotals(n(row.sum), n(row.count))
            );
          }
        }
      }

      const distribution = emptyDistribution();
      let totalSum = 0;
      let totalCount = 0;
      let totalPositive = 0;
      let totalCritical = 0;
      for (const row of criterionRows) {
        totalSum += n(row.sum);
        totalCount += n(row.count);
        totalPositive += n(row.positive);
        totalCritical += n(row.critical);
        distribution[1] += n(row.r1);
        distribution[2] += n(row.r2);
        distribution[3] += n(row.r3);
        distribution[4] += n(row.r4);
        distribution[5] += n(row.r5);
      }

      const invited = invitations.length;
      const opened = invitations.filter((i) => i.firstOpenedAt).length;
      const started = invitations.filter((i) => i.startedAt).length;
      const completed = invitations.filter((i) => i.completedAt).length;

      // Nome do responsável nos pontos de atenção: mesmo motor oficial do
      // CRM/Pedidos (snapshot pode conter o placeholder "Vendedor ID N").
      const attentionResponsibleRows = attentionRows.map((row) => ({
        row,
        responsibleCommercialIdSnapshot: row.responsibleId ?? null,
        responsibleCommercialNameSnapshot: row.responsible ?? null,
      }));
      const attentionNames = await resolveSatisfactionResponsibleNames(
        prisma,
        attentionResponsibleRows
      );
      const attentionNameByRow = new Map(
        attentionResponsibleRows.map((e) => [e.row, attentionNames.get(e) ?? null])
      );

      return {
        kpis: {
          responseCount: responseIds.length,
          averageRating: averageFromTotals(totalSum, totalCount),
          positiveCount: totalPositive,
          positivePercent:
            totalCount > 0 ? roundTo((totalPositive / totalCount) * 100, 1) : null,
          criticalCount: totalCritical,
          criticalPercent:
            totalCount > 0 ? roundTo((totalCritical / totalCount) * 100, 1) : null,
          responseRate: calculateResponseRate({
            activeInvitations: invited,
            completedInvitations: completed,
          }),
          alertCustomerCount: new Set(
            alertRows.map((row) => row.customerId).filter((id): id is string => Boolean(id))
          ).size,
        },
        funnel: {
          invited,
          opened,
          started,
          completed,
          openRate: calculateFunnelRate(opened, invited),
          startRate: calculateFunnelRate(started, invited),
          completionRate: calculateFunnelRate(completed, invited),
          abandonmentRate: calculateAbandonmentRate({
            startedCount: started,
            completedCount: completed,
          }),
        },
        criteria: criterionRows
          .map((row) => toCriterionDto(row, previousByCriterion))
          .sort((a, b) => {
            if (a.average == null && b.average == null) return 0;
            if (a.average == null) return 1;
            if (b.average == null) return -1;
            return a.average - b.average;
          }),
        distribution,
        evolution: evolutionRows.map((row) => ({
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          referenceStart: row.referenceStart.toISOString(),
          averageRating: averageFromTotals(n(row.sum), n(row.count)),
          responseCount: n(row.responses),
        })),
        attentionPoints: attentionRows.map((row) => ({
          responseId: row.responseId,
          customerName: row.customerName ?? "Cliente não identificado",
          questionCode: row.questionCode,
          criterion:
            SATISFACTION_RATING_CODE_SHORT_LABELS[
              row.questionCode as keyof typeof SATISFACTION_RATING_CODE_SHORT_LABELS
            ] ?? row.label,
          rating: Number(row.rating),
          submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
          responsibleCommercialName: attentionNameByRow.get(row) ?? null,
        })),
      };
    },

    /**
     * Histórico de um cliente comparável entre campanhas.
     * Compara SEMPRE por `question.code` — nunca por posição, que mudaria de
     * significado se o questionário evoluir.
     */
    async getCustomerHistory(customerId: string, limit = 10) {
      return prisma.$queryRaw<
        Array<{
          campaignName: string;
          submittedAt: Date | null;
          questionCode: string;
          rating: number;
        }>
      >`
        SELECT c."name"          AS "campaignName",
               r."submittedAt"   AS "submittedAt",
               q."code"          AS "questionCode",
               a."ratingValue"   AS "rating"
          FROM "SatisfactionSurveyResponse" r
          JOIN "SatisfactionSurveyCampaign" c ON c."id" = r."campaignId"
          JOIN "SatisfactionSurveyAnswer" a ON a."responseId" = r."id"
          JOIN "SatisfactionSurveyCampaignQuestion" q ON q."id" = a."questionId"
         WHERE r."customerId" = ${customerId}::uuid
           AND r."status" = 'SUBMITTED'
           AND a."ratingValue" IS NOT NULL
         ORDER BY r."submittedAt" DESC NULLS LAST
         LIMIT ${limit * 12}
      `;
    },
  };
}

export type SatisfactionAnalyticsService = ReturnType<
  typeof createSatisfactionAnalyticsService
>;
