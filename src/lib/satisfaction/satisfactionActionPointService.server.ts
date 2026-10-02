/**
 * Satisfação — action points (camada com I/O).
 *
 * Regras que este serviço garante:
 *  - Só pesquisa ENCERRADA (ou arquivada) tem action points.
 *  - Um action point por ponto de atenção: a âncora é a resposta crítica
 *    (`answerId` UNIQUE), nunca um texto ou posição.
 *  - Só nota crítica (<= 2) de resposta SUBMITTED vira ponto de atenção — a
 *    mesma regra do dashboard (`SATISFACTION_CRITICAL_MAX`).
 *  - O escopo de carteira do vendedor é aplicado na consulta, não na tela.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  SATISFACTION_RATING_CODE_SHORT_LABELS,
  type SatisfactionCampaignStatusValue,
} from "./satisfactionContracts.js";
import { SATISFACTION_CRITICAL_MAX } from "./satisfactionMetrics.js";
import {
  canManageActionPoints,
  formatDateOnly,
  isActionPointOverdue,
  todayDateOnly,
  type SatisfactionActionPointInput,
  type SatisfactionActionPointPriorityValue,
  type SatisfactionActionPointStatusValue,
} from "./satisfactionActionPoints.js";
import {
  recordSatisfactionAudit,
  SATISFACTION_AUDIT_ENTITIES,
} from "./satisfactionAudit.server.js";
import { SatisfactionDomainError } from "./satisfactionCampaignService.server.js";
import { resolveSatisfactionResponsibleNames } from "./satisfactionSellerDisplay.server.js";

export type SatisfactionActionPointDto = {
  id: string;
  responsibleUserId: string;
  responsibleName: string;
  priority: SatisfactionActionPointPriorityValue;
  status: SatisfactionActionPointStatusValue;
  rootCause: string | null;
  actionPlan: string;
  dueDate: string | null;
  overdue: boolean;
  completedAt: string | null;
  resultNotes: string | null;
  customerFeedbackAt: string | null;
  updatedAt: string;
};

export type SatisfactionAttentionPointRow = {
  /** Âncora do action point: a resposta crítica. */
  answerId: string;
  responseId: string;
  customerName: string;
  questionCode: string;
  criterion: string;
  rating: number;
  submittedAt: string | null;
  responsibleCommercialName: string | null;
  actionPoint: SatisfactionActionPointDto | null;
};

export type SatisfactionActionPointBoard = {
  campaign: { id: string; code: string; name: string; status: SatisfactionCampaignStatusValue };
  /** false enquanto a pesquisa não foi encerrada. */
  enabled: boolean;
  summary: {
    attentionPoints: number;
    withoutActionPoint: number;
    open: number;
    inProgress: number;
    done: number;
    cancelled: number;
    overdue: number;
  };
  rows: SatisfactionAttentionPointRow[];
};

/** Teto de pontos de atenção por pesquisa — pesquisa B2B, volume pequeno. */
const MAX_ATTENTION_POINTS = 1000;

const ACTION_POINT_SELECT = {
  id: true,
  responsibleUserId: true,
  responsibleNameSnapshot: true,
  priority: true,
  status: true,
  rootCause: true,
  actionPlan: true,
  dueDate: true,
  completedAt: true,
  resultNotes: true,
  customerFeedbackAt: true,
  updatedAt: true,
} as const;

type ActionPointRecord = Prisma.SatisfactionActionPointGetPayload<{
  select: typeof ACTION_POINT_SELECT;
}>;

function toActionPointDto(record: ActionPointRecord, today: string): SatisfactionActionPointDto {
  const status = record.status as SatisfactionActionPointStatusValue;
  const dueDate = formatDateOnly(record.dueDate);
  return {
    id: record.id,
    responsibleUserId: record.responsibleUserId,
    responsibleName: record.responsibleNameSnapshot,
    priority: record.priority as SatisfactionActionPointPriorityValue,
    status,
    rootCause: record.rootCause,
    actionPlan: record.actionPlan,
    dueDate,
    overdue: isActionPointOverdue({ status, dueDate }, today),
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    resultNotes: record.resultNotes,
    customerFeedbackAt: formatDateOnly(record.customerFeedbackAt),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createSatisfactionActionPointService(deps: {
  prisma: PrismaClient;
  now?: () => Date;
}) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  return {
    /** Pontos de atenção da pesquisa, cada um com o seu action point (se houver). */
    async getBoard(
      campaignId: string,
      allowedCustomerIds: string[] | null
    ): Promise<SatisfactionActionPointBoard> {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, code: true, name: true, status: true, deletedAt: true },
      });
      if (!campaign || campaign.deletedAt) {
        throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      }
      const status = campaign.status as SatisfactionCampaignStatusValue;
      const enabled = canManageActionPoints(status);

      const answers = enabled
        ? await prisma.satisfactionSurveyAnswer.findMany({
            where: {
              ratingValue: { lte: SATISFACTION_CRITICAL_MAX },
              response: {
                campaignId,
                status: "SUBMITTED",
                ...(allowedCustomerIds ? { customerId: { in: allowedCustomerIds } } : {}),
              },
            },
            orderBy: [{ ratingValue: "asc" }, { createdAt: "asc" }],
            take: MAX_ATTENTION_POINTS,
            select: {
              id: true,
              ratingValue: true,
              question: { select: { code: true, label: true } },
              response: {
                select: {
                  id: true,
                  declaredCompanyName: true,
                  submittedAt: true,
                  originalSubmittedAt: true,
                  invitation: {
                    select: {
                      customerNameSnapshot: true,
                      responsibleCommercialIdSnapshot: true,
                      responsibleCommercialNameSnapshot: true,
                    },
                  },
                },
              },
              actionPoint: { select: ACTION_POINT_SELECT },
            },
          })
        : [];

      // Nome do responsável comercial pelo mesmo motor oficial das outras telas.
      const invitations = answers
        .map((answer) => answer.response.invitation)
        .filter((invitation): invitation is NonNullable<typeof invitation> => invitation != null);
      const commercialNames = await resolveSatisfactionResponsibleNames(prisma, invitations);

      const today = todayDateOnly(now());
      const rows = answers.map((answer): SatisfactionAttentionPointRow => {
        const submittedAt = answer.response.originalSubmittedAt ?? answer.response.submittedAt;
        return {
          answerId: answer.id,
          responseId: answer.response.id,
          customerName:
            answer.response.invitation?.customerNameSnapshot ??
            answer.response.declaredCompanyName ??
            "Cliente não identificado",
          questionCode: answer.question.code,
          criterion:
            SATISFACTION_RATING_CODE_SHORT_LABELS[
              answer.question.code as keyof typeof SATISFACTION_RATING_CODE_SHORT_LABELS
            ] ?? answer.question.label,
          rating: Number(answer.ratingValue),
          submittedAt: submittedAt ? submittedAt.toISOString() : null,
          responsibleCommercialName: answer.response.invitation
            ? (commercialNames.get(answer.response.invitation) ?? null)
            : null,
          actionPoint: answer.actionPoint ? toActionPointDto(answer.actionPoint, today) : null,
        };
      });

      const count = (value: SatisfactionActionPointStatusValue) =>
        rows.filter((row) => row.actionPoint?.status === value).length;

      return {
        campaign: { id: campaign.id, code: campaign.code, name: campaign.name, status },
        enabled,
        summary: {
          attentionPoints: rows.length,
          withoutActionPoint: rows.filter((row) => !row.actionPoint).length,
          open: count("OPEN"),
          inProgress: count("IN_PROGRESS"),
          done: count("DONE"),
          cancelled: count("CANCELLED"),
          overdue: rows.filter((row) => row.actionPoint?.overdue).length,
        },
        rows,
      };
    },

    /** Cria ou atualiza o action point do ponto de atenção (idempotente por answerId). */
    async saveActionPoint(
      answerId: string,
      input: SatisfactionActionPointInput,
      context: { userId: string | null; allowedCustomerIds: string[] | null }
    ): Promise<SatisfactionActionPointDto> {
      const answer = await prisma.satisfactionSurveyAnswer.findUnique({
        where: { id: answerId },
        select: {
          id: true,
          ratingValue: true,
          response: {
            select: {
              status: true,
              customerId: true,
              campaign: { select: { id: true, status: true, deletedAt: true } },
            },
          },
          actionPoint: {
            select: { id: true, status: true, completedAt: true, responsibleUserId: true },
          },
        },
      });
      if (
        !answer ||
        answer.response.campaign.deletedAt ||
        answer.response.status !== "SUBMITTED" ||
        answer.ratingValue == null ||
        answer.ratingValue > SATISFACTION_CRITICAL_MAX
      ) {
        throw new SatisfactionDomainError("Ponto de atenção não encontrado.", "NOT_FOUND");
      }

      const { allowedCustomerIds } = context;
      if (
        allowedCustomerIds &&
        (!answer.response.customerId || !allowedCustomerIds.includes(answer.response.customerId))
      ) {
        throw new SatisfactionDomainError("Cliente fora da sua carteira comercial.", "FORBIDDEN");
      }

      if (!canManageActionPoints(answer.response.campaign.status as SatisfactionCampaignStatusValue)) {
        throw new SatisfactionDomainError(
          "Action points só podem ser registrados depois que a pesquisa é encerrada.",
          "LOCKED"
        );
      }

      const responsible = await prisma.appUser.findUnique({
        where: { id: input.responsibleUserId },
        select: { id: true, name: true, isActive: true },
      });
      // Usuário inativo só é aceito se já era o responsável (edição de outro campo).
      const keepsResponsible = answer.actionPoint?.responsibleUserId === input.responsibleUserId;
      if (!responsible || (!responsible.isActive && !keepsResponsible)) {
        throw new SatisfactionDomainError(
          "Responsável inválido: selecione um usuário ativo.",
          "INVALID_STATE"
        );
      }

      const completedAt =
        input.status === "DONE" ? (answer.actionPoint?.completedAt ?? now()) : null;

      const data = {
        responsibleUserId: responsible.id,
        responsibleNameSnapshot: responsible.name,
        priority: input.priority,
        status: input.status,
        rootCause: input.rootCause,
        actionPlan: input.actionPlan,
        dueDate: input.dueDate,
        completedAt,
        resultNotes: input.resultNotes,
        customerFeedbackAt: input.customerFeedbackAt,
        updatedByUserId: context.userId,
      };

      const saved = await prisma.satisfactionActionPoint.upsert({
        where: { answerId },
        create: {
          ...data,
          campaignId: answer.response.campaign.id,
          answerId,
          createdByUserId: context.userId,
        },
        update: data,
        select: ACTION_POINT_SELECT,
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.actionPoint,
        entityId: saved.id,
        action: answer.actionPoint ? "UPDATED" : "CREATED",
        oldValue: answer.actionPoint?.status ?? null,
        // Só situação/prazo/responsável: o texto do plano não vai para a trilha.
        newValue: `${input.status} / prazo ${formatDateOnly(input.dueDate)} / ${responsible.name}`,
        performedBy: context.userId,
      });

      return toActionPointDto(saved, todayDateOnly(now()));
    },

    /** Usuários ativos que podem ser responsáveis por um action point. */
    async listAssignees(): Promise<Array<{ id: string; name: string }>> {
      return prisma.appUser.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      });
    },
  };
}

export type SatisfactionActionPointService = ReturnType<
  typeof createSatisfactionActionPointService
>;
