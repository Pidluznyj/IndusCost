# IndusCost — Matriz de perfis e nomenclatura recomendada

> Fase: `INDUSCOST-ACCESS-PERMISSIONS-AUDIT-UX-A`.
>
> **Proposta**. Esta fase é diagnóstico. Os templates atuais
> (`PERMISSION_TEMPLATES`) cobrem a maioria dos casos; este documento
> recomenda evolução incremental.

## 1. Estado atual dos templates

Já existem 6 templates prontos em `src/lib/permissionCatalogUtils.ts`
(usados pelo botão **Modelos rápidos** do `PermissionEditor`):

| Template id           | Label                       | Role sugerida        |
| --------------------- | --------------------------- | -------------------- |
| `seller`              | Vendedor                    | `SELLER`             |
| `commercial_manager`  | Gestor Comercial            | `COMMERCIAL_MANAGER` |
| `purchases`           | Compras                     | —                    |
| `engineering`         | Engenharia / Custos         | —                    |
| `system_admin`        | Administração do Sistema    | `ADMIN`              |
| `read_only`           | Somente Leitura             | `VIEWER`             |

## 2. Perfis recomendados (proposta)

Mantemos os 6 atuais e propomos **4 perfis adicionais** para cobrir
gaps reais do uso operacional. Apenas Super Administrador continua
com bypass automático (`role === SUPER_ADMIN` → todas).

### 2.1 Super Administrador (`role = SUPER_ADMIN`)

- **Objetivo**: dono do sistema, integração Nomus, configurações
  críticas, mudança de regras.
- **Permissões**: implícitas (todas).
- **Não deve acessar**: nada está fora.
- **Observações**: deve ter sempre ≥ 2 ativos. Não pode se auto-bloquear.

### 2.2 Administrador Operacional (`role = ADMIN`)

- **Objetivo**: parâmetros operacionais, usuários, tabelas de preço,
  identidade visual; sem alterar BOM/custo.
- **Permissões sugeridas** (já cobertas pelo template `system_admin`):
  `dashboard.view`, `settings.view`, `users.manage`,
  `settings.branding.view`, `settings.branding.edit`,
  `settings.global_params.view`, `settings.global_params.edit`,
  `settings.nomus.view`, `settings.price_tables.view`,
  `settings.price_tables.manage`, `settings.operational.view`,
  `settings.operational.manage`.
- **Não deve acessar**: produtos/BOM, custo industrial, sincronização
  Nomus apply (essa continua bootstrap-only).
- **Observação**: `settings.global_params.edit` tem proteção extra
  (`requireBootstrapForGlobalParamMutation`) quando a categoria é
  `GLOBAL_PARAM` — confirmar via bootstrap.

### 2.3 Engenharia de Produto (`role = ADMIN` ou `VIEWER`)

- **Objetivo**: BOM, roteiro, custo industrial, manutenção Nomus,
  histórico.
- **Permissões sugeridas** (já cobertas por `engineering` +
  ajustes para Nomus):
  `dashboard.view`, `products.view`, `products.create`, `products.edit`,
  `products.export.engineering`,
  `products.tab.info`, `products.tab.bom`, `products.tab.routing`,
  `products.tab.tree`, `products.tab.cost`, `products.tab.composition`,
  `materials.view`, `materials.edit`,
  `machines.view`, `machines.edit`,
  `employees.view`,
  `opex.view`,
  `simulations.view`, `simulations.create`.
- **Não deve acessar**: propostas/pedidos/comercial; users.manage;
  publicação de tabelas (`pricing.publish_tables`).

### 2.4 Engenharia Consulta (NOVO — proposta)

- **Objetivo**: enxergar BOM, custo e histórico **sem aplicar mudanças**.
- **Permissões sugeridas**:
  `dashboard.view`, `products.view`,
  `products.tab.info`, `products.tab.bom`, `products.tab.routing`,
  `products.tab.tree`, `products.tab.cost`, `products.tab.composition`,
  `materials.view`, `machines.view`, `employees.view`, `opex.view`,
  `simulations.view`, `reports.view`, `guide.view`.
- **Não deve acessar**: `products.create/edit/delete`, `materials.edit`,
  `machines.edit`, `simulations.create`.
- **Implementação sugerida**: novo template `engineering_readonly`.

### 2.5 Comercial / Vendedor (`role = SELLER`)

- **Objetivo**: CRM do próprio vendedor + propostas + pedidos.
- **Permissões**: já cobertas pelo template `seller`.
- **Não deve acessar**: custo industrial (`products.tab.cost`,
  `products.tab.composition`), edição de produto, BOM, tabelas de preço.
- **Regra adicional**: `crm.seller.own` é INCOMPATÍVEL com
  `crm.seller.all` (pelo menos um deve existir se `crm.seller.view`
  estiver ativa). Hoje validado parcialmente; ver action plan.

### 2.6 Gestor Comercial (`role = COMMERCIAL_MANAGER`)

- **Objetivo**: ampla visão comercial — CRM geral, todos os vendedores,
  carteiras, indicadores.
- **Permissões**: já cobertas pelo template `commercial_manager`.
- **Não deve acessar**: custo industrial completo (`products.tab.composition`).

### 2.7 Compras / Suprimentos

- **Objetivo**: solicitações de compra, materiais, fornecedores.
- **Permissões**: já cobertas pelo template `purchases`.
- **Não deve acessar**: BOM (`products.edit`), preço (`pricing.*`),
  propostas/pedidos.

### 2.8 Financeiro / Controladoria (NOVO — proposta)

- **Objetivo**: tributos, custos indiretos, formação de preço,
  publicação de tabelas, relatórios.
- **Permissões sugeridas**:
  `dashboard.view`, `reports.view`,
  `pricing.view`, `pricing.simulate`, `pricing.generate_tables`,
  `pricing.publish_tables`,
  `taxes.view`, `taxes.edit`,
  `opex.view`, `opex.edit`,
  `settings.price_tables.view`,
  `products.view`, `products.tab.cost`.
- **Não deve acessar**: edição de produto/BOM, propostas/pedidos.
- **Implementação sugerida**: novo template `finance_controller`.

### 2.9 PCP / Produção (NOVO — proposta)

- **Objetivo**: máquinas, roteiros, consulta de estrutura, tempos.
- **Permissões sugeridas**:
  `dashboard.view`, `products.view`,
  `products.tab.info`, `products.tab.routing`, `products.tab.tree`,
  `machines.view`, `machines.edit`,
  `employees.view`, `maintenance.view`, `maintenance.manage`.
- **Não deve acessar**: preço, propostas, pedidos, `products.tab.cost`,
  `products.tab.composition`.
- **Implementação sugerida**: novo template `pcp_production`.

### 2.10 Consulta / Leitura (`role = VIEWER`)

- **Objetivo**: visualizar dados sem alterar.
- **Permissões**: cobertas pelo template `read_only`.

### 2.11 Integração Nomus (NOVO — proposta)

- **Objetivo**: técnico responsável por sincronizações Nomus
  (`settings.nomus.sync`, `settings.nomus.view`).
- **Permissões sugeridas**:
  `dashboard.view`, `settings.view`, `settings.nomus.view`,
  `settings.nomus.sync`, `products.view`,
  `products.tab.info`, `products.tab.bom`, `products.tab.tree`.
- **Não deve acessar**: nada comercial nem `users.manage`.
- **Implementação sugerida**: novo template `nomus_integration` e
  remover `settings.nomus.sync` da lista de ÓRFÃS.

## 3. Matriz consolidada

| Perfil                    | dashboard | products.* | products.tab.cost | products.tab.composition | materials.edit | pricing.simulate | pricing.publish | proposals.* | sales_orders.* | settings.view | users.manage | settings.nomus.sync | maintenance |
| ------------------------- | --------- | ---------- | ----------------- | ------------------------ | -------------- | ---------------- | --------------- | ----------- | -------------- | ------------- | ------------ | ------------------- | ----------- |
| Super Admin               | ✅        | ✅         | ✅                | ✅                       | ✅             | ✅               | ✅              | ✅          | ✅             | ✅            | ✅           | ✅                  | ✅          |
| Admin Operacional         | ✅        | —          | —                 | —                        | —              | —                | ✅              | —           | —              | ✅            | ✅           | —                   | —           |
| Engenharia                | ✅        | ✅         | ✅                | ✅                       | ✅             | —                | —               | —           | —              | —             | —            | —                   | —           |
| Engenharia Consulta (NOVO)| ✅        | view-only  | ✅                | ✅                       | —              | —                | —               | —           | —              | —             | —            | —                   | —           |
| Vendedor                  | ✅        | —          | —                 | —                        | —              | —                | —               | ✅          | ✅             | —             | —            | —                   | —           |
| Gestor Comercial          | ✅        | —          | —                 | —                        | —              | —                | —               | ✅          | ✅             | —             | —            | —                   | —           |
| Compras                   | ✅        | view-only  | —                 | —                        | —              | —                | —               | —           | —              | —             | —            | —                   | —           |
| Financeiro (NOVO)         | ✅        | view-only  | ✅                | —                        | —              | ✅               | ✅              | —           | —              | —             | —            | —                   | —           |
| PCP / Produção (NOVO)     | ✅        | view-only  | —                 | —                        | —              | —                | —               | —           | —              | —             | —            | —                   | ✅          |
| Consulta / Leitura        | ✅        | view-only  | —                 | —                        | —              | —                | —               | view-only   | view-only      | —             | —            | —                   | —           |
| Nomus Integração (NOVO)   | ✅        | view-only  | —                 | —                        | —              | —                | —               | —           | —              | ✅            | —            | ✅                  | —           |

## 4. Nomenclatura recomendada

O padrão atual já é coerente: **`modulo.acao`** (com sub-sub
opcional). Algumas exceções pontuais:

| Permissão atual                     | Comentário                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `sales_orders.view`                 | Usa `_` em vez de `.`. Coerente com `sales_orders.detail.view`, manter.                                  |
| `settings.global_params.view`       | OK.                                                                                                     |
| `settings.price_tables.manage`      | `manage` mistura criar/editar/excluir/publicar. Manter, mas considerar `.publish` separado no futuro.   |
| `crm.activities.create/edit`        | OK.                                                                                                     |
| `costs.view`                        | **Legado**. Não usar em novos templates. Marcado como ÓRFÃ.                                              |
| `products.tab.routing`              | **Órfão**: backend não checa; só UI poderia. Se mantido, ligar no `getVisibleProductTabs`.              |
| `sales_orders.invoice.view`         | **Órfão**: marcado no catálogo mas sem uso. Decidir se entra no template `sales_orders` ou remover.     |
| `settings.nomus.sync`               | **Órfão**: o sync hoje só pode ser disparado via CLI/bootstrap. Ligar na rota de sync futura.            |
| `purchases.indicators.view`         | **Órfão**: rota de indicadores de compras não usa hoje. Ligar quando o módulo expor o painel.            |

### Convenção sugerida

```
modulo.acao
modulo.sub_modulo.acao
modulo.sub_modulo.detalhe.acao
```

- `view`        — leitura genérica.
- `view.detail` ou `detail.view` — leitura detalhada (já usado em
  `sales_orders.detail.view`).
- `create` / `edit` / `delete` — escrita por verbo.
- `manage` — composto (criar + editar + excluir + alguma ação específica).
- `publish` / `apply` / `sync` — operações irreversíveis em massa
  (devem sempre vir com `risk: "critical"`).

## 5. Permissões críticas (devem sempre exigir confirmação)

Já marcadas como `risk: "critical"` no catálogo (`PERMISSION_CATALOG`):

| Permissão                             | Onde é usada                                            |
| ------------------------------------- | ------------------------------------------------------- |
| `users.manage`                        | Tela de Usuários e Permissões.                          |
| `proposals.delete`                    | Excluir proposta.                                       |
| `products.delete`                     | Excluir item de engenharia.                             |
| `purchases.delete`                    | Apenas remoção de linha local (sem endpoint DELETE no backend). |
| `pricing.publish_tables`              | Publicar tabela comercial.                              |
| `settings.global_params.edit`         | Editar parâmetros globais (proteção extra via bootstrap quando categoria=GLOBAL_PARAM). |
| `settings.nomus.sync`                 | Disparar sincronização Nomus.                           |
| `settings.price_tables.manage`        | Gerenciar tabelas de preço.                             |

`risk: "sensitive"`: `crm.seller.all`, `products.tab.cost`,
`products.tab.composition`, `employees.edit`, `opex.edit`,
`taxes.edit`, `pricing.generate_tables`, `costs.view`,
`settings.global_params.view`, `settings.nomus.view`,
`settings.operational.manage`.

## 6. Implementação recomendada (fase futura)

Não implementar nesta fase. Para uma fase
`INDUSCOST-ACCESS-PERMISSIONS-PROFILES-EXPANSION-B` futura:

1. Adicionar 4 templates novos ao `PERMISSION_TEMPLATES`:
   - `engineering_readonly`
   - `finance_controller`
   - `pcp_production`
   - `nomus_integration`
2. Reativar as 4 permissões órfãs ligando-as nas rotas/UIs reais.
3. Aposentar `costs.view` (mantendo compatibilidade): renomear label
   para "(legado — não usar)" e adicionar warning visual ao marcar.
4. Documentar matriz no Guia do Sistema (módulo `guide`).
