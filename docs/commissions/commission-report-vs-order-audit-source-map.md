# Relatório de Comissões × Auditoria 360º (PD 02523)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-14 |
| **Pedido âncora** | PD 02523 |

---

## 1. Fonte — Auditoria 360º > Aba Comissões

| Item | Valor |
|------|--------|
| Service | `orderFullAuditService.loadCommissionBlock` |
| Tabelas | `CommissionOrderSnapshot` ACTIVE, `CommissionOrderItemSnapshot`, `CommissionReceivableSchedule`, ledger de baixas (read-only) |
| Comissão prevista | `totalFinalCommissionAmount` / `scheduledCommissionAmount` do schedule |
| Recálculo | **Não** — read-only |

---

## 2. Fonte — Comercial > Comissões > Relatórios

| Item | Valor |
|------|--------|
| Endpoint | `GET /api/commissions/reports` |
| Service | `getCommissionReportsPage` → ledger CLOSED (`CommissionReceiptLedgerLine`) **ou** prévia `getReceiptClosingPreviewPage` / `commissionReceiptEngine` |
| Eixo período | `settlementDate` do CR (mês/ano do recebimento) |
| Status `NO_MARGIN` | Engine: schedule programado = 0 + itens `NO_COMMERCIAL_PRICE_TABLE` / `INVALID_COMMERCIAL_PRICE_RANGE` |
| Exibição fina | `mapSourceLineToReportRecord` → `lineFinalCommission` (antes: só `COMMISSIONABLE` mostrava valor) |

---

## 3. Divergência PD 02523

| | Auditoria 360º | Relatório (antes) |
|--|----------------|-------------------|
| Comissão | R$ 12,19 | R$ 0,00 |
| Base | R$ 300,00 | R$ 0,00 |
| Status | Snapshot / schedule oficial | Sem margem/tabela (`NO_MARGIN`) |
| Vendedor | Rodrigo Da Silva Ramos | (variável) |

**Causa provável:** o relatório prioriza o **ledger CLOSED** (ou prévia stale) gravado quando o schedule/snapshot ainda estava zerado. Depois da rematerialização, a Auditoria 360º lê o snapshot ACTIVE (R$ 12,19), mas o fechamento persistido continua com status de “sem margem” e valores zero. A UI do relatório ainda **zerava** qualquer linha que não fosse `COMMISSIONABLE`.

Classificação: `NO_MARGIN_MISCLASSIFIED` / `REPORT_ZERO_SNAPSHOT_HAS_COMMISSION`.

---

## 4. Regra final

1. Relatório deve respeitar snapshot/schedule oficial ACTIVE na **exibição**.
2. `NO_MARGIN` só é válido se snapshot e schedule oficiais também não tiverem comissão prevista.
3. Divergência → status `COMMISSION_SOURCE_MISMATCH` + alerta textual (não zerar).
4. Comissão **paga** / linhas CLOSED no banco **não são alteradas** — só a projeção da tela.
5. Enrichment: `enrichReportLinesWithOfficialSnapshots` após anexar `localOrderId`.

Scripts:

- `tmp-audits/inspect-commission-report-vs-audit-pd02523.ts`
- `tmp-audits/inspect-commission-report-snapshot-divergences.ts`
- `scripts/qaCommissionReportUsesOfficialSnapshot.ts`
