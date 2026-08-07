-- CASH-SUPPORT-P0-CONCURRENCY-001 (resíduo "b"): idempotência do aceite de
-- conciliação bancária. Repetir o mesmo comando com a mesma chave não pode
-- criar um segundo match.
--
-- Aditiva e nullable: matches anteriores à coluna continuam válidos, e o
-- índice único ignora NULL no Postgres (vários matches sem chave convivem).
-- Rollback: remover o indice e a coluna adicionados acima, sem perda de dado existente.
ALTER TABLE "TreasuryReconciliationMatch" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "TreasuryReconciliationMatch_companyCode_idempotencyKey_key" ON "TreasuryReconciliationMatch"("companyCode", "idempotencyKey");
