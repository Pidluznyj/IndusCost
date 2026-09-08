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

## Linha do tempo mensal — AP_CORPORATE_MONTHLY_AXIS = dueDate

A tabela **Linha do tempo mensal** (`executiveSummary.monthlyTimeline`) atribuía o **Pago** de Contas a
Pagar ao mês da **data efetiva de pagamento** (paymentDate/settlementDate), sobre a população
recortada por data de pagamento. Baixas atrasadas inflavam o mês da baixa (junho/2026 concentrava
títulos vencidos em abril/maio baixados em junho).

Regra corporativa agora aplicada: **dueDate define o mês; a baixa define o status.**

| Coluna | Campo | Regra |
|---|---|---|
| Pago | `paid` | `sumApCashRealizedDueInPeriod` — realizado **com caixa** (`resolveFinanceApCashRealizedAmount`) dos títulos cuja dueDate cai no mês |
| A pagar | `payableOpenDue` | `sumApOpenDueInPeriod` — saldo aberto dos títulos cuja dueDate cai no mês (inalterado) |
| (info) | `payableSettledWithoutCash` | baixas `WITHOUT_CASH` dos títulos do mês — encerradas pelo motor oficial, **fora** de Pago e de Saídas est. |
| Saídas est. | `estimatedOutflow` | `paid + payableOpenDue` |

Semântica de caixa (`resolveFinanceApCashRealizedAmount` = `cashRealizedAmount`): cancelado → 0; em qualquer
baixa (normal, `WITHOUT_CASH`, `FORCED`) só o `amountPaid` informado conta; quitação com `amountPaid = 0`
encerra o título mas **não** vira caixa (nunca infere `amountPayable`). **FORCED_CASH_SEMANTICS=UNRESOLVED**:
o espelho não distingue baixa forçada com ou sem dinheiro; a regra de segurança limita o caixa ao
`amountPaid` comprovado. Ver seção "AP_SETTLED × AP_CASH_REALIZED".

O card **Pago YTD** continua com sua semântica própria (realizado pela data efetiva canônica no
ano — pergunta "quanto saiu no ano"), documentada como eixo distinto; a linha mensal responde
"a que mês pertence a obrigação". O fluxo planejado (`plannedMonthlyTimeline`) já era por dueDate
e não muda. AR não foi alterado. Nenhuma exceção específica de mês existe.

Invariantes testadas: um título aparece em no máximo um mês; `month = month(dueDate)`; mudar
`settlementDate` sem mudar `dueDate` não muda o mês; OPEN → SETTLED move o valor de A pagar para Pago
**no mesmo mês**; `WITHOUT_CASH` não aumenta Pago; cancelado não entra; baixas atrasadas (abr→jun,
jan→ago, dez/2025→jan/2026) não deslocam o valor. SQL read-only para decompor um mês real:
`scripts/audit-cash-flow-ap-monthly-due-vs-settlement.sql`.

## AP_SETTLED × AP_CASH_REALIZED (terceiro commit)

| Conceito | Resolver | Significado |
|---|---|---|
| **AP_SETTLED** | `resolveFinanceApRealizedAmount` (`realizedAmount`) | Obrigação encerrada pelo estado operacional: `amountPaid`, ou `amountPayable` quando baixado sem valor pago. Tela Contas a Pagar ("Pago", `paidYtd`, `paidInAppliedPeriod`). |
| **AP_CASH_REALIZED** | `resolveFinanceApCashRealizedAmount` (`cashRealizedAmount`) | Saída financeira afirmável pela evidência do título: só `amountPaid > 0`. Nunca acima de `amountPaid`; nunca `amountPayable` inferido. |

Consumidores do Fluxo de Caixa que passam a usar **AP_CASH_REALIZED**: Pago YTD (`cashPaidYtd`), Saldo
realizado YTD, Estimativa AP do ano (`cashEstimatedYearTotal` = cashPaidYtd + total ainda a pagar), Estimativa
líquida anual, Saídas do período e série mensal realizada/combinada (`financeCashFlowLedger`), calendário
realizado, fluxo planejado "Pago" (`sumApPaidInPeriod`), comparativo anual (`sumApPaidByPaymentInPeriod`),
totais da carteira YTD e Linha do tempo mensal. Consumidores fora do Fluxo que mantêm **AP_SETTLED**: tela
Contas a Pagar, auditoria de cálculo AP, drill-down de fornecedores por centro de custo, Relatório Presidencial
(`paidYtd` do motor AP) e Tesouraria (fronteira própria).

Eixos: Linha do tempo mensal = **dueDate**; Pago YTD = **data efetiva de pagamento**. A soma mensal por
vencimento não precisa bater com o Pago YTD por pagamento — não é bug; a definição de caixa por título é a
mesma nos dois. Invariantes testadas: `cashRealized ≤ amountPaid`, `cashRealized ≤ realized`,
`cashPaidYtd ≤ paidYtd`, WITHOUT_CASH/FORCED/quitação sem valor não viram saída, cancelado = 0, parcial = só
`amountPaid`, e o título encerrado sem caixa não reaparece em aberto.
