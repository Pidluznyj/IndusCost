# Diagnóstico de runtime — Usuários e Permissões (IndusCost)

**Data:** 2026-07-16  
**Escopo:** somente diagnóstico (sem correção de comportamento).  
**Caso motivador:** usuária “Leticia”, perfil exibido **Visualizador** (`VIEWER`), intenção = somente **Financeiro > Contas a Pagar**; na prática viu/abriu Engenharia, Simulador, Suprimentos, Simulações, Financeiro, Conciliação de Carteira, Custos Indiretos, Operações, Máquinas, Administração, Pessoas/RH.

---

## 1. Arquitetura efetivamente usada hoje

Há **dois modelos coexistindo**. O que **manda no runtime de sessão** é o legado materializado.

| Camada | O que é | Usado em runtime? |
|--------|---------|-------------------|
| `AppUser.role` | Enum (`VIEWER`, `ADMIN`, …) | Sim — label UI, presets de matriz, `SUPER_ADMIN` bypass, fallback FE `ROLE_MATRIX` se bag vazia |
| `AppUser.permissions[]` | Bag de chaves legadas (`finance.accountsPayable.view`, `costs.view`, …) | **Sim — fonte principal** após `getEffectivePermissions` |
| `UserPermissionOverride` | Grants estruturados por `resourceKey` (canView/Execute/Manage) | **Só no editor/admin**; **não** é lido em login/`/api/auth/me` |
| `PermissionResource` + seed | Árvore (`financeiro.contas_pagar`, …) | Catálogo + dual-write + matriz; FE tem catálogo paralelo em `permissionsClient.ts` |
| `AccessProfile` | Perfil com lista de permissões + `roleBase` | Ao **aplicar** perfil, **substitui** `role` + `permissions[]`; nome exibido se vinculado |
| `RolePermission` / preset seed | Baseline por role na árvore | Usado ao **salvar matriz** (`buildEffectiveFlagsMap`) e dual-write; **não** no login |
| FE `ROLE_MATRIX` | Defaults por role no cliente | Só se `effectivePermissions.length === 0` |

**Motor efetivo (sessão):**

```
AppUser.permissions[]
  → filterKnownPermissions
  → getEffectivePermissions (SUPER_ADMIN = todas as chaves; senão = bag filtrada)
  → SafeAppUser.effectivePermissions
  → cookie/sessão → GET /api/auth/me
  → AuthContext.hasPermission / createPermissionsApi / canAccessModule
```

**Conclusão:** o editor novo (matriz / overrides / resourceKey) é **fonte de verdade na persistência administrativa**, mas o **runtime de menu/rota/API** consome sobretudo a **bag legada** `AppUser.permissions[]` (e aliases cruzados). Overrides estruturados **não** são reavaliados a cada request autenticado.

---

## 2. Fluxo do login → tela

1. Login autentica e cria sessão server-side.
2. Cliente chama `GET /api/auth/me` (`AuthContext.loadMe`).
3. Backend monta `toSafeAppUser` → `permissions` + `effectivePermissions` + `role` + `accessProfileName` (label).
4. Frontend guarda em **React state** (`AuthContext`). Não há snapshot de permissões em `localStorage`/`sessionStorage` (só layout da sidebar: collapsed/expanded groups).
5. Sidebar: `buildResourceAwareSidebarNavigation` → itens com `resourceKey` via `canViewResource` / `canAccessResourceClient`; sem `resourceKey` → `canAccessModule` legado.
6. Rotas: `Layout.tsx` → `evaluatePathViewAccess` (mesmo resolvedor da sidebar). Path **não mapeado** a módulo = **permitido** (`unmapped`).
7. Abas: `filterTabsByView` / resourceKeys de módulo (quando existentes).
8. APIs: `requireAppAuth` + `requireAnyPermission([...])` (ou equivalentes) sobre a **bag** da sessão; **não** consultam `UserPermissionOverride`.

---

## 3. Fluxo da sessão

| Pergunta | Resposta |
|----------|----------|
| Sessão recebe role? | Sim |
| Recebe `permissions[]`? | Sim |
| Recebe perfil? | `accessProfileId` / `accessProfileName` (metadado); **não** recalcula grants do perfil a cada me |
| Recebe resource grants / overrides? | **Não** |
| Recebe permissões efetivas? | Sim — `effectivePermissions` = bag filtrada (exceto SUPER_ADMIN) |
| Token JWT com permissões? | Sessão app (cookie); permissões vêm do DB do usuário a cada `me` / auth hydrate |
| Cache FE de permissões? | Estado React até logout/`loadMe`; sem invalidação automática ao salvar matriz de **outro** usuário |

---

## 4. Fluxo do editor (salvar matriz)

Arquivos: `AdminUsersModule` → `saveUserPermissionOverrides` (client) → `userPermissionAdminRoutes` → `saveUserPermissionOverrides` (service).

1. UI monta draft; `overridesPayloadFromDraft` **só emite override** se o valor **difere** do baseline da role.
2. Payload → replace de `UserPermissionOverride` do usuário.
3. `buildEffectiveFlagsMap(role, overrides)` = **preset da role ⊕ overrides** (para **todas** as seeds).
4. `materializeLegacyPermissionsFromFlags` / `materializeStructuredToLegacy` → nova `AppUser.permissions[]` (**dual-write**).
5. Dual-write: chaves com alias estrutural no **seed** são derivadas das flags (ex.: `costs.view`↔machines/suprimentos, `products.view`↔`operations.performance` — se o recurso efetivo é NONE, a chave **cai**). Chaves do catálogo **sem** alias no seed (ex.: `pricing.view`) são **preservadas** da bag anterior.
6. Retorno da API atualiza tela admin; a **sessão da usuária alvo** só muda no próximo `me`/login dela.

**Deny:** desmarcar checkbox que a role concede → override com `canView: false` (deny explícito). Desmarcar o que já é `NONE` na role → **nada** é gravado (ausência ≠ deny persistido).

---

## 5. Fluxo da sidebar

- Mapa: `SIDEBAR_MODULE_RESOURCE_KEYS` / `SIDEBAR_GROUP_RESOURCE_KEYS` (`sidebarMenuResources.ts`).
- Filtro: `sidebarNavigation.ts` — se há `resourceKey` e `canViewResource`, usa resource; senão `canAccessModule`.
- Grupos aparecem se **tiverem filhos** acessíveis (não bastam só autenticação).
- Itens **sem** `resourceKey` (ex.: `opex` / Custos Indiretos): só legado (`costs.view` / `opex.view`).

### Tabela — itens do print (cenário Contas a Pagar / VIEWER)

| Item sidebar | Componente / mapa | resourceKey | Chave legada típica | Regra | Esperado (só AP) | Causa provável da exibição |
|--------------|-------------------|-------------|---------------------|-------|------------------|----------------------------|
| Financeiro (grupo/item) | `finance` → `FINANCEIRO` | `financeiro` | `finance.accountsPayable.view` está em `legacyAliasKeys` do **pai** | alias legado | Grupo **abre** | **Bleed confirmado:** AP libera parent |
| Contas a Pagar | seção interna `/finance` (não item sidebar dedicado) | seed `financeiro.contas_pagar` | `finance.accountsPayable.view` | módulo finance + seções | Autorizado | Correto se bag tem AP |
| Conciliação de Carteira | `portfolio-reconciliation` | `financeiro.conciliacao_carteira` | **também** lista `finance.accountsPayable.view` | alias cruzado | **Não** deveria | **Bleed confirmado** |
| Engenharia | grupo `engenharia` | `engineering` | `products.view`, … | resource + aliases | Não | Bag com `products.view` **ou** bag vazia + `ROLE_MATRIX.VIEWER` |
| Produtos / Simulador / Simulações | módulos engenharia | keys `engineering.*` (FE) | `products.view` / `simulations.view` / `costs.view` | resource ou legado | Não | Mesmo; simulador OR em `canAccessModule` |
| Suprimentos | `materials` | `suprimentos` | `materials.view`, `costs.view` | resource | Não | `materials.view` ou `costs.view` na bag |
| Custos Indiretos | `opex` | **sem** resourceKey | `opex.view` \|\| `costs.view` | **só legado** | Não | `costs.view` |
| Operações / Máquinas | `machines` | `operations.machines` | `machines.view`, `costs.view` | resource | Não | `costs.view` / `machines.view` |
| Administração / Pessoas RH | `employees` | `admin.employees` (**FE**; **ausente no seed**) | `employees.view`, `costs.view` | resource FE | Não | `costs.view` / `employees.view` |
| Comercial / Pedidos | comercial | `comercial.*` | `crm.view`, `sales_orders.view` | resource | Não (intenção) | **Baseline VIEWER** materializa comercial no dual-write |

---

## 6. Fluxo das rotas

`evaluatePathViewAccess` (`resourceNavigationAccess.ts`):

- Módulo mapeado → mesma regra da sidebar.
- `/employees`, `/machines` → resource keys → **protegidos** se bag limpa (teste diagnóstico).
- Path sem módulo → **allowed** (`unmapped`) — risco residual para rotas fora do mapa.

`Layout.tsx` consome essa decisão (não é “só esconder menu”).

---

## 7. Fluxo do backend

- Guards usam `requireAppAuth` + listas de chaves legadas (`hasPermission` / `requireAnyPermission` sobre a sessão).
- **Não** recalculam árvore/overrides.
- Exemplo Pessoas/RH: `GET /api/employees` exige qualquer de `EMPLOYEES_VIEW_PERMISSIONS` = `employees.view` | `employees.edit` | **`costs.view`**.
- Contas a Pagar / finance: guards com chaves `finance.*` (e OR amplos em módulos).
- Divergência FE/BE: FE `ROLE_MATRIX` quando bag vazia **não** existe no backend → menus fantasma possíveis; no caso Leticia (bag provavelmente **não** vazia) o problema é alias/acúmulo, não ROLE_MATRIX.

Classificação resumida:

| Área | Proteção API típica |
|------|---------------------|
| Pessoas/RH | Permissão específica **ampla** (`costs.view` conta como view) |
| Máquinas | Permissão específica / legado costs |
| Financeiro / Contas a Pagar | Chaves finance.* |
| Lookups RH | Guards próprios (auth + permissões de employees) |
| Alguns endpoints | Só autenticação (auditar pontualmente; ver `permissions-endpoint-audit.md`) |

---

## 8. Precedência real

Ordem prática no **cliente** (`resolveRawFlags` / ancestors):

1. `SUPER_ADMIN` → tudo.
2. Se `effectivePermissions.length === 0` → `ROLE_MATRIX[role][resourceKey]` (VIEWER inclui Engenharia).
3. Senão → base `NONE`, depois **OR** se qualquer `legacyAliasKeys` ∈ bag.
4. Ancestrais podem ser elevados quando filho libera (legado).

No **login/backend:**

1. `SUPER_ADMIN` → todas as chaves do catálogo.
2. Senão → **somente** `AppUser.permissions[]` filtradas.
3. Role **não** adiciona chaves no login (exceto SUPER_ADMIN).

No **save da matriz:**

1. Baseline **oficial do seed** por role.
2. Override merge (deny explícito vence baseline daquele resourceKey).
3. Dual-write materializa bag (+ preserve unmapped).

---

## 9. Papel da role VIEWER / “Visualizador”

| Aspecto | Evidência |
|---------|-----------|
| Label UI | `formatRoleLabel(role)` → “Visualizador” (header/footer). É a **role**, não necessariamente o AccessProfile. |
| Seed VIEWER | Dashboard + Comercial/Pedidos = view; Financeiro (incl. contas_pagar) = **NONE**; Operações/Admin = NONE |
| FE `ROLE_MATRIX.VIEWER` | Dashboard + Comercial + **Engenharia/Produtos** (mais amplo que o seed) |
| AccessProfile “Visualizador” | `VIEWER_LIGHT_PERMISSIONS`: dashboard, crm, customers, proposals, **products.view**, reports, guide — **substitui** bag ao aplicar |
| Login | VIEWER **não** injeta seed; só a bag |
| Matriz | Ao salvar, dual-write **reintroduz** baseline comercial do seed mesmo se a intenção UI for “só Contas a Pagar”, a menos que haja **deny** override em cada recurso comercial |

**Hipótese “VIEWER = pode ver tudo”:** **descartada** no login. **Parcialmente confirmada** no FE se bag vazia (`ROLE_MATRIX`). **Parcialmente confirmada** no save: baseline comercial + aliases financeiros cruzados.

---

## 10. Papéis dos demais artefatos

| Artefato | Papel |
|----------|--------|
| AccessProfile | Overlay administrativo; ao aplicar, **substitui** role+permissions (não soma com bag antiga naquele passo) |
| `AppUser.permissions[]` | **Runtime** |
| Grants / overrides | Persistência da matriz; entrada do dual-write |
| Dual-write | Mantém bag sincronizada (imperfeita: aliases cruzados + preserve unmapped + baseline role) |
| Caches | React session; sem cache de permissões no localStorage |

---

## 11. Causas-raiz (classificação)

### Confirmadas (código + testes diagnósticos)

1. **Alias cruzado Contas a Pagar → Financeiro pai + Conciliação**  
   - Arquivos: `permissionsClient.ts`, `permissionResourceSeedData.ts`  
   - `finance.accountsPayable.view` em `legacyAliasKeys` de `financeiro` **e** `financeiro.conciliacao_carteira`  
   - Impacto: intenção “só AP” abre menu Financeiro e Conciliação  
   - Severidade: **alta**

2. **Mega-key `costs.view` abre Pessoas/RH, Máquinas, Suprimentos, Custos Indiretos, Simulações (legado)**  
   - FE aliases + `modulePermissions` + `EMPLOYEES_VIEW_PERMISSIONS`  
   - Severidade: **crítica** se a chave estiver na bag

3. **`products.view` abre Engenharia / Produtos / (com OR) Simulador**  
   - FE aliases + `canAccessModule`  
   - AccessProfile Visualizador **inclui** `products.view`  
   - Dual-write: `products.view` está mapeado a `operations.performance` no seed — com VIEWER NONE, **remove** a chave no save da matriz; se a bag ainda a tem, o save/dual-write **não** rodou depois do perfil (ou há outra chave: `materials.view` / `simulations.view` / bag vazia + ROLE_MATRIX)  
   - Severidade: **alta**

4. **Baseline VIEWER no dual-write re-materializa Comercial (+ dashboard)**  
   - `buildEffectiveFlagsMap` + materialize → `crm.view`, `sales_orders.view`, `dashboard.view` mesmo com override só em Contas a Pagar  
   - Matriz “só Contas a Pagar” **não** zera comercial sem denies explícitos  
   - Severidade: **alta** (intenção vs persistência)

5. **Desmarcar checkbox ≠ deny universal**  
   - `overridesPayloadFromDraft`: só grava diff vs role  
   - Ausência de override = baseline da role  
   - Severidade: **alta** (UX vs expectativa de deny)

6. **Catálogo FE ≠ seed**  
   - `admin.employees`, `engineering.*` no FE; ausentes/incompletos no seed  
   - Matriz seed **não controla** esses resourceKeys; só aliases legados  
   - Severidade: **alta**

7. **Overrides não entram no login**  
   - Runtime ignora tabela de overrides  
   - Severidade: **média** (se dual-write ok, bag cobre; se dual-write falha/diverge, editor mente)

### Prováveis (dependem do dado da usuária no servidor)

- Bag da Leticia ainda contém `costs.view` e/ou `products.view` e/ou perfil Visualizador aplicado anteriormente.  
- Sessão antiga até novo login/`me` após save (se testou sem relogar).

### Descartadas

- “Login amplia VIEWER automaticamente para todos os módulos” — `getEffectivePermissions` **não** faz isso.  
- “Sidebar só autenticação” — itens mapeados usam resource/legado.  
- “Rota `/employees` sem resource” — está mapeada; com bag só AP, `evaluatePathViewAccess` **nega** (teste).

---

## 12. Módulos afetados pelo desenho atual

Financeiro (pai), Conciliação, Contas a Pagar (chave compartilhada), Engenharia, Simulador, Simulações, Suprimentos, Custos Indiretos, Operações/Máquinas, Administração/Pessoas-RH, Comercial (baseline VIEWER).

---

## 13. Respostas objetivas (checklist do prompt)

1. **O que manda hoje?** `AppUser.permissions[]` → `effectivePermissions` (+ aliases FE/BE).  
2. **Editor novo é oficial ou overlay?** Oficial na **gravação** (overrides + dual-write); overlay relativo ao **runtime**, que lê a bag.  
3. **VIEWER concede o quê?** Seed: dashboard + comercial/pedidos. FE vazio: + engenharia. Perfil Visualizador: + products etc. Login: nada além da bag.  
4. **Matriz retira ou só acrescenta?** Retira chaves **mapeadas** cujo recurso efetivo fica NONE (ex.: `costs.view`, `products.view` no save VIEWER); **não** remove baseline comercial sem deny; **preserva** chaves unmapped no seed; baseline role **re-soma** comercial/dashboard no save.  
5. **Deny funciona?** Sim **se** gravado como override `false` e dual-write refletir; não se o checkbox só “iguala” ausência.  
6. **Desmarcar checkbox?** Diff vs role → deny ou noop.  
7. **Por que Pessoas/RH aparece?** Quase certamente `costs.view` e/ou `employees.view` na bag (aliases FE + API).  
8. **Por que a rota abre?** Layout usa o mesmo resolvedor; com essas chaves, `canViewModule("employees")` = true.  
9. **API RH protegida?** Sim, mas aceita **`costs.view`**.  
10. **Por que Máquinas?** Mesmo `costs.view` / `machines.view`.  
11. **Itens financeiros extras?** Alias AP no pai + Conciliação.  
12. **Contas a Pagar chave?** Estrutural `financeiro.contas_pagar` → legado `finance.accountsPayable.view`.  
13. **Chaves salvas = sidebar?** Parcialmente; aliases compartilhados e keys FE-only divergem.  
14. **Chaves salvas = APIs?** Parcialmente; APIs usam listas legadas (às vezes mais amplas).  
15. **Cache sessão?** Estado React; permissões no servidor na sessão/`me`.  
16. **Logout/login?** Necessário para a **usuária alvo** refletir save; admin não atualiza sessão dela.  
17. **Legado acumulado?** Sim para unmapped; mapped mega-keys caem no dual-write — se ainda aparecem na sessão, save não rodou ou bag pré-dual-write.  
18. **Fallback permissivo?** Bag vazia → ROLE_MATRIX; path unmapped → allow; `costs.view` mega-key.  
19. **Módulos fora da árvore seed?** Engenharia (`engineering.*`), Pessoas (`admin.employees*`), opex sem resourceKey, etc.  
20. **Solução definitiva recomendada?** Ver `permissions-definitive-solution-options.md` — recomendação: resolvedor único backend + resourceKeys alinhados + deny/precedência + migrar aliases (eliminar mega-keys e bleed AP→conciliação).

---

## 14. Validações e evidências de teste

Arquivo: `src/lib/security/permissionsRuntimeDiagnosis.test.ts` (documenta comportamento **atual**, inclusive bugs).

Comandos previstos no prompt: `npx prisma validate`, checks de imports/bundle, testes de permissões, `npm run build` — resultados na entrega do commit.
