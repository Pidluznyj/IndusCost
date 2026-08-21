-- Comercial → Satisfação de Clientes (docs/commercial/customer-satisfaction-module.md).
--
-- Migration ADITIVA. Auditoria da geração (prisma migrate diff schema-antes → schema-novo):
--   0 DROP, 0 ALTER em tabela existente, 11 CREATE TABLE, 10 CREATE TYPE,
--   36 índices (11 únicos), 21 FOREIGN KEY. Nenhum objeto pré-existente é tocado —
--   Customer só ganha relações inversas no Prisma, o que não gera DDL.
--
-- Invariantes materializadas aqui:
--   * SatisfactionSurveyInvitation(campaignId, customerId) UNIQUE  → audiência idempotente.
--   * SatisfactionSurveyResponse.invitationId UNIQUE               → uma resposta por convite.
--   * SatisfactionSurveyResponse(campaignId, idempotencyKey) UNIQUE → duplo submit é no-op.
--   * SatisfactionSurveyResponse(importBatchId, importFingerprint) UNIQUE → import idempotente.
--   * SatisfactionSurveyAnswer(responseId, questionId) UNIQUE      → uma linha por pergunta.
--   * SatisfactionSurveyAccessToken.tokenHash UNIQUE               → só o SHA-256 é persistido.

-- CreateEnum
CREATE TYPE "SatisfactionTemplateStatus" AS ENUM ('ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "SatisfactionQuestionType" AS ENUM ('RATING', 'TEXT', 'SHORT_TEXT', 'PHONE', 'DATE', 'TAX_ID');

-- CreateEnum
CREATE TYPE "SatisfactionCampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SatisfactionAccessTokenKind" AS ENUM ('INDIVIDUAL', 'GENERAL');

-- CreateEnum
CREATE TYPE "SatisfactionAccessTokenStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SatisfactionResponseSource" AS ENUM ('INDIVIDUAL_LINK', 'GENERAL_LINK', 'GOOGLE_FORMS_IMPORT');

-- CreateEnum
CREATE TYPE "SatisfactionResponseStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "SatisfactionCustomerMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED');

-- CreateEnum
CREATE TYPE "SatisfactionEventType" AS ENUM ('OPENED', 'STARTED', 'DRAFT_SAVED', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "SatisfactionImportBatchStatus" AS ENUM ('PREVIEWED', 'APPLIED');

-- CreateTable
CREATE TABLE "SatisfactionSurveyTemplate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "SatisfactionTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyQuestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "templateId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "SatisfactionQuestionType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "scaleMin" INTEGER,
    "scaleMax" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyCampaign" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateId" UUID NOT NULL,
    "referenceStart" TIMESTAMPTZ(6) NOT NULL,
    "referenceEnd" TIMESTAMPTZ(6) NOT NULL,
    "opensAt" TIMESTAMPTZ(6),
    "closesAt" TIMESTAMPTZ(6),
    "status" "SatisfactionCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "allowGeneralLink" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" UUID,
    "publishedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "archivedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SatisfactionSurveyCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyCampaignQuestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "sourceQuestionId" UUID,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "helpText" TEXT,
    "type" "SatisfactionQuestionType" NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "scaleMin" INTEGER,
    "scaleMax" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyCampaignQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyInvitation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "customerNameSnapshot" TEXT NOT NULL,
    "customerTaxIdSnapshot" TEXT,
    "responsibleCommercialIdSnapshot" INTEGER,
    "responsibleCommercialNameSnapshot" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstOpenedAt" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SatisfactionSurveyInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyAccessToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "invitationId" UUID,
    "kind" "SatisfactionAccessTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "status" "SatisfactionAccessTokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "lastUsedAt" TIMESTAMPTZ(6),
    "rotatedFromId" UUID,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionPublicSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenHash" TEXT NOT NULL,
    "campaignId" UUID NOT NULL,
    "invitationId" UUID,
    "accessTokenId" UUID NOT NULL,
    "responseId" UUID,
    "scope" TEXT NOT NULL DEFAULT 'SATISFACTION_RESPONSE',
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionPublicSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyResponse" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "invitationId" UUID,
    "customerId" UUID,
    "customerMatchStatus" "SatisfactionCustomerMatchStatus",
    "source" "SatisfactionResponseSource" NOT NULL,
    "status" "SatisfactionResponseStatus" NOT NULL DEFAULT 'DRAFT',
    "respondentName" TEXT,
    "respondentPhone" TEXT,
    "declaredCompanyName" TEXT,
    "declaredTaxId" TEXT,
    "declaredDate" TIMESTAMPTZ(6),
    "startedAt" TIMESTAMPTZ(6),
    "lastSavedAt" TIMESTAMPTZ(6),
    "submittedAt" TIMESTAMPTZ(6),
    "originalSubmittedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT,
    "importBatchId" UUID,
    "importFingerprint" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyAnswer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "responseId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "ratingValue" INTEGER,
    "textValue" TEXT,
    "dateValue" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionSurveyEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "invitationId" UUID,
    "responseId" UUID,
    "type" "SatisfactionEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SatisfactionSurveyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatisfactionImportBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "campaignId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "SatisfactionImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "statsJson" JSONB,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SatisfactionImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyTemplate_code_key" ON "SatisfactionSurveyTemplate"("code");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyTemplate_status_idx" ON "SatisfactionSurveyTemplate"("status");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyQuestion_templateId_sortOrder_idx" ON "SatisfactionSurveyQuestion"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyQuestion_templateId_code_key" ON "SatisfactionSurveyQuestion"("templateId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyCampaign_code_key" ON "SatisfactionSurveyCampaign"("code");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyCampaign_status_opensAt_idx" ON "SatisfactionSurveyCampaign"("status", "opensAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyCampaign_templateId_idx" ON "SatisfactionSurveyCampaign"("templateId");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyCampaign_referenceStart_referenceEnd_idx" ON "SatisfactionSurveyCampaign"("referenceStart", "referenceEnd");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyCampaignQuestion_campaignId_sortOrder_idx" ON "SatisfactionSurveyCampaignQuestion"("campaignId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyCampaignQuestion_campaignId_code_key" ON "SatisfactionSurveyCampaignQuestion"("campaignId", "code");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyInvitation_campaignId_completedAt_idx" ON "SatisfactionSurveyInvitation"("campaignId", "completedAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyInvitation_customerId_idx" ON "SatisfactionSurveyInvitation"("customerId");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyInvitation_responsibleCommercialIdSnapsho_idx" ON "SatisfactionSurveyInvitation"("responsibleCommercialIdSnapshot");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyInvitation_campaignId_customerId_key" ON "SatisfactionSurveyInvitation"("campaignId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyAccessToken_tokenHash_key" ON "SatisfactionSurveyAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyAccessToken_campaignId_status_idx" ON "SatisfactionSurveyAccessToken"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyAccessToken_invitationId_status_idx" ON "SatisfactionSurveyAccessToken"("invitationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionPublicSession_tokenHash_key" ON "SatisfactionPublicSession"("tokenHash");

-- CreateIndex
CREATE INDEX "SatisfactionPublicSession_campaignId_idx" ON "SatisfactionPublicSession"("campaignId");

-- CreateIndex
CREATE INDEX "SatisfactionPublicSession_expiresAt_idx" ON "SatisfactionPublicSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SatisfactionPublicSession_invitationId_idx" ON "SatisfactionPublicSession"("invitationId");

-- CreateIndex
CREATE INDEX "SatisfactionPublicSession_accessTokenId_idx" ON "SatisfactionPublicSession"("accessTokenId");

-- CreateIndex
CREATE INDEX "SatisfactionPublicSession_responseId_idx" ON "SatisfactionPublicSession"("responseId");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyResponse_invitationId_key" ON "SatisfactionSurveyResponse"("invitationId");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyResponse_campaignId_status_submittedAt_idx" ON "SatisfactionSurveyResponse"("campaignId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyResponse_customerId_submittedAt_idx" ON "SatisfactionSurveyResponse"("customerId", "submittedAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyResponse_campaignId_customerMatchStatus_idx" ON "SatisfactionSurveyResponse"("campaignId", "customerMatchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyResponse_campaignId_idempotencyKey_key" ON "SatisfactionSurveyResponse"("campaignId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyResponse_importBatchId_importFingerprint_key" ON "SatisfactionSurveyResponse"("importBatchId", "importFingerprint");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyAnswer_questionId_ratingValue_idx" ON "SatisfactionSurveyAnswer"("questionId", "ratingValue");

-- CreateIndex
CREATE UNIQUE INDEX "SatisfactionSurveyAnswer_responseId_questionId_key" ON "SatisfactionSurveyAnswer"("responseId", "questionId");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyEvent_campaignId_type_occurredAt_idx" ON "SatisfactionSurveyEvent"("campaignId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyEvent_invitationId_type_idx" ON "SatisfactionSurveyEvent"("invitationId", "type");

-- CreateIndex
CREATE INDEX "SatisfactionSurveyEvent_responseId_idx" ON "SatisfactionSurveyEvent"("responseId");

-- CreateIndex
CREATE INDEX "SatisfactionImportBatch_campaignId_status_idx" ON "SatisfactionImportBatch"("campaignId", "status");

-- CreateIndex
CREATE INDEX "SatisfactionImportBatch_fileHash_idx" ON "SatisfactionImportBatch"("fileHash");

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyQuestion" ADD CONSTRAINT "SatisfactionSurveyQuestion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SatisfactionSurveyTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyCampaign" ADD CONSTRAINT "SatisfactionSurveyCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "SatisfactionSurveyTemplate"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyCampaignQuestion" ADD CONSTRAINT "SatisfactionSurveyCampaignQuestion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyInvitation" ADD CONSTRAINT "SatisfactionSurveyInvitation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyInvitation" ADD CONSTRAINT "SatisfactionSurveyInvitation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyAccessToken" ADD CONSTRAINT "SatisfactionSurveyAccessToken_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyAccessToken" ADD CONSTRAINT "SatisfactionSurveyAccessToken_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "SatisfactionSurveyInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionPublicSession" ADD CONSTRAINT "SatisfactionPublicSession_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionPublicSession" ADD CONSTRAINT "SatisfactionPublicSession_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "SatisfactionSurveyInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionPublicSession" ADD CONSTRAINT "SatisfactionPublicSession_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "SatisfactionSurveyAccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionPublicSession" ADD CONSTRAINT "SatisfactionPublicSession_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SatisfactionSurveyResponse"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyResponse" ADD CONSTRAINT "SatisfactionSurveyResponse_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyResponse" ADD CONSTRAINT "SatisfactionSurveyResponse_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "SatisfactionSurveyInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyResponse" ADD CONSTRAINT "SatisfactionSurveyResponse_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyResponse" ADD CONSTRAINT "SatisfactionSurveyResponse_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "SatisfactionImportBatch"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyAnswer" ADD CONSTRAINT "SatisfactionSurveyAnswer_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SatisfactionSurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyAnswer" ADD CONSTRAINT "SatisfactionSurveyAnswer_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "SatisfactionSurveyCampaignQuestion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyEvent" ADD CONSTRAINT "SatisfactionSurveyEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyEvent" ADD CONSTRAINT "SatisfactionSurveyEvent_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "SatisfactionSurveyInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionSurveyEvent" ADD CONSTRAINT "SatisfactionSurveyEvent_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "SatisfactionSurveyResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatisfactionImportBatch" ADD CONSTRAINT "SatisfactionImportBatch_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "SatisfactionSurveyCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Seed do questionário histórico V1 ──────────────────────────────────────
-- UUIDs LITERAIS e fixos: gen_random_uuid() aqui tornaria o ON CONFLICT não
-- idempotente e faria cada ambiente divergir de ids. Reexecutar é no-op.
--
-- Escala histórica preservada: 1=Ruim 2=Regular 3=Bom 4=Ótimo 5=Excelente.
-- O artefato "Choose / Opção 1" do Google Forms NÃO é uma pergunta negocial
-- válida e por isso não entra no V1.
INSERT INTO "SatisfactionSurveyTemplate"
  ("id", "code", "name", "description", "version", "status", "isLocked")
VALUES (
  '5a715fac-0000-4000-8000-000000000001',
  'CUSTOMER_SATISFACTION_V1',
  'Pesquisa de Satisfação de Clientes — V1',
  'Questionário histórico migrado do Google Forms. Imutável: uma revisão futura nasce como novo template (V2), preservando a comparabilidade da série histórica.',
  1,
  'ACTIVE',
  true
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "SatisfactionSurveyQuestion"
  ("id", "templateId", "code", "label", "type", "sortOrder", "required", "scaleMin", "scaleMax")
VALUES
  ('5a715fac-0001-4000-8000-000000000001', '5a715fac-0000-4000-8000-000000000001', 'CUSTOMER_NAME',             'Cliente (nome da empresa)',             'SHORT_TEXT', 1,  true,  NULL, NULL),
  ('5a715fac-0001-4000-8000-000000000002', '5a715fac-0000-4000-8000-000000000001', 'TAX_ID',                    'CNPJ',                                  'TAX_ID',     2,  false, NULL, NULL),
  ('5a715fac-0001-4000-8000-000000000003', '5a715fac-0000-4000-8000-000000000001', 'CONTACT_PHONE',             'Telefone/celular para contato',         'PHONE',      3,  true,  NULL, NULL),
  ('5a715fac-0001-4000-8000-000000000004', '5a715fac-0000-4000-8000-000000000001', 'SURVEY_DATE',               'Data',                                  'DATE',       4,  true,  NULL, NULL),
  ('5a715fac-0001-4000-8000-000000000005', '5a715fac-0000-4000-8000-000000000001', 'RESPONDENT_NAME',           'Responsável pelo preenchimento',        'SHORT_TEXT', 5,  true,  NULL, NULL),
  ('5a715fac-0001-4000-8000-000000000006', '5a715fac-0000-4000-8000-000000000001', 'COMMERCIAL_SERVICE',        'Atendimento comercial e telefônico',    'RATING',     6,  true,  1,    5),
  ('5a715fac-0001-4000-8000-000000000007', '5a715fac-0000-4000-8000-000000000001', 'QUOTE_ORDER_RESPONSE_TIME', 'Tempo de resposta a cotações e Pedidos', 'RATING',     7,  true,  1,    5),
  ('5a715fac-0001-4000-8000-000000000008', '5a715fac-0000-4000-8000-000000000001', 'DELIVERY_DEADLINE',         'Cumprimento do prazo de entrega',       'RATING',     8,  true,  1,    5),
  ('5a715fac-0001-4000-8000-000000000009', '5a715fac-0000-4000-8000-000000000001', 'ORDER_CONFORMITY',          'Conformidade do Pedido',                'RATING',     9,  true,  1,    5),
  ('5a715fac-0001-4000-8000-00000000000a', '5a715fac-0000-4000-8000-000000000001', 'PRODUCT_QUALITY',           'Qualidade do Produto',                  'RATING',     10, true,  1,    5),
  ('5a715fac-0001-4000-8000-00000000000b', '5a715fac-0000-4000-8000-000000000001', 'TECHNICAL_SUPPORT',         'Suporte Técnico',                       'RATING',     11, true,  1,    5),
  ('5a715fac-0001-4000-8000-00000000000c', '5a715fac-0000-4000-8000-000000000001', 'OPEN_FEEDBACK',             'Descreva aqui elogios ou pontos que em sua opinião, poderiam ser melhorados ou alguma ocorrência de insatisfação sobre nosso atendimento, qualidade, prazo de entrega.', 'TEXT', 12, true, NULL, NULL)
ON CONFLICT ("templateId", "code") DO NOTHING;
