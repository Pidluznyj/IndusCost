# Status Nomus do item do Pedido de Venda (SalesOrderItem)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Atualizado** | 2026-07-13 |
| **Sync** | `scripts/nomusSalesOrdersSyncV1.ts` |
| **Normalizador** | `src/lib/sales/nomusSalesOrderItemStatus.ts` |

## Problema

A tabela `SalesOrderItem` não tinha status do item. O Nomus envia o status em `SalesOrder.nomusRawResponse.itensPedido[].status`. Sem persistir, a aba **Status Pedidos** tratava item cancelado como pendente (ex.: PD 02207).

## Campos em SalesOrderItem

| Campo | Uso |
|-------|-----|
| `nomusItemExternalId` | id do item no payload Nomus, quando existir |
| `nomusItemSequence` | sequência/`item`/índice no payload |
| `nomusItemStatusRaw` | status bruto (`"4"`, `"6"`, texto) |
| `nomusItemStatusNormalized` | `FULFILLED` \| `CANCELED` \| `PARTIAL` \| `PENDING` \| `UNKNOWN` |
| `nomusQuantityFulfilled` | qtde atendida no Nomus |
| `nomusQuantityPending` | qtde pendente ativa (0 se cancelado/atendido) |
| `nomusIsCanceled` | `true` quando status cancelado |
| `nomusIsStale` | item local que sumiu do payload atual |
| `nomusLastSeenAt` | última vez visto no sync |
| `nomusRawItem` | cópia do objeto `itensPedido[]` |

## Mapa inicial de códigos

Evidência PD 02207:

| Código Nomus | Significado | Normalizado |
|--------------|-------------|-------------|
| 4 | Atendido totalmente | `FULFILLED` |
| 6 | Cancelado | `CANCELED` |

Códigos 1–3 e 5 também têm mapeamento inicial (`PENDING` / `PARTIAL`). Desconhecido → `UNKNOWN` (status bruto preservado).

## Sync

Ao importar `itensPedido`:

1. Casa por `nomusItemExternalId` / `[nomus-line:N]` nas notes.
2. Senão por `idProduto` + proposta/produto.
3. Grava status bruto/normalizado, flags, raw e `nomusLastSeenAt`.
4. Itens que sumiram do payload: `nomusIsStale = true` (sem delete físico); não entram como item ativo.

## Impacto — Status Pedidos

- Cancelado/stale **não** contam como pendente ativo.
- Compõem valor cancelado / chip “Itens cancelados”.
- `% atendido` usa só itens ativos.
- Pedido só é parcial com saldo ativo real.
- PD 02207 → completo/recebido com cancelamento (não Parciais).

Fonte no load: colunas persistidas + fallback `nomusRawResponse` (`enrichFactsWithOrderItemStatus`).

## Impacto — margem / comissão

- Item cancelado/stale → margem `ITEM_CANCELADO` (ignorado na consolidação).
- Comissão: itens cancelados/stale **não entram** no bundle ativo (não geram `NO_MARGIN` indevido).
- Aparecem como ignorados/cancelados na auditoria de margem.

Não altera Contas a Receber, Fluxo, Presidencial, regra de vendedor comissionável nem comissões pagas.

## Diagnóstico

```bash
npx tsx tmp-audits/inspect-order-status-pd02207.ts
```
