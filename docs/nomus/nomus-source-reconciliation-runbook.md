# SYNC-08 — Runbook: backfill e reconciliação histórica Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-08 |
| **Pré-requisitos** | SYNC-01…07 |
| **Atualizado** | 2026-07-17 |
| **Produção** | Cursor **não** tem acesso ao banco de produção — executar no host autorizado |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Campos oficiais? | Negócio: códigos, status, valores, datas operacionais, `rawPayload`/`payloadHash` comercial |
| 2 | Campos só lifecycle? | `sourcePresenceStatus`, `presentInLastPayload`, `firstSeenAt`, `lastSeenAt`, `missingSince`, `missingConsecutiveRuns`, `sourceRemovedAt`, `lastSyncRunId` |
| 3 | Preview sem escrita? | **Sim** |
| 4 | Lock reutilizável? | Backfill: `NOMUS_LIFECYCLE_BACKFILL_LOCK_FILE`. Reconcile: locks SYNC-04/05/06 por entidade |
| 5 | Retomável / idempotente? | **Sim** — `--resume-cursor`, lotes, reexecução sem delete físico |

---

## 1. Backfill inicial

```bash
npm run backfill:nomus:lifecycle:preview -- --entity=all
npm run backfill:nomus:lifecycle:apply -- --entity=all --batch-size=200
```

Inicializa:

- `PRESENT`
- `presentInLastPayload = true`
- `firstSeenAt` / `lastSeenAt` (evidência segura: createdAt / syncedAt / updatedAt)
- `missingConsecutiveRuns = 0`

**Não declara ausência.** Linhas já `MISSING_*` são preservadas (exceto `--force-present`).

---

## 2. Reconciliação histórica

| Comando | Entidade |
|---------|----------|
| `npm run reconcile:nomus:sales-orders -- preview\|apply` | Pedidos |
| `npm run reconcile:nomus:accounts-receivable -- preview\|apply` | CR |
| `npm run reconcile:nomus:accounts-payable -- preview\|apply` | CP |

Flags comuns:

- `--externalId`
- `--orderCode` (só Pedidos)
- `--from` / `--to`
- `--batch-size`
- `--confirm-candidates`
- `--explain`
- `--json` / `--csv`
- `--resume-cursor`

### Preview

Não escreve. Mostra universos local/Nomus, escopo, completude, creates/updates, candidatos/confirmados/reativados, fora do escopo, impacto operacional e valores.

### Apply

- só lifecycle (+ hash de presença quando aplicável)
- lock + lotes + `NomusSourceSyncRun`
- idempotente; sem delete físico
- **para** se coleta inconclusiva ou flag desligada

Flags de ausência (fail-closed):

- `NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED`
- `NOMUS_SOURCE_RECONCILE_AR_ENABLED`
- `NOMUS_SOURCE_RECONCILE_AP_ENABLED`

---

## 3. Pilotos

| Entidade | Piloto | Nota |
|----------|--------|------|
| Pedidos | **PD 02739** (`externalSalesOrderId` 2737) | Caso documentado OP-81 / SYNC-04 |
| CR | **externalId 17748** | Somente após consulta **independente** — não usar estado do Pedido |
| CP | Título `PRESENT` aberto escolhido no **preview** | Sem presumir ausência |

---

## 4. Ordem sugerida em produção

1. `backfill:nomus:lifecycle:preview` → `apply`
2. `reconcile:nomus:sales-orders -- preview` (janela do piloto) → revisar → `apply` com flag on
3. `reconcile:nomus:accounts-receivable -- preview --externalId=17748` → apply se COMPLETE
4. `reconcile:nomus:accounts-payable -- preview` → escolher piloto seguro → apply
5. Ligar flags SYNC-07 (`NOMUS_OPS_EXCLUDE_MISSING_*`) só após validar consumidores

---

## 5. Código

| Peça | Path |
|------|------|
| Backfill puro | `src/lib/nomus/nomusLifecycleBackfill.ts` |
| Backfill server | `src/lib/nomus/nomusLifecycleBackfill.server.ts` |
| CLI reconcile | `src/lib/nomus/nomusSourceReconcileCli.ts` |
| Runners | `src/lib/nomus/nomusSourceReconcile.server.ts` |
| Scripts | `scripts/nomusLifecycleBackfill.ts`, `scripts/nomus*SourceReconcile.ts` |
