# Etapa 24 — Plano de deploy (documental, não executado)

**Este documento não foi executado. É plano para uso posterior no servidor.**

## 1. Pré-deploy

- [ ] Merge aprovado para `main`
- [ ] Commit exato registrado (ver `11-pull-request-handoff.md`)
- [ ] Working tree limpo no servidor
- [ ] Backup do banco (`pg_dump`)
- [ ] Backup do crontab
- [ ] Backup do `.env`
- [ ] Backup do build atual (`dist/` anterior)
- [ ] Nenhuma integração Nomus ativa no momento do deploy
- [ ] Crons pausados temporariamente
- [ ] Espaço em disco suficiente
- [ ] `pg_isready` confirma Postgres ativo
- [ ] Serviço atual saudável antes de iniciar

## 2. Migrations

- Esperada: `20260905120000_treasury_reconciliation_idempotency` (aditiva, nullable)
- SQL: ver `prisma/migrations/20260905120000_treasury_reconciliation_idempotency/migration.sql`
- Risco: baixo — `ADD COLUMN` + `CREATE UNIQUE INDEX` sem dado a migrar
- `npx prisma migrate status` antes
- `npx prisma migrate deploy`
- Validação posterior: `npx prisma migrate status` confirma aplicada
- Rollback compatível: `DROP INDEX` + `DROP COLUMN` (documentado em `11-pull-request-handoff.md`)

## 3. Build

- `npm ci` somente se `package-lock.json` mudou
- `npx prisma validate`
- `npx prisma generate`
- `npm run check:frontend-server-imports`
- `npm run build`
- `npm run check:browser-bundle`

## 4. Serviço

- Troca de build (symlink ou diretório versionado)
- Restart controlado do processo Node
- Health check (`/health` ou equivalente)
- Confirmar autenticação funcionando
- Confirmar porta respondendo
- Checar logs por 5–10 minutos após restart

## 5. Validação funcional

- [ ] Feature flag `treasury.reconciliation.enabled` inicialmente OFF (se possível) ou
      restrita a usuário piloto
- [ ] Conta piloto definida
- [ ] Visão canônica (`/finance/treasury/caixa`) carrega normalmente
- [ ] `GET /cash-support` responde 200 para usuário autorizado
- [ ] Movimento bancário aparece mesmo sem match
- [ ] Previsão aparece sem botão de conciliar
- [ ] Conciliação manual 1:1 funciona ponta a ponta
- [ ] Reversão funciona e preserva auditoria
- [ ] Nomus permanece inalterado após as ações acima (checagem manual pontual)

## 6. Restaurar crons

Somente após a validação funcional da seção 5 estar completa.

## 7. Rollback

- Commit anterior (`git revert` ou deploy do build anterior salvo)
- Build anterior (restaurar `dist/` do backup)
- Migration: `DROP INDEX`/`DROP COLUMN` (script pronto, ver acima)
- Feature flag: desligar `treasury.reconciliation.enabled` imediatamente contém o
  impacto sem precisar reverter código
- Crontab: restaurar backup
- Serviço: restart após rollback de build

## 8. Critério GO/NO-GO

**GO** somente se todos os itens da seção 1 e 5 estiverem marcados **e** a migration
tiver sido aplicada com sucesso confirmado. **NO-GO** se qualquer teste da seção 5 falhar
ou se o Postgres não estiver saudável antes do deploy.

## 9. Não executar

Este plano é para consulta futura. Nenhum passo acima foi executado durante esta sessão.
