# Runbook — reprocessar / materializar comissão

## Objetivo

Alinhar `CommissionReceivableSchedule` ao `CommissionOrderSnapshot` oficial **sem alterar comissão já paga**.

## Quando rodar

- Linha em Comercial > Comissões com badge **Divergente do snapshot** / status `COMMISSION_SOURCE_MISMATCH`
- Alerta `COMMISSION_MAIN_VIEW_DIFFERS_FROM_ORDER_SNAPSHOT`
- Schedule ACTIVE zerado e snapshot com `totalFinalCommissionAmount > 0`
- Após republicar tabela de preço / ajustar regra (casos reais `NO_MARGIN`)
- Relatório ainda “Sem margem/tabela” com snapshot oficial com comissão (ex.: PD 02523) — a tela já corrige a **exibição**; reprocessar fechamento remove o stale do ledger CLOSED

Diagnóstico:

```bash
npx tsx tmp-audits/inspect-commission-report-vs-audit-pd02523.ts
npx tsx tmp-audits/inspect-commission-report-snapshot-divergences.ts
npx tsx scripts/qaCommissionReportUsesOfficialSnapshot.ts
```

Ver: [commission-report-vs-order-audit-source-map.md](./commission-report-vs-order-audit-source-map.md).

## Fluxo seguro

1. Confirmar na Auditoria 360º (aba Comissões) o snapshot ACTIVE e totais.
2. Diagnóstico:
   ```bash
   npx tsx tmp-audits/inspect-commission-main-vs-order-snapshot.ts
   ```
3. Materializar / rebuild schedule do pedido (motor oficial):
   - UI: Comercial > Comissões > Reprocessar (quando disponível)
   - ou script de materialização do mês (`rebuild-commission-materialization` / `commissionReprocess`)
4. Validar:
   ```bash
   npx tsx scripts/qaCommissionMainVsOrderSnapshot.ts
   ```
5. Não reabrir/alterar lotes de pagamento já quitados.

## Garantias

- Snapshot da Auditoria permanece read-only.
- Ensure de preview agora também rebuilda schedules ACTIVE zerados quando o snapshot ligado tem comissão > 0.
- Persistência de fechamento mapeia `COMMISSION_SOURCE_MISMATCH` → `STALE_SCHEDULE` no enum Prisma (motivo preservado em `exceptionReason`).
