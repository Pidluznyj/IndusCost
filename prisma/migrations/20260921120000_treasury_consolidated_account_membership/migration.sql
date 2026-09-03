-- Membership TEMPORAL da conta no caixa consolidado da Tesouraria.
--
-- Migration ADITIVA e DETERMINÍSTICA. Não altera nenhuma tabela existente
-- além de acrescentar a FK reversa em TreasuryFinancialAccount/AppUser via
-- as constraints abaixo. Sem DROP, sem TRUNCATE, sem DELETE.
--
-- MOTIVO: a linha do tempo da Tesouraria decide se um saldo manual pode
-- ancorar o consolidado perguntando "quantas contas eram esperadas HOJE, e
-- quantas informaram?". Sem histórico de quando cada conta entrou/saiu do
-- consolidado, uma conta nova (ex.: cadastrada em 03/09/2026) contaminaria
-- retroativamente dias anteriores, e uma conta desativada continuaria sendo
-- cobrada para sempre. Este intervalo [validFrom, validUntil] resolve isso.
--
-- BOOTSTRAP: para toda conta atualmente com includeInConsolidated = true,
-- abre um intervalo determinístico:
--   validFrom = o MENOR entre (a) o dia civil (America/Sao_Paulo) de
--               createdAt e (b) o dia civil do snapshot MANUAL não
--               cancelado mais antigo daquela conta (se existir e for
--               anterior a createdAt) — um saldo informado é a própria
--               asserção do usuário de que a conta já existia naquele dia.
--   validUntil = NULL se a conta está ativa; senão o dia civil de
--               deactivatedAt.
--   reason = 'BOOTSTRAP'.
--
-- LIMITAÇÃO CONHECIDA: toggles de includeInConsolidated anteriores a este
-- bootstrap não são reconstruídos aqui (não há como inferir com segurança) —
-- eles continuam auditáveis em TreasuryAuditLog (entityType
-- 'FINANCIAL_ACCOUNT') para correção manual, se necessário. Contas com
-- includeInConsolidated = false no momento do bootstrap NÃO recebem
-- intervalo (nunca fizeram parte do consolidado, até onde os campos atuais
-- permitem provar).
--
-- Não aplicar em produção via Cursor. Não aplicar automaticamente — revisar
-- e rodar via `prisma migrate deploy` no ambiente correto.

-- CreateTable
CREATE TABLE "TreasuryConsolidatedAccountMembership" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accountId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "validUntil" DATE,
    "reason" TEXT NOT NULL,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(6),
    "closedByUserId" UUID,

    CONSTRAINT "TreasuryConsolidatedAccountMembership_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TreasuryConsolidatedAccountMembership_validUntil_check"
        CHECK ("validUntil" IS NULL OR "validUntil" >= "validFrom")
);

-- AddForeignKey
ALTER TABLE "TreasuryConsolidatedAccountMembership"
    ADD CONSTRAINT "TreasuryConsolidatedAccountMembership_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryConsolidatedAccountMembership"
    ADD CONSTRAINT "TreasuryConsolidatedAccountMembership_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryConsolidatedAccountMembership"
    ADD CONSTRAINT "TreasuryConsolidatedAccountMembership_closedByUserId_fkey"
    FOREIGN KEY ("closedByUserId") REFERENCES "AppUser"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "TreasuryConsolidatedAccountMembership_accountId_validFrom_idx"
    ON "TreasuryConsolidatedAccountMembership"("accountId", "validFrom");

CREATE INDEX "TreasuryConsolidatedAccountMembership_validFrom_validUntil_idx"
    ON "TreasuryConsolidatedAccountMembership"("validFrom", "validUntil");

CREATE INDEX "TreasuryConsolidatedAccountMembership_createdByUserId_idx"
    ON "TreasuryConsolidatedAccountMembership"("createdByUserId");

CREATE INDEX "TreasuryConsolidatedAccountMembership_closedByUserId_idx"
    ON "TreasuryConsolidatedAccountMembership"("closedByUserId");

-- Um único intervalo ABERTO (validUntil IS NULL) por conta — impede duas
-- linhas "vigentes" simultâneas para a mesma conta.
CREATE UNIQUE INDEX "TreasuryConsolidatedAccountMembership_accountId_open_key"
    ON "TreasuryConsolidatedAccountMembership"("accountId")
    WHERE "validUntil" IS NULL;

-- BOOTSTRAP determinístico — ver cabeçalho.
INSERT INTO "TreasuryConsolidatedAccountMembership"
    ("accountId", "validFrom", "validUntil", "reason", "createdAt")
SELECT
    a.id,
    LEAST(
        (a."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date,
        COALESCE(
            (SELECT MIN((s."referenceAt" AT TIME ZONE 'America/Sao_Paulo')::date)
               FROM "TreasuryBalanceSnapshot" s
              WHERE s."accountId" = a.id AND s."cancelledAt" IS NULL),
            (a."createdAt" AT TIME ZONE 'America/Sao_Paulo')::date
        )
    ) AS "validFrom",
    CASE WHEN a."isActive" THEN NULL
         ELSE (a."deactivatedAt" AT TIME ZONE 'America/Sao_Paulo')::date END AS "validUntil",
    'BOOTSTRAP',
    now()
FROM "TreasuryFinancialAccount" a
WHERE a."includeInConsolidated" = true;
