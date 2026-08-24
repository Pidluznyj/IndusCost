/**
 * Satisfação — serviço da superfície pública (cliente respondendo pela Internet).
 *
 * Segurança:
 *  - O token do link é trocado UMA vez por uma sessão pública de escopo
 *    `SATISFACTION_RESPONSE`, amarrada a campanha/convite. Essa sessão não é
 *    AppSession, não tem papel, não tem permissão e não abre nada do IndusCost.
 *  - O DTO devolvido contém só o necessário para preencher o formulário:
 *    nenhum id interno, nenhum dado financeiro, nenhum outro cliente.
 *  - Submit é transacional e idempotente: duplo clique, retry de rede ou
 *    refresh não criam segunda resposta.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  resolveCampaignUnavailableReason,
  validateAnswers,
  type SatisfactionAnswerInput,
  type SatisfactionCampaignStatusValue,
  type SatisfactionQuestionSpec,
  type SatisfactionSubmitInput,
  type SatisfactionUnavailableReason,
  type SatisfactionValidationIssue,
  normalizeCompanyNameKey,
  normalizeTaxIdDigits,
} from "./satisfactionContracts.js";
import {
  evaluateTokenUsability,
  generatePublicSessionToken,
  hashSatisfactionToken,
  isWellFormedSatisfactionToken,
} from "./satisfactionToken.js";

/** Vida da sessão pública: folgada para preencher com calma, curta para não virar credencial permanente. */
export const SATISFACTION_PUBLIC_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const SATISFACTION_PUBLIC_SESSION_COOKIE = "induscost_satisfaction_session";
export const SATISFACTION_PUBLIC_SESSION_SCOPE = "SATISFACTION_RESPONSE";

export type SatisfactionPublicFailure = {
  ok: false;
  reason: SatisfactionUnavailableReason;
  message: string;
};

export type SatisfactionPublicSessionResult =
  | { ok: true; sessionToken: string; expiresAt: Date }
  | SatisfactionPublicFailure;

/** Pergunta como o cliente a vê. Sem id interno: a identidade é o `code`. */
export type SatisfactionPublicQuestionDto = {
  code: string;
  label: string;
  helpText: string | null;
  type: string;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
};

export type SatisfactionPublicFormDto = {
  surveyTitle: string;
  surveyDescription: string | null;
  referencePeriod: { start: string; end: string };
  /** Nome de exibição do cliente convidado; null no link geral. */
  customerDisplayName: string | null;
  /** Link geral exige que o respondente se identifique. */
  requiresSelfIdentification: boolean;
  questions: SatisfactionPublicQuestionDto[];
  /**
   * Identificação vinda do CADASTRO (snapshot do convite) no link individual.
   * `locked: true` = o formulário exibe como somente leitura; o servidor
   * também sobrescreve esses códigos no submit, então adulterar via devtools
   * não tem efeito. Vazio no link geral (cliente se identifica).
   */
  identificationPrefill: Array<{
    questionCode: string;
    textValue: string;
    locked: boolean;
  }>;
  draft: {
    version: number;
    answers: Array<{
      questionCode: string;
      ratingValue: number | null;
      textValue: string | null;
      dateValue: string | null;
    }>;
    respondentName: string | null;
    respondentPhone: string | null;
  } | null;
  ratingScale: Array<{ value: number; label: string }>;
  turnstileSiteKey: string | null;
  /**
   * Identidade visual (Configurações > Identidade visual). A logo expandida
   * viaja como data URL dentro do próprio DTO: a superfície pública não pode
   * chamar APIs administrativas (o guard bloqueia), e data URL dispensa
   * liberar qualquer path novo na allowlist.
   */
  branding: {
    logoDataUrl: string | null;
    companyName: string | null;
  };
};

const UNAVAILABLE_MESSAGES: Record<SatisfactionUnavailableReason, string> = {
  NOT_OPEN: "Esta pesquisa não está disponível.",
  NOT_STARTED: "Esta pesquisa ainda não começou.",
  CLOSED: "Esta pesquisa já foi encerrada. Obrigado pelo interesse!",
  ALREADY_ANSWERED: "Suas respostas já foram registradas. Obrigado!",
  REVOKED: "Este link não é mais válido.",
  EXPIRED: "Este link expirou.",
  INVALID: "Link inválido.",
};

function fail(reason: SatisfactionUnavailableReason): SatisfactionPublicFailure {
  return { ok: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
}

/**
 * Forma comum de todo retorno de erro da superfície pública.
 * `reason` é sempre string aqui porque cada operação tem seu próprio conjunto
 * de motivos (indisponibilidade, VALIDATION, VERSION_CONFLICT).
 */
export type SatisfactionPublicErrorResult = {
  ok: false;
  reason: string;
  message?: string;
  issues?: SatisfactionValidationIssue[];
  currentVersion?: number;
};

/**
 * Estreitamento explícito dos retornos `{ ok: true } | { ok: false, ... }`.
 *
 * O `tsconfig.json` do projeto não habilita `strictNullChecks`, e sem ela o
 * TypeScript NÃO estreita união discriminada por literal booleano — `if
 * (!r.ok)` não expõe `r.reason`. Em vez de espalhar cast em cada rota,
 * concentramos a conversão aqui: por construção, todo retorno com `ok: false`
 * carrega `reason`, então o cast é seguro e fica num lugar só.
 */
export function asPublicError(value: {
  ok: boolean;
}): SatisfactionPublicErrorResult | null {
  return value.ok === false ? (value as SatisfactionPublicErrorResult) : null;
}

function toQuestionSpec(question: {
  id: string;
  code: string;
  label: string;
  type: string;
  sortOrder: number;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
}): SatisfactionQuestionSpec {
  return {
    id: question.id,
    code: question.code,
    label: question.label,
    type: question.type as SatisfactionQuestionSpec["type"],
    sortOrder: question.sortOrder,
    required: question.required,
    scaleMin: question.scaleMin,
    scaleMax: question.scaleMax,
  };
}

export function createSatisfactionPublicService(deps: {
  prisma: PrismaClient;
  now?: () => Date;
}) {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());

  /** Resolve a sessão pública ativa a partir do cookie. */
  async function resolveSession(sessionToken: string | null | undefined) {
    if (!sessionToken) return null;
    const tokenHash = hashSatisfactionToken(sessionToken);
    const session = await prisma.satisfactionPublicSession.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now() } },
      select: {
        id: true,
        campaignId: true,
        invitationId: true,
        accessTokenId: true,
        responseId: true,
        scope: true,
      },
    });
    if (!session) return null;
    // Escopo é verificado explicitamente: esta sessão só serve para responder.
    if (session.scope !== SATISFACTION_PUBLIC_SESSION_SCOPE) return null;
    return session;
  }

  return {
    resolveSession,

    /**
     * Troca token do link → sessão pública. O token em claro entra aqui uma
     * única vez e nunca é persistido nem logado.
     */
    async exchangeToken(rawToken: string): Promise<SatisfactionPublicSessionResult> {
      if (!isWellFormedSatisfactionToken(rawToken)) return fail("INVALID");

      const tokenHash = hashSatisfactionToken(rawToken);
      const accessToken = await prisma.satisfactionSurveyAccessToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          campaignId: true,
          invitationId: true,
          kind: true,
          status: true,
          expiresAt: true,
          revokedAt: true,
          campaign: {
            select: { id: true, status: true, opensAt: true, closesAt: true },
          },
          invitation: {
            select: { id: true, revokedAt: true, completedAt: true },
          },
        },
      });

      if (!accessToken) return fail("INVALID");

      const usability = evaluateTokenUsability(
        {
          status: accessToken.status as "ACTIVE" | "REVOKED" | "EXPIRED",
          expiresAt: accessToken.expiresAt,
          revokedAt: accessToken.revokedAt,
        },
        now()
      );
      if (!usability.usable) {
        return fail((usability as { reason: SatisfactionUnavailableReason }).reason);
      }

      if (accessToken.invitation?.revokedAt) return fail("REVOKED");
      if (accessToken.invitation?.completedAt) return fail("ALREADY_ANSWERED");

      const unavailable = resolveCampaignUnavailableReason(
        {
          status: accessToken.campaign.status as SatisfactionCampaignStatusValue,
          opensAt: accessToken.campaign.opensAt,
          closesAt: accessToken.campaign.closesAt,
        },
        now()
      );
      if (unavailable) return fail(unavailable);

      const session = generatePublicSessionToken();
      const expiresAt = new Date(now().getTime() + SATISFACTION_PUBLIC_SESSION_TTL_MS);

      await prisma.$transaction(async (tx) => {
        await tx.satisfactionPublicSession.create({
          data: {
            tokenHash: session.tokenHash,
            campaignId: accessToken.campaignId,
            invitationId: accessToken.invitationId,
            accessTokenId: accessToken.id,
            scope: SATISFACTION_PUBLIC_SESSION_SCOPE,
            expiresAt,
          },
        });
        await tx.satisfactionSurveyAccessToken.update({
          where: { id: accessToken.id },
          data: { lastUsedAt: now() },
        });
        if (accessToken.invitationId) {
          await tx.satisfactionSurveyInvitation.updateMany({
            where: { id: accessToken.invitationId, firstOpenedAt: null },
            data: { firstOpenedAt: now() },
          });
        }
        await tx.satisfactionSurveyEvent.create({
          data: {
            campaignId: accessToken.campaignId,
            invitationId: accessToken.invitationId,
            type: "OPENED",
          },
        });
      });

      return { ok: true, sessionToken: session.token, expiresAt };
    },

    /** DTO do formulário. Minimizado por construção. */
    async getForm(
      sessionToken: string | null,
      turnstileSiteKey: string | null
    ): Promise<{ ok: true; form: SatisfactionPublicFormDto } | SatisfactionPublicFailure> {
      const session = await resolveSession(sessionToken);
      if (!session) return fail("INVALID");

      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: session.campaignId },
        select: {
          name: true,
          description: true,
          status: true,
          opensAt: true,
          closesAt: true,
          referenceStart: true,
          referenceEnd: true,
          questions: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!campaign) return fail("INVALID");

      const unavailable = resolveCampaignUnavailableReason(
        {
          status: campaign.status as SatisfactionCampaignStatusValue,
          opensAt: campaign.opensAt,
          closesAt: campaign.closesAt,
        },
        now()
      );
      if (unavailable) return fail(unavailable);

      const invitation = session.invitationId
        ? await prisma.satisfactionSurveyInvitation.findUnique({
            where: { id: session.invitationId },
            select: {
              customerNameSnapshot: true,
              customerTaxIdSnapshot: true,
              completedAt: true,
              revokedAt: true,
            },
          })
        : null;

      if (invitation?.revokedAt) return fail("REVOKED");
      if (invitation?.completedAt) return fail("ALREADY_ANSWERED");

      const draftWhere: Prisma.SatisfactionSurveyResponseWhereInput | null =
        session.invitationId
          ? { invitationId: session.invitationId }
          : session.responseId
            ? { id: session.responseId }
            : null;

      const existing = draftWhere
        ? await prisma.satisfactionSurveyResponse.findFirst({
        where: draftWhere,
        select: {
          id: true,
          status: true,
          version: true,
          respondentName: true,
          respondentPhone: true,
          answers: {
            select: {
              ratingValue: true,
              textValue: true,
              dateValue: true,
              question: { select: { code: true } },
            },
          },
        },
          })
        : null;

      if (existing?.status === "SUBMITTED") return fail("ALREADY_ANSWERED");

      // Logo do sistema (expandida). Fail-soft: o formulário nunca deixa de
      // abrir por causa da identidade visual. Só aceitamos data:image/* — um
      // valor corrompido no cadastro não pode virar vetor de injeção no src.
      let brandingLogoDataUrl: string | null = null;
      let brandingCompanyName: string | null = null;
      try {
        const branding = await prisma.brandingSettings.findFirst({
          select: { systemExpandedLogoDataUrl: true, companyName: true },
        });
        const rawLogo = branding?.systemExpandedLogoDataUrl ?? null;
        brandingLogoDataUrl =
          rawLogo && rawLogo.startsWith("data:image/") ? rawLogo : null;
        brandingCompanyName = branding?.companyName?.trim() || null;
      } catch {
        /* sem branding configurado ou indisponível — segue sem logo */
      }

      return {
        ok: true,
        form: {
          surveyTitle: campaign.name,
          surveyDescription: campaign.description,
          referencePeriod: {
            start: campaign.referenceStart.toISOString(),
            end: campaign.referenceEnd.toISOString(),
          },
          customerDisplayName: invitation?.customerNameSnapshot ?? null,
          requiresSelfIdentification: session.invitationId == null,
          identificationPrefill: buildIdentityPrefill(invitation),
          questions: campaign.questions.map((question) => ({
            code: question.code,
            label: question.label,
            helpText: question.helpText,
            type: question.type,
            required: question.required,
            scaleMin: question.scaleMin,
            scaleMax: question.scaleMax,
          })),
          draft: existing
            ? {
                version: existing.version,
                answers: existing.answers.map((answer) => ({
                  questionCode: answer.question.code,
                  ratingValue: answer.ratingValue,
                  textValue: answer.textValue,
                  dateValue: answer.dateValue ? answer.dateValue.toISOString() : null,
                })),
                respondentName: existing.respondentName,
                respondentPhone: existing.respondentPhone,
              }
            : null,
          ratingScale: [1, 2, 3, 4, 5].map((value) => ({
            value,
            label: ["", "Ruim", "Regular", "Bom", "Ótimo", "Excelente"][value] ?? String(value),
          })),
          turnstileSiteKey,
          branding: {
            logoDataUrl: brandingLogoDataUrl,
            companyName: brandingCompanyName,
          },
        },
      };
    },

    /**
     * Autosave. Usa `version` como CAS: se o cliente mandar uma versão velha
     * (duas abas, requisição fora de ordem), a gravação é recusada em vez de
     * sobrescrever resposta mais nova.
     *
     * CONTRATO: `answers` é o conjunto COMPLETO do formulário, não um delta.
     * Pergunta ausente do payload tem a resposta removida — é assim que o
     * cliente consegue desmarcar algo. O formulário público envia sempre o
     * estado inteiro.
     */
    async saveDraft(
      sessionToken: string | null,
      payload: {
        answers: SatisfactionAnswerInput[];
        respondentName: string | null;
        respondentPhone: string | null;
        expectedVersion: number | null;
      }
    ): Promise<
      | { ok: true; version: number }
      | SatisfactionPublicFailure
      | { ok: false; reason: "VERSION_CONFLICT"; message: string; currentVersion: number }
    > {
      const session = await resolveSession(sessionToken);
      if (!session) return fail("INVALID");

      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: session.campaignId },
        select: {
          status: true,
          opensAt: true,
          closesAt: true,
          questions: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!campaign) return fail("INVALID");

      const unavailable = resolveCampaignUnavailableReason(
        {
          status: campaign.status as SatisfactionCampaignStatusValue,
          opensAt: campaign.opensAt,
          closesAt: campaign.closesAt,
        },
        now()
      );
      if (unavailable) return fail(unavailable);

      const specs = campaign.questions.map(toQuestionSpec);
      // Link individual: identidade vem do CADASTRO, nunca do cliente.
      const draftIdentity = session.invitationId
        ? await prisma.satisfactionSurveyInvitation.findUnique({
            where: { id: session.invitationId },
            select: { customerNameSnapshot: true, customerTaxIdSnapshot: true },
          })
        : null;
      const draftAnswers = applyIdentityOverrides(
        payload.answers,
        draftIdentity,
        new Set(specs.map((q) => q.code))
      );
      const validation = validateAnswers(specs, draftAnswers, { enforceRequired: false });
      if (!validation.ok) return fail("INVALID");

      const result = await prisma.$transaction(async (tx) => {
        const existing = session.invitationId
          ? await tx.satisfactionSurveyResponse.findUnique({
              where: { invitationId: session.invitationId },
              select: { id: true, status: true, version: true },
            })
          : session.responseId
            ? await tx.satisfactionSurveyResponse.findUnique({
                where: { id: session.responseId },
                select: { id: true, status: true, version: true },
              })
            : null;

        if (existing?.status === "SUBMITTED") {
          return { kind: "already" as const };
        }

        if (
          existing &&
          payload.expectedVersion != null &&
          payload.expectedVersion !== existing.version
        ) {
          return { kind: "conflict" as const, currentVersion: existing.version };
        }

        let responseId = existing?.id ?? null;
        const nextVersion = (existing?.version ?? 0) + 1;

        if (!responseId) {
          const created = await tx.satisfactionSurveyResponse.create({
            data: {
              campaignId: session.campaignId,
              invitationId: session.invitationId,
              source: session.invitationId ? "INDIVIDUAL_LINK" : "GENERAL_LINK",
              status: "DRAFT",
              startedAt: now(),
              lastSavedAt: now(),
              version: nextVersion,
              respondentName: payload.respondentName,
              respondentPhone: payload.respondentPhone,
            },
            select: { id: true },
          });
          responseId = created.id;

          if (session.invitationId) {
            await tx.satisfactionSurveyInvitation.updateMany({
              where: { id: session.invitationId, startedAt: null },
              data: { startedAt: now() },
            });
          }
          await tx.satisfactionPublicSession.update({
            where: { id: session.id },
            data: { responseId },
          });
          await tx.satisfactionSurveyEvent.create({
            data: {
              campaignId: session.campaignId,
              invitationId: session.invitationId,
              responseId,
              type: "STARTED",
            },
          });
        } else {
          await tx.satisfactionSurveyResponse.update({
            where: { id: responseId },
            data: {
              lastSavedAt: now(),
              version: nextVersion,
              respondentName: payload.respondentName,
              respondentPhone: payload.respondentPhone,
            },
          });
        }

        await persistAnswers(tx, responseId, validation.answers, specs);

        await tx.satisfactionSurveyEvent.create({
          data: {
            campaignId: session.campaignId,
            invitationId: session.invitationId,
            responseId,
            type: "DRAFT_SAVED",
          },
        });

        return { kind: "saved" as const, version: nextVersion };
      });

      if (result.kind === "already") return fail("ALREADY_ANSWERED");
      if (result.kind === "conflict") {
        return {
          ok: false,
          reason: "VERSION_CONFLICT",
          message: "Suas respostas foram atualizadas em outra aba. Recarregue a página.",
          currentVersion: result.currentVersion,
        };
      }
      return { ok: true, version: result.version };
    },

    /**
     * Submissão final. Tudo numa transação: validar → gravar respostas →
     * marcar SUBMITTED → marcar convite concluído → registrar evento.
     *
     * Idempotência em três camadas:
     *  1. convite já concluído devolve sucesso idempotente;
     *  2. `invitationId` é UNIQUE — não existe segunda resposta;
     *  3. `(campaignId, idempotencyKey)` é UNIQUE — retry com a mesma chave
     *     encontra a resposta existente em vez de criar outra.
     */
    async submit(
      sessionToken: string | null,
      input: SatisfactionSubmitInput
    ): Promise<
      | { ok: true; responseId: string; alreadySubmitted: boolean }
      | SatisfactionPublicFailure
      | { ok: false; reason: "VALIDATION"; issues: SatisfactionValidationIssue[] }
    > {
      const session = await resolveSession(sessionToken);
      if (!session) return fail("INVALID");

      const campaign = await prisma.satisfactionSurveyCampaign.findUnique({
        where: { id: session.campaignId },
        select: {
          status: true,
          opensAt: true,
          closesAt: true,
          questions: { orderBy: { sortOrder: "asc" } },
        },
      });
      if (!campaign) return fail("INVALID");

      const unavailable = resolveCampaignUnavailableReason(
        {
          status: campaign.status as SatisfactionCampaignStatusValue,
          opensAt: campaign.opensAt,
          closesAt: campaign.closesAt,
        },
        now()
      );
      if (unavailable) return fail(unavailable);

      // Já concluído: devolve sucesso idempotente ANTES de validar de novo.
      if (session.invitationId) {
        const invitation = await prisma.satisfactionSurveyInvitation.findUnique({
          where: { id: session.invitationId },
          select: {
            revokedAt: true,
            completedAt: true,
            customerNameSnapshot: true,
            customerTaxIdSnapshot: true,
            response: { select: { id: true } },
          },
        });
        if (invitation?.revokedAt) return fail("REVOKED");
        if (invitation?.completedAt && invitation.response) {
          return { ok: true, responseId: invitation.response.id, alreadySubmitted: true };
        }
      }

      if (input.idempotencyKey) {
        const previous = await prisma.satisfactionSurveyResponse.findFirst({
          where: {
            campaignId: session.campaignId,
            idempotencyKey: input.idempotencyKey,
            status: "SUBMITTED",
          },
          select: { id: true },
        });
        if (previous) {
          return { ok: true, responseId: previous.id, alreadySubmitted: true };
        }
      }

      const specs = campaign.questions.map(toQuestionSpec);
      // Blindagem: no link individual, CUSTOMER_NAME/TAX_ID vêm do snapshot
      // do convite — qualquer valor enviado pelo cliente para esses códigos é
      // descartado. Também satisfaz o required de CUSTOMER_NAME por construção.
      const submitIdentity = session.invitationId
        ? await prisma.satisfactionSurveyInvitation.findUnique({
            where: { id: session.invitationId },
            select: { customerNameSnapshot: true, customerTaxIdSnapshot: true },
          })
        : null;
      const submitAnswers = applyIdentityOverrides(
        input.answers,
        submitIdentity,
        new Set(specs.map((q) => q.code))
      );
      const validation = validateAnswers(specs, submitAnswers, { enforceRequired: true });
      if (!validation.ok) {
        return {
          ok: false,
          reason: "VALIDATION",
          issues: (validation as { issues: SatisfactionValidationIssue[] }).issues,
        };
      }

      const submittedAt = now();

      try {
        const responseId = await prisma.$transaction(async (tx) => {
          const existing = session.invitationId
            ? await tx.satisfactionSurveyResponse.findUnique({
                where: { invitationId: session.invitationId },
                select: { id: true, status: true },
              })
            : session.responseId
              ? await tx.satisfactionSurveyResponse.findUnique({
                  where: { id: session.responseId },
                  select: { id: true, status: true },
                })
              : null;

          if (existing?.status === "SUBMITTED") return existing.id;

          const matched = await resolveCustomerMatch(tx, {
            invitationId: session.invitationId,
            declaredTaxId: input.declaredTaxId,
            declaredCompanyName: input.declaredCompanyName,
          });

          const data = {
            campaignId: session.campaignId,
            invitationId: session.invitationId,
            customerId: matched.customerId,
            customerMatchStatus: matched.status,
            source: session.invitationId ? ("INDIVIDUAL_LINK" as const) : ("GENERAL_LINK" as const),
            status: "SUBMITTED" as const,
            respondentName: input.respondentName,
            respondentPhone: input.respondentPhone,
            declaredCompanyName: input.declaredCompanyName,
            declaredTaxId: input.declaredTaxId,
            submittedAt,
            lastSavedAt: submittedAt,
            idempotencyKey: input.idempotencyKey,
          };

          let id: string;
          if (existing) {
            await tx.satisfactionSurveyResponse.update({
              where: { id: existing.id },
              data: { ...data, version: { increment: 1 } },
            });
            id = existing.id;
          } else {
            const created = await tx.satisfactionSurveyResponse.create({
              data: { ...data, startedAt: submittedAt, version: 1 },
              select: { id: true },
            });
            id = created.id;
          }

          await persistAnswers(tx, id, validation.answers, specs);

          if (session.invitationId) {
            await tx.satisfactionSurveyInvitation.update({
              where: { id: session.invitationId },
              data: { completedAt: submittedAt },
            });
            // Envio direto, sem autosave: sem isto o funil contaria uma
            // conclusão que nunca "começou".
            await tx.satisfactionSurveyInvitation.updateMany({
              where: { id: session.invitationId, startedAt: null },
              data: { startedAt: submittedAt },
            });
          }

          await tx.satisfactionSurveyEvent.create({
            data: {
              campaignId: session.campaignId,
              invitationId: session.invitationId,
              responseId: id,
              type: "SUBMITTED",
            },
          });

          // A sessão NÃO é revogada aqui de propósito. Se fosse, um retry de
          // rede legítimo (a resposta já foi gravada, mas o cliente não
          // recebeu o 200) cairia em "Link inválido" em vez do resultado
          // idempotente "já enviado". A trava contra segunda resposta é o
          // invitation.completedAt + o UNIQUE de idempotencyKey; a sessão
          // expira sozinha pelo TTL.
          await tx.satisfactionPublicSession.update({
            where: { id: session.id },
            data: { responseId: id },
          });

          return id;
        });

        return { ok: true, responseId, alreadySubmitted: false };
      } catch (error) {
        // Corrida real de duplo submit: o UNIQUE do banco venceu. Devolvemos o
        // resultado idempotente em vez de erro — o cliente já respondeu.
        if (isUniqueViolation(error)) {
          const existing = await prisma.satisfactionSurveyResponse.findFirst({
            where: session.invitationId
              ? { invitationId: session.invitationId }
              : {
                  campaignId: session.campaignId,
                  idempotencyKey: input.idempotencyKey ?? undefined,
                },
            select: { id: true },
          });
          if (existing) {
            return { ok: true, responseId: existing.id, alreadySubmitted: true };
          }
        }
        throw error;
      }
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Grava as respostas de forma idempotente: upsert por (responseId, questionId)
 * e remoção das perguntas que deixaram de ter valor. Nunca grava zero para
 * "não respondido" — a linha simplesmente não existe.
 */
async function persistAnswers(
  tx: Prisma.TransactionClient,
  responseId: string,
  answers: ReturnType<typeof validateAnswers> extends { ok: true; answers: infer A }
    ? A
    : Array<{
        questionId: string;
        questionCode: string;
        ratingValue: number | null;
        textValue: string | null;
        dateValue: Date | null;
      }>,
  specs: readonly SatisfactionQuestionSpec[]
): Promise<void> {
  const answered = new Set(answers.map((a) => a.questionId));
  const removable = specs.filter((spec) => !answered.has(spec.id)).map((spec) => spec.id);

  if (removable.length > 0) {
    await tx.satisfactionSurveyAnswer.deleteMany({
      where: { responseId, questionId: { in: removable } },
    });
  }

  for (const answer of answers) {
    await tx.satisfactionSurveyAnswer.upsert({
      where: { responseId_questionId: { responseId, questionId: answer.questionId } },
      create: {
        responseId,
        questionId: answer.questionId,
        ratingValue: answer.ratingValue,
        textValue: answer.textValue,
        dateValue: answer.dateValue,
      },
      update: {
        ratingValue: answer.ratingValue,
        textValue: answer.textValue,
        dateValue: answer.dateValue,
      },
    });
  }
}

/** Códigos de identificação que o cadastro responde no link individual. */
const IDENTITY_PREFILL_CODES = { name: "CUSTOMER_NAME", taxId: "TAX_ID" } as const;

type IdentitySnapshots = {
  customerNameSnapshot: string | null;
  customerTaxIdSnapshot: string | null;
} | null;

/** Prefill exibido no formulário (link individual). Vazio no link geral. */
function buildIdentityPrefill(
  invitation: IdentitySnapshots
): Array<{ questionCode: string; textValue: string; locked: boolean }> {
  if (!invitation) return [];
  const prefill: Array<{ questionCode: string; textValue: string; locked: boolean }> = [];
  if (invitation.customerNameSnapshot) {
    prefill.push({
      questionCode: IDENTITY_PREFILL_CODES.name,
      textValue: invitation.customerNameSnapshot,
      locked: true,
    });
  }
  if (invitation.customerTaxIdSnapshot) {
    prefill.push({
      questionCode: IDENTITY_PREFILL_CODES.taxId,
      textValue: invitation.customerTaxIdSnapshot,
      locked: true,
    });
  }
  return prefill;
}

/**
 * Sobrepõe as respostas de identificação com os snapshots do convite.
 * O que o cliente tiver digitado (ou adulterado) nesses códigos é descartado;
 * sem snapshot de CNPJ o campo segue livre (é opcional no V1).
 */
function applyIdentityOverrides(
  answers: SatisfactionAnswerInput[],
  invitation: IdentitySnapshots,
  campaignQuestionCodes: ReadonlySet<string>
): SatisfactionAnswerInput[] {
  if (!invitation) return answers;
  // So injeta o que EXISTE no questionario da campanha: injetar codigo
  // desconhecido derrubaria o submit com UNKNOWN_QUESTION em campanhas cujo
  // snapshot nao tem os campos de identificacao.
  const overrides = buildIdentityPrefill(invitation).filter((o) =>
    campaignQuestionCodes.has(o.questionCode)
  );
  if (overrides.length === 0) return answers;
  const overriddenCodes = new Set(overrides.map((o) => o.questionCode));
  return [
    ...answers.filter((a) => !overriddenCodes.has(a.questionCode)),
    ...overrides.map((o) => ({ questionCode: o.questionCode, textValue: o.textValue })),
  ];
}

/**
 * Correspondência com o cadastro oficial — SEMPRE no servidor.
 *
 * Não existe endpoint público de busca de Customer: o cliente digita os
 * próprios dados e o backend tenta casar. CNPJ primeiro (identidade forte);
 * nome só quando resolve para exatamente UM cliente — havendo ambiguidade,
 * fica UNMATCHED para revisão humana, nunca um palpite.
 */
async function resolveCustomerMatch(
  tx: Prisma.TransactionClient,
  input: {
    invitationId: string | null;
    declaredTaxId: string | null;
    declaredCompanyName: string | null;
  }
): Promise<{ customerId: string | null; status: "MATCHED" | "UNMATCHED" }> {
  if (input.invitationId) {
    const invitation = await tx.satisfactionSurveyInvitation.findUnique({
      where: { id: input.invitationId },
      select: { customerId: true },
    });
    if (invitation) return { customerId: invitation.customerId, status: "MATCHED" };
  }

  const digits = normalizeTaxIdDigits(input.declaredTaxId);
  if (digits) {
    const candidates = await tx.customer.findMany({
      where: { taxId: { contains: digits.slice(0, 14) } },
      select: { id: true, taxId: true },
      take: 5,
    });
    const exact = candidates.filter((c) => normalizeTaxIdDigits(c.taxId) === digits);
    if (exact.length === 1) return { customerId: exact[0]!.id, status: "MATCHED" };
  }

  const nameKey = normalizeCompanyNameKey(input.declaredCompanyName);
  if (nameKey && nameKey.length >= 4) {
    const candidates = await tx.customer.findMany({
      where: { companyName: { contains: nameKey.split(" ")[0] ?? "", mode: "insensitive" } },
      select: { id: true, companyName: true },
      take: 50,
    });
    const matches = candidates.filter(
      (c) => normalizeCompanyNameKey(c.companyName) === nameKey
    );
    // Ambíguo = não identificado. Um palpite errado contamina a análise.
    if (matches.length === 1) return { customerId: matches[0]!.id, status: "MATCHED" };
  }

  return { customerId: null, status: "UNMATCHED" };
}

export type SatisfactionPublicService = ReturnType<typeof createSatisfactionPublicService>;
