# Regras oficiais de status de NF-e

## Fonte

- Tabela/modelo: `NomusNfe`
- Campo estrutural: `NomusNfe.status` (Int)
- Constantes: `NOMUS_NFE_STATUS_AUTHORIZED = 4`, `NOMUS_NFE_STATUS_CANCELLED = 7` em `src/lib/nomusNfeClassification.ts`
- Evidências auxiliares: `xmlCancelamento`, `justificativaCancelamento`, `rawPayload`

## Helper canônico

`src/lib/finance/nfeStatus.ts`

- `normalizeNfeStatus(rawNfe)` → `{ statusRaw, statusNormalized, isCanceled, isValidForBilling, label }`
- `isNomusNfeCancelled(status)` — status `7` ou texto de cancelamento
- `isNomusNfeValidForBilling(status)` — `false` se cancelada / denegada / inutilizada

A Auditoria 360º e o Status Pedidos **consomem** esse helper. Não inventam regra paralela.

## Status normalizados

| Normalizado | Significado | Faturamento válido |
|---|---|---|
| `AUTHORIZED` | Autorizada (4) | Sim |
| `CANCELED` | Cancelada (7) | Não |
| `DENIED` | Denegada | Não |
| `VOIDED` | Inutilizada | Não |
| `UNKNOWN` | Não mapeado / ausente | Sim se sem evidência de cancelamento (alerta) |

## Regras de negócio

1. NF cancelada **aparece** na auditoria (abas NF-e, Divergências, Auditoria Técnica).
2. NF cancelada **não** compõe `nfeValidValue` / `nfeAllocatedValue`.
3. NF cancelada **não** transforma pedido em Faturado se for a única NF.
4. Pedido com NF válida + cancelada usa a válida para status/faturamento e alerta a cancelada.
5. CR real vinculado à NF cancelada **não é apagado**; gera `CANCELED_NFE_WITH_RECEIVABLE`.
6. Documento de saída vinculado à NF cancelada gera `DOCUMENT_LINKED_TO_CANCELED_NFE`.

## Alertas

- `NFE_CANCELED_LINKED_TO_ORDER`
- `CANCELED_NFE_INCLUDED_IN_BILLING_VALUE` (catálogo / regressão)
- `CANCELED_NFE_WITH_RECEIVABLE`
- `DOCUMENT_LINKED_TO_CANCELED_NFE`
- `NFE_STATUS_UNKNOWN`
