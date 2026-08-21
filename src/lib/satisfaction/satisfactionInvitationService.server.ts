/**
 * Satisfação — convites e links públicos.
 *
 * Consequência deliberada de guardar só o hash: o token em claro NÃO pode ser
 * recuperado depois. "Copiar link" de um convite que já tem token emitido
 * significa ROTACIONAR (revoga o anterior, emite um novo e o entrega uma única
 * vez). O link antigo deixa de valer na hora — o que é o comportamento correto
 * para um segredo, e é registrado na auditoria.
 *
 * A alternativa (guardar o token reversível para poder recopiar) foi rejeitada:
 * comprometeria o hashing só para conveniência de UI.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  resolveInvitationStatus,
  type SatisfactionInvitationStatusValue,
} from "./satisfactionContracts.js";
import {
  buildSatisfactionPublicUrl,
  generateSatisfactionToken,
} from "./satisfactionToken.js";
import {
  recordSatisfactionAudit,
  SATISFACTION_AUDIT_ENTITIES,
} from "./satisfactionAudit.server.js";
import { SatisfactionDomainError } from "./satisfactionCampaignService.server.js";

export type SatisfactionInvitationRow = {
  id: string;
  customerId: string;
  customerName: string;
  responsibleCommercialName: string | null;
  status: SatisfactionInvitationStatusValue;
  firstOpenedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  revokedAt: Date | null;
  /** Já existe link ativo? O token em si nunca é devolvido aqui. */
  hasActiveLink: boolean;
  /** Trecho não sensível, para o operador reconhecer o link no suporte. */
  linkPrefix: string | null;
  responseId: string | null;
};

export type SatisfactionIssuedLink = {
  /** Texto em claro — só existe nesta resposta, nunca é relido do banco. */
  url: string;
  tokenPrefix: string;
  rotated: boolean;
};

const MAX_PAGE_SIZE = 200;

export function createSatisfactionInvitationService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  async function loadInvitationOrThrow(invitationId: string) {
    const invitation = await prisma.satisfactionSurveyInvitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        campaignId: true,
        customerId: true,
        revokedAt: true,
        completedAt: true,
        campaign: { select: { status: true } },
      },
    });
    if (!invitation) {
      throw new SatisfactionDomainError("Convite não encontrado.", "NOT_FOUND");
    }
    return invitation;
  }

  return {
    async listInvitations(
      campaignId: string,
      filters: {
        page: number;
        pageSize: number;
        status: SatisfactionInvitationStatusValue | null;
        search: string | null;
        allowedCustomerIds: string[] | null;
      }
    ): Promise<{
      rows: SatisfactionInvitationRow[];
      total: number;
      page: number;
      pageSize: number;
    }> {
      const pageSize = Math.min(Math.max(1, Math.trunc(filters.pageSize) || 25), MAX_PAGE_SIZE);
      const page = Math.max(1, Math.trunc(filters.page) || 1);

      const where: Prisma.SatisfactionSurveyInvitationWhereInput = { campaignId };
      if (filters.search) {
        where.customerNameSnapshot = { contains: filters.search, mode: "insensitive" };
      }
      if (filters.allowedCustomerIds) {
        where.customerId = { in: filters.allowedCustomerIds };
      }
      // Status é derivado; traduzimos para condição de banco, sem filtrar no Node.
      switch (filters.status) {
        case "REVOKED":
          where.revokedAt = { not: null };
          break;
        case "COMPLETED":
          where.revokedAt = null;
          where.completedAt = { not: null };
          break;
        case "STARTED":
          where.revokedAt = null;
          where.completedAt = null;
          where.startedAt = { not: null };
          break;
        case "OPENED":
          where.revokedAt = null;
          where.completedAt = null;
          where.startedAt = null;
          where.firstOpenedAt = { not: null };
          break;
        case "NOT_OPENED":
          where.revokedAt = null;
          where.firstOpenedAt = null;
          break;
        default:
          break;
      }

      const [total, invitations] = await Promise.all([
        prisma.satisfactionSurveyInvitation.count({ where }),
        prisma.satisfactionSurveyInvitation.findMany({
          where,
          orderBy: [{ customerNameSnapshot: "asc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            customerId: true,
            customerNameSnapshot: true,
            responsibleCommercialNameSnapshot: true,
            firstOpenedAt: true,
            startedAt: true,
            completedAt: true,
            revokedAt: true,
            response: { select: { id: true, status: true } },
            accessTokens: {
              where: { status: "ACTIVE" },
              select: { tokenPrefix: true },
              take: 1,
            },
          },
        }),
      ]);

      const rows = invitations.map((invitation): SatisfactionInvitationRow => ({
        id: invitation.id,
        customerId: invitation.customerId,
        customerName: invitation.customerNameSnapshot,
        responsibleCommercialName: invitation.responsibleCommercialNameSnapshot,
        status: resolveInvitationStatus(invitation),
        firstOpenedAt: invitation.firstOpenedAt,
        startedAt: invitation.startedAt,
        completedAt: invitation.completedAt,
        revokedAt: invitation.revokedAt,
        hasActiveLink: invitation.accessTokens.length > 0,
        linkPrefix: invitation.accessTokens[0]?.tokenPrefix ?? null,
        responseId:
          invitation.response?.status === "SUBMITTED" ? invitation.response.id : null,
      }));

      return { rows, total, page, pageSize };
    },

    /**
     * Emite (ou rotaciona) o link individual e devolve o texto em claro UMA vez.
     * Tokens anteriores são revogados na mesma transação — nunca há dois links
     * válidos para o mesmo convite.
     */
    async issueInvitationLink(
      invitationId: string,
      baseUrl: string | null,
      userId: string | null
    ): Promise<SatisfactionIssuedLink> {
      const invitation = await loadInvitationOrThrow(invitationId);
      if (invitation.revokedAt) {
        throw new SatisfactionDomainError(
          "Convite revogado. Reative a audiência antes de gerar um novo link.",
          "CONFLICT"
        );
      }
      if (invitation.campaign.status === "ARCHIVED") {
        throw new SatisfactionDomainError(
          "Pesquisa arquivada: não é possível gerar novos links.",
          "LOCKED"
        );
      }

      const generated = generateSatisfactionToken();

      const rotated = await prisma.$transaction(async (tx) => {
        const previous = await tx.satisfactionSurveyAccessToken.findMany({
          where: { invitationId, status: "ACTIVE" },
          select: { id: true },
        });
        if (previous.length > 0) {
          await tx.satisfactionSurveyAccessToken.updateMany({
            where: { id: { in: previous.map((p) => p.id) } },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        await tx.satisfactionSurveyAccessToken.create({
          data: {
            campaignId: invitation.campaignId,
            invitationId,
            kind: "INDIVIDUAL",
            tokenHash: generated.tokenHash,
            tokenPrefix: generated.tokenPrefix,
            createdByUserId: userId,
            rotatedFromId: previous[0]?.id ?? null,
          },
        });
        return previous.length > 0;
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.invitation,
        entityId: invitationId,
        action: rotated ? "LINK_REGENERATED" : "LINK_GENERATED",
        // Só o prefixo não sensível entra na trilha; jamais o token.
        newValue: `prefixo ${generated.tokenPrefix}`,
        performedBy: userId,
      });

      return {
        url: buildSatisfactionPublicUrl(generated.token, baseUrl),
        tokenPrefix: generated.tokenPrefix,
        rotated,
      };
    },

    /** Revoga o convite e todos os seus links. A resposta já enviada permanece. */
    async revokeInvitation(invitationId: string, userId: string | null): Promise<void> {
      const invitation = await loadInvitationOrThrow(invitationId);
      if (invitation.revokedAt) return;

      await prisma.$transaction(async (tx) => {
        await tx.satisfactionSurveyAccessToken.updateMany({
          where: { invitationId, status: "ACTIVE" },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
        await tx.satisfactionPublicSession.updateMany({
          where: { invitationId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.satisfactionSurveyInvitation.update({
          where: { id: invitationId },
          data: { revokedAt: new Date() },
        });
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.invitation,
        entityId: invitationId,
        action: "LINK_REVOKED",
        performedBy: userId,
      });
    },

    /** Link geral da campanha (WhatsApp/QR). Também entregue uma única vez. */
    async issueGeneralLink(
      campaignId: string,
      baseUrl: string | null,
      userId: string | null
    ): Promise<SatisfactionIssuedLink> {
      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, allowGeneralLink: true },
      });
      if (!campaign) throw new SatisfactionDomainError("Pesquisa não encontrada.", "NOT_FOUND");
      if (!campaign.allowGeneralLink) {
        throw new SatisfactionDomainError(
          "Esta pesquisa não habilitou o link geral.",
          "INVALID_STATE"
        );
      }
      if (campaign.status === "ARCHIVED") {
        throw new SatisfactionDomainError("Pesquisa arquivada.", "LOCKED");
      }

      const generated = generateSatisfactionToken();
      const rotated = await prisma.$transaction(async (tx) => {
        const previous = await tx.satisfactionSurveyAccessToken.findMany({
          where: { campaignId, kind: "GENERAL", status: "ACTIVE" },
          select: { id: true },
        });
        if (previous.length > 0) {
          await tx.satisfactionSurveyAccessToken.updateMany({
            where: { id: { in: previous.map((p) => p.id) } },
            data: { status: "REVOKED", revokedAt: new Date() },
          });
        }
        await tx.satisfactionSurveyAccessToken.create({
          data: {
            campaignId,
            kind: "GENERAL",
            tokenHash: generated.tokenHash,
            tokenPrefix: generated.tokenPrefix,
            createdByUserId: userId,
            rotatedFromId: previous[0]?.id ?? null,
          },
        });
        return previous.length > 0;
      });

      await recordSatisfactionAudit(prisma, {
        entityType: SATISFACTION_AUDIT_ENTITIES.campaign,
        entityId: campaignId,
        action: rotated ? "LINK_REGENERATED" : "LINK_GENERATED",
        newValue: `link geral, prefixo ${generated.tokenPrefix}`,
        performedBy: userId,
      });

      return {
        url: buildSatisfactionPublicUrl(generated.token, baseUrl),
        tokenPrefix: generated.tokenPrefix,
        rotated,
      };
    },
  };
}

export type SatisfactionInvitationService = ReturnType<
  typeof createSatisfactionInvitationService
>;
