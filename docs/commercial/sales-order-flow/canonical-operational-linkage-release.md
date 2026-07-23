# Release Candidate — Vínculos canônicos do Kanban (KAN-LINK-01…10)

| | |
|---|---|
| **Ticket** | KAN-LINK-10 |
| **Branch** | `feat/kanban-canonical-operational-links` |
| **Atualizado** | 2026-07-22 |
| **Computation** | `sales-order-flow/v2` |
| **Migrations** | Nenhuma nesta feature |
| **Deploy** | Não executado por este RC (código + docs apenas) |

## Arquitetura

```text
SalesOrder / Item (oficial, read-only)
        │
        ▼
Evidence pack (OP-49 + refs DS/OP oficiais)
        │
        ▼
Canonical graph (KAN-LINK-02…06)
  resolvers DS/OP → reconcile → FromPack
        │
        ▼
Item engine (OP-50) ← única fonte de alocações canônicas
        │
        ▼
Order engine (OP-51) → fingerprint v2 → snapshots/eventos
        │
        ├── API list/summary/detail (+ operationalDiagnostics)
        └── UI Kanban/card/drawer (sem recalcular estágio)
```

Runbook operacional: `canonical-operational-linkage-runbook.md`.

## Campos de vínculo

### DS → Pedido / item

- `externalSalesOrderId` / `idPedido`
- `orderCodeNormalized` (PD*)
- `externalSalesOrderItemId` / `idItemPedido`
- `salesOrderItemSequence`
- `externalProductId` (desempate único; nunca sozinho se ambíguo)
- Validade: cancelado / devolução / transferência não avançam

### OP → Pedido / item

- `NomusProductionOrderSalesLink`: `externalSalesOrderId`, `externalSalesOrderItemId`, `salesOrderItemId`, `linkedQuantity`, `isCurrent`
- Etiqueta inequívoca da OP (só se não ambígua)
- OP cancelada não cobre

### Item → item

- UUID interno `salesOrderItemId`
- `nomusItemExternalId` + sequência `00010`…
- Cobertura e gargalo **por item**; sem vazamento entre itens

### NF → Pedido

1. `SalesOrderNfeLink`
2. Cadeia DS.`idNfe` → NF
3. Alocações O2C (quando presentes)
4. Somente NF **autorizada** avança faturamento/envio proxy

## Precedência

`DIRECT_EXTERNAL_ID` → refs diretas de pedido/item → `SALES_ORDER_NFE_LINK` → cadeia DS/NF → refs de OP/etiqueta → hint → `UNRESOLVED` / `AMBIGUOUS`.

Cliente + valor + data **não** criam vínculo.

## Cobertura / parcial / corte / sem OP / cancelamentos

| Tema | Comportamento |
|------|----------------|
| Quantidade | Soma por item; progresso capped 100%; excesso → inconsistência |
| Parcial | Mantém residual ativo e coluna da primeira pendência |
| Corte | Encerra saldo operacional (`FULFILLED_WITH_CUT`) |
| Sem OP | DS/NF posteriores prevalecem; não exige OP indevida |
| DS/NF cancelados/rejeitados | Histórico; não avançam |
| Devolução | Histórico não operacional |
| Dupla contagem DS+NF | `max` pareado por `idNfe` |
| Terminal | `SHIPPED_COMPLETED` não regride por ausência de OP |

## Gate de segurança (RC)

| Check | Status |
|-------|--------|
| Sem exceção por pedido/cliente em produção | OK (scanner KAN-LINK-09 + KAN-VAL-01) |
| Sem fuzzy cliente/valor/data | OK (resolvedores) |
| Sem write em entidades oficiais | OK (recompute/rebuild) |
| Sem N+1 por card | OK (budgets OP-75 + batch evidence) |
| Sem alteração financeira | OK (escopo só fluxo/snapshots) |
| Sem migration | OK |
| Auditoria não suja git sem `--output` | OK (`tmp-audits/` ignorado) |
| Scripts não miram produção automaticamente | OK (exige `DATABASE_URL` + `--apply`) |

## Falhas preexistentes (fora do escopo)

- `tsc --noEmit` no workspace reporta erros em `tmp-audits/inspect-*.ts` (scripts locais não rastreados/fora da feature). Evidência: paths sob `tmp-audits/`.
- Warnings Vite de chunk size / dynamic import de `SalesOrderDetailDialog` (pré-existentes).
