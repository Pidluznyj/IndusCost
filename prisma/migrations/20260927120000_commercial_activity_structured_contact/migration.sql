-- Registro de contato estruturado do CRM Comercial (CommercialActivity).
-- Só colunas novas e anuláveis: contatos antigos ficam com NULL (sem backfill,
-- sem default); nada existente é alterado.
--   nextActionType                  código da próxima ação ("NONE" = nenhuma)
--   createdByUserId                 usuário autenticado que registrou
--   commercialOwnerIdentityKey      responsável comercial no momento do contato
--   commercialOwnerExternalSellerId id Nomus desse responsável, quando houver
ALTER TABLE "CommercialActivity" ADD COLUMN "nextActionType" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN "createdByUserId" UUID;
ALTER TABLE "CommercialActivity" ADD COLUMN "commercialOwnerIdentityKey" TEXT;
ALTER TABLE "CommercialActivity" ADD COLUMN "commercialOwnerExternalSellerId" INTEGER;
