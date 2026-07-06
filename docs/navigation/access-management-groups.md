# Agrupamento visual da gestão de acesso (IndusCost / My Industry)

Documentação da camada **visual** que organiza permissões existentes pelas mesmas áreas da sidebar agrupada.

**Importante:** grupos de acesso são apenas organização de UI. Não existem permissões de “grupo”, não há novas permission keys e a autorização real continua checando cada key individualmente (`hasPermission`, `canAccessModule`, etc.).

## Grupos de acesso

| Grupo visual | Área da sidebar | Menus relacionados (visibilidade depende das keys) |
| --- | --- | --- |
| **Dashboard / Sistema** | Dashboard (direto) | Dashboard |
| **Engenharia** | Engenharia | Produtos, Suprimentos, Simulações, Projetos |
| **Comercial** | Comercial | CRM Comercial, Clientes, Propostas, Pedidos de venda, Formação de Preço, Comissões |
| **Financeiro** | Financeiro | Financeiro, Custos Indiretos, Tributos, Relatórios |
| **Operações** | Operações | Estoque/Almoxarifado, Compras, Máquinas, Manutenção Predial, Gestão de Frota |
| **Administração** | Administração | Pessoas/RH, Configurações, Guia do Sistema |
| **Sistema / Outros** | Fallback | Permissões legadas ou sem mapeamento explícito (ex.: `costs.view`) |

Dentro de cada grupo visual, as permissões continuam subdivididas pelos **grupos originais do catálogo** (CRM, Clientes, Financeiro, etc.) com a mesma árvore pai/filho (`parentKey`, `requires`).

## Mapeamento técnico

Fonte: `src/lib/permissionGroups.ts`

- Cada entrada de `PERMISSION_CATALOG` é atribuída a um grupo visual via campo `module` (prioritário) ou `group` (fallback).
- Exemplos:
  - `crm.*`, `customers.*`, `proposals.*`, `sales_orders.*`, `pricing.*`, `commissions.*` → **Comercial**
  - `finance.*`, `taxes.*`, `opex.*`, `reports.*` → **Financeiro**
  - `products.*`, `materials.*`, `simulations.*`, `projects.*` → **Engenharia**
  - `inventory.*`, `purchases.*`, `machines.*`, `maintenance.*`, `fleet.*` → **Operações**
  - `employees.*`, `settings.*`, `users.manage`, `accessProfiles.*`, `guide.view` → **Administração**
  - `costs.view` (legado) → **Sistema / Outros**

## UI afetada

| Arquivo | Papel |
| --- | --- |
| `src/lib/permissionGroups.ts` | Helper de agrupamento visual |
| `src/lib/permissionGroups.test.ts` | Auditoria de cobertura e integridade |
| `src/components/admin/PermissionEditor.tsx` | Editor compartilhado (usuários + perfis de acesso) |

Funcionalidades na tela:

- Accordion por área (Engenharia, Comercial, …)
- Contador **X de Y** permissões habilitadas por área
- Texto **Menus relacionados** (informativo — não substitui checks individuais)
- Ações por área: **Selecionar grupo**, **Limpar grupo**, **Só visualização** (reutiliza `enablePermission` / `clearGroup` do catálogo)
- Marcar/desmarcar checkboxes individuais inalterado

## Confirmações

| Item | Status |
| --- | --- |
| Permission keys | **Inalteradas** — `ALL_PERMISSION_KEYS` intacto |
| Grants / roles / endpoints | **Inalterados** |
| Paths / rotas / telas | **Inalterados** |
| Banco / migrations | **Nenhuma alteração** |
| Autorização real | Continua por key individual; grupo é só visual |

## Arquivos relacionados (fonte de verdade)

- `src/lib/permissionCatalog.ts` — catálogo central de keys
- `src/lib/permissionCatalogUtils.ts` — toggle, templates, árvore por grupo do catálogo
- `src/lib/navigationGroups.ts` — agrupamento da sidebar (referência de menus)
- `src/lib/modulePermissions.ts` — `canAccessModule` (gate real do menu)

## Correção colateral

Permissões dos catálogos **Financeiro** e **Projetos** passam a aparecer no editor: antes, grupos fora de `PERMISSION_GROUP_ORDER` não eram renderizados na UI antiga.
