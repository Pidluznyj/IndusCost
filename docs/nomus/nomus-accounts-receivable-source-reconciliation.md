# SYNC-05 — Reconciliação de lifecycle nas Contas a Receber

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-05 |
| **Pré-requisitos** | SYNC-01…04 |
| **Atualizado** | 2026-07-17 |
| **Piloto** | CR `externalId` **17748** (ligado ao PD 02739) — **entidade independente** |

---

## 0. Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Endpoint retorna todos os CRs? | Só o **universo da query**: janela `dataInicio`–`dataFim` + `apenasPendentes` + páginas. |
| 2 | Títulos pagos no payload? | Com default `apenasPendentes=false`, **sim**. |
| 3 | Cancelados aparecem? | `status` boolean mapeado; não são delete. |
| 4 | Consulta individual por externalId? | **Não há GET `{id}`**. Confirmação: scan de lista (`lookupNomusAccountsReceivableByExternalId`) ou 2ª run completa. |
| 5 | `full_refresh` é completo? | **Não por label.** COMPLETE só com `startPage=1` + drain + sem `maxPages` + sem erro/429. |

---

## 1. Escopo autoritativo

| Modo | Declaração | Ausência |
|------|------------|----------|
| `apenasPendentes=false` | `DUE_DATE_WINDOW_ALL_TITLES` | Locais na janela de vencimento |
| `apenasPendentes=true` | `OPEN_RECEIVABLES_SCOPE` | Só títulos **abertos**; pagos históricos **preservados** (`ignoredOutsideScope`) |

Sem prova de completude → CREATE/UPDATE + execução **INCONCLUSIVE** para ausência.

**Independência:** ausência de Pedido **não** implica ausência de CR.

---

## 2. Campos atualizados (CREATE/UPDATE)

Status, vencimento, agendamento, competência, valores (receber/saldo/recebido), liquidação, pessoa/CNPJ, empresa, forma de pagamento, conta, suspensão, juros/multa, descrição, NF origem, `rawPayload`, `payloadHash`, datas Nomus + lifecycle PRESENT.

Não sobrescreve campos internos alheios ao Nomus. Ausência **não** zera histórico financeiro.

---

## 3. Preview / apply

`sourceLifecycle` no JSON: creates, updates, unchanged, missing*, reactivated, `totalOpenAffected`, `totalReceivedHistoricalProtected`, escopo, completude.

- Lock: `NOMUS_ACCOUNTS_RECEIVABLE_RECONCILE_LOCK_FILE`
- Flag: `NOMUS_SOURCE_RECONCILE_AR_ENABLED` (fail-closed)
- Apply por lotes transacionais; sem delete

---

## 4. Código

| Peça | Path |
|------|------|
| Adapter | `src/lib/nomus/nomusAccountsReceivableSourceReconciliation.ts` |
| Server | `src/lib/nomus/nomusAccountsReceivableSourceReconciliation.server.ts` |
| Syncer | `scripts/nomusAccountsReceivableSync.ts` |
