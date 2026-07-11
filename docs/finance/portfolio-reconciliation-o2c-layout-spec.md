# Spec — Layout O2C da Conciliação de Carteira

| | |
|---|---|
| **Escopo** | Somente Financeiro → Conciliação de Carteira / aba Inteligência |
| **Data** | 2026-07-11 |
| **Não alterar** | Funil Pedido→Caixa, comissões, Fluxo/CR/AP, sync, migration, allocation engine |

## Objetivo

Reorganizar a leitura para: **quanto em pedido → entrega futura/passada → evidência (doc/NF/CR) → só pedido com condição → detalhe item↔NF/doc**.

Manter visual de cards/cores; mudar disposição e narrativa.

## KPIs de negócio (bloco principal)

| Key | Significado | Regra (sobre `PortfolioMaturityOrderRow`) |
|-----|-------------|------------------------------------------|
| `VALOR_EM_PEDIDOS` | Valor oficial em pedidos | Σ `orderValue` |
| `ENTREGA_FUTURA` | Entrega prevista no futuro | `expectedDeliveryDate` > asOf (fallback `forecastDate`) |
| `ENTREGA_VENCIDA` | Entrega no passado, ainda na carteira | data < asOf e não `RECEBIDO` |
| `VIROU_CR` | Já é Contas a Receber | `hasReceivable` ou status CR/RECEBIDO |
| `COM_DOC_OU_NF` | Tem documento de saída e/ou NF | `hasStockDocument \|\| hasNfe` |
| `SO_PEDIDO` | Sem NF, sem doc, sem CR | `!hasNfe && !hasStockDocument && !hasReceivable` |
| `SO_PEDIDO_COM_CONDICAO` | Só pedido **com** condição | `SO_PEDIDO` e **sem** tag `SEM_CONDICAO_PAGAMENTO` |
| `SO_PEDIDO_SEM_CONDICAO` | Só pedido **sem** condição | `SO_PEDIDO` e tag `SEM_CONDICAO_PAGAMENTO` |

Alertas técnicos **não** somam carteira extra.

## Funil de evidência

`SO_PEDIDO` → `DOC_OU_NF` → `CR_ABERTO` → `RECEBIDO` | raia `BLOQUEADO`

## Buckets de tempo

Data efetiva: `receivableDueDate` ?? `forecastDate` ?? `expectedDeliveryDate`.  
Buckets: vencidos · 0–30 · 31–60 · 61–90+.

## Layout

1. Filtros compactos  
2. 6 cards de negócio (+ “?”) — clique filtra  
3. Funil + buckets  
4. Grade / sanfonas  
5. Drawer (Mapa default — itens↔NF/doc)  
6. KPIs vendedor/cliente abaixo da dobra  

## API

Campo adicional no payload de intelligence: `o2cBusinessKpis` (puro, read-only).
