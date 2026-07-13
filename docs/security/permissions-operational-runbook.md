# Runbook operacional — permissões (IndusCost / My Industry)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Catálogo relacional `PermissionResource` / `RolePermission` / overrides / auditoria |
| **Seed** | `scripts/seedPermissionResources.ts` |
| **Validação** | `scripts/validatePermissionsSetup.ts` |
| **Fonte do catálogo** | `src/lib/permissionResourceSeedData.ts` |
| **Detalhe técnico** | `docs/security/permissions-migration-and-seed.md` |

Este runbook é o procedimento **seguro** para popular, atualizar e diagnosticar permissões.  
Não altera cálculos de negócio (AR, caixa, comissões, O2C, etc.).

---

## Comandos rápidos

```bash
# Validar catálogo em código (sem banco)
npm run permissions:validate

# Inventário / relatório (não falha o processo só por erros — útil em CI de auditoria)
npm run permissions:audit

# Plano seguro sem escrever no banco
npm run permissions:seed -- --catalog-only

# Aplicar seed (idempotente) — exige DATABASE_URL
npm run permissions:seed

# Preview contra o banco sem gravar
npm run permissions:seed -- --dry-run

# Reaplicar defaults oficiais nas roles (exceto política create-only; ver §4)
npm run permissions:seed -- --sync-role-defaults
```

| Script npm | Comando |
|------------|---------|
| `permissions:seed` | `tsx scripts/seedPermissionResources.ts` |
| `permissions:validate` | `tsx scripts/validatePermissionsSetup.ts --catalog-only` |
| `permissions:audit` | `tsx scripts/validatePermissionsSetup.ts --audit` |

---

## 1. Como aplicar migration

1. Confirme o ambiente (`DATABASE_URL` de **dev/staging** — nunca rode migrate experimental em produção sem janela).
2. Gere o client e valide o schema:

```bash
npx prisma validate
npx prisma generate
```

3. Aplique a migration de ACL (já versionada):

```bash
# preferível em deploy:
npx prisma migrate deploy

# ou em desenvolvimento local:
npx prisma migrate dev
```

Migration de referência: `prisma/migrations/20260723120000_permission_resource_rbac`.

4. **Não** misture migrate com seed no mesmo comando cego em produção. Ordem: migrate → seed → validate.

---

## 2. Como rodar seed

O seed é **idempotente**:

- Upsert de `PermissionResource` por `key`.
- `RolePermission` para `SUPER_ADMIN`: sempre sincroniza full (`view`+`execute`+`manage`).
- Demais roles: **create-only** por padrão (não sobrescreve customização no banco).
- **Nunca** apaga `RolePermission`, `UserPermissionOverride`, resources ou `AppUser.permissions[]`.
- **Não** cria usuário/senha.
- Grava auditoria `SEED_PERMISSION_RESOURCES` quando não é dry-run.

### Sem banco (seguro / CI local)

```bash
npm run permissions:seed -- --catalog-only
```

### Com banco

```bash
# 1) opcional: simular
npm run permissions:seed -- --dry-run

# 2) aplicar
npm run permissions:seed
```

Exigir SUPER_ADMIN ativo (falha se não houver):

```bash
PERMISSION_SEED_REQUIRE_SUPER_ADMIN=1 npm run permissions:seed
```

---

## 3. Como validar

```bash
# Sempre (catálogo em código + abas PR + mínimos por role + SUPER_ADMIN full)
npm run permissions:validate

# Com DATABASE_URL: também confere tabelas, órfãos e SUPER_ADMIN ativo
npx tsx scripts/validatePermissionsSetup.ts
```

O validador verifica, entre outros:

- catálogo carregado e íntegro;
- roles com permissões mínimas (ex.: `dashboard` view);
- SUPER_ADMIN com acesso total no preset;
- (DB) pelo menos um SUPER_ADMIN ativo;
- recursos órfãos (parent inválido);
- `RolePermission` / overrides apontando para `resourceKey` inexistente;
- abas da Conciliação:
  - `financeiro.conciliacao_carteira.tab.conciliacao`
  - `financeiro.conciliacao_carteira.tab.inteligencia`
  - `financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa`

Exit code `1` se houver `error` (exceto `permissions:audit`).

---

## 4. Como restaurar padrão por role

Há dois níveis:

### A) Defaults oficiais no banco (`RolePermission`)

```bash
# Recarrega flags da matriz seed nas roles não-SUPER_ADMIN
npm run permissions:seed -- --sync-role-defaults
```

Use com cuidado: sobrescreve customizações feitas direto em `RolePermission`.

### B) Usuário específico (overrides → preset da role)

Na UI **Admin → Usuários / Permissões**:

1. Selecione o usuário.
2. Use **Aplicar preset da role** ou **Restaurar padrão da role**.
3. Confirme limpeza de overrides se solicitado.

Via API (admin autenticado):

- `POST /api/admin/users/:id/permissions/apply-preset`
- `POST /api/admin/users/:id/permissions/restore-role-default`
- body: `{ "confirmClearOverrides": true }` quando houver overrides.

Isso limpa `UserPermissionOverride`, realinha `AppUser.permissions[]` (dual-write) e registra auditoria.

---

## 5. Como evitar bloquear o sistema

1. **Sempre** mantenha ≥1 `SUPER_ADMIN` ativo antes de alterar ACL.
2. Não remova `users.manage` / `admin.usuarios` / `admin.permissoes.action.manage` do próprio usuário admin sem outro SUPER_ADMIN.
3. Prefira `--dry-run` / `--catalog-only` antes de aplicar em staging.
4. Não use `--sync-role-defaults` em produção sem revisão do diff.
5. Seed **não** apaga resources órfãos legados — remoção manual só após inventário.
6. Em dúvida, valide: `npm run permissions:validate` + smoke login como SUPER_ADMIN.
7. Runtime ainda usa sessão + permissões efetivas; um seed incompleto não deve ser “corrigido” apagando usuários.

---

## 6. Como criar nova permissão para nova tela/aba

1. **Defina a chave** estável, hierárquica, em `src/lib/permissionResourceSeedData.ts`  
   Ex.: `financeiro.conciliacao_carteira.tab.minha_aba`.
2. Preencha `label`, `type` (`MENU`|`SUBMENU`|`TAB`|`ACTION`), `parentKey`, `module`, `sortOrder`.
3. Atualize `ROLE_MATRIX` para **todas** as roles (ADMIN, COMMERCIAL_MANAGER, SELLER, VIEWER).  
   Gaps na matriz falham `validatePermissionResourceCatalog`.
4. Espelhe no frontend (`permissionsClient` / `ResourceKeys`) se a UI usar o motor de recursos.
5. Proteja a rota/aba no backend com `requirePermission(resourceKey, action)`.
6. Rode:

```bash
npm run permissions:seed -- --catalog-only
npm run permissions:validate
npm run permissions:seed          # com DATABASE_URL
npx tsx scripts/validatePermissionsSetup.ts
```

7. Libere a aba para roles necessárias (matriz) ou override pontual na UI de usuários.
8. Commit: seed data + guards + UI gate juntos.

---

## 7. Como diagnosticar 403

1. Confirme sessão válida (`/api/auth/me`) — 401 ≠ 403.
2. Anote `resourceKey` + ação (`view`|`execute`|`manage`|`admin`) da rota.
3. Verifique se o usuário é `SUPER_ADMIN` (bypass total no motor).
4. Se não for:
   - preset da role cobre o recurso? (`ROLE_MATRIX` / UI Resumo);
   - há override bloqueando?;
   - dual-write `AppUser.permissions[]` desatualizado? Reaplique preset ou salve overrides.
5. Rode `npm run permissions:audit` e confira se o resource existe no catálogo/banco.
6. Logs do guard: mensagem `FORBIDDEN` / `Sem permissão…`.
7. Após correção, peça novo login ou `loadMe` para refrescar permissões efetivas.

---

## 8. Como liberar acesso emergencial para SUPER_ADMIN

**Preferência:** promover um usuário existente a `SUPER_ADMIN` via UI Admin (com outro SUPER_ADMIN logado), ou bootstrap admin se o ambiente ainda estiver em modo bootstrap.

Se o banco estiver acessível e **ninguém** consegue entrar:

```sql
-- EMERGÊNCIA — execute só com acesso DBA e registro do incidente.
-- 1) Liste candidatos
SELECT id, email, role, "isActive" FROM "AppUser" ORDER BY email;

-- 2) Ative / promova um usuário conhecido (substitua o e-mail)
UPDATE "AppUser"
SET role = 'SUPER_ADMIN', "isActive" = true
WHERE email = 'admin@empresa.com';
```

Depois:

```bash
npm run permissions:seed
npx tsx scripts/validatePermissionsSetup.ts
```

O seed **não** cria senha. Se a senha foi perdida, use o fluxo de redefinição de senha do Admin (com outro admin) ou procedimento interno de reset de hash — fora do escopo do seed.

Registre a ação (quem, quando, por quê) e reverta promoções temporárias quando o incidente acabar.

---

## Checklist pós-deploy

- [ ] `npx prisma migrate deploy`
- [ ] `npm run permissions:seed`
- [ ] `npx tsx scripts/validatePermissionsSetup.ts` (com `DATABASE_URL`)
- [ ] Login SUPER_ADMIN OK
- [ ] Abrir Conciliação: abas Conciliação / Inteligência / Auditoria Pedido→Caixa
- [ ] Smoke: usuário SELLER sem acesso indevido a Admin

---

## Referências

- Modelo: `docs/security/permissions-model-plan.md`
- Migration/seed técnico: `docs/security/permissions-migration-and-seed.md`
- Inventário: `docs/security/permissions-current-inventory.md`
