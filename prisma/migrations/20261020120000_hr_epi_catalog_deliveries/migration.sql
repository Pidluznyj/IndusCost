-- EPIs e uniformes (docs/hr/epi-uniforms.md):
--   catálogo global (HrEpiItem) + eventos de entrega (HrEpiDeliveryEvent) com itens (HrEpiDelivery)
--   + ficha por evento com identificador único (HrEpiDeliveryForm) + comprovantes assinados (HrEpiDeliveryReceipt).
-- Aditiva: nenhuma entrega é apagada. Cada entrega existente vira um evento de 1 item com o MESMO id
-- (mesma data, mesmo responsável): o significado histórico não muda. Só as já devolvidas passam a "Encerrado".

-- ───────────────────────────── Catálogo ─────────────────────────────
CREATE TABLE "HrEpiItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "caNumber" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "replacementDays" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEpiItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrEpiItem_type_check" CHECK ("type" IN ('EPI', 'UNIFORM')),
    CONSTRAINT "HrEpiItem_unit_check" CHECK ("unit" IN ('UNIT', 'PAIR', 'KIT')),
    CONSTRAINT "HrEpiItem_replacementDays_check" CHECK ("replacementDays" IS NULL OR "replacementDays" > 0),
    CONSTRAINT "HrEpiItem_description_check" CHECK (length(btrim("description")) > 0)
);

CREATE UNIQUE INDEX "HrEpiItem_number_key" ON "HrEpiItem"("number");
CREATE UNIQUE INDEX "HrEpiItem_code_key" ON "HrEpiItem"("code");
CREATE INDEX "HrEpiItem_active_description_idx" ON "HrEpiItem"("active", "description");
-- Duplicação acidental: mesmo tipo + mesma descrição (sem caixa/espaços) + mesmo CA.
-- Modelos diferentes (outro CA ou outra descrição) continuam permitidos. Fora do schema Prisma.
CREATE UNIQUE INDEX "HrEpiItem_type_description_ca_key"
  ON "HrEpiItem"("type", lower(btrim("description")), coalesce(upper(btrim("caNumber")), ''));

-- Código gerado na criação é imutável.
CREATE FUNCTION "HrEpiItem_code_immutable"() RETURNS trigger AS $$
BEGIN
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'Código do EPI/uniforme não pode ser alterado';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HrEpiItem_code_immutable_trg"
  BEFORE UPDATE ON "HrEpiItem"
  FOR EACH ROW EXECUTE FUNCTION "HrEpiItem_code_immutable"();

-- ───────────────────────────── Evento de entrega ─────────────────────────────
CREATE TABLE "HrEpiDeliveryEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "deliveredAt" TIMESTAMPTZ(6) NOT NULL,
    "responsibleName" TEXT,
    "notes" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEpiDeliveryEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HrEpiDeliveryEvent_employeeId_deliveredAt_idx" ON "HrEpiDeliveryEvent"("employeeId", "deliveredAt" DESC);
-- Alvo das FKs compostas (evento + colaborador): item, ficha e comprovante nunca apontam outro colaborador.
CREATE UNIQUE INDEX "HrEpiDeliveryEvent_id_employeeId_key" ON "HrEpiDeliveryEvent"("id", "employeeId");
ALTER TABLE "HrEpiDeliveryEvent" ADD CONSTRAINT "HrEpiDeliveryEvent_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ───────────────────────────── Itens entregues ─────────────────────────────
ALTER TABLE "HrEpiDelivery" ADD COLUMN     "eventId" UUID,
ADD COLUMN     "itemCaNumber" TEXT,
ADD COLUMN     "itemCode" TEXT,
ADD COLUMN     "itemId" UUID,
ADD COLUMN     "itemType" TEXT,
ADD COLUMN     "itemUnit" TEXT,
ADD COLUMN     "replacedByDeliveryId" UUID,
ADD COLUMN     "replacementAdjustReason" TEXT,
ADD COLUMN     "replacementDays" INTEGER,
ADD COLUMN     "replacementDueDate" DATE,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "statusChangedAt" TIMESTAMPTZ(6),
ADD COLUMN     "statusChangedByUserId" UUID,
ADD COLUMN     "statusReason" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Entregas existentes: um evento de 1 item cada, com o mesmo id, data, responsável e autor.
INSERT INTO "HrEpiDeliveryEvent" ("id", "employeeId", "deliveredAt", "responsibleName", "createdByUserId", "createdAt", "updatedAt")
SELECT "id", "employeeId", "deliveredAt", "responsibleName", "createdByUserId", "createdAt", "createdAt"
FROM "HrEpiDelivery";
UPDATE "HrEpiDelivery" SET "eventId" = "id";
ALTER TABLE "HrEpiDelivery" ALTER COLUMN "eventId" SET NOT NULL;

-- Entregas antigas já devolvidas: encerradas, com a data da devolução.
UPDATE "HrEpiDelivery"
SET "status" = 'CLOSED',
    "statusReason" = 'Devolvido (registro anterior ao catálogo de EPIs)',
    "statusChangedAt" = "returnedAt"
WHERE "returnedAt" IS NOT NULL;

ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_status_check"
  CHECK ("status" IN ('ACTIVE', 'REPLACED', 'CLOSED', 'CANCELLED'));
-- Substituída aponta a nova entrega; encerrada/cancelada exige motivo; vigente não aponta substituta.
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_status_consistency_check" CHECK (
  ("status" = 'ACTIVE' AND "replacedByDeliveryId" IS NULL)
  OR ("status" = 'REPLACED' AND "replacedByDeliveryId" IS NOT NULL)
  OR ("status" IN ('CLOSED', 'CANCELLED') AND "statusReason" IS NOT NULL AND length(btrim("statusReason")) > 0)
);
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_replacementDays_check"
  CHECK ("replacementDays" IS NULL OR "replacementDays" > 0);
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_itemType_check"
  CHECK ("itemType" IS NULL OR "itemType" IN ('EPI', 'UNIFORM'));
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_not_self_replaced_check"
  CHECK ("replacedByDeliveryId" IS NULL OR "replacedByDeliveryId" <> "id");

CREATE UNIQUE INDEX "HrEpiDelivery_replacedByDeliveryId_key" ON "HrEpiDelivery"("replacedByDeliveryId");
CREATE INDEX "HrEpiDelivery_eventId_idx" ON "HrEpiDelivery"("eventId");
CREATE INDEX "HrEpiDelivery_itemId_idx" ON "HrEpiDelivery"("itemId");
CREATE INDEX "HrEpiDelivery_status_replacementDueDate_idx" ON "HrEpiDelivery"("status", "replacementDueDate");

ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_eventId_employeeId_fkey" FOREIGN KEY ("eventId", "employeeId") REFERENCES "HrEpiDeliveryEvent"("id", "employeeId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "HrEpiItem"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrEpiDelivery" ADD CONSTRAINT "HrEpiDelivery_replacedByDeliveryId_fkey" FOREIGN KEY ("replacedByDeliveryId") REFERENCES "HrEpiDelivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- ───────────────────────────── Ficha do evento ─────────────────────────────
CREATE TABLE "HrEpiDeliveryForm" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "formCode" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payload" JSONB NOT NULL,
    "payloadSha256" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedByUserId" UUID,
    "issuedByName" TEXT,
    "printCount" INTEGER NOT NULL DEFAULT 1,
    "lastPrintedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPrintedByUserId" UUID,
    "supersededAt" TIMESTAMPTZ(6),

    CONSTRAINT "HrEpiDeliveryForm_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrEpiDeliveryForm_status_check" CHECK ("status" IN ('ACTIVE', 'SUPERSEDED')),
    CONSTRAINT "HrEpiDeliveryForm_revision_check" CHECK ("revision" >= 1),
    CONSTRAINT "HrEpiDeliveryForm_formCode_check" CHECK ("formCode" ~ '^FE-[0-9]{4}-[0-9]{5,}$'),
    CONSTRAINT "HrEpiDeliveryForm_documentNumber_check" CHECK ("documentNumber" = "formCode" || '-R' || lpad("revision"::text, 2, '0')),
    CONSTRAINT "HrEpiDeliveryForm_superseded_check" CHECK (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "HrEpiDeliveryForm_documentNumber_key" ON "HrEpiDeliveryForm"("documentNumber");
CREATE INDEX "HrEpiDeliveryForm_employeeId_idx" ON "HrEpiDeliveryForm"("employeeId");
CREATE UNIQUE INDEX "HrEpiDeliveryForm_eventId_revision_key" ON "HrEpiDeliveryForm"("eventId", "revision");
CREATE UNIQUE INDEX "HrEpiDeliveryForm_formCode_revision_key" ON "HrEpiDeliveryForm"("formCode", "revision");
CREATE UNIQUE INDEX "HrEpiDeliveryForm_id_eventId_key" ON "HrEpiDeliveryForm"("id", "eventId");
-- Fora do schema Prisma: no máximo uma revisão vigente por evento; um código de ficha por evento.
CREATE UNIQUE INDEX "HrEpiDeliveryForm_one_active_per_event" ON "HrEpiDeliveryForm"("eventId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "HrEpiDeliveryForm_code_first_revision" ON "HrEpiDeliveryForm"("formCode") WHERE "revision" = 1;

ALTER TABLE "HrEpiDeliveryForm" ADD CONSTRAINT "HrEpiDeliveryForm_eventId_employeeId_fkey" FOREIGN KEY ("eventId", "employeeId") REFERENCES "HrEpiDeliveryEvent"("id", "employeeId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrEpiDeliveryForm" ADD CONSTRAINT "HrEpiDeliveryForm_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Revisões seguintes repetem o código da 1ª; conteúdo emitido não muda
-- (só a contagem de impressões e a passagem ACTIVE → SUPERSEDED).
CREATE FUNCTION "HrEpiDeliveryForm_guard"() RETURNS trigger AS $$
DECLARE
  first_code TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."revision" > 1 THEN
      SELECT "formCode" INTO first_code FROM "HrEpiDeliveryForm" WHERE "eventId" = NEW."eventId" AND "revision" = 1;
      IF first_code IS DISTINCT FROM NEW."formCode" THEN
        RAISE EXCEPTION 'Ficha de EPI: revisão com código diferente da ficha original';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
     OR NEW."formCode" IS DISTINCT FROM OLD."formCode" OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."documentNumber" IS DISTINCT FROM OLD."documentNumber" OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."payloadSha256" IS DISTINCT FROM OLD."payloadSha256" OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
     OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."issuedByUserId" IS DISTINCT FROM OLD."issuedByUserId" THEN
    RAISE EXCEPTION 'Ficha de EPI emitida não pode ser alterada';
  END IF;
  IF OLD."status" = 'SUPERSEDED' AND NEW."status" <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Revisão substituída da ficha de EPI não volta a vigente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HrEpiDeliveryForm_guard_trg"
  BEFORE INSERT OR UPDATE ON "HrEpiDeliveryForm"
  FOR EACH ROW EXECUTE FUNCTION "HrEpiDeliveryForm_guard"();

-- ───────────────────────────── Comprovantes (ficha assinada) ─────────────────────────────
-- Documento do mesmo colaborador (FK composta abaixo).
CREATE UNIQUE INDEX "HrEmployeeDocument_id_employeeId_key" ON "HrEmployeeDocument"("id", "employeeId");

CREATE TABLE "HrEpiDeliveryReceipt" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "formId" UUID,
    "documentId" UUID NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "supersededAt" TIMESTAMPTZ(6),
    "uploadedByUserId" UUID,
    "uploadedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "batchId" UUID,
    "validationResult" TEXT,
    "validatedAt" TIMESTAMPTZ(6),
    "validatedByUserId" UUID,
    "validationNote" TEXT,

    CONSTRAINT "HrEpiDeliveryReceipt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "HrEpiDeliveryReceipt_status_check" CHECK ("status" IN ('CURRENT', 'SUPERSEDED')),
    CONSTRAINT "HrEpiDeliveryReceipt_superseded_check" CHECK (("status" = 'SUPERSEDED') = ("supersededAt" IS NOT NULL)),
    CONSTRAINT "HrEpiDeliveryReceipt_sha_check" CHECK ("fileSha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "HrEpiDeliveryReceipt_size_check" CHECK ("fileSize" > 0),
    CONSTRAINT "HrEpiDeliveryReceipt_validation_check" CHECK (
      ("validationResult" IS NULL AND "validatedAt" IS NULL)
      OR ("validationResult" IN ('APPROVED', 'REJECTED') AND "validatedAt" IS NOT NULL)
    ),
    CONSTRAINT "HrEpiDeliveryReceipt_rejection_note_check" CHECK (
      "validationResult" IS DISTINCT FROM 'REJECTED' OR length(btrim(coalesce("validationNote", ''))) > 0
    )
);

CREATE INDEX "HrEpiDeliveryReceipt_eventId_uploadedAt_idx" ON "HrEpiDeliveryReceipt"("eventId", "uploadedAt" DESC);
CREATE INDEX "HrEpiDeliveryReceipt_fileSha256_idx" ON "HrEpiDeliveryReceipt"("fileSha256");
-- Fora do schema Prisma: um comprovante vigente por evento.
CREATE UNIQUE INDEX "HrEpiDeliveryReceipt_one_current_per_event" ON "HrEpiDeliveryReceipt"("eventId") WHERE "status" = 'CURRENT';

ALTER TABLE "HrEpiDeliveryReceipt" ADD CONSTRAINT "HrEpiDeliveryReceipt_eventId_employeeId_fkey" FOREIGN KEY ("eventId", "employeeId") REFERENCES "HrEpiDeliveryEvent"("id", "employeeId") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrEpiDeliveryReceipt" ADD CONSTRAINT "HrEpiDeliveryReceipt_formId_eventId_fkey" FOREIGN KEY ("formId", "eventId") REFERENCES "HrEpiDeliveryForm"("id", "eventId") ON DELETE RESTRICT ON UPDATE NO ACTION;
-- Documento que é comprovante não é excluído (preservação documental).
ALTER TABLE "HrEpiDeliveryReceipt" ADD CONSTRAINT "HrEpiDeliveryReceipt_documentId_employeeId_fkey" FOREIGN KEY ("documentId", "employeeId") REFERENCES "HrEmployeeDocument"("id", "employeeId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Arquivo, vínculo e autoria do comprovante não mudam; só a situação (CURRENT → SUPERSEDED) e a conferência.
CREATE FUNCTION "HrEpiDeliveryReceipt_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."eventId" IS DISTINCT FROM OLD."eventId" OR NEW."employeeId" IS DISTINCT FROM OLD."employeeId"
     OR NEW."formId" IS DISTINCT FROM OLD."formId" OR NEW."documentId" IS DISTINCT FROM OLD."documentId"
     OR NEW."fileSha256" IS DISTINCT FROM OLD."fileSha256" OR NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt"
     OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId" OR NEW."batchId" IS DISTINCT FROM OLD."batchId" THEN
    RAISE EXCEPTION 'Comprovante de EPI anexado não pode ser alterado';
  END IF;
  IF OLD."status" = 'SUPERSEDED' AND NEW."status" <> 'SUPERSEDED' THEN
    RAISE EXCEPTION 'Comprovante substituído não volta a vigente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "HrEpiDeliveryReceipt_guard_trg"
  BEFORE UPDATE ON "HrEpiDeliveryReceipt"
  FOR EACH ROW EXECUTE FUNCTION "HrEpiDeliveryReceipt_guard"();
