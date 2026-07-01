# Relatório final — sidebar agrupada e gestão visual de acessos

**Projeto:** IndusCost / My Industry  
**Escopo:** validação integrada pós-implementação (sem alteração de rotas, URLs, permissões reais ou telas)  
**Última validação:** 2026-07-01  
**Commit de referência:** *(preenchido após push)*

---

## 1. Estrutura final do menu

| Grupo | Itens (ordem de exibição) |
| --- | --- |
| **Dashboard** *(direto)* | Dashboard |
| **Engenharia** | Produtos · Suprimentos · Simulações · Projetos |
| **Comercial** | CRM Comercial · Clientes · Propostas · Pedidos de venda · Formação de Preço · Comissões |
| **Financeiro** | Financeiro · Custos Indiretos · Tributos · Relatórios |
| **Operações** | Estoque / Almoxarifado · Compras · Máquinas · Manutenção Predial · Gestão de Frota |
| **Administração** | Pessoas / RH · Configurações · Guia do Sistema |

**Total:** 23 módulos · 6 grupos visuais (+ Dashboard direto)

Fonte de dados: `src/lib/navigationGroups.ts` → `buildGroupedNavigationStructure()`  
Renderização: `src/components/layout/Sidebar.tsx` → `buildAccessibleSidebarNavigation()`

**Validação automatizada:** `src/lib/sidebarGroupingFinalValidation.test.ts` — estrutura e labels conferidos contra mapa oficial.

---

## 2. Rotas preservadas

Todos os links da sidebar continuam no formato `/{AppModuleId}`:

| Módulo | Path | Rota em App.tsx |
| --- | --- | --- |
| dashboard | `/dashboard` | ✓ |
| products | `/products` | ✓ |
| materials | `/materials` | ✓ |
| simulations | `/simulations` | ✓ |
| projects | `/projects` | ✓ |
| crm-commercial | `/crm-commercial` | ✓ |
| customers | `/customers` | ✓ |
| proposals | `/proposals` | ✓ |
| sales-orders | `/sales-orders` | ✓ |
| pricing | `/pricing` | ✓ |
| commissions | `/commissions/*` | ✓ |
| finance | `/finance` | ✓ |
| opex | `/opex` | ✓ |
| taxes | `/taxes` | ✓ |
| reports | `/reports` | ✓ |
| inventory | `/inventory` | ✓ |
| purchases | `/purchases` | ✓ |
| machines | `/machines` | ✓ |
| maintenance | `/maintenance` | ✓ |
| fleet | `/fleet` | ✓ |
| employees | `/employees` | ✓ |
| settings | `/settings` | ✓ |
| guide | `/guide` | ✓ |

Sub-rotas internas (ex.: `/products/indicators`, `/finance/*`) **não foram alteradas** — apenas o entry point do módulo na sidebar.

**Auditoria:** `npm run audit:navigation-grouping` → **OK** (23 itens, baseline alinhado).

---

## 3. Permissões preservadas

- Visibilidade de cada item continua via `canAccessModule()` em `modulePermissions.ts`.
- Mapeamento read-only de permissões de menu: `MODULE_MENU_PERMISSION_KEYS` em `navigationGroups.ts`.
- **Nenhuma permission key nova** foi criada pelo agrupamento visual.
- Grupos **não** concedem acesso — apenas organizam itens já filtrados.

### Simulação por role (perfis sistema)

| Role / perfil | Comportamento validado |
| --- | --- |
| **SUPER_ADMIN** | Vê os 23 módulos (`getEffectivePermissions` → todas as keys) |
| **ADMIN** (`role_admin`) | Vê módulos conforme template admin; **sem** Comissões se não houver key |
| **COMMERCIAL_MANAGER** | Comercial (CRM, Clientes, Propostas, Pedidos); **sem** Comissões/Formação de Preço indevidos |
| **SELLER** | CRM, Clientes, Propostas, Pedidos; **sem** Comissões, Configurações ou módulo Financeiro; pode ver **Relatórios** e **Guia** via legado `dashboard.view` |
| **VIEWER** | Consulta básica; **sem** Configurações, Comissões ou Compras indevidos |

Testes: `sidebarGroupingFinalValidation.test.ts` (14 testes) + `sidebarNavigation.test.ts` + `permissionGroups.test.ts`.

**Regressões encontradas nesta validação:** nenhuma na frente sidebar/acesso.

---

## 4. Gestão visual de acessos agrupada

**Tela:** Configurações → Usuários e Permissões (`PermissionEditor.tsx`)

| Aspecto | Status |
| --- | --- |
| Permissões agrupadas por área (Engenharia, Comercial, …) | ✓ |
| Bulk “marcar grupo” / “somente view” | ✓ |
| Salvar continua persistindo **keys individuais** (`togglePermissionSelected`) | ✓ |
| Sem permission key nova indevida | ✓ |
| Grupos são **somente visuais** | ✓ |
| Catálogo 100% mapeado (`auditPermissionAccessGroupCoverage`) | ✓ |

Fonte: `src/lib/permissionGroups.ts`

---

## 5. Auditorias executadas

| Comando | Resultado | Observação |
| --- | --- | --- |
| `npm run audit:navigation-grouping` | **OK** | 23 itens; paths, labels, permissões e menus alinhados |
| `npm run test:commissions` | **OK** | 69 testes passando |
| `audit-sales-margin-official-policy.ts` (2026-07) | **OK** (estático) | Runtime pulado — PostgreSQL indisponível em `localhost:5432` |
| `audit-executive-report-cash-radar.ts` (2026-07) | **Falha runtime** | Requer banco; fora do escopo sidebar |
| `audit-production-cost-versioning.ts` (619.24AA) | **Falha runtime** | Requer banco; fora do escopo sidebar |

---

## 6. Checks obrigatórios

| Check | Resultado |
| --- | --- |
| `npx prisma validate` | **OK** |
| `npm run build` | **OK** |
| `npm run check:frontend-server-imports` | **OK** (495 arquivos) |
| `npm run check:browser-bundle` | **OK** (dist/ livre de Prisma) |
| grep Prisma em `dist/` | **OK** (nenhuma ocorrência) |
| `NODE_ENV=production` server smoke (10s) | **OK** — `Server running on http://0.0.0.0:3000` (recovery Nomus falha sem DB — esperado) |

---

## 7. Riscos conhecidos

1. **Ordem flat vs. ordem agrupada:** no modo colapsado, ícones seguem `SIDEBAR_MODULE_ORDER` (ordem legada), não a ordem visual dos grupos — comportamento intencional.
2. **Relatórios / Guia via `dashboard.view`:** perfis com apenas `dashboard.view` (ex.: SELLER) ainda veem Relatórios e Guia do Sistema — regra legada em `canAccessModule`, não introduzida pelo agrupamento.
3. **Legado `costs.view`:** continua abrindo módulos de operação/custo — preservado de propósito.
4. **localStorage:** preferência de grupos expandidos (`induscost.sidebar.expandedGroups`) é por navegador.
5. **Baseline de auditoria:** novos módulos no menu exigem atualizar `navigation-grouping-baseline.json`.
6. **Auditorias com DB:** scripts de margem executivo/custo exigem PostgreSQL local ou `DATABASE_URL` válida.

---

## 8. Checklist de teste manual

### Sidebar expandida
- [ ] Dashboard aparece no topo, fora de accordion
- [ ] Cinco grupos na ordem: Engenharia → Administração
- [ ] Clicar grupo expande/recolhe; estado persiste após F5
- [ ] Rota ativa destaca item e contorno do grupo
- [ ] Scroll com muitos itens; rodapé (usuário + Sair) fixo

### Sidebar colapsada
- [ ] Ícones com tooltip nativo (`title`)
- [ ] Todos os módulos permitidos acessíveis
- [ ] Nenhum submenu quebrado

### Permissões
- [ ] Usuário só Engenharia → só grupo Engenharia visível
- [ ] Sem Dashboard → item Dashboard oculto
- [ ] SUPER_ADMIN → menu completo

### Gestão de acessos
- [ ] Permissões agrupadas por área
- [ ] Salvar perfil persiste e reflete na sidebar após relogin
- [ ] Bulk por grupo não cria keys novas

### Rotas
- [ ] Cada item abre a tela correta (smoke por módulo crítico)
- [ ] Links internos profundos (ex. `/products/indicators`) continuam funcionando

---

## 9. Arquivos de referência

| Arquivo | Função |
| --- | --- |
| `src/lib/navigationGroups.ts` | Definição de grupos e paths |
| `src/lib/sidebarNavigation.ts` | Filtro por permissão + expansão |
| `src/components/layout/Sidebar.tsx` | UI agrupada |
| `src/lib/permissionGroups.ts` | Agrupamento visual na gestão de acessos |
| `src/lib/navigationGroupingAudit.ts` | Motor de auditoria |
| `src/lib/sidebarGroupingFinalValidation.test.ts` | Validação integrada automatizada |
| `docs/navigation/navigation-grouping-baseline.json` | Baseline anti-regressão |
| `docs/navigation/sidebar-grouping-map.md` | Mapa e guia de uso |

---

## 10. Garantias

- **URLs:** inalteradas (`/{moduleId}`)
- **Rotas App.tsx:** não modificadas nesta validação
- **Permissões reais:** `canAccessModule` + catálogo intactos
- **Telas / módulos funcionais:** sem alteração
- **Banco / migrations:** sem alteração
