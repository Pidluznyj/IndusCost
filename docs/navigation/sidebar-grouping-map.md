# Mapa de agrupamento da sidebar (IndusCost / My Industry)

Documentação técnica da **camada de dados** `src/lib/navigationGroups.ts`.  
Esta etapa **não altera** rotas, URLs, componentes de tela, permissões nem a sidebar visual.

Fonte de verdade dos itens: `SIDEBAR_MODULE_ORDER` + `MODULE_LABELS` em `src/lib/modulePermissions.ts`.

## Grupos oficiais

| Grupo | Tipo | Ordem |
| --- | --- | --- |
| Dashboard | Item direto (sem accordion) | 1 |
| Engenharia | Accordion | 2 |
| Comercial | Accordion | 3 |
| Financeiro | Accordion | 4 |
| Operações | Accordion | 5 |
| Administração | Accordion | 6 |
| Outros | Fallback (somente se item não mapeado) | 99 |

## Mapeamento menu → grupo → path

| Menu atual (label) | `AppModuleId` | Grupo novo | Path atual | URL mudou? | Observação |
| --- | --- | --- | --- | --- | --- |
| Dashboard | `dashboard` | Dashboard (direto) | `/dashboard` | Não | Topo da sidebar; sem accordion |
| Produtos | `products` | Engenharia | `/products` | Não | — |
| Suprimentos | `materials` | Engenharia | `/materials` | Não | — |
| Simulações | `simulations` | Engenharia | `/simulations` | Não | — |
| Projetos | `projects` | Engenharia | `/projects` | Não | — |
| CRM Comercial | `crm-commercial` | Comercial | `/crm-commercial` | Não | — |
| Clientes | `customers` | Comercial | `/customers` | Não | — |
| Propostas | `proposals` | Comercial | `/proposals` | Não | — |
| Pedidos de venda | `sales-orders` | Comercial | `/sales-orders` | Não | — |
| Formação de Preço | `pricing` | Comercial | `/pricing` | Não | — |
| Comissões | `commissions` | Comercial | `/commissions` | Não | — |
| Financeiro | `finance` | Financeiro | `/finance` | Não | — |
| Custos Indiretos | `opex` | Financeiro | `/opex` | Não | — |
| Tributos | `taxes` | Financeiro | `/taxes` | Não | — |
| Relatórios | `reports` | Financeiro | `/reports` | Não | — |
| Estoque / Almoxarifado | `inventory` | Operações | `/inventory` | Não | — |
| Compras | `purchases` | Operações | `/purchases` | Não | — |
| Máquinas | `machines` | Operações | `/machines` | Não | — |
| Manutenção Predial | `maintenance` | Operações | `/maintenance` | Não | — |
| Gestão de Frota | `fleet` | Operações | `/fleet` | Não | — |
| Pessoas / RH | `employees` | Administração | `/employees` | Não | — |
| Configurações | `settings` | Administração | `/settings` | Não | — |
| Guia do Sistema | `guide` | Administração | `/guide` | Não | — |

## Confirmações

- **Rotas/URLs:** nenhuma alterada; paths continuam `/{AppModuleId}`.
- **Permissões:** `canAccessModule` e `permissionCatalog` inalterados; `MODULE_MENU_PERMISSION_KEYS` espelha as chaves usadas no gate de menu.
- **Sidebar visual:** `Sidebar.tsx` consome `buildAccessibleSidebarNavigation()` — Dashboard direto + grupos expansíveis; modo colapsado mantém ícones flat com `title`.
- **Itens não mapeados:** todos os 23 módulos atuais estão mapeados; grupo **Outros** vazio na auditoria (`unmappedItemIds: []`).

## Como usar a nova sidebar

### Navegação expandida (padrão)

1. **Dashboard** aparece no topo, fora dos accordions — um clique leva direto a `/dashboard`.
2. Os demais módulos ficam em **cinco grupos**: Engenharia, Comercial, Financeiro, Operações e Administração.
3. Clique no **nome do grupo** para expandir ou recolher; o estado fica salvo no navegador (`localStorage`).
4. Ao abrir uma tela, o **grupo correspondente abre automaticamente** (ex.: em Produtos, Engenharia fica expandida).
5. O item da rota atual fica **destacado em primary**; o grupo ativo recebe contorno discreto.

### Sidebar reduzida (colapsada)

- Clique na seta no rodapé para recolher.
- Cada módulo permitido aparece como **ícone** na ordem oficial do menu.
- Passe o mouse sobre o ícone para ver o **tooltip** com o nome do item (`title` nativo).
- Paths e permissões são os mesmos — apenas a apresentação muda.

### Scroll e rodapé

- A área central do menu rola quando há muitos itens; o **card do usuário** e **Sair** permanecem fixos no rodapé.
- Em telas baixas, o último grupo continua acessível via scroll vertical.

## Como os grupos ajudam na gestão de acesso

A sidebar agrupada espelha a mesma lógica visual usada em **Configurações → Usuários e Permissões** (`PermissionEditor`):

| Área da sidebar | O que facilita na gestão |
| --- | --- |
| Engenharia | Conceder produtos, suprimentos, simulações e projetos juntos |
| Comercial | CRM, clientes, propostas, pedidos, formação de preço e comissões |
| Financeiro | Financeiro, tributos, OPEX e relatórios |
| Operações | Estoque, compras, máquinas, manutenção e frota |
| Administração | RH, configurações, usuários e guia |

**Importante:** marcar permissões continua sendo **por key individual** — o grupo não substitui `canAccessModule` nem cria permissão única de “acesso ao grupo”.

## Garantias: URLs e permissões preservadas

- Todos os links usam `to={path}` → `/{AppModuleId}` (inalterado).
- Filtro de visibilidade: `buildAccessibleSidebarNavigation(auth)` + `canAccessModule`.
- Grupos **sem itens permitidos não aparecem**; Dashboard só aparece com permissão correspondente.
- Auditoria contínua: `npm run audit:navigation-grouping` (baseline em `navigation-grouping-baseline.json`).

## Arquivos relacionados

| Arquivo | Papel |
| --- | --- |
| `src/lib/navigationGroups.ts` | Tipos, grupos oficiais, builder |
| `src/lib/navigationGroups.test.ts` | Auditoria de cobertura e integridade |
| `src/lib/modulePermissions.ts` | Ordem, labels e permissões de menu |
| `src/lib/sidebarNavigation.ts` | Filtro por permissão, expansão de grupos, flat colapsado |
| `src/lib/sidebarNavigation.test.ts` | Testes da sidebar agrupada |
| `src/components/layout/Sidebar.tsx` | UI agrupada (Dashboard + accordions, acabamento visual) |
| `src/lib/navigationGroupingAudit.ts` | Auditoria automatizada anti-regressão |
| `docs/navigation/navigation-grouping-baseline.json` | Snapshot de paths/labels/grupos |
| `src/lib/mainNavigation.ts` | Segmentos de path (documentação/validação) |

## Auditoria

Execute periodicamente ou em CI:

```bash
npm run audit:navigation-grouping
```

Status **OK** confirma que paths, labels, permissões de menu e agrupamento permanecem alinhados ao baseline.
