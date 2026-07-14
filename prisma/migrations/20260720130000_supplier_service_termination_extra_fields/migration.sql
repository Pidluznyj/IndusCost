-- Dias adicionais, multa sem aviso e pedido nas linhas de comissão do encerramento

ALTER TABLE "SupplierServiceTermination"
  ADD COLUMN "extraWorkedDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "extraWorkedAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN "noticePenaltyAmount" DECIMAL(20,2) NOT NULL DEFAULT 0;

ALTER TABLE "SupplierServiceTerminationCommissionLink"
  ADD COLUMN "orderCode" TEXT;
