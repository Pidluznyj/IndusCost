-- P21: versão de permissões por usuário + epoch de sessão.
ALTER TABLE "AppUser" ADD COLUMN "permissionsVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "AppSession" ADD COLUMN "permissionsVersionAtIssue" INTEGER NOT NULL DEFAULT 0;
