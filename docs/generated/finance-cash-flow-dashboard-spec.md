# Especificação — Dashboard Fluxo de Caixa

**Projeto:** IndusCost  
**Branch:** `main`  
**Data:** 2026-06-09  
**Fase:** 5 — Resumo Executivo YTD compacto

---

## 1. Conceito de negócio

Fluxo de caixa **não é faturamento**. Faturamento (`SalesOrder` / NF-e) mede venda/nota; fluxo de caixa mede **entrada e saída de dinheiro** prevista ou realizada.

| Conceito | Fonte | Campo de data | Campo de valor |
|----------|-------|---------------|----------------|
| Entrada prevista | `NomusAccountsReceivable` | `dueDate` | `balanceReceivable` (aberto) |
| Entrada realizada | `NomusAccountsReceivable` | `settlementDate` | `amountReceived` |
| Saída prevista | `NomusAccountsPayable` | `dueDate` | `balancePayable` (aberto, positivo) |
| Saída realizada | `NomusAccountsPayable` | `paymentDate ?? settlementDate` | `amountPaid` |

**Não usar:** `SalesOrder`, `NomusNfe` como fonte principal de caixa (apenas contexto futuro em Faturamento).

---

## 2. Fontes de dados

### NomusAccountsReceivable (entradas)

| Campo | Uso no fluxo |
|-------|--------------|
| `dueDate` | Data base vencimento (previsto) |
| `settlementDate` | Data base baixa (realizado) |
| `competenceDate` | Data base emissão/competência |
| `balanceReceivable` | Valor previsto (título aberto) |
| `amountReceived` | Valor realizado |
| `companyName`, `personName`, `personCnpj` | Filtros |
| `paymentMethodName`, `bankAccountName` | Filtros avançados |
| `sourceInvoiceId`, `sourceInvoiceNumber` | Filtro NF emitida |
| `suspendCollection` | Excluído do previsto quando suspenso |
| `syncedAt` | Última sync (header) |

### NomusAccountsPayable (saídas)

| Campo | Uso no fluxo |
|-------|--------------|
| `dueDate` | Data base vencimento (previsto) |
| `paymentDate`, `settlementDate` | Data base baixa (realizado) |
| `competenceDate` | Data base emissão/competência |
| `balancePayable` | Valor previsto (positivo internamente) |
| `amountPaid` | Valor realizado |
| `suspendPayment` | Excluído do previsto quando suspenso |
| Demais campos | Espelham AR |

---

## 3. Regras de cálculo

### 3.1 Modos de visão (`viewMode`)

| Modo | Entradas | Saídas |
|------|----------|--------|
| `projected` | Saldo aberto AR por vencimento | Saldo aberto AP por vencimento |
| `realized` | `amountReceived` por baixa | `amountPaid` por pagamento |
| `combined` | Previsto + realizado no mesmo bucket mensal | Previsto + realizado no mesmo bucket |

### 3.2 Data base (`dateBase`)

| Valor | AR | AP |
|-------|----|----|
| `due` | `dueDate` | `dueDate` |
| `settlement` | `settlementDate` | `paymentDate ?? settlementDate` |
| `issue` | `competenceDate` | `competenceDate` |

No modo `projected`, a data base efetiva é sempre `dueDate` (independente do filtro).

### 3.3 Fluxo líquido e saldo acumulado

```
netFlow[m] = inflow[m] - outflow[m]
accumulated[m] = accumulated[m-1] + netFlow[m]
```

**Exceção:** saldo inicial bancário = 0 (não há ledger bancário no sistema). Rotulado com `FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE`.

### 3.4 Meses futuros

No ano corrente, meses **após** o mês de referência retornam `null` no modo `realized` (não zero falso). No modo `projected`, meses futuros podem ter valores de títulos em aberto.

### 3.5 Valores AP

Armazenados como **positivos** no payload (`outflowAmount`). Na UI, exibidos como saída (sinal visual negativo / cor vermelha).

---

## 4. Motor gerencial de posição líquida e necessidade de caixa

### 4.1 Posição líquida de caixa (carteira em aberto)

```
netCashPosition = totalReceivableOpen - totalPayableOpen
netCashPositionAbs = |netCashPosition|
netCashPositionStatus = surplus  (se >= 0)
                      | deficit  (se < 0)
netCashPositionLabel = "Superávit projetado" | "Déficit projetado"
```

| Campo | Regra |
|-------|-------|
| `cashCoverageRatio` | `totalReceivableOpen / totalPayableOpen` quando pagar > 0; `null` se pagar = 0 |
| `cashNeedAmount` | `netCashPositionAbs` em déficit; `0` em superávit |
| `cashNeedLabel` | `"Necessidade de caixa"` \| `"Folga projetada"` |

Implementação: `buildNetCashPositionMetrics` em `financeCashFlowIntelligence.ts`.

### 4.2 Série mensal para gráfico principal

Por mês (`monthlySeries[]`):

| Campo | Regra |
|-------|-------|
| `inflowAmount` | AR no mês |
| `outflowAmount` | AP no mês (positivo no payload) |
| `netFlowAmount` | inflow − outflow |
| `accumulatedBalance` | acumulado do fluxo líquido |
| `status` | `positive` se net ≥ 0; `negative` se net < 0; `null` em meses futuros sem dado (realizado) |

### 4.3 Leitura executiva (`executiveReading`)

Frases determinísticas geradas por `buildCashFlowExecutiveReading` — sem LLM externo. Cobre déficit/folga, vencidos AR/AP, meses negativos e concentração (> 40% em cliente/fornecedor).

---

## 5. KPIs — Resumo executivo (UI)

| KPI | Campo |
|-----|-------|
| Posição líquida de caixa | `cards.netCashPosition` + hero |
| Total a receber | `cards.totalReceivableOpen` |
| Total a pagar | `cards.totalPayableOpen` |
| Necessidade / Folga de caixa | `cards.cashNeedLabel` + `cashNeedAmount` ou `netCashPositionAbs` |
| Meses com saldo negativo | `cards.negativeBalanceMonthsCount` |
| Vencidos no caixa | `cards.overdueCashImpact` |

Campos auxiliares de período: `netFlowAmount`, `accumulatedBalance`, `outflowToInflowPercent`.

---

## 6. Gráfico principal

**Título:** Posição Líquida Mensal — Receber x Pagar

| Série | Visual | Campo |
|-------|--------|-------|
| Posição líquida | Barras verdes acima / vermelhas abaixo do zero | `monthlySeries[].netFlowAmount` |
| Saldo acumulado | Linha azul | `monthlySeries[].accumulatedBalance` |

Altura fixa `FINANCE_CASH_FLOW_CHART_HEIGHT = 280` — evita colapso do `ResponsiveContainer`.

Tooltip: mês, a receber, a pagar, posição líquida, saldo acumulado.

---

## 7. Previsão de caixa (`cashForecast`)

Motor: `financeCashFlowForecast.ts` → `buildCashFlowForecast`.

### 7.1 Horizontes

| Horizonte | Meses | Campo |
|-----------|-------|-------|
| Mês atual | 1 | `horizons.currentMonth` |
| Próximos 3 meses | 3 | `horizons.next3Months` |
| Próximos 6 meses | 6 | `horizons.next6Months` |
| Próximos 12 meses | 12 | `horizons.next12Months` |

Buckets rolantes a partir do mês de referência (12 pontos em `monthlyPoints`).

### 7.2 Premissas — cenário base

| Regra | Detalhe |
|-------|---------|
| Data prevista | `dueDate` (vencimento) no modo `projected` |
| Data realizada | `settlementDate` (AR) / `paymentDate ?? settlementDate` (AP) no modo `realized` |
| Valor previsto | `balanceReceivable` / `balancePayable` (títulos abertos) |
| Valor realizado | `amountReceived` / `amountPaid` |
| Filtros | Mesmos de AR/AP aplicados antes do cálculo |
| Meses futuros (realizado) | `null` — evita zero falso |

Métricas por horizonte: `projectedInflow`, `projectedOutflow`, `projectedNet`, `projectedAccumulated`, `worstMonth`, `bestMonth`, `negativeMonthsCount`, `firstNegativeMonth`, `maxCashNeed`, `maxCashSurplus`.

### 7.3 Cenário conservador (`conservativeScenario`)

**Rótulo:** *Cenário conservador — estimativa, não altera dados oficiais.*

| Premissa | Fator |
|----------|-------|
| Recebíveis em aberto | 80% (`CONSERVATIVE_OPEN_RECEIVABLE_FACTOR`) |
| Vencidos a receber | 50% (`CONSERVATIVE_OVERDUE_RECEIVABLE_FACTOR`) |
| Contas a pagar | 100% |

Métricas: `projectedInflowConservative`, `projectedOutflow`, `projectedNetConservative`, `cashNeedConservative`, `deltaVsBase`.

### 7.4 Cenário crítico (`stressScenario`)

**Rótulo:** *Cenário crítico — simulação gerencial.*

| Premissa | Fator |
|----------|-------|
| Recebíveis em aberto | 60% (`STRESS_OPEN_RECEIVABLE_FACTOR`) |
| Vencidos a receber | 30% (`STRESS_OVERDUE_RECEIVABLE_FACTOR`) |
| Contas a pagar | 100% (vencidos a pagar permanecem imediatos) |

Métricas: `projectedInflowStress`, `projectedOutflowStress`, `projectedNetStress`, `cashNeedStress`, `monthsAtRiskStress`.

### 7.5 Gráfico de cenários

**Título:** Previsão de caixa por cenário — `scenarioChartPoints[]` com `base`, `conservative`, `stress` por mês (fluxo líquido). Verde = positivo; vermelho = negativo.

### 7.6 Necessidade de caixa (painel UI)

Compara necessidade no cenário base (`cards.cashNeedAmount` ou `maxCashNeed` do horizonte), conservador e crítico; destaca mês de maior pressão e valores vencidos AR/AP.

### 7.7 Recomendações operacionais (`operationalRecommendations`)

Regras determinísticas em `buildCashFlowOperationalRecommendations`: cobrança de vencidos, negociação com fornecedor, mês de pressão, déficit, concentração de cliente vencido.

### 7.8 Limitações

O fluxo de caixa **projetado** depende dos vencimentos de AR/AP sincronizados do Nomus. **Não substitui** saldo bancário real nem previsão de faturamento. Cenários conservador e crítico são simulações visuais — não alteram dados oficiais.

---

## 8. Resumo Executivo YTD

O **primeiro bloco** da aba Visão Geral é sempre **YTD (Year to Date)**, separado das análises filtradas abaixo.

### 8.1 Regras de escopo

| Situação | Período YTD |
|----------|-------------|
| Ano selecionado = ano vigente | 01/01 do ano até **hoje** (data de referência) |
| Ano passado | 01/01 até **31/12** do ano (ano fechado) |

- Campo payload: `executiveYtd` + `executiveYtdReading`
- **Filtro de mês não altera o YTD do topo** — apenas as seções abaixo
- Demais filtros (empresa, cliente, visão, etc.) continuam aplicados ao YTD
- Chips na UI: **Topo: YTD** vs **Análises abaixo: filtros aplicados**

### 8.2 Métricas YTD

Posição líquida, receber/pagar em aberto, necessidade/folga, vencidos, meses negativos no ano e **tendência** (`improving` / `worsening` / `stable`).

Tendência: compara saldo acumulado do último mês válido com o de 3 meses antes; menos de 4 meses com dado → “Dados insuficientes”.

### 8.3 Visual

Cards compactos (`min-h` baixo, fonte menor) + mini gráfico “Tendência YTD do caixa” (barras líquido + linha acumulado).

### 8.4 Limitação

YTD é visão gerencial baseada em AR/AP Nomus — **não substitui saldo bancário real**.

---

## 9. Painel CFO e insights determinísticos

Motor: `financeCashFlowCfoDiagnostics.ts` — **sem IA externa**, sem alterar dados oficiais.

### 8.1 Score de saúde do caixa (`cashHealthScore`)

Escala **0–100** (evitar falsa precisão — score composto, não índice bancário).

| Componente | Peso | Regra |
|------------|------|-------|
| Posição líquida | 25 | Superávit = 25; déficit penalizado por \|net\| / max(receber, pagar) |
| Meses negativos | 15 | 15 × max(0, 1 − meses/6) |
| Vencidos AR | 15 | 15 × max(0, 1 − vencidosAR / receber aberto) |
| Vencidos AP | 15 | 15 × max(0, 1 − vencidosAP / pagar aberto) |
| Concentração cliente | 10 | Pleno &lt; 40%; reduz acima (`CFO_CONCENTRATION_ALERT_PERCENT`) |
| Concentração fornecedor | 10 | Idem |
| Necessidade conservadora | 5 | 5 × max(0, 1 − need / receber aberto) |
| Tendência 3 meses | 5 | Líquido 3m ≥ 0 → 5; mês atual positivo → 2 |

| Faixa | Classificação |
|-------|---------------|
| 80–100 | Saudável |
| 60–79 | Atenção |
| 40–59 | Risco |
| 0–39 | Crítico |

### 8.2 Insights executivos (`executiveInsights`)

`buildCashFlowExecutiveInsights(payload, arRows, apRows, referenceDate)` retorna:

- `summary`, `riskLevel`
- `alerts[]`, `opportunities[]`, `recommendedActions[]` (top 5 por impacto), `watchItems[]`
- `diagnostics`: saúde, risco 30/60/90 dias, pressão de pagamentos, oportunidade de cobrança, concentração

Cada item: `title`, `description`, `severity` (info/warning/critical/success), `relatedAmount`, `relatedEntity`, `suggestedAction`.

### 8.3 Calendário diário (`dailyCalendar`)

Agrupamento por dia no mês filtrado (ou mês de referência): entrada, saída, líquido, status positivo/negativo, destaque de grandes movimentos.

### 8.4 Abas UI

| Aba | Conteúdo |
|-----|----------|
| Visão Geral | Diagnóstico CFO + resumo + previsão |
| Calendário | Grade diária com mini resumo |
| Risco de Caixa | Score, cenários, concentração, ações, tabela crítica |

---

## 10. Filtros

### Principais (sempre visíveis)

- Ano, Mês, Empresa
- Visão: Previsto / Realizado / Previsto x Realizado
- Data base: Vencimento / Baixa / Emissão
- Status: Todos / Aberto / Pago / Vencido

### Avançados (colapsáveis)

- Cliente, Fornecedor, CNPJ/CPF
- Forma de pagamento, Conta bancária
- NF emitida?

### UX

- Draft/applied com chips, Aplicar/Limpar, pending changes
- Export usa filtros **aplicados**

---

## 11. Abas internas

| Aba | Fase |
|-----|------|
| Visão Geral | **implementada** |
| Calendário | **implementada** |
| Risco de Caixa | **implementada** |
| Acumulado | planejada |
| Detalhado | planejada |
| Entradas | planejada |
| Saídas | planejada |

---

## 12. API

| Endpoint | Builder | Fonte |
|----------|---------|-------|
| `GET /api/finance/cash-flow/dashboard` | `buildFinanceCashFlowDashboard` | AR + AP |
| `GET /api/finance/cash-flow/export` | `buildFinanceCashFlowExportCsv` | AR + AP |

---

## 13. Exceções rotuladas

| Constante | Texto |
|-----------|-------|
| `FINANCE_CASH_FLOW_PROJECTED_BALANCE_SCOPE` | Saldo projetado — não considera saldo bancário inicial |
| `FINANCE_CASH_FLOW_SYNC_SCOPE` | Última sync — MAX(syncedAt) global AR/AP |
| `FINANCE_CASH_FLOW_NOT_BILLING_SCOPE` | Fluxo de caixa ≠ faturamento — fonte AR/AP |
| `FINANCE_CASH_FLOW_COMBINED_SCOPE` | Modo combinado — soma previsto e realizado no período |

---

## 14. Export CSV estendido

Linhas `mensal` mantêm colunas originais + `cenario_base_liquido`, `conservador_liquido`, `critico_liquido`. Linhas resumo: `necessidade_caixa` (base/conservador/crítico) e `horizonte_12m`.

## 15. Pendências (fases posteriores)

1. Tabela detalhada consolidada AR/AP (aba Detalhado)
2. Saldo bancário inicial configurável
3. Centro de custo / classificação (quando disponível no Nomus)
4. Integração contextual com Faturamento (link diagnóstico, sem misturar fontes)

## 16. Validação final (auditoria)

### 15.1 Perguntas que a tela deve responder

| Pergunta | Onde |
|----------|------|
| Quanto tenho a receber / pagar? | Hero + KPIs (`totalReceivableOpen`, `totalPayableOpen`) |
| Posição líquida? | Hero `netCashPosition` |
| Sobra ou falta dinheiro? | Status superávit/déficit + necessidade de caixa |
| Meses negativos? | KPI + gráfico + forecast |
| Necessidade de caixa? | KPI + painel cenários + CFO |
| Clientes/fornecedores críticos? | Top listas + CFO |
| Vencidos a cobrar/pagar? | Listas + CFO alertas |
| Cenários base/conservador/crítico? | Gráfico cenários + export |
| Plano de ação? | `operationalRecommendations` + `executiveInsights.recommendedActions` |

### 15.2 Layout rejeitado (Control Room)

Commits neutralizados: `525fa83`, `e6e2c1a`. Rollback: `6e674a1`.

**Não recriar:** `finance-control-room.css`, `financeControlRoomTheme.ts`, `cash-flow-page-formatted.html`.

Padrão visual atual: **BI executivo** (`FinanceBiDashboardShell`), não Control Room.

### 15.3 Limitações explícitas

- Fluxo projetado depende de vencimentos AR/AP Nomus.
- **Não substitui** saldo bancário real (`hasInitialBankBalance: false`).
- Cenários conservador/crítico são simulações — não alteram dados oficiais.
- Fluxo de caixa **≠** faturamento (fonte: AR/AP, não SalesOrder/NF-e).

### 15.4 Testes executados na validação

| Comando | Resultado |
|---------|-----------|
| `npx prisma validate` | OK |
| `npm run test:finance:cash-flow` | 76+ testes |
| `npm run test:finance:navigation` | 17 testes |
| `npm run test:finance:accounts-receivable` | 119 testes |
| `npm run test:finance:accounts-payable` | 107 testes |
| `npm run test:finance:billing` | 49 testes |
| `npm run test:finance:billing-nfes` | 10 testes |
| `npm run test:nomus:accounts-receivable` | 23 testes |
| `npm run test:nomus:accounts-payable` | 30 testes |
| `npm run test:nomus:nfes` | 44 testes |
| `npm run lint` | OK |
| `npm run build` | OK |

Suíte cash-flow cobre: posição líquida, necessidade de caixa, gráfico positivo/negativo, empty state, cenários, CFO score, recomendações, export, filtros, NaN/Infinity, ausência de Control Room.

---

*Gerado pela especificação do dashboard Fluxo de Caixa — IndusCost.*
