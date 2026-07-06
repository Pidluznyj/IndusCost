# IndusCost — Plano de ação de permissões

> Fase: `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.
>
> Cada item tem: prioridade (P0–P3), esforço estimado, impacto,
> risco, dependências e fase sugerida.

## Como ler

- **P0** — crítico, fazer em até 24h.
- **P1** — necessário antes de escalar uso do sistema.
- **P2** — melhoria operacional importante.
- **P3** — backlog futuro.

## Resumo

| ID  | Prioridade | Item                                                                       | Esforço | Impacto | Risco se não fizer                          |
| --- | ---------- | -------------------------------------------------------------------------- | ------- | ------- | ------------------------------------------- |
| ✅  | P1         | Anti-auto-bloqueio (backend + UI)                                          | M       | Alto    | Admin se trancar fora                       |
| ✅  | P1         | Proteção do último Super Admin ativo                                       | S       | Alto    | Sistema sem Super Admin                     |
| A1  | P1         | Proteger `/api/test-db` com `requireAppAuth`                               | XS      | Médio   | Vazamento de contagens                      |
| A2  | P1         | Tornar fluxo de promoção a Super Admin **idempotente** + log               | S       | Médio   | Auditabilidade do bootstrap                 |
| A3  | P2         | Criar `AppUserChangeLog` para auditar mudanças de role/permissões          | M       | Médio   | Sem rastreabilidade                         |
| A4  | P2         | Rate limit em `POST /api/auth/login`                                       | M       | Alto    | Brute force                                 |
| A5  | P2         | Adicionar templates `engineering_readonly`, `finance_controller`, `pcp_production`, `nomus_integration` | S | Médio | Admin recria manualmente |
| A6  | P2         | Decidir destino das 4 permissões ÓRFÃS (ligar ou remover)                  | S       | Baixo   | Confusão / código morto                     |
| A7  | P2         | Adicionar permissão `users.password.self_change` + tela de troca de senha  | M       | Médio   | Admin gerencia senha manualmente            |
| A8  | P3         | Política mínima de senha (força, troca periódica opcional)                 | M       | Médio   | Senha fraca                                 |
| A9  | P3         | Painel "Quem tem essa permissão?" no editor                                | S       | Baixo   | Falta de visibilidade                       |
| A10 | P3         | "Comparar dois usuários" (diff de permissões)                              | S       | Baixo   | Falta de visibilidade                       |
| A11 | P3         | Deprecar `costs.view` legado                                               | S       | Baixo   | Mantém complexidade                         |
| A12 | P3         | Migrar `AppUser.permissions: String[]` para tabela `UserPermission`        | L       | Baixo   | Sem urgência enquanto poucos usuários       |

## Detalhamento

### ✅ Concluído nesta fase

#### Backend (`PATCH /api/admin/users/:id`)

```ts
// 409 quando o admin tenta:
- inativar a si mesmo                  → CANNOT_DEACTIVATE_SELF
- rebaixar a si mesmo de SUPER_ADMIN    → CANNOT_DEMOTE_SELF
- remover sua própria users.manage     → CANNOT_REMOVE_OWN_USERS_MANAGE
// 409 quando o alvo é o único Super Admin ativo:
- inativar ou rebaixar                  → LAST_SUPER_ADMIN_PROTECTED
```

Implementação: bloqueios determinísticos + uma query de COUNT para o
"último Super Admin", todos em transação implícita.

#### Frontend (`AdminUsersModule.tsx`)

- Badge **Você** no usuário logado.
- Badge **Único Super** quando aplicável.
- Botão **Inativar** desabilitado para self e último Super Admin com tooltip.
- Banner azul "Você está editando seu próprio usuário."
- Lista de warnings vermelhos antes do botão **Salvar** quando o admin
  tenta uma operação que o backend vai bloquear.
- Aviso amarelo quando o usuário em edição é o último Super Admin.

### A1 — `/api/test-db` exposto sem auth (P1, esforço XS)

**Situação atual**: `app.get("/api/test-db", async (req, res) => {...})`
em `server.ts:1513` retorna `prisma.machine.count()`,
`prisma.product.count()`, `prisma.material.count()` etc. sem nenhum
guard.

**Recomendação**: adicionar `requireAppAuth, requirePermission("settings.view")`
ou simplesmente desabilitar em produção (`if (process.env.NODE_ENV ===
"production") return res.status(404)`).

**Impacto**: nenhum dado sensível direto, mas vazamento de inteligência
de negócio (tamanho de carteira, número de produtos).

### A2 — Idempotência e log do bootstrap (P1, esforço S)

`POST /api/admin/users/bootstrap-super-admin` já é idempotente
(faz `update` se o e-mail existir), mas não há entrada em log
explicando "Promoção via bootstrap". Recomenda-se:

- Inserir entrada em `EngineeringChangeLog` ou criar
  `AppUserChangeLog` específico com `entityType=APP_USER`,
  `changeOrigin=BOOTSTRAP_PROMOTION`, `oldValue=<role anterior>`,
  `newValue=SUPER_ADMIN`.
- Pode ser feito sem migration usando `EngineeringChangeLog` com
  `entityType=PRODUCT` (gambiarra) ou criar tabela própria — preferir
  tabela própria em fase futura.

### A3 — `AppUserChangeLog` (P2, esforço M)

Adicionar modelo:

```prisma
model AppUserChangeLog {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  appUserId    String   @db.Uuid
  changedBy    String?  // id do admin que alterou
  changedAt    DateTime @default(now()) @db.Timestamptz(6)
  fieldName    String   // "role" | "permissions" | "isActive" | "password" | "@created" | "@bootstrap_promoted"
  oldValue     String?
  newValue     String?
  oldValueJson Json?
  newValueJson Json?
  reason       String?

  @@index([appUserId, changedAt])
  @@index([changedBy])
}
```

Gravar a cada `PATCH /api/admin/users/:id`,
`POST /api/admin/users/:id/reset-password` e
`POST /api/admin/users/bootstrap-super-admin`.

Exibir timeline no editor de usuário.

### A4 — Rate limit no login (P2, esforço M)

Sugestão simples: tabela em memória `loginAttempts` (key=ip+email,
TTL 15min, max 10). Para produção, considerar `express-rate-limit`
ou Redis.

### A5 — Novos templates (P2, esforço S)

Adicionar 4 templates ao `PERMISSION_TEMPLATES` em
`src/lib/permissionCatalogUtils.ts`:

- `engineering_readonly`
- `finance_controller`
- `pcp_production`
- `nomus_integration`

Permissões detalhadas em
[`induscost-permissions-matrix-proposal.md`](./induscost-permissions-matrix-proposal.md).

### A6 — Destino das 4 permissões órfãs (P2, esforço S)

| Permissão                       | Decisão recomendada                                                     |
| ------------------------------- | ----------------------------------------------------------------------- |
| `products.tab.routing`          | LIGAR — usar em `getVisibleProductTabs` (hoje só usa `products.tab.info` na aba histórico). |
| `purchases.indicators.view`     | LIGAR ou REMOVER — depende se o painel de indicadores volta.            |
| `sales_orders.invoice.view`     | LIGAR — incluir no template `read_only` e bloquear NFe sem ela.         |
| `settings.nomus.sync`           | LIGAR — quando endpoint REST de sync existir.                            |
| `costs.view` (legado)           | DEPRECAR — manter para compat, mas avisar no editor.                    |

### A7 — Troca de senha self-service (P2, esforço M)

Permissão nova: `users.password.self_change` (ou nem precisa — pode
ser implícita do user autenticado). UI nova `ProfileModule` com:

- Formulário de troca de senha (senha atual + nova + confirmação).
- Endpoint `POST /api/auth/change-password` com revogação de outras sessões.

### A8 — Política mínima de senha (P3, esforço M)

Hoje só exige 8 caracteres (`APP_PASSWORD_MIN_LENGTH`). Sugerir:

- Mínimo 10 caracteres.
- Mínimo 1 letra, 1 número.
- Sem o e-mail/nome dentro.
- Endpoint `validatePasswordStrong` no `appAuth.ts`.

### A9 — "Quem tem essa permissão?" (P3, esforço S)

No `PermissionEditor`, ao clicar no nome da permissão, abrir popover
listando usuários que a têm. Depende de endpoint
`GET /api/admin/permissions/:key/users` (read-only).

### A10 — Comparar usuários (P3, esforço S)

No `AdminUsersModule`, seleção múltipla → botão "Comparar" → modal
com diff de permissões e role.

### A11 — Deprecar `costs.view` (P3, esforço S)

- Marcar no catálogo como `risk: "critical"` ou novo `risk: "legacy"`.
- Adicionar warning visual no `PermissionEditor`.
- Migrar usuários que tenham `costs.view` para permissões específicas
  do módulo (`employees.view`, `machines.view`, `materials.view`,
  `opex.view`, `simulations.view`).
- Após migração: remover do catálogo e da função
  `canAccessModule`/`modulePermissions.ts`.

### A12 — Migrar para tabela relacional (P3, esforço L)

Hoje `AppUser.permissions: String[]` funciona porque há poucos usuários.
Em escala (>50 usuários), considerar:

```prisma
model UserPermission {
  appUserId    String @db.Uuid
  permissionKey String
  grantedAt    DateTime @default(now())
  grantedBy    String?

  @@id([appUserId, permissionKey])
}
```

Migração: backfill a partir do array. Manter array como cache por
performance (denormalized) ou abandonar.

## Próxima fase recomendada

`INDUSCOST-ACCESS-PERMISSIONS-AUDIT-LOG-B` — adicionar
`AppUserChangeLog`, rate limit no login e proteção de `/api/test-db`.
Cobre A1, A3 e A4 — ataque os P1/P2 mais ruidosos primeiro.
