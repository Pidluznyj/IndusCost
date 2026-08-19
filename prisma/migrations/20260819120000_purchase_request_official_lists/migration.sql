-- Compras: campos oficiais por lista (solicitante, categoria, centro de custo).
-- Aditiva: colunas novas nullable + tabela de apoio com seed. Nenhum DROP,
-- nenhuma mudanca de tipo/nullability em coluna existente, nenhum backfill
-- inventado — os snapshots de texto existentes permanecem como estao.

CREATE TABLE "PurchaseRequestCategory" (
  "id"        UUID        NOT NULL DEFAULT gen_random_uuid(),
  "code"      TEXT        NOT NULL,
  "name"      TEXT        NOT NULL,
  "isActive"  BOOLEAN     NOT NULL DEFAULT true,
  "sortOrder" INTEGER     NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "PurchaseRequestCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseRequestCategory_code_key" ON "PurchaseRequestCategory"("code");
CREATE INDEX "PurchaseRequestCategory_isActive_sortOrder_idx" ON "PurchaseRequestCategory"("isActive", "sortOrder");

-- Seed: familias de Suprimentos + categorias administrativas acordadas.
INSERT INTO "PurchaseRequestCategory" ("code", "name", "sortOrder") VALUES
  ('MATERIA_PRIMA',       'Matéria-Prima',            10),
  ('INSUMO',              'Insumo',                   20),
  ('EMBALAGEM',           'Embalagem',                30),
  ('MATERIAL_ESCRITORIO', 'Material de escritório',   40),
  ('MANUTENCAO',          'Manutenção',               50),
  ('EPI_SEGURANCA',       'EPI / Segurança',          60),
  ('LIMPEZA',             'Limpeza',                  70),
  ('SERVICOS',            'Serviços',                 80),
  ('INVESTIMENTO',        'Investimento / Ativo',     90),
  ('OUTROS',              'Outros',                  100);

ALTER TABLE "PurchaseRequest"
  ADD COLUMN "requesterEmployeeId" UUID,
  ADD COLUMN "requestCategoryId" UUID,
  ADD COLUMN "defaultFinancialCostCenterId" UUID;

ALTER TABLE "PurchaseRequestItem"
  ADD COLUMN "financialCostCenterId" UUID;

CREATE INDEX "PurchaseRequest_requesterEmployeeId_idx" ON "PurchaseRequest"("requesterEmployeeId");
CREATE INDEX "PurchaseRequest_requestCategoryId_idx" ON "PurchaseRequest"("requestCategoryId");
CREATE INDEX "PurchaseRequest_defaultFinancialCostCenterId_idx" ON "PurchaseRequest"("defaultFinancialCostCenterId");

ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_requesterEmployeeId_fkey"
    FOREIGN KEY ("requesterEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "PurchaseRequest_requestCategoryId_fkey"
    FOREIGN KEY ("requestCategoryId") REFERENCES "PurchaseRequestCategory"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT "PurchaseRequest_defaultFinancialCostCenterId_fkey"
    FOREIGN KEY ("defaultFinancialCostCenterId") REFERENCES "FinancialCostCenter"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "PurchaseRequestItem"
  ADD CONSTRAINT "PurchaseRequestItem_financialCostCenterId_fkey"
    FOREIGN KEY ("financialCostCenterId") REFERENCES "FinancialCostCenter"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
