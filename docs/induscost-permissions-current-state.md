# IndusCost — Estado atual do controle de acesso (auditoria)

> Fase: `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.
>
> Documento de diagnóstico. Reflete o código em produção em
> `/opt/induscost` no banco `teste_bi`. Auditoria estática, sem
> alteração de dados.
>
> Relatório automatizado por `npm run audit:permissions` em
> [`docs/generated/permissions-audit-report.md`](generated/permissions-audit-report.md).

## 1. Modelagem em uma frase

> O IndusCost tem **uma tabela de usuários** (`AppUser`) com **uma
> coluna `role` de enum fechado** e **um array `permissions: String[]`
> direto**. Não existe tabela de Role/Permission/RolePermission — o
> "catálogo de permissões" é declarado em código (`PERMISSION_CATALOG`)
> e validado por whitelist.

## 2. Tabelas Prisma

### `AppUser` (`prisma/schema.prisma:1067`)

| Campo                  | Tipo                | Observações                                       |
| ---------------------- | ------------------- | ------------------------------------------------- |
| `id`                   | `UUID`              | PK.                                               |
| `name`                 | `String`            | Nome humano.                                      |
| `email`                | `String` (`@unique`) | Login.                                            |
| `passwordHash`         | `String`            | scrypt (`scrypt:v1:<salt>:<derived>`).            |
| `role`                 | `AppUserRole` enum  | `SUPER_ADMIN \| ADMIN \| COMMERCIAL_MANAGER \| SELLER \| VIEWER`. |
| `permissions`          | `String[]`          | Lista direta; validada por whitelist do catálogo. |
| `isActive`             | `Boolean`           | Login bloqueado se `false`.                       |
| `externalSellerId`     | `Int?`              | Vínculo opcional ao vendedor Nomus.                |
| `sellerResponsibleName`| `String?`           | Nome do vendedor (fallback).                       |
| `lastLoginAt`          | `DateTime?`         | Atualizado pelo `POST /api/auth/login`.            |
| Índices                |                     | `role`, `isActive`, `externalSellerId`.           |

### `AppSession` (`prisma/schema.prisma:1087`)

Sessões opacas; cookie httpOnly `induscost_session` (12h TTL).

| Campo       | Tipo       |
| ----------- | ---------- |
| `id`        | `UUID`     |
| `userId`    | FK         |
| `tokenHash` | sha256(token) (`@unique`) |
| `expiresAt` | TTL                       |
| `revokedAt` | logout/reset de senha     |
| `createdAt` |                           |

### `AppUserRole` (`prisma/schema.prisma:1059`)

```prisma
enum AppUserRole {
  SUPER_ADMIN
  ADMIN
  COMMERCIAL_MANAGER
  SELLER
  VIEWER
}
```

- **Não há tabela** `Role`, `Permission`, `RolePermission` ou
  `UserPermission`. Tudo no campo `AppUser.permissions`.
- **`SUPER_ADMIN` ganha todas as permissões** automaticamente em
  `getEffectivePermissions`, independentemente do array gravado.

## 3. Catálogo central de permissões

Arquivo: `src/lib/permissionCatalog.ts`. Exporta `PERMISSION_CATALOG`,
`ALL_PERMISSION_KEYS` e `PERMISSION_GROUP_ORDER`.

- **73 permissões** no catálogo.
- Cada entrada: `{ key, label, group, module, description, type,
  parentKey?, requires?, risk? }`.
- `type`: `"menu" | "section" | "tab" | "action"`.
- `risk`: `"normal" | "sensitive" | "critical"`.
- `requires`: cadeia hierárquica (ex.: `crm.activities.create`
  exige `crm.view` e `crm.customer_cockpit.view`).
- Grupos: Geral, CRM, Clientes, Propostas, Pedidos de Venda,
  Engenharia / Produtos, Compras, Precificação / Impostos,
  Custos / Operação, Configurações / Sistema, Manutenção.

### Helpers (`src/lib/permissionCatalogUtils.ts`)

- `enablePermission`/`disablePermission` — respeita `requires` e
  desce/sobe na árvore.
- `togglePermissionSelected` — marca/desmarca via árvore.
- `buildGroupTree(group, search)` — agrupa em árvore filtrável.
- `applyTemplatePermissions(id)` — aplica perfis pré-prontos
  (`seller`, `commercial_manager`, `purchases`, `engineering`,
  `system_admin`, `read_only`).
- `selectAllInGroup`, `selectViewOnlyForGroup`, `clearGroup`.
- `summarizePermissionSelection` — resumo (total, grupos,
  críticas, módulos liberados).
- `riskBadgeLabel` — label do badge de risco.

### Templates prontos

| Template               | Role sugerida        | Resumo                                                  |
| ---------------------- | -------------------- | ------------------------------------------------------- |
| `seller`               | `SELLER`             | CRM, clientes, propostas e pedidos do próprio vendedor. |
| `commercial_manager`   | `COMMERCIAL_MANAGER` | Visão comercial ampla + indicadores.                    |
| `purchases`            | —                    | Compras, materiais, consulta de produtos.               |
| `engineering`          | —                    | Engenharia, BOM, custo, materiais, simulações.          |
| `system_admin`         | `ADMIN`              | Configurações + usuários + parâmetros sensíveis.        |
| `read_only`            | `VIEWER`             | Consulta sem ações de escrita ou exclusão.              |

## 4. Helpers de autorização (backend)

Local: `src/lib/appAuth.ts` + `src/lib/appAuthMiddleware.ts`.

| Helper                                      | Função                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `hasPermission(user, perm)`                 | Pure: verifica se a perm está em `effectivePermissions`.                                              |
| `hasAnyPermission(user, perms)`             | Pure: união lógica.                                                                                   |
| `getEffectivePermissions(user)`             | Para `SUPER_ADMIN` retorna `ALL_PERMISSION_KEYS`; outros retornam `filterKnownPermissions(...)`.       |
| `filterKnownPermissions(input)`             | Whitelist contra o catálogo — ignora desconhecidas.                                                   |
| `toSafeAppUser(user)`                       | Projeção pública (sem hash de senha).                                                                  |
| `createAuthGuards(readAppSession)`          | Fábrica que retorna `requireAppAuth`, `requirePermission`, `requireAnyPermission`, `requireAllPermissions`. |

Em `server.ts`, helpers adicionais combinam app auth com bootstrap
admin:

| Helper                                  | Função                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| `requireBootstrapAdmin`                 | Aceita só o admin bootstrap (env vars).                                                       |
| `requireBootstrapOrAnyPermission([])`   | Aceita bootstrap OU `hasAnyPermission`.                                                       |
| `requireUserAdminOrBootstrap`           | Aceita bootstrap OU usuário com `users.manage`.                                               |
| `requireBootstrapForGlobalParamMutation`| Exige bootstrap quando a mutation toca `IndirectCost.category === "GLOBAL_PARAM"`.            |

## 5. Bootstrap admin (acesso administrativo temporário)

- Habilitado por `BOOTSTRAP_ADMIN_ENABLED=1` + `BOOTSTRAP_ADMIN_USERNAME`,
  `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_SESSION_SECRET` no `.env`.
- Cookie `induscost_bootstrap_admin` (8h TTL).
- Único caminho: pode promover qualquer e-mail para `SUPER_ADMIN`
  via `POST /api/admin/users/bootstrap-super-admin`.
- Usado como **porta de emergência** quando o sistema fica sem Super Admin.

## 6. Estatísticas (gerador automatizado)

`npm run audit:permissions` produz:

- **73** permissões no catálogo;
- **73** observadas (zero fora do catálogo);
- **0** fantasmas (todas usadas no código existem no catálogo);
- **5** órfãs (declaradas mas sem uso): `costs.view` (legado),
  `products.tab.routing`, `purchases.indicators.view`,
  `sales_orders.invoice.view`, `settings.nomus.sync`;
- **2** SOMENTE_FE (UI esconde mas backend não checa): ambas
  documentadas como falso-positivo (`products.export.engineering`
  é export client-side a partir de `GET /api/products` já protegido;
  `purchases.delete` é remoção de item local no form);
- **26** SOMENTE_BE (backend protege, UI não esconde explicitamente —
  detalhe didático, não risco);
- **179** rotas REST (87 mutations / 92 leituras);
- **9** rotas sem `requirePermission`/`requireAnyPermission`
  (todas são `auth/me/login/logout`, `bootstrap-admin/*`,
  `/api/admin/*` com `requireUserAdminOrBootstrap`, `/api/health`,
  fallback `GET *`). Apenas `/api/test-db` chama atenção — sem
  autenticação e expõe contagens de tabelas;
- **4** mutations sem `requirePermission` direto — todas legítimas
  (`POST /api/auth/login`, `POST /api/auth/logout`,
  `POST /api/bootstrap-admin/login`, `POST /api/bootstrap-admin/logout`).

## 7. Como o frontend usa permissões

- `src/contexts/AuthContext.tsx` expõe `useAuth()` com `authUser`,
  `hasPermission`, `hasAnyPermission`, `isSuperAdmin`,
  `authLoading`, `authError`, `login`, `logout`, `loadMe`.
- `src/lib/modulePermissions.ts` centraliza:
  - `canAccessModule(moduleId, check)` — gate de menu lateral;
  - helpers específicos (`canFilterAllCrmSellers`, `getVisibleProductTabs`,
    `canDeleteProposal`, etc.);
  - aceita **legado** `costs.view` para liberar módulos de custo/operação
    (compatibilidade Fase 1K-D).
- Componentes que dependem de permissões:
  - `AdminUsersModule` (gate `users.manage`);
  - `ProductModule` (`products.create/edit/delete/export.engineering`);
  - `PurchaseModule` (`purchases.create/edit/delete`);
  - `PricingModule` (`pricing.simulate/generate_tables/publish_tables`);
  - `SettingsModule` (`settings.view`).
- O resto se baseia em `canAccessModule` + `canAccessSettingsSection`.

## 8. Limitações identificadas (informativo — não corrigidas nesta fase)

1. **`/api/test-db` é público** e expõe contagens (`prisma.machine.count`,
   etc.). Risco baixo de vazamento, mas deveria exigir autenticação.
2. **`costs.view` (legado)** ainda existe — boa hora para deprecar
   (status atual: ÓRFÃ no catálogo).
3. **4 permissões órfãs** não usadas — provavelmente plano antigo
   não implementado ou removido em refactor. Ver lista acima.
4. **SOMENTE_BE: 26 permissões** — backend impõe, UI não mostra o gate.
   Não é risco de segurança (gate real está no backend), mas é
   oportunidade didática para o admin entender o que cada usuário
   acessa.
5. **`AppUser.permissions` é array desnormalizado** — sem tabela
   relacional. Em escala maior dificulta query do tipo "quem tem
   `users.manage`?". Não é problema agora (poucos usuários).
6. **Não há histórico de mudanças** de permissão/role/ativação.
   Apenas `updatedAt`. Auditoria futura precisaria de `AppUserChangeLog`.
7. **Sem auto-bloqueio antes desta fase**: o backend não impedia
   o admin de inativar a si mesmo, rebaixar o próprio role ou
   remover sua `users.manage`. Corrigido por esta fase (vide
   `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`).
8. **Sem proteção do último Super Admin**: anteriormente, era
   possível inativar/rebaixar o único Super Administrador ativo
   sem aviso. Corrigido por esta fase.

## 9. Riscos identificados nesta auditoria

| ID  | Severidade | Item                                                                  | Status                                                     |
| --- | ---------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| R1  | P1         | Auto-inativação / auto-rebaixamento / auto-perda de `users.manage`    | ✅ corrigido nesta fase (backend + UI)                      |
| R2  | P1         | Inativar/rebaixar último Super Admin ativo                            | ✅ corrigido nesta fase                                     |
| R3  | P2         | `/api/test-db` público com contagens de tabelas                       | ⚠️ pendente (ver action plan)                              |
| R4  | P2         | `costs.view` legado mantido para compat                               | ⚠️ pendente (manter por agora, plano de remoção)           |
| R5  | P3         | 4 permissões órfãs (`products.tab.routing`, `purchases.indicators.view`, `sales_orders.invoice.view`, `settings.nomus.sync`) | ⚠️ revisar caso a caso (usar ou remover)                   |
| R6  | P3         | Sem auditoria de mudanças em permissões                               | ⚠️ pendente (proposta no action plan)                      |
| R7  | P3         | `AppUser.permissions` desnormalizado dificulta queries futuras        | ⚠️ aceitável agora; revisar quando ultrapassar ~50 usuários |
