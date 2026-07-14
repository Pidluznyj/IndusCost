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

## CRM Gestão por Responsável

Filtro **Vendedor do pedido** consolida IDs com o mesmo nome normalizado e
enriquece ID-only via Comissionamento (`mergeCommissionSellerNamesIntoMap`).

## Auditoria 360º

Mesmo DTO `orderSeller` em Pedido de Venda, Resumo e Comissões.
Se o snapshot ACTIVE tem `rawSellerId` e o SalesOrder está incompleto, resolve
pelo snapshot e emite alerta técnico (não `SELLER_NOT_INFORMED`).
