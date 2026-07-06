# Perfis de Acesso — relatório de implementação

**Fase:** AUTH-ACCESS-PROFILES-A  
**Data:** 2026-06-08  
**Branch:** `main`

## Problema resolvido

O cadastro de usuários dependia de **roles fixos** (`AppUserRole`) e **modelos rápidos hardcoded** em `permissionCatalogUtils.ts`. Super Administradores não podiam criar, editar ou reutilizar perfis de acesso dinamicamente sem alterar código.

## Model criado

**`AccessProfile`** (Prisma):

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID | PK |
| `name` | String unique | Nome do perfil |
| `description` | String? | Descrição |
| `roleBase` | `AppUserRole?` | Role sugerido para compatibilidade |
| `systemKey` | String? unique | Chave estável para perfis de sistema |
| `permissions` | `String[]` | Permissões do catálogo |
| `isSystem` | Boolean | Protege contra exclusão |
| `isActive` | Boolean | Visível para novos usuários |
| `createdAt` / `updatedAt` | DateTime | Auditoria |

**`AppUser.accessProfileId`** — FK opcional para rastrear o perfil aplicado (permissões efetivas continuam em `AppUser.permissions`).

**Migration:** `20260608120000_access_profiles`

## Perfis de sistema (seed idempotente)

15 perfis iniciais equivalentes aos modelos atuais, criados via `ensureSystemAccessProfiles()` na primeira listagem:

- Super administrador, Administrador, Gestor comercial, Vendedor, Visualizador
- Somente Leitura, Compras, Engenharia / Custos, Administração do Sistema
- Frota — Administrador, Operador, Financeiro, Manutenção, Solicitante, Visualizador

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/access-profiles` | Lista perfis (`activeOnly`, `includeInactive`, `search`) |
| GET | `/api/access-profiles/:id` | Detalhe |
| POST | `/api/access-profiles` | Criar |
| PUT | `/api/access-profiles/:id` | Editar |
| PATCH | `/api/access-profiles/:id/status` | Ativar/inativar |
| POST | `/api/access-profiles/:id/duplicate` | Duplicar |
| DELETE | `/api/access-profiles/:id` | Excluir (não-sistema, sem usuários) |

**Autorização:** `SUPER_ADMIN`, `users.manage`, `accessProfiles.manage` (gerenciar) ou `accessProfiles.view` (listar).

## Permissões novas

| Chave | Uso |
|-------|-----|
| `accessProfiles.view` | Consultar perfis |
| `accessProfiles.manage` | CRUD de perfis |

Incluídas no perfil de sistema **Administrador** (`role_admin`).

## Fluxo — criar perfil

1. Configurações → Usuários e Permissões → aba **Perfis de Acesso**
2. Novo perfil → nome, descrição, role base opcional, permissões por módulo
3. Salvar → disponível para usuários ativos

## Fluxo — criar usuário com perfil

1. Configurações → Usuários → **Novo usuário**
2. Selecionar **Perfil de acesso** (lista perfis ativos)
3. Permissões e role base aplicados automaticamente
4. Ajuste fino manual possível → exibe “permissões personalizadas”
5. Role (`AppUserRole`) permanece para compatibilidade

## Compatibilidade com roles antigos

- `AppUserRole` enum **mantido** (SUPER_ADMIN, ADMIN, etc.)
- Usuários existentes **sem** `accessProfileId` continuam funcionando
- `SUPER_ADMIN` ainda recebe todas as permissões via `getEffectivePermissions`
- Modelos rápidos hardcoded permanecem como **fallback** se API de perfis indisponível

## Segurança

- Perfis de sistema não excluíveis
- Perfis em uso não excluíveis (inativar)
- Último perfil administrativo ativo não pode ser inativado
- Guardrails de auto-bloqueio de usuário preservados

## Limitações

- Permissões efetivas ainda gravadas por usuário (`permissions[]`) — perfil é template + referência
- Seed de sistema não sobrescreve perfis já existentes (`upsert` com `update: {}`)
- Sem histórico de alteração de perfil (auditoria futura)

## Validação no servidor

```bash
git pull origin main
npx prisma migrate deploy
npx prisma generate
npm run test:auth:access-profiles
npm run lint
npm run build
```

1. Login como Super Admin
2. Configurações → Perfis de Acesso → verificar 15 perfis de sistema
3. Criar perfil customizado e duplicar
4. Novo usuário → selecionar perfil → confirmar permissões
5. Menu lateral reflete permissões do perfil aplicado

## Arquivos principais

- `prisma/schema.prisma` — model `AccessProfile`
- `src/lib/accessProfilesService.ts` — regras de negócio
- `src/lib/accessProfilesRoutes.ts` — API
- `src/lib/accessProfilesSeedData.ts` — seeds
- `src/components/AccessProfilesModule.tsx` — UI admin
- `src/components/AdminUsersModule.tsx` — integração usuário
- `src/components/admin/PermissionEditor.tsx` — atalhos por perfil cadastrado
