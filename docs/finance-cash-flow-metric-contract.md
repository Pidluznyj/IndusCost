# Contrato de métricas AR — Fluxo de Caixa

**Tela:** Financeiro → Fluxo de Caixa

**Autoridade:** motor oficial de Contas a Receber (`financeAccountsReceivableRulesEngine`) + adapters

**Camada de contrato:** `src/lib/financeCashFlowArMetrics.ts`

**Regra:** mesmo conceito → um helper / mesmo resultado até o centavo. Conceitos diferentes permanecem diferentes e testados como diferentes.

Não altera fórmulas financeiras validadas. Não generaliza o overlay histórico de fevereiro/2026.

---

## Matriz de autoridade

| Métrica | Nome técnico | Origem | Campo monetário | Eixo de data | Saneamento | Filtros | Fórmula | Consumidores | Deve bater com | Pode divergir de | Motivo |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Carteira AR aberta | `AR_OPEN_PORTFOLIO` | `computeOfficialArMetrics.openAmount` / `buildBlocksFromPortfolio` | `balanceReceivable` | nenhum | gerencial AR | identidade sim; **ignora year/month/viewMode/dateBase** | SUM saldo aberto elegível | cards de carteira, reconciliação, Top clientes (por cliente) | recon `cashFlowOpenPortfolio` vs AR oficial | recorte anual, forward até 31/12, radar | Portfólio ≠ período |
| Aberto no período | `AR_OPEN_DUE_IN_PERIOD` | `sumOfficialArOpenDueInPeriod` | `balanceReceivable` | `dueDate` | gerencial AR | year/mês do recorte + identidade | SUM aberto com vencimento no intervalo | timeline mensal «A receber», planejado mensal, calendário (mês) | planejado vs calendário no mesmo escopo | YTD oficial, forward | Recorte temporal explícito |
| Aberto no ano | `AR_OPEN_DUE_IN_YEAR` | YTD `totalReceivableOpen` | `balanceReceivable` | `dueDate` no ano civil selecionado, **incluindo vencimentos futuros** | gerencial AR | year sim; **ignora month** | SUM aberto da população do ano (não é 01/01→hoje) | card «A receber no ano» | totais YTD `openAmount` | `AR_OPEN_PORTFOLIO`, `AR_OPEN_FORWARD_TO_YEAR_END` | Ano civil ≠ carteira total ≠ restante do ano; **não chamar de YTD** |
| Restante até 31/12 | `AR_OPEN_FORWARD_TO_YEAR_END` | motor oficial `openUntilYearEnd` | `balanceReceivable` | `dueDate` hoje→31/12 | gerencial AR | year sim; **ignora month** | SUM aberto no intervalo futuro | card «A receber restante no ano», export | addendo da estimativa anual | aberto do mês original (vencidos), YTD de carteira | Forward começa na data-base |
| Recebido YTD oficial | `AR_RECEIVED_YTD` | motor oficial `receivedYtd` | `amountReceived` | `settlementDate` (regra vigente) | gerencial AR | year sim; **ignora month** | SUM recebido 01/01→data-base | card executivo «Recebido YTD», export `resumo_recebido_ytd` | addendo da estimativa anual | «Recebido YTD por vencimento», timeline de movimento, planejado | Baixa ≠ vencimento |
| Estimativa AR do ano | `AR_ESTIMATED_YEAR_TOTAL` | `composeCanonicalArEstimatedYearTotal` sobre addendos oficiais | misto | settlement + due | gerencial AR | iguais aos addendos | `receivedYtd + openUntilYearEnd` (`roundMoney`) | card «Estimativa AR do ano», export | os dois addendos oficiais | total anual do comparativo (Σ 12 meses por dueDate) | Conceitos diferentes |
| Fluxo planejado mensal | `AR_PLANNED_BY_DUE_MONTH` | `buildExecutiveMonthlyTimeline` `dateAxis: "dueDate"` | recebido=`amountReceived`; aberto=`balanceReceivable` | `dueDate` | gerencial AR | year + identidade; **ignora month/viewMode** | mês: recebido por due + aberto por due | gráfico planejado, comparativo anual (população sem filtros de página), calendário previsto | comparativo anual no mesmo ano/população; SUM dias = mês | timeline de movimento; estimativa anual | Eixo de vencimento |
| Linha do tempo mensal | `AR_MOVEMENT_TIMELINE_MONTHLY` | `buildExecutiveMonthlyTimeline` `dateAxis: "movement"` | idem + overlay | movement (settlement + fev/2026) e aberto por due | gerencial AR | year + identidade | recebido no eixo movement; aberto por dueDate | tabela linha do tempo | aberto mensal do planejado (mesmo dueDate) | recebido mensal do planejado | Overlay e eixo de baixa |
| Radar Diário | `AR_DAILY_RADAR_OPEN_DUE` | `buildFinanceCashFlowDailyRadar` / `resolveCashFlowArAmount(projected)` | `balanceReceivable` | `dueDate` faixas | gerencial AR do radar | **independente dos filtros da página** | SUM da faixa = SUM dias = SUM detalhes | Radar Diário | internamente faixa/dias/detalhe | cards/gráficos da página se filtros diferirem | Escopo operacional próprio |
| Recebido por vencimento | `AR_RECEIVED_BY_DUE_IN_PERIOD` | `sumArReceivedInPeriod` | `amountReceived` | `dueDate` | gerencial AR | year + identidade | SUM amountReceived com due no período | card YTD «Recebido YTD por vencimento», recebido do planejado | planejado mensal (mesmo eixo) | `AR_RECEIVED_YTD` | Semântica deliberada |

---

## Divergências intencionais

1. **Planejado por dueDate ≠ realizado por settlementDate** (e ≠ overlay de movimento).
2. **Aberto no ano (vencimento no ano civil, inclusive futuro) ≠ restante do ano (hoje→31/12) ≠ YTD 01/01→hoje**.
3. **Portfólio aberto ≠ recorte de período/mês**. Top clientes usa carteira; ano/mês da página não se aplicam.
4. **Radar Diário ≠ filtros globais da página** (visão operacional independente).
5. **Comparativo anual ignora filtros da página** (visão consolidada do ano); o gráfico planejado do dashboard respeita identidade/ano YTD.
6. **Estimativa AR do ano ≠ total de entradas do comparativo anual**.
7. Overlay histórico fev/2026 (datas 04, 05, 09, 19 e lag > 15) **só** na timeline de movimento. Não altera planejado, estimativa anual, YTD oficial, radar, forecast, carteira nem comissão.

---

## Paridade obrigatória (0 centavos)

- `AR_ESTIMATED_YEAR_TOTAL` = `AR_RECEIVED_YTD` + `AR_OPEN_FORWARD_TO_YEAR_END`
- Planejado mensal ≡ comparativo anual quando ano e população equivalentes
- Total anual do comparativo = soma dos 12 meses
- Radar: faixa = soma dos dias = soma dos detalhes
- Top cliente = soma canônica dos títulos abertos daquele cliente (`balanceReceivable`)
- Export CSV dos resumos executivos = payload do dashboard
- Frontend apenas formata; não soma received+open

---

## Escopos de filtro na tela (UI)

Estes blocos **não** usam os mesmos filtros do dashboard filtrado. A interface deve deixar o contrato visível; a lógica não deve ser “forçada” a coincidir.

| Superfície | Filtros da página | Contrato visual |
|---|---|---|
| Comparativo anual (`AR_PLANNED_BY_DUE_MONTH` na população anual) | **Ignora** filtros da página (visão consolidada do ano) | «Visão consolidada do ano — independente dos filtros da página.» |
| Radar Diário (`AR_DAILY_RADAR_OPEN_DUE`) | **Independente** dos filtros globais | «Visão operacional independente dos filtros da página.» |
| Top clientes (`AR_OPEN_PORTFOLIO` por cliente) | Identidade (empresa/cliente/NF) sim; **ano/mês não se aplicam** | «Top clientes por saldo AR em aberto» · «Carteira atual; o período da página não se aplica.» |
| Card «A receber no ano» (`AR_OPEN_DUE_IN_YEAR`) | Ano sim; mês ignorado; inclui vencimentos futuros no ano | Não rotular como «A receber YTD» (YTD seria 01/01→hoje) |
