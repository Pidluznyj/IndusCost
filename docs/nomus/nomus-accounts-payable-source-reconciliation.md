# SYNC-06 — Reconciliação de lifecycle nas Contas a Pagar

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-06 |
| **Pré-requisitos** | SYNC-01…05 |
| **Atualizado** | 2026-07-17 |
| **Eixo operacional** | **Data de Vencimento (`dueDate`)** — agrupamento, filtro e competência operacional |

---

## 0. Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Endpoint cobre abertos, pagos e cancelados? | Com `apenasPendentes=false` (default): **sim** (janela de vencimento). Cancelados via `status`. |
| 2 | Escopo real do full_refresh? | Query: `dataInicio`–`dataFim` + `apenasPendentes` + páginas. Label **não** prova completude. |
| 3 | Consulta individual? | **Não** há GET `{id}`. Confirmação: scan de lista ou 2ª run completa. |
| 4 | Sync atualiza campos oficiais? | **Sim** (upsert por hash) + lifecycle PRESENT. |
| 5 | Histórico após ausência? | Pagamentos, documentos, apropriações/CC gerencial, auditoria — **não apagados**. |

---

## 1. Escopo

| Modo | Declaração |
|------|-----------|
| `apenasPendentes=false` | `DUE_DATE_WINDOW_ALL_TITLES` |
| `apenasPendentes=true` | `OPEN_PAYABLES_SCOPE` (pagos históricos fora da ausência) |

Ausência só com COMPLETE (`startPage=1` + drain + sem maxPages/erro) + `NOMUS_SOURCE_RECONCILE_AP_ENABLED`.

Independência: não inferir ausência de CP por Pedido/CR.

---

## 2. Regra de vencimento protegida

- Escopo canônico: `accounts_payable_due_date_window`
- `getAccountsPayableOperationalDueDate` usa **dueDate** (não competência/pagamento)
- Patches de ausência **não** alteram `dueDate`

---

## 3. Preview / apply

`sourceLifecycle`: creates/updates/unchanged/missing*/reactivated, `totalOpenAffected`, `totalPaidHistoricalProtected`, escopo, completude, `operationalAxis: dueDate`.

Lock: `NOMUS_ACCOUNTS_PAYABLE_RECONCILE_LOCK_FILE`.

---

## 4. Código

| Peça | Path |
|------|------|
| Adapter | `src/lib/nomus/nomusAccountsPayableSourceReconciliation.ts` |
| Server | `src/lib/nomus/nomusAccountsPayableSourceReconciliation.server.ts` |
| Syncer | `scripts/nomusAccountsPayableSync.ts` |
