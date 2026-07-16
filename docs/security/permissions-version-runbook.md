# P21 — `permissionsVersion` e invalidação de sessão

## Objetivo

Alterações de permissão passam a ter efeito previsível e rápido: o token/sessão identifica o usuário, **não** é autoridade de ACL. A versão monotônica por usuário invalida cache e sessões antigas.

## Migration (não executar em produção neste deploy)

Arquivo: `prisma/migrations/20260729120000_app_user_permissions_version/migration.sql`

```sql
ALTER TABLE "AppUser" ADD COLUMN "permissionsVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AppSession" ADD COLUMN "permissionsVersionAtIssue" INTEGER NOT NULL DEFAULT 0;
```

Homolog/staging:

```bash
npx prisma migrate deploy
npx prisma generate
```

**Produção:** aplicar migration em janela planejada; não rodar automaticamente com este release.

## Fluxo de invalidação

| Evento | Backend | Frontend |
|--------|---------|----------|
| Save overrides / preset / perfil bulk | `permissionsVersion++`, revoga sessões do alvo (exceto ator em self-edit), atualiza `permissionsVersionAtIssue` da sessão do ator | — |
| Request com sessão stale | `readAppSession` revoga sessão → 401 | `APP_AUTH_REQUIRED_EVENT` |
| Poll `/api/auth/permissions-version` | Retorna versão atual | Se ≠ versão em memória → `POST /api/auth/sync-session-permissions` ou `/me` |
| Self-edit no Admin Users | Mantém cookie; epoch atualizado | `loadMe()` após save |
| API protegida | `requireResource` / guards usam estado atual do DB via `resolveEffectiveAccess` | — |

## Endpoints

- `GET /api/auth/permissions-version` — leve, para poll (60s + focus/visibility)
- `POST /api/auth/sync-session-permissions` — atualiza epoch da sessão e retorna payload tipo `/me`
- `GET /api/auth/me` — source-of-truth do frontend (inclui `permissionsVersion`)

## Testes

```bash
npx prisma validate
npm run test:permissions-version   # se script existir
tsx --test src/lib/permissionsVersion.test.ts src/lib/authFlow.test.ts
npm run test:require-resource
npm run lint
npm run build
```

Cenários manuais:

1. Duas abas — revogar permissão na aba A → aba B recebe 401 ou refresh na próxima poll
2. Conceder permissão — poll/sync atualiza menu sem logout
3. Self-edit — matriz própria salva e `loadMe()` reflete mudança
4. SUPER_ADMIN / Leticia — guards continuam via resolvedor; epoch stale revoga sessão igualmente

## Rollback

- Reverter deploy (código anterior ignora colunas novas se migration já aplicada — colunas são inofensivas)
- Desligar poll no FE (revert AuthContext) se necessário
- Migration reversa opcional: `DROP COLUMN` (só se nenhum código depende)
