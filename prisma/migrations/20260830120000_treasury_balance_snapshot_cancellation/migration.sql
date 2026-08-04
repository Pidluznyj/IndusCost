-- Cancelamento lógico de TreasuryBalanceSnapshot (SUPER_ADMIN) — nunca DELETE físico.
-- Aditiva e nullable: registros existentes ficam com cancelledAt=NULL (ativos).
-- Todo consumidor deve filtrar cancelledAt IS NULL para o snapshot cancelado
-- sumir de saldo atual / projeção / relatórios / linha do tempo do Caixa.
-- Não aplicar em produção via Cursor.

ALTER TABLE "TreasuryBalanceSnapshot"
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "cancelledByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;

CREATE INDEX IF NOT EXISTS "TreasuryBalanceSnapshot_cancelledAt_idx"
  ON "TreasuryBalanceSnapshot"("cancelledAt");

ALTER TABLE "TreasuryBalanceSnapshot"
  ADD CONSTRAINT "TreasuryBalanceSnapshot_cancelledByUserId_fkey"
  FOREIGN KEY ("cancelledByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
