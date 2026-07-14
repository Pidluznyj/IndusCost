# Comissão × Contas a Receber — base no valor original do título

**Atualizado:** 2026-07-14  
**Projeto:** IndusCost / My Industry

---

## 1. Regra oficial

| Conceito | Campo oficial | Papel |
|----------|---------------|--------|
| **Valor original do CR** | `NomusAccountsReceivable.amountReceivable` (`valorReceber`) / `CommissionReceivableSchedule.receivableNominalAmount` | **Base comissionável (teto)** |
| **Valor recebido** | `amountReceived` (`valorRecebido`) | **Gatilho e proporção** de liberação |
| **Comissão prevista** | `scheduledCommissionAmount` / `commissionExpectedAmount` | Calculada na materialização (venda) |
| **Comissão liberada** | `releasedCommissionAmount` | `expected × min(recebido, original) / original` |

**Nunca** usar o recebido bruto (com juros/multa/acréscimos) como base que *aumente* a comissão além do previsto sobre o original.

### Exemplo

- CR original: R$ 10.000,00  
- Recebido: R$ 10.350,00 (R$ 350 juros/multa)  
- Comissão prevista 5% → R$ 500,00  

**Correto:** libera R$ 500,00 (base R$ 10.000).  
**Errado:** 5% × R$ 10.350 = R$ 517,50.

Fórmula canônica (`resolveReceivableCommissionPrincipal` / `releaseCommissionFromMaterializedSchedule`):

```text
original   = receivableNominalAmount || amountReceivable
principal  = min(received, original)
ratio      = principal / original          // ≤ 1
released   = expected × ratio              // ≤ expected
ignored    = max(0, received − original)   // juros/multa proxy
```

---

## 2. Onde nasce a base da comissão

1. **Accrual (previsto):** materialização do pedido/NF → `scheduledCommissionAmount` (motor de regras sobre a venda).  
2. **Liberação:** fechamento por recebimento (`commissionReceiptEngine`) aplica a proporção sobre o **original do CR**.  
3. **Campo de base no ledger:** `allocatedCommercialBase` = principal (não o recebido bruto).

Helper puro (frontend-safe): `src/lib/commissions/commission-money.shared.ts`

- `resolveReceivableCommissionPrincipal`
- `computeCommissionReleasedFromReceivablePrincipal`
- `computeReleasedAmountForReceivable` (delta incremental)

---

## 3. Fluxo atual (pós-correção)

| Stage | Service | Usa original? |
|-------|---------|----------------|
| Preview/fechamento por recebimento | `releaseCommissionFromMaterializedSchedule` | Sim — base = principal |
| Legacy schedule release | `computeScheduleReleaseTarget` | Sim — via helper |
| Fallback item recalc | allocate sobre `min(received, amountReceivable)` | Sim (cap) |
| Comissão **paga** (`paidAmount`) | payout ao vendedor | **Não é base de CR**; não altera automaticamente |

### Risco histórico (corrigido)

`commissionableBaseAmount` era igual a `amountReceived` mesmo com ratio já capped em 1 — KPIs/auditoria mostravam base inflada e o fallback item calculava `% × recebido` sem teto do original.

---

## 4. Juros / multa / acréscimos

Nomus sincroniza taxas do título (`lateFeePercent`, `monthlyInterestRate`), **sem** valor de juros do settlement separado.

Política:

- Se `received > original` → `ignoredFinancialChargesAmount = received − original` e flag  
  `RECEIPT_AMOUNT_GREATER_THAN_RECEIVABLE_ORIGINAL`.  
- Esses encargos **não** entram em `commissionableBaseAmount`.  
- Se no futuro existirem `interestAmount` / `fineAmount` no recebimento, subtrair do principal **antes** do `min`.

**Limitação parcial:** em pagamento parcial (ex.: R$ 5.100 com R$ 100 de juros embutidos e original R$ 10.000), sem campo separado o sistema **não** isola os R$ 100 — usa `min(5100, 10000) = 5100`. O teto duro é no original integral.

---

## 5. Desconto / abatimento

Flag `RECEIVABLE_DISCOUNT_DETECTED` quando:

- saldo em aberto ≈ 0 **e**  
- recebido &lt; original  

Comportamento: **não** trata desconto como juros negativo; apenas audita. Comissão liberada segue `min(recebido, original) / original` (proporção menor).

---

## 6. Reprocessamento e comissão paga

- Preview/apply de fechamento e rematerialização de schedules **abertos** usam a nova regra.  
- `CommissionRecord.paidAmount` (já pago ao vendedor) **não** é recalculado automaticamente.  
- Se histórico pago foi baseado em recebido bruto, gerar auditoria/divergência — ajuste só com aprovação operacional.

---

## 7. UI

Fechamento por recebimento (detalhe): colunas **Original CR**, **Recebido bruto**, **Base comissão**, **Juros/multa ignorados**.

---

## 8. QA / diagnóstico

```bash
npx tsx scripts/qaCommissionReceivableOriginalBase.ts
npx tsx tmp-audits/inspect-commission-receivable-base.ts
npx tsx tmp-audits/inspect-commission-overreceived-samples.ts
```
