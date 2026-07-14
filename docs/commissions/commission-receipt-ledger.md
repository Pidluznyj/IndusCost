# Ledger de comissão por recebimento

Tabelas:

- `CommissionMonthlyClosing` — cabeçalho do fechamento (totais, hash, notes, closedBy/At).
- `CommissionReceiptLedgerLine` — linhas auditáveis por título/baixa.

## Campos de regra

| Campo | Uso |
|-------|-----|
| `ruleId` | `CommissionRule.id` válido ou `null` |
| `ruleNameSnapshot` | Nome textual no fechamento |
| `ruleSnapshotJson` | Snapshot (rate, exclusionRuleId, alertas) |
| `customerExclusionRuleId` | Regra de exclusão de cliente |

Nunca gravar ID de exclusão em `ruleId` (quebra FK `CommissionReceiptLedgerLine_ruleId_fkey`).

## Persistência

`createClosingWithLines` (transação):

1. cria closing CLOSED;
2. mapeia linhas da prévia;
3. valida IDs em `CommissionRule` / `CommissionCustomerExclusionRule`;
4. `createMany` só com FKs válidas ou null.

Idempotência: segundo apply do mesmo mês → `ReceiptClosingDuplicateError`.
