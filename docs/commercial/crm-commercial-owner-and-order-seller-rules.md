# Responsável da carteira × Vendedor do pedido

## Conceitos

| Conceito | Fonte | Uso |
|----------|--------|-----|
| **Responsável da carteira** (`CrmCustomerCommercialOwner`) | CRM / cadastro do cliente | Carteira, relacionamento, follow-up, filtro de clientes |
| **Vendedor do pedido** | Raw Nomus → **canônico** via `orderSellerIdentityResolver` / CommissionPerson | Análise de vendas, filtro de pedidos, comissão, Auditoria 360º |

Ver também: [crm-order-seller-canonical-grouping.md](./crm-order-seller-canonical-grouping.md).

Autoatribuição de carteira **não** persiste label `Vendedor ID N` — exige nome real.

## Exibição de nomes comerciais no CRM

O CRM Comercial fala a mesma língua em todas as abas (Gestão Geral, Gestão por
Responsável, Carteira de Clientes):

| Regra | Detalhe |
|-------|---------|
| Label executivo | Sempre nome canônico/resolvido (`displayName`) |
| Nunca como label principal | `Vendedor ID 464`, `rawSellerId`, ID puro Nomus |
| ID Nomus | Somente tooltip técnico, auditoria, campo “ID externo”, logs |
| Resolver compartilhado | `commercialPersonIdentityResolver` + `enrichOrderSellerOptionRowsWithNames` |
| Aliases | `CommissionPerson` / `CommissionPersonAlias` (mesma fonte das Comissões) |

- **Responsável da Carteira** e **Vendedor do Pedido** continuam conceitos
  separados (carteira vs pedido), mas ambos usam a mesma resolução de nome.
- Owners legados salvos como `Vendedor ID N` são resolvidos em leitura
  (SalesOrder + catálogo de comissionamento); se não houver alias →
  `Vendedor não mapeado` (ID só em auditoria).

## Autoatribuição

Quando sincronizar/importar Pedido de Venda:

1. Se o pedido tem vendedor informado **e** o cliente **não** tem Responsável Comercial ativo → criar owner com `assignmentSource = AUTO_FROM_SALES_ORDER_SELLER`.
2. Se o cliente **já** tem responsável ativo → **não substituir**.
3. Se o nome for operacional (FINANCEIRO/FATURAMENTO) ou sem vendedor → não atribuir; alerta `CUSTOMER_OWNER_AUTO_ASSIGN_SELLER_NOT_MAPPED`.
4. Múltiplos vendedores no histórico: usa o pedido **mais recente**; alerta `MULTIPLE_ORDER_SELLERS_FOR_CUSTOMER`.

Hook: `autoAssignCommercialOwnersAfterNomusSync` após apply do sync Nomus.  
Backfill: `scripts/backfillCrmCommercialOwnerFromSalesOrderSeller.ts` (`preview` \| `apply`).

## Filtros no CRM

- **Responsável da carteira** — filtra clientes via `CrmCustomerCommercialOwner`.
- **Vendedor do pedido** — filtra pedidos via vendedor Nomus/`SalesOrder` (inclui Gislene se houver pedidos dela).

Permissões: SELLER só vê própria carteira; filtro de vendedor do pedido aplica-se **dentro** desse escopo. ADMIN/gestor veem todos.

## Comissão

Continua usando **somente** vendedor do pedido. Responsável comercial **não** vira comissionável.

## Propostas

Não são fonte oficial de vendedor do pedido nem de comissão.
