# Vendedor do Pedido — agrupamento canônico

| Campo | Valor |
|-------|--------|
| **Projeto** | IndusCost / My Industry |
| **Resolver** | `src/lib/commercial/orderSellerIdentityResolver.ts` |
| **Comissões** | `commissionNomusOrderSellerResolver` / `CommissionPerson` + Alias |

## Conceitos

1. **Raw Nomus** — `externalSellerId` / `nomusSellerName` (rastreabilidade).
2. **Canônico** — pessoa comissionada após alias/ID (`CommissionPerson`).
3. **Responsável Comercial CRM** — carteira do cliente (eixo separado).

## Exibição

| Situação | Label |
|----------|--------|
| Alias/person resolve | Nome canônico (ex.: Rodrigo Da Silva Ramos) |
| Há raw, sem alias | `Vendedor não mapeado` |
| Sem raw em SalesOrder nem snapshot | `Sem vendedor informado` |

Nunca usar `Vendedor ID 1399` como nome principal.

## Exibição de nomes comerciais no CRM

Aplicável a **Vendedor do Pedido** e **Responsável da Carteira**:

1. CRM nunca exibe ID Nomus como label principal.
2. Ambos os filtros usam `enrichOrderSellerOptionRowsWithNames` +
   `consolidateSellerRowFragments` (e `commercialPersonIdentityResolver` para
   DTOs/listas).
3. Labels legados `Vendedor ID N` são tratados como nome vazio e resolvidos
   pelo mesmo caminho (SalesOrder → CommissionPerson/Alias).
4. IDs agrupados no mesmo canônico viram **uma** opção de filtro.
5. Responsável da Carteira e Vendedor do Pedido permanecem eixos separados.

## CRM Gestão por Responsável

Filtro **Vendedor do pedido** e filtro **Responsável da carteira** consolidam
IDs com o mesmo nome normalizado e enriquecem ID-only via Comissionamento
(`mergeCommissionSellerNamesIntoMap`).

## Auditoria 360º

Mesmo DTO `orderSeller` em Pedido de Venda, Resumo e Comissões.
Se o snapshot ACTIVE tem `rawSellerId` e o SalesOrder está incompleto, resolve
pelo snapshot e emite alerta técnico (não `SELLER_NOT_INFORMED`).
