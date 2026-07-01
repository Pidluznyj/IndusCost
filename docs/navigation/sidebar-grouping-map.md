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
- **Sidebar visual:** `Sidebar.tsx` permanece com lista flat (`ALL_MENU_ITEMS`); agrupamento só disponível via helper.
- **Itens não mapeados:** todos os 23 módulos atuais estão mapeados; grupo **Outros** vazio na auditoria (`unmappedItemIds: []`).

## Arquivos relacionados

| Arquivo | Papel |
| --- | --- |
| `src/lib/navigationGroups.ts` | Tipos, grupos oficiais, builder |
| `src/lib/navigationGroups.test.ts` | Auditoria de cobertura e integridade |
| `src/lib/modulePermissions.ts` | Ordem, labels e permissões de menu |
| `src/components/layout/Sidebar.tsx` | UI atual (não alterada nesta etapa) |
| `src/lib/mainNavigation.ts` | Segmentos de path (documentação/validação) |

## Próxima etapa (fora do escopo atual)

Consumir `buildGroupedNavigationStructure()` na `Sidebar.tsx` para renderizar accordions, mantendo os mesmos `NavLink` e paths.
