# Plano oficial — permissionamento por menu / submenu / aba

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-13 |
| **Status** | Desenho — **não aplicar** neste prompt |
| **Base** | `docs/security/permissions-current-inventory.md` |
| **Relacionados** | `docs/induscost-permissions-action-plan.md`, `docs/induscost-permissions-matrix-proposal.md`, `docs/induscost-permissions-portfolio-reconciliation-step1.md` |

---

## Princípios

1. **Foco:** ver menu → ver submenu → ver aba → executar ações críticas. Evitar explosão de ações por tela.
2. **Reutilizar o motor atual** (`PERMISSION_CATALOG`, `AppUser.permissions[]`, `AccessProfile`, `getEffectivePermissions`, `createAuthGuards`). Não reinventar auth.
3. **Hierarquia obrigatória na resolução efetiva:** filho sem pai = inválido (exceto regra explícita documentada).
4. **Segurança na API;** UI só esconde.
5. **SUPER_ADMIN** = bypass seguro do catálogo inteiro (já existe).
6. **Fase C iniciada no schema:** migration `20260723120000_permission_resource_rbac` + seed — ver `docs/security/permissions-migration-and-seed.md`. Runtime ainda **não** lê as novas tabelas.

---

## 1. Arquitetura proposta

### 1.1 Camadas

```text
┌─────────────────────────────────────────────────────────────┐
│  ResourceCatalog (código)                                   │
│  resourceKey + type(MENU|SUBMENU|TAB|ACTION_NODE)           │
│  + parentKey + label + module + description + risk          │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│  PermissionGrant = resourceKey + action                     │
│  actions: view | read | create | update | delete |          │
│           export | execute | admin                          │
│  (na prática atual: chave flat "a.b.c.view")                │
└──────────────────────────┬──────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  RolePreset          AccessProfile      UserOverride
  (por AppUserRole)   (template copiado) (allow/deny opcional)
        └──────────────────┬──────────────────┘
                           ▼
                 resolveEffectivePermissions(user)
                           │
            ┌──────────────┼──────────────┐
            ▼              ▼              ▼
         Sidebar        UI tabs        API guards
```

### 1.2 Modelo alvo vs. estado atual

| Conceito desejado | Estado atual (manter na Fase A) | Alvo futuro (Fase C, opcional) |
|-------------------|----------------------------------|--------------------------------|
| Catálogo central | `permissionCatalog.ts` | Mesmo + `ResourceCatalog` tipado |
| Grants por role | seeds `AccessProfile` + templates | Tabela `RolePermission` |
| Override por usuário | `AppUser.permissions[]` (snapshot) | `UserPermissionOverride` + base role |
| Perfis nomeados | `AccessProfile` (cópia no apply) | Manter; opcional sync live |
| SUPER_ADMIN | `getEffectivePermissions` → all | Sem mudança de comportamento |

**Decisão de produto (oficial neste plano):**  
Fase A/B evoluem o **catálogo hierárquico + resolução de herança + aliases**, sem migration.  
Fase C só se o número de usuários/auditoria exigir modelo relacional (item A12 do action plan).

### 1.3 Tipos de recurso

| Tipo | Significado | Exemplo |
|------|-------------|---------|
| `MENU` | Grupo ou item raiz do sidebar / domínio | `financeiro`, `comercial`, `admin` |
| `SUBMENU` | Item navegável sob um menu | `financeiro.conciliacao_carteira` |
| `TAB` | Aba interna de uma tela | `financeiro.conciliacao_carteira.tab.inteligencia` |
| `ACTION` | Ação crítica (não é “ver”) | `admin.permissoes.action.manage` |

> No catálogo **atual**, `section` ≈ `SUBMENU` e `tab`/`action` já existem. O plano unifica a nomenclatura oficial sem exigir rename imediato das chaves em runtime.

### 1.4 Ações permitidas (vocabulario)

| Action | Uso típico | Quando criar |
|--------|------------|--------------|
| `view` | Ver menu / submenu / aba | **Padrão** para quase tudo |
| `read` | Sinônimo de view em APIs read-only; preferir `view` para não duplicar | Só se precisar distinguir “listar” vs “detalhe” |
| `create` / `update` / `delete` | Mutação | Só onde há risco real |
| `export` | Export CSV/PDF | Telas financeiras / relatórios |
| `execute` | Jobs, rebuild, sync | Ex.: rebuild OrderToCashAudit |
| `admin` | Governança (usuários, ACL) | Restrito |

**Regra de simplicidade:** para MENU / SUBMENU / TAB, a grant padrão é só `view`. Demais actions só em nós ACTION ou anexadas ao SUBMENU quando já existem no catálogo vivo.

### 1.5 Resolução efetiva (pseudo)

```text
1. Se role == SUPER_ADMIN → ALL catalog grants
2. base = RolePreset[role] ∪ AccessProfile.permissions (se aplicado) ∪ AppUser.permissions
3. aplicar UserOverride: DENY remove; ALLOW adiciona
4. expandir requires/parent: grant filho só vale se todos os ancestrais view estiverem presentes
5. filterKnownPermissions(whitelist catálogo)
6. retornar Set efetivo
```

**Herança (obrigatória):**

- Sem `MENU.view` → nenhum `SUBMENU` / `TAB` / `ACTION` daquele ramo.
- Sem `SUBMENU.view` → nenhuma `TAB` / `ACTION` filha.
- Grant de `TAB.view` **não** abre o menu pai sozinho.
- Exceção só com flag `orphanEscape: true` no catálogo (proibida no catálogo inicial).

---

## 2. Diagrama textual da hierarquia

```text
dashboard                          [MENU]
comercial                          [MENU]
  comercial.pedidos_venda          [SUBMENU]
  comercial.crm                    [SUBMENU]
comissoes                          [MENU]
financeiro                         [MENU]
  financeiro.contas_receber        [SUBMENU]
  financeiro.contas_pagar          [SUBMENU]
  financeiro.fluxo_caixa           [SUBMENU]
  financeiro.relatorio_presidencial[SUBMENU]
  financeiro.conciliacao_carteira  [SUBMENU]
    …tab.conciliacao               [TAB]
    …tab.inteligencia              [TAB]
    …tab.auditoria_pedido_caixa    [TAB]
suprimentos                        [MENU]
  suprimentos.inteligencia_mercado [SUBMENU]
admin                              [MENU]
  admin.usuarios                   [SUBMENU]
  admin.permissoes                 [SUBMENU]
    …action.manage                 [ACTION]  (crítica)
```

Fluxo de bloqueio:

```text
financeiro.view = NEGADO
  ⇒ conciliacao_carteira.* invisível e 403 na API
  ⇒ mesmo se AppUser.permissions contiver tab.inteligencia.view (descartado na resolução)
```

---

## 3. Catálogo inicial de permissões

### 3.1 Convenção de chaves oficiais (recurso)

- Formato: `dominio[.area[.tab.nome]]` em **snake_case** português (estável para docs/produto).
- Grant de visão: `{resourceKey}.view` (ou action explícita no final).
- **Alias runtime** aponta para a chave já existente no `PERMISSION_CATALOG` (inglês), até cutover.

### 3.2 Catálogo mínimo (obrigatório deste plano)

| resourceKey | label | type | parent | module | description | alias atual (runtime) |
|-------------|-------|------|--------|--------|-------------|------------------------|
| `dashboard` | Dashboard | MENU | — | dashboard | Painel principal | `dashboard.view` |
| `financeiro` | Financeiro | MENU | — | finance | Domínio financeiro | `finance.view` |
| `financeiro.conciliacao_carteira` | Conciliação de Carteira | SUBMENU | `financeiro` | finance | Módulo Conciliação / Inteligência / Auditoria O2C | `finance.portfolioReconciliation.view` |
| `financeiro.conciliacao_carteira.tab.conciliacao` | Aba Conciliação | TAB | `financeiro.conciliacao_carteira` | finance | Conciliar carteira vs pedido/caixa | `finance.portfolioReconciliation.conciliation.view` |
| `financeiro.conciliacao_carteira.tab.inteligencia` | Aba Inteligência da Carteira | TAB | `financeiro.conciliacao_carteira` | finance | KPIs e inteligência O2C | `finance.portfolioReconciliation.intelligence.view` |
| `financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa` | Aba Auditoria Pedido → Caixa | TAB | `financeiro.conciliacao_carteira` | finance | Auditoria pedido → caixa | `finance.portfolioReconciliation.orderToCashAudit.view` |
| `financeiro.contas_receber` | Contas a Receber | SUBMENU | `financeiro` | finance | Dashboard / seções AR | `finance.accountsReceivable.view` |
| `financeiro.contas_pagar` | Contas a Pagar | SUBMENU | `financeiro` | finance | Dashboard / seções AP | `finance.accountsPayable.view` |
| `financeiro.fluxo_caixa` | Fluxo de Caixa | SUBMENU | `financeiro` | finance | Visão de fluxo (criar chave dedicada se ainda OR legado) | *gap* — hoje OR finance/AR/AP/reports |
| `financeiro.relatorio_presidencial` | Relatório Presidencial | SUBMENU | `financeiro` | finance | Relatório executivo | *gap* — `finance.executiveReport.view` referenciado e **ausente** do catálogo |
| `comercial` | Comercial | MENU | — | comercial | Grupo comercial (CRM, pedidos, etc.) | composto: `crm.view` ∨ `sales_orders.view` ∨ … (ver §5) |
| `comercial.pedidos_venda` | Pedidos de Venda | SUBMENU | `comercial` | sales-orders | Pedidos de venda | `sales_orders.view` |
| `comercial.crm` | CRM | SUBMENU | `comercial` | crm-commercial | CRM Comercial | `crm.view` |
| `comissoes` | Comissões | MENU | — | commissions | Módulo de comissões | `commissions.view` |
| `suprimentos` | Suprimentos | MENU | — | materials | Materiais / compras (entrada lateral) | `materials.view` (+ legado `costs.view`) |
| `suprimentos.inteligencia_mercado` | Inteligência de Mercado | SUBMENU | `suprimentos` | materials | Cotações / alertas de mercado | `materials.market*.view` (união documentada na implementação) |
| `admin` | Administração | MENU | — | settings | Configurações / governança | `settings.view` |
| `admin.usuarios` | Usuários | SUBMENU | `admin` | settings | Gestão de usuários | `users.manage` |
| `admin.permissoes` | Permissões / Perfis | SUBMENU | `admin` | settings | Perfis e editor de permissões | `accessProfiles.view` |
| `admin.permissoes.action.manage` | Gerir permissões | ACTION | `admin.permissoes` | settings | Criar/editar perfis e grants | `accessProfiles.manage` |

### 3.3 Ações críticas sugeridas (fase B, não obrigatórias no MVP de visão)

| resourceKey + action | Motivo |
|----------------------|--------|
| `financeiro.conciliacao_carteira` + `execute` | Rebuild / jobs OrderToCashAudit |
| `financeiro.contas_receber` + `export` | Export AR |
| `financeiro.contas_pagar` + `export` | Export AP |
| `admin.usuarios` + `admin` | Equivale a `users.manage` (já crítico) |
| `admin.permissoes` + `admin` | Equivale a `accessProfiles.manage` |

### 3.4 Rascunho Prisma (somente documentação — **não migrar agora**)

```prisma
// FASE C — rascunho. Não criar migration neste prompt.

enum AppPermissionAction {
  view
  read
  create
  update
  delete
  export
  execute
  admin
}

// Catálogo continua em código; RolePermission só armazena grants.
model RolePermission {
  id         String              @id @default(cuid())
  role       AppUserRole
  resourceKey String
  action     AppPermissionAction
  createdAt  DateTime            @default(now())

  @@unique([role, resourceKey, action])
  @@index([role])
}

model UserPermissionOverride {
  id         String              @id @default(cuid())
  appUserId  String
  resourceKey String
  action     AppPermissionAction
  effect     String              // "ALLOW" | "DENY"
  reason     String?
  createdAt  DateTime            @default(now())
  createdBy  String?

  appUser    AppUser             @relation(fields: [appUserId], references: [id])

  @@unique([appUserId, resourceKey, action, effect])
  @@index([appUserId])
}
```

Até a Fase C, **não** existem essas tabelas; grants continuam em `String[]`.

---

## 4. Matriz inicial por role

Legenda: `V` = view concedido · `—` = negado · `A` = action/admin · `*` = bypass total

| Recurso | SUPER_ADMIN | ADMIN | COMMERCIAL_MANAGER | SELLER | VIEWER |
|---------|:-----------:|:-----:|:------------------:|:------:|:------:|
| `dashboard` | * | V | V | V | V |
| `financeiro` | * | V | — | — | — |
| `financeiro.conciliacao_carteira` | * | V | — | — | — |
| `…tab.conciliacao` | * | V | — | — | — |
| `…tab.inteligencia` | * | V | — | — | — |
| `…tab.auditoria_pedido_caixa` | * | V | — | — | — |
| `financeiro.contas_receber` | * | V | — | — | — |
| `financeiro.contas_pagar` | * | V | — | — | — |
| `financeiro.fluxo_caixa` | * | V | — | — | — |
| `financeiro.relatorio_presidencial` | * | V | — | — | — |
| `comercial` | * | V | V | V | V (leitura leve) |
| `comercial.pedidos_venda` | * | V | V | V | V |
| `comercial.crm` | * | V | V | V (`crm.seller.own`) | V (`crm.general` leve / conforme template) |
| `comissoes` | * | V | V (gestão) | V (próprio, se já houver) | — |
| `suprimentos` | * | V | — | — | — |
| `suprimentos.inteligencia_mercado` | * | V | — | — | — |
| `admin` | * | V | — | — | — |
| `admin.usuarios` | * | A | — | — | — |
| `admin.permissoes` | * | V | — | — | — |
| `admin.permissoes.action.manage` | * | — ou A** | — | — | — |

\*\* **ADMIN e permissões críticas:** por padrão ADMIN **vê** `admin.permissoes` e **pode** gerir usuários (`admin.usuarios`), mas **não** recebe automaticamente `accessProfiles.manage` / grants de ACL crítica até política explícita do tenant.  
**Recomendação operacional:** pelo menos 2 `SUPER_ADMIN` ativos; ADMIN operacional usa perfis sem editar o próprio bypass.

### 4.1 Presets (mapeamento para seeds atuais)

| Role | Preset / seed de referência |
|------|-----------------------------|
| SUPER_ADMIN | `role_super_admin` (permissions `[]` + bypass) |
| ADMIN | `role_admin` / template `system_admin` + users/accessProfiles conforme política |
| COMMERCIAL_MANAGER | `role_commercial_manager` / `commercial_manager` |
| SELLER | `role_seller` / `seller` + escopo `crm.seller.own` |
| VIEWER | `role_viewer` ou `read_only` |

### 4.2 Exceções por usuário

1. Preferir **AccessProfile** nomeado (cópia) para 90% dos casos.
2. Ajuste fino: editar `AppUser.permissions[]` no PermissionEditor (já existe).
3. Futuro: `UserPermissionOverride` ALLOW/DENY com motivo + `AppUserChangeLog`.
4. DENY sempre vence ALLOW na mesma chave (quando overrides existirem).
5. Overrides **não** quebram herança: ALLOW em TAB sem MENU continua inválido.

### 4.3 Como não bloquear todos os admins

Já parcialmente implementado (action plan ✅):

- Não permitir remover a própria `users.manage`.
- Não permitir auto-rebaixar / auto-inativar SUPER_ADMIN.
- Proteger último SUPER_ADMIN ativo.
- Bootstrap cookie `induscost_bootstrap_admin` para recuperação operacional (fora de AppUser).

Neste modelo novo, adicionar na implementação futura:

- Checklist no editor: “ao menos 1 SUPER_ADMIN e 1 ADMIN com `admin.usuarios`”.
- Simulador “como este usuário vê o menu” antes de salvar.

---

## 5. Regras de backend

1. **Toda rota de domínio** usa `requireAppAuth` + `requirePermission` / `requireAnyPermission`.
2. **Nunca** confiar só no hide da UI.
3. Para recurso hierárquico, o guard pede a chave **mais específica** da operação (ex.: tab), e o resolver já exige pais.
4. Remover gradualmente ORs legados (`finance.view` \| AR \| AP \| reports) **depois** do backfill — janela de compatibilidade documentada.
5. Asserts `role === SUPER_ADMIN` em deletes destrutivos podem permanecer como segunda trava; novos endpoints preferem chave `*.admin` / `*.execute`.
6. Gaps a fechar na mesma trilha de implementação (não neste prompt):
   - `GET /api/test-db`
   - chave dedicada `financeiro.fluxo_caixa` / `financeiro.relatorio_presidencial`
7. Conciliação de Carteira já é o **padrão de referência** (módulo + 3 tabs + routes).

### 5.1 Menu composto `comercial`

O sidebar atual agrupa vários módulos. Opções:

| Opção | Descrição | Recomendação |
|-------|-----------|--------------|
| A | `comercial` é só grupo UI; cada submenu tem gate próprio | **Preferida** — alinha com `navigationGroups` |
| B | `comercial.view` artificial OR de filhos | Evitar; duplica OR legado |

Oficial: **Opção A**. `comercial` no catálogo deste plano é **âncora documental** do grupo; grants efetivos ficam nos SUBMENUs (`comercial.crm`, `comercial.pedidos_venda`, …). O accordion “Comercial” aparece se **qualquer** filho for visível.

---

## 6. Regras de frontend

1. Sidebar: `buildAccessibleSidebarNavigation` / `canAccessModule` — só com `MENU`/`SUBMENU` efetivos.
2. Tabs: esconder aba sem `TAB.view`; não montar fetch da aba sem permissão (padrão PR).
3. Botões críticos: desabilitar/ocultar sem `ACTION`, mas API é a fonte da verdade.
4. `RequireAuth` continua só sessão na Fase A; Fase B pode adicionar `RequirePermission` por rota.
5. Admin UI: PermissionEditor em árvore MENU → SUBMENU → TAB → ACTION, com herança visual (marcar pai ao marcar filho; avisar se marcar filho sem pai).
6. UX simples: presets por role + “avançado” para overrides; evitar checklist de 162 chaves na primeira tela.

---

## 7. Estratégia de migração

### Fase A — Documentação + aliases (este prompt / imediato)

- Publicar este plano + inventário.
- Manter chaves inglesas em runtime.
- Tabela de alias §3.2 é a ponte.

### Fase B — Catálogo + guards (próximos prompts)

1. Garantir no catálogo vivo: fluxo de caixa e relatório presidencial com chaves dedicadas + `parentKey`/`requires`.
2. Remover OR legado da Conciliação **após** confirmar que admins/perfis têm as 4 chaves PR.
3. Script read-only de backfill: listar usuários sem pai mas com filho; corrigir grants.
4. Atualizar seeds `AccessProfile` / templates.
5. Ampliar tab-ACL só onde houver risco (não AR/AP inteiros no dia 1).

### Fase C — Relacional (opcional)

- Migration `RolePermission` + `UserPermissionOverride` + `AppUserChangeLog`.
- Dual-read: resolver lê String[] **ou** tabelas; depois cutover.
- Deprecar snapshot cego sem perfil.

### Usuários existentes

| Situação | Ação |
|----------|------|
| SUPER_ADMIN | Nenhuma (bypass) |
| Usuário com `finance.view` amplo | Manter acesso via alias/OR até backfill das chaves finas |
| Usuário só com tab PR legada implícita | Após remoção do OR, conceder explicitamente tabs necessárias |
| AccessProfile desatualizado | Reaplicar perfil ou script de sync one-shot |

---

## 8. Estratégia de fallback

1. **Compatibilidade:** se alias oficial não resolvido, aceitar chave legada equivalente.
2. **OR legado:** feature-flag / constante `LEGACY_FINANCE_OR_ENABLED` (já conceitualmente presente na PR) — default `true` até backfill; depois `false`.
3. **Catálogo desconhecido:** `filterKnownPermissions` descarta chaves órfãs (já existe).
4. **Falha de resolução:** negar (fail closed) em API; UI mostra “sem permissão”.
5. **Recuperação:** bootstrap admin + proteção último SUPER_ADMIN.
6. **Rollback:** reativar OR legado e reverter commit de guards sem migration destrutiva.

---

## 9. Critérios de aceite (quando implementar)

- [ ] Catálogo oficial documentado com parent-child para o conjunto mínimo §3.2.
- [ ] Aliases cobrem 100% das chaves mínimas que já existem no runtime.
- [ ] SUPER_ADMIN continua com acesso total sem lista manual.
- [ ] ADMIN não perde `users.manage` / auto-bloqueio (regras atuais preservadas).
- [ ] Herança: filho sem pai nunca aparece no efetivo.
- [ ] TAB não abre MENU sozinha.
- [ ] Conciliação: 3 tabs + módulo respeitam grants (já parcialmente feito).
- [ ] APIs das tabs PR retornam 403 sem permissão (já parcialmente feito).
- [ ] Script de inventário / backfill dry-run sem escrever no banco.
- [ ] Sem migration obrigatória até Fase C aprovada.
- [ ] Testes: `check:server-imports`, `check:frontend-server-imports`, unitários de resolução/herança, `build`.

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Remover OR legado cedo demais | Lockout financeiro | Flag + backfill + checklist de perfis |
| Duas nomenclaturas (PT resource vs EN key) | Confusão de admin | Aliases + UI mostra label; key técnica escondida no avançado |
| Explosão de actions | Editor inutilizável | Só `view` em MENU/SUBMENU/TAB no MVP |
| ADMIN sem `accessProfiles.manage` | Ninguém edita ACL | Garantir ≥1 SUPER_ADMIN; documentar política |
| AccessProfile snapshot defasado | Usuário “fantasma” | Aviso no editor + reaplicar perfil |
| Menu `comercial` composto | Grupo vazio ou sempre aberto | Opção A (§5.1): grupo = OR visual dos filhos |
| Gaps fluxo/presidencial | ACL impossível | Criar chaves dedicadas na Fase B |
| Modelo RolePermission cedo | Migration sem ganho | Adiar Fase C |

---

## Apêndice A — Respostas às 12 definições pedidas

| # | Tema | Decisão |
|---|------|---------|
| 1 | Chaves oficiais | §3.2 `resourceKey` snake_case PT |
| 2 | Nomes amigáveis | coluna `label` |
| 3 | Tipo | MENU / SUBMENU / TAB / ACTION |
| 4 | Hierarquia | `parent` + resolução ancestral |
| 5 | Descrição | coluna `description` |
| 6 | Módulo | coluna `module` (ids sidebar) |
| 7 | Defaults por role | §4 matriz |
| 8 | Herança | filho exige pais; tab não abre menu |
| 9 | Exceção usuário | perfil + array; futuro override ALLOW/DENY |
| 10 | Não bloquear admins | proteções atuais + ≥2 SUPER_ADMIN + simulador |
| 11 | Migrar existentes | Fase A alias → B backfill → C opcional |
| 12 | UI simples | presets + árvore + avançado; labels não keys |

---

## Apêndice B — Arquivos prováveis na implementação (não alterar agora)

- `src/lib/permissionCatalog.ts` / `permissionCatalogUtils.ts` / `permissionGroups.ts`
- `src/lib/appAuth.ts` / `appAuthMiddleware.ts`
- `src/lib/modulePermissions.ts` / `navigationGroups.ts` / `sidebarNavigation.ts`
- `src/lib/financePortfolioReconciliationPermissions.ts` (+ routes/page)
- `src/lib/accessProfilesSeedData.ts`
- `src/components/admin/PermissionEditor.tsx`, `AdminUsersModule.tsx`, `AccessProfilesModule.tsx`
- Docs: este plano, inventário, action plan

---

## Apêndice C — Fora de escopo deste documento

- Implementação de guards/UI
- Migration Prisma
- Remoção imediata do OR legado
- Redesign visual do PermissionEditor
- Permissionamento fino de todas as abas AR/AP
