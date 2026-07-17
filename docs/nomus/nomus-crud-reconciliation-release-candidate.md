# SYNC-10 — Release candidate: reconciliação CRUD Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-10 |
| **Pré-requisitos** | SYNC-01…09 enviados |
| **Atualizado** | 2026-07-17 |
| **Escopo** | Validação RC · **sem** deploy servidor · **sem** acesso produção · **sem** apply real |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Todos os modos possuem preview? | **Sim** |
| 2 | Ausências exigem payload completo? | **Sim** |
| 3 | Três entidades independentes? | **Sim** |
| 4 | Kill switch por entidade? | **Sim** (fail-closed) |
| 5 | Rollback operacional? | **Sim** (runbook) |

---

## Matriz CRUD final

| | Pedidos | CR | CP |
|---|---------|----|----|
| **CREATE** | Novo → PRESENT completo | Novo título completo | Novo título completo |
| **UPDATE** | Hash/cabeçalho/itens | Saldo / pagamento | Vencimento / pagamento |
| **DELETE lógico** | Candidato → confirmado com prova | Idem; ≠ Pedido | Idem; dueDate preservada |
| **Ops** | Excluem só `MISSING_CONFIRMED` (flag ops) | Idem | Idem |
| **REACTIVATE** | → PRESENT; sem duplicidade | Idem | Idem |

---

## Provas de segurança (delete)

Arquivos SYNC auditados: sem `delete` / `deleteMany` / cascade destrutivo em Pedido/CR/CP.

Exceção documentada: FK `lastSyncRunId` **ON DELETE SET NULL** na migration (não limpa entidades de negócio).

---

## Performance

- Índices: `sourcePresenceStatus`, `lastSeenAt`, `lastSyncRunId`, runs.
- Paginação Nomus + `maxPages`.
- Apply em lotes + `--resume-cursor`.
- Locais: `findMany` único; updates em `$transaction` por batch (sem N+1 de relações).
- Filtros de presença usam coluna indexada.

---

## Flags

```
NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED
NOMUS_SOURCE_RECONCILE_AR_ENABLED
NOMUS_SOURCE_RECONCILE_AP_ENABLED
NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED
NOMUS_OPS_EXCLUDE_MISSING_AR_ENABLED
NOMUS_OPS_EXCLUDE_MISSING_AP_ENABLED
```

---

## Migration

`prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql`

---

## Preview (comandos)

```bash
npm run backfill:nomus:lifecycle:preview -- --entity=all
npm run reconcile:nomus:sales-orders -- preview
npm run reconcile:nomus:sales-orders -- preview --orderCode="PD 02739"
npm run reconcile:nomus:accounts-receivable -- preview
npm run reconcile:nomus:accounts-receivable -- preview --externalId=17748
npm run reconcile:nomus:accounts-payable -- preview
```

Runbook completo (21 passos + rollback): `docs/nomus/nomus-source-reconciliation-runbook.md`

---

## Testes RC

```bash
npm run test:nomus:source-rc
```

Consolida matriz Pedidos/CR/CP, falhas, auditoria de delete, performance e runbook.
