# AP — Obrigação remanescente do ano (Fluxo de Caixa × Contas a Pagar)

Correção semântica do bloco **Contas a Pagar — Saídas** da Visão executiva do Fluxo de Caixa.
Antes, "A pagar restante no ano" somava apenas títulos abertos com vencimento **de hoje até 31/12**
e a "Estimativa AP do ano" era `Pago YTD + esse valor` — títulos vencidos antes da data-base e
ainda não pagos **desapareciam** da estimativa anual (caso real: R$ 4.529.133,73 em aberto na tela
Contas a Pagar × R$ 3.904.150,43 no Fluxo; diferença = R$ 624.983,30, o vencido gerencial).

## Conceitos canônicos (motor oficial `financeAccountsPayableRulesEngine.ts`)

| Conceito | Campo (`FinanceAccountsPayableMetrics` → `executiveSummary.payable`) | Definição |
|---|---|---|
| **AP_PAID_YTD** | `paidYtd` | Pagamentos efetivos entre 01/01 e a data-base, pela data efetiva canônica (motor oficial). |
| **AP_OVERDUE_OPEN** | `overdueOpenBeforeBase` | Títulos elegíveis ainda em aberto com vencimento operacional **< data-base**, dentro do ano selecionado. |
| **AP_DUE_TODAY_OPEN** | `dueTodayOpenInYear` / `dueTodayOpen` | Abertos com vencimento operacional **= data-base**. Já contido em "A vencer até 31/12". |
| **AP_DUE_REMAINING_TO_YEAR_END** | `openUntilYearEnd` / `openFromTodayToYearEnd` | Abertos com vencimento operacional **≥ data-base e ≤ 31/12**. Não inclui vencidos. UI: **A vencer até 31/12**. |
| **AP_OPEN_REMAINING_OBLIGATION** | `openRemainingObligation` | `overdueOpenBeforeBase + openUntilYearEnd` (vencido + hoje + a vencer). UI: **Total ainda a pagar**. |
| **AP_ESTIMATED_YEAR_TOTAL** | `estimatedYearTotal` | `paidYtd + openRemainingObligation`. UI: **Estimativa AP do ano**. |

Decisão sobre "vence hoje": a data-base é **inclusive** no intervalo a vencer (`forwardFromDate = hoje`),
como já era; por isso o título que vence hoje fica em A vencer até 31/12 e nunca em Vencido em aberto,
sem buraco entre os dois.

## Regras preservadas

- **Eixo corporativo AP = `dueDate`** (vencimento operacional). O vencido continua alocado na sua
  dueDate original: **não** é deslocado para o mês atual, **não** entra na composição mensal futura
  (Set/Out/Nov/Dez), **não** usa `settlementDate` como eixo. A correção é de **escopo da obrigação
  remanescente**, não de reatribuição temporal.
- Elegibilidade e "ainda em aberto" vêm do resolver canônico (`isFinanceApOpen` /
  `resolveFinanceApOpenAmount`): cancelados, pagamento suspenso, `WITHOUT_CASH`, `FORCED`, stale,
  grupo interno e agenda de pedido de compra seguem as regras vigentes.
- Todas as métricas anuais derivam da **mesma passada** sobre a população AP já carregada
  (`filterFinanceApRows` com o ano e sem mês). Nenhuma consulta nova por card.
- "Saídas do período" não foi alterado (série mensal do Fluxo conforme `viewMode`).

## Invariantes (testadas)

```
openRemainingObligation = overdueOpenBeforeBase + openUntilYearEnd
estimatedYearTotal      = paidYtd + openRemainingObligation
openUntilYearEnd        ≤ openRemainingObligation
overdueOpenBeforeBase   > 0  ⇒ nunca some de openRemainingObligation
overdueOpenBeforeBase   = 0  ⇒ openRemainingObligation = openUntilYearEnd
estimatedYearNet        = realizedYtd + projectedRemaining   (projectedRemaining = AR a vencer − AP total ainda a pagar)
```

`auditAccountsPayableRules` emite aviso se qualquer identidade quebrar.

## Paridade Contas a Pagar × Fluxo de Caixa

`auditCashFlowApOpenRemainingObligationParityWithAp` (parte de `buildCashFlowArApReconciliationReport`)
exige, para o mesmo ano, mesma data-base e mesmos filtros gerenciais **sem filtro de mês**:

- Fluxo `Total ainda a pagar` = Contas a Pagar `Em aberto` (`cards.totalOpenAmount`);
- Fluxo `Vencido em aberto` = Contas a Pagar `Vencido gerencial` (`cards.overdueAmount`).

Diferença de escopo conhecida e documentada: título aberto com vencimento **operacional**
(reagendamento) posterior a 31/12 conta no Em aberto de Contas a Pagar (filtro de ano por dueDate)
mas fica fora do horizonte anual do Fluxo; a auditoria reporta a divergência em vez de escondê-la.
O filtro de mês do Fluxo **não** afeta as métricas anuais (que o ignoram), e sim "Saídas do período".

## UI (Visão executiva)

Pago YTD · **Vencido em aberto** · **A vencer até 31/12** (antes "A pagar restante no ano") ·
**Total ainda a pagar** · Estimativa AP do ano. A composição abaixo dos cards mostra
"Vencido antes da data-base: X", os meses futuros, "A vencer até 31/12: Y" e
"Total ainda a pagar: X + Y". O frontend não recalcula nada: todos os valores vêm do backend.

## Arquivos

- Motor: `src/lib/financeAccountsPayableRulesEngine.ts` (+ `.types.ts`)
- Adaptadores: `src/lib/financeAccountsPayableRulesAdapter.ts`, `src/lib/financeCashFlowRulesAdapter.ts`
- Resumo executivo: `src/lib/financeCashFlowExecutiveSummary.ts`
- Paridade: `src/lib/financeCashFlowArApReconciliation.ts`
- UI: `src/components/finance/cash-flow/FinanceCashFlowExecutiveSummaryPanel.tsx`, tooltips em `src/lib/financeKpiTooltips.ts`
- Export CSV: `resumo_ap_vencido_em_aberto`, `resumo_ap_total_ainda_a_pagar`
- Testes: `financeAccountsPayableRulesEngine.test.ts` (A–I, invariantes, paridade), `financeCashFlowExecutiveSummary.test.ts`, `financeCashFlowArApReconciliation.test.ts`
