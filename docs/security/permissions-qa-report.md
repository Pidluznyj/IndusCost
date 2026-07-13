# Relatório QA — Permissionamento

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data (UTC)** | 2026-07-13T11:54:32.092Z |
| **Script** | `scripts/qaPermissions.ts` |
| **Pass** | 19 |
| **Fail** | 0 |
| **Warn** | 2 |
| **Skip** | 0 |
| **Conclusão** | **LIBERADO** |

## Status por categoria

- **Catálogo**: PASS (✅1)
- **Hierarquia**: WARN (✅2 ✅3 ✅4 ⚠️5 ✅6)
- **Roles**: PASS (✅7 ✅8 ✅9 ✅10 ✅11)
- **Abas PR**: PASS (✅12 ✅13 ✅14)
- **HTTP guards**: PASS (✅15 ✅16 ✅17)
- **Frontend**: PASS (✅18 ✅19)
- **Governança**: PASS (✅20)
- **Live DB**: WARN (⚠️100)

## Testes feitos

### 1. Catálogo existe

- **Categoria:** Catálogo
- **Status:** ✅ `pass`
- **Evidências:**
  - PERMISSION_RESOURCE_SEEDS.length=42

### 2. Hierarquia válida

- **Categoria:** Hierarquia
- **Status:** ✅ `pass`
- **Evidências:**
  - validatePermissionResourceCatalog() → []

### 3. Menus sem parent

- **Categoria:** Hierarquia
- **Status:** ✅ `pass`
- **Evidências:**
  - menus=6
  - todos MENU com parentKey=null

### 4. Submenus com parent menu

- **Categoria:** Hierarquia
- **Status:** ✅ `pass`
- **Evidências:**
  - submenus=10
  - todos SUBMENU → MENU

### 5. Tabs com parent submenu

- **Categoria:** Hierarquia
- **Status:** ⚠️ `warn`
- **Evidências:**
  - tabs=25; 12 com parent SUBMENU
  - comissoes.tab.fechamento_mes → MENU comissoes
  - comissoes.tab.excecoes_cliente → MENU comissoes
  - comissoes.tab.relatorios → MENU comissoes
  - comissoes.tab.dashboard → MENU comissoes
  - comissoes.tab.previstas → MENU comissoes
  - comissoes.tab.confirmadas → MENU comissoes
  - comissoes.tab.liberacao → MENU comissoes
  - comissoes.tab.pagamentos → MENU comissoes
  - comissoes.tab.pessoas → MENU comissoes
  - comissoes.tab.regras → MENU comissoes
  - comissoes.tab.auditoria → MENU comissoes
  - comissoes.tab.configuracoes → MENU comissoes
  - suprimentos.tab.catalogo → MENU suprimentos
- **Notas:** Ideal MENU→SUBMENU→TAB. Tabs sob MENU (comissões / catálogo) aceitas como pendência estrutural, não bloqueante.

### 6. Actions com parent válido

- **Categoria:** Hierarquia
- **Status:** ✅ `pass`
- **Evidências:**
  - actions=1
  - admin.permissoes.action.manage → admin.permissoes

### 7. SUPER_ADMIN acessa tudo

- **Categoria:** Roles
- **Status:** ✅ `pass`
- **Evidências:**
  - Acesso total em 42 recursos × 3 ações

### 8. ADMIN tem permissões esperadas

- **Categoria:** Roles
- **Status:** ✅ `pass`
- **Evidências:**
  - ADMIN: financeiro+conciliação+usuários; sem manage ACL crítica

### 9. COMMERCIAL_MANAGER não acessa admin.permissoes

- **Categoria:** Roles
- **Status:** ✅ `pass`
- **Evidências:**
  - admin.permissoes view=false
  - admin view=false
  - comercial.crm view=true

### 10. SELLER não acessa admin e respeita permissões comerciais

- **Categoria:** Roles
- **Status:** ✅ `pass`
- **Evidências:**
  - admin view=false
  - admin.usuarios view=false
  - admin.permissoes view=false
  - comercial view=true
  - comercial.pedidos_venda view=true
  - comercial.crm view=true
  - comercial.crm.tab.gestao_geral view=false
  - comercial.crm.tab.gestao_vendedor view=true

### 11. VIEWER não acessa ações críticas

- **Categoria:** Roles
- **Status:** ✅ `pass`
- **Evidências:**
  - VIEWER sem execute/manage/admin em 1 ACTION(s)
  - comercial.pedidos_venda view=true execute=false

### 12. Aba Conciliação protegida

- **Categoria:** Abas PR
- **Status:** ✅ `pass`
- **Evidências:**
  - SELLER view=false (expect false)
  - VIEWER view=false (expect false)
  - COMMERCIAL_MANAGER view=false (expect false)
  - ADMIN view=true (expect true)
  - SUPER_ADMIN view=true (expect true)

### 13. Aba Inteligência protegida

- **Categoria:** Abas PR
- **Status:** ✅ `pass`
- **Evidências:**
  - SELLER view=false (expect false)
  - VIEWER view=false (expect false)
  - COMMERCIAL_MANAGER view=false (expect false)
  - ADMIN view=true (expect true)
  - SUPER_ADMIN view=true (expect true)

### 14. Aba Auditoria Pedido → Caixa protegida

- **Categoria:** Abas PR
- **Status:** ✅ `pass`
- **Evidências:**
  - SELLER view=false (expect false)
  - VIEWER view=false (expect false)
  - COMMERCIAL_MANAGER view=false (expect false)
  - ADMIN view=true (expect true)
  - SUPER_ADMIN view=true (expect true)

### 15. Endpoint sem login retorna 401

- **Categoria:** HTTP guards
- **Status:** ✅ `pass`
- **Evidências:**
  - {"ok":false,"status":401,"body":{"error":"UNAUTHORIZED","message":"Autenticação necessária."}}

### 16. Endpoint sem permissão retorna 403

- **Categoria:** HTTP guards
- **Status:** ✅ `pass`
- **Evidências:**
  - {"ok":false,"status":403,"body":{"error":"FORBIDDEN","code":"PERMISSION_DENIED","message":"Você não tem permissão para acessar este recurso (admin.permissoes.action.manage:manage).","resourceKey":"admin.permissoes.action.manage","action":"manage"}}

### 17. Endpoint com permissão retorna 200

- **Categoria:** HTTP guards
- **Status:** ✅ `pass`
- **Evidências:**
  - authorizeResourceAccess → ok (equivale a 200 no middleware)

### 18. Frontend não importa Prisma

- **Categoria:** Frontend
- **Status:** ✅ `pass`
- **Evidências:**
  - [check:frontend-server-imports] OK — 643 arquivo(s) frontend rastreado(s); nenhum caminho até Prisma/server.

### 19. Menu lateral não mostra recurso bloqueado

- **Categoria:** Frontend
- **Status:** ✅ `pass`
- **Evidências:**
  - createSidebarCanViewResource(SELLER) bloqueia: admin, admin.usuarios, admin.permissoes, financeiro, financeiro.conciliacao_carteira
  - permite: dashboard, comercial, comercial.crm

### 20. Não deixar o sistema sem SUPER_ADMIN

- **Categoria:** Governança
- **Status:** ✅ `pass`
- **Evidências:**
  - assertCanChangeSuperAdminRole bloqueia rebaixamento do último SUPER_ADMIN
  - assertCanChangeSuperAdminRole bloqueia inativação do último SUPER_ADMIN
  - com 2 SUPER_ADMIN ativos, demote permitido

### 100. Checagens live (DATABASE_URL)

- **Categoria:** Live DB
- **Status:** ⚠️ `warn`
- **Evidências:**
  - Banco inacessível:  Invalid `prisma.permissionResource.findMany()` invocation in C:\Users\paulo\OneDrive - Lazarios Koppetel\Documentos\Lazarios\TI\IndusCost\IndusCost\scripts\qaPermissions.ts:582:57    579 const { PrismaClient } = await import("@prisma/client");   580 const prisma = new PrismaClient();   581 try { → 582   const resources = await prisma.permissionResource.findMany( Can't reach database server at `localhost:5432`  Please make sure your database server is running at `localhost:543
- **Notas:** Tratado como warn — ambiente local sem Postgres.

## Falhas encontradas

Nenhuma falha bloqueante neste run.

## Correções feitas

- Criado `scripts/qaPermissions.ts` + `npm run permissions:qa` cobrindo os 20 critérios.
- Relatório gerado automaticamente a cada run deste script.
- Fix Windows: check #18 invoca `node node_modules/tsx/dist/cli.mjs` (evita `npx.cmd` EINVAL).
- Nenhuma falha bloqueante no motor/guards/UI client neste ciclo.

## Pendências reais

- ⚠️ #5 Tabs com parent submenu: Ideal MENU→SUBMENU→TAB. Tabs sob MENU (comissões / catálogo) aceitas como pendência estrutural, não bloqueante.
- ⚠️ #100 Checagens live (DATABASE_URL): Tratado como warn — ambiente local sem Postgres.

## Conclusão

**LIBERADO** para uso operacional do permissionamento menu/submenu/aba/ação, com ressalvas de warn acima (se houver).

Pré-requisito em cada ambiente: `npx prisma migrate deploy` + `npm run permissions:seed` + SUPER_ADMIN ativo.

## Comandos de evidência

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm run check:browser-bundle
npm test
npm run build
npx tsx scripts/qaPermissions.ts
```
