-- Exigência manual de leitura e aceite da Política Comercial por usuário.
--
-- Estritamente ADITIVA: uma coluna, sem DROP, sem backfill.
--
-- "mustAcceptCommercialPolicy" nasce FALSE para todo mundo: nada muda no
-- deploy. O vendedor (SELLER) continua obrigado pelo perfil; a flag serve para
-- o SUPER_ADMIN incluir outras pessoas (supervisor, gestor, administrativo) na
-- obrigação de ler e aceitar a versão vigente.

ALTER TABLE "AppUser"
  ADD COLUMN IF NOT EXISTS "mustAcceptCommercialPolicy" BOOLEAN NOT NULL DEFAULT false;
