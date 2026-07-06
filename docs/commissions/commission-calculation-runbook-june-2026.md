# Runbook — Cálculo de Comissões (Junho/2026)

**Projeto:** IndusCost / My Industry  
**Módulo:** Comissões  
**Data:** 2026-07-01

---

## 1. Resumo do motor

O motor oficial está em `commission-calculation-service.server.ts`. Fluxo:

1. Carrega pedidos do período (`loadCommissionOrderSources`).
2. Para cada pedido ativo, item e beneficiário (vendedor/representante conforme settings):
   - Resolve **pessoa comissionada** (`resolveOrCreateCommissionPerson`).
   - Seleciona **regra ativa** por prioridade (`selectBestMatchingRule`).
   - Calcula **base** (valor líquido do item) e **comissão** (`ratePercent` da regra).
3. **Sem NF-e autorizada + doc. saída:** gera **prevista** (`FORECAST_FROM_ORDER` ou `WAITING_NFE`) com parcelas `SALES_ORDER_INSTALLMENT`.
4. **Com NF-e autorizada:** supersede previstas (`SUPERSEDED_BY_OUTPUT_DOCUMENT`) e cria registro **confirmado** (`OUTPUT_DOCUMENT`) com parcelas `ACCOUNTS_RECEIVABLE`.
5. **Liberação:** `commission-release-service.ts` — proporcional ao recebimento AR (`EACH_RECEIVABLE_PAID` padrão).
6. **Pagamento:** manual via lotes (`commission-payment-service.server.ts`) — nunca automático.
7. **Idempotência:** `calculationHash` único por pedido/item/NF/pessoa/origem — upsert, não duplica.

---

## 2. Entidades Prisma

| Model | Uso |
|-------|-----|
| `SalesOrder` | Origem provisória (read-only) |
| `SalesOrderNfeLink` / `NomusNfe` | NF-e |
| `InventoryMovement` | Proxy Documento de Saída |
| `NomusAccountsReceivable` | Parcelas, recebimento, liberação |
| `CommissionPerson` | Vendedor/representante comissionável |
| `CommissionRule` / `CommissionRuleCondition` | Percentual e condições |
| `CommissionRecord` | Registro calculado |
| `CommissionPaymentSchedule` | Parcelas pedido ou AR |
| `CommissionPaymentBatch` | Pagamento ao comissionado |
| `CommissionAuditIssue` | Divergências |
| `CommissionSettings` | Flags operacionais |
| `CommissionCalculationRun` | Histórico de recálculo |

---

## 3. Status `CommissionRecordStatus`

| Status | Significado |
|--------|-------------|
| `FORECAST_FROM_ORDER` | Prevista pelo pedido |
| `WAITING_NFE` | Pedido com vínculo NF-e, aguardando confirmação |
| `SUPERSEDED_BY_OUTPUT_DOCUMENT` | Prevista substituída (inativa) |
| `CONFIRMED_BY_OUTPUT_DOCUMENT` | Confirmada por doc. saída |
| `WAITING_RECEIVABLE` | Confirmada, aguardando CR |
| `WAITING_PAYMENT` | Liberável / aguardando recebimento |
| `PARTIALLY_RELEASED` / `RELEASED` | Liberada |
| `PAID_PARTIAL` / `PAID_TOTAL` | Paga (bloqueio auto-alteração) |
| `CANCELLED` / `REVERSED` / `ERROR` | Inativos |

**Nota:** não existe `SUPERSEDED` — usar `SUPERSEDED_BY_OUTPUT_DOCUMENT`.

---

## 4. Fluxo previsto → confirmado → liberado → pago

```text
Pedido (SALES_ORDER) → FORECAST_FROM_ORDER / WAITING_NFE
        ↓ NF-e + doc. saída
OUTPUT_DOCUMENT → CONFIRMED / WAITING_RECEIVABLE
        ↓ recebimento AR
PARTIALLY_RELEASED / RELEASED
        ↓ lote pagamento (manual)
PAID_PARTIAL / PAID_TOTAL
```

---

## 5. Pré-requisitos (junho/2026)

- [ ] PostgreSQL acessível (`DATABASE_URL`)
- [ ] Migration comissões aplicada (`npx prisma migrate deploy`)
- [ ] Pedidos jun/2026 sincronizados Nomus
- [ ] **Regras ativas** cadastradas (não inventar percentual)
- [ ] **Pessoas comissionadas** (backfill ou criação automática no cálculo)
- [ ] Configurações revisadas (`/commissions/settings`)

---

## 6. Riscos

| Risco | Mitigação |
|-------|-----------|
| Sem regra ativa | Apply bloqueado; cadastrar regra na UI |
| Doc. saída Nomus ausente | Proxy `InventoryMovement`; issues de auditoria |
| Apply sem preview | Sempre `--preview` antes de `--apply` |
| Alterar comissão paga | `paidCommissionBlockAutoChange` |
| Duplicação | `calculationHash` upsert |

---

## 7. Sequência operacional — Junho/2026

```bash
# 1) Prontidão geral
npx tsx scripts/audit-commission-readiness.ts --year=2026 --month=6

# 2) Prontidão específica junho
npx tsx scripts/audit-commission-june-readiness.ts --year=2026 --month=6

# 3) Cobertura de regras
npx tsx scripts/audit-commission-rules-coverage.ts --year=2026 --month=6

# 4) Backfill pessoas (preview → apply)
npx tsx scripts/backfill-commission-persons.ts --year=2026 --month=6 --preview
npx tsx scripts/backfill-commission-persons.ts --year=2026 --month=6 --apply

# 5) Preview cálculo
npx tsx scripts/recalculate-commissions.ts --year=2026 --month=6 --preview

# 6) Apply SOMENTE se sem BLOQUEANTE
npx tsx scripts/recalculate-commissions.ts --year=2026 --month=6 --apply

# 7) Pós-apply
npx tsx scripts/audit-commission-links.ts --year=2026 --month=6
npx tsx scripts/audit-commission-financial-release.ts --year=2026 --month=6
npx tsx scripts/export-commission-june-comparison.ts --year=2026 --month=6 --outDir=tmp/commissions-june-2026

# 8) Comparar com Nomus (quando arquivo disponível)
npx tsx scripts/compare-commission-with-nomus-export.ts --year=2026 --month=6 --nomusFile=tmp/nomus-june.csv
```

---

## 8. Deploy servidor (resumo)

```bash
cd /opt/induscost
git pull --ff-only origin main
npx prisma validate
npx prisma migrate deploy
npx prisma generate
NODE_ENV=production npm run build
# reiniciar tsx server.ts
# executar sequência §7
```

---

## 9. Telas após cálculo

Com registros em `CommissionRecord`, as telas deixam de ficar zeradas:

- Dashboard, Previstas, Confirmadas, Liberação, Pagamentos, Auditoria.

Sem regras e sem apply, telas permanecem vazias — comportamento esperado.

---

*Runbook operacional — não altera pedidos, AR, NF-e, financeiro ou sync Nomus.*
