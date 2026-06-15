# Dicionário de Dados e Regras — Fluxo de Caixa

**Projeto:** IndusCost  
**Tela:** Financeiro → Fluxo de Caixa (`/finance/cash-flow`)  
**Data:** 2026-06-12  
**Tipo:** Documentação técnica e negocial (auditoria — sem alteração de regras)

Documento complementar: `docs/finance/FINANCE_CASH_FLOW_BLUEPRINT.md`, `docs/generated/finance-cash-flow-dashboard-spec.md`.

---

## 1. Resumo executivo

O **Fluxo de Caixa** consolida movimentos financeiros de entrada e saída a partir de títulos sincronizados do Nomus:

| Conceito | Fonte no sistema |
|----------|------------------|
| **Entradas** | `NomusAccountsReceivable` (Contas a Receber) |
| **Saídas** | `NomusAccountsPayable` (Contas a Pagar) |
| **Saldo líquido** | Entradas − Saídas (no período filtrado) |

**Faturamento não é caixa.** Notas fiscais (`NomusNfe`, pedidos `SalesOrder`) medem receita operacional/faturamento; o fluxo usa apenas títulos AR/AP. A origem “Com NF / Sem NF” no fluxo classifica o **recebível** (vínculo `sourceInvoiceId` / `sourceInvoiceNumber`), não importa valor de NF-e de faturamento.

**Saldo acumulado ≠ saldo bancário.** `hasInitialBankBalance: false` — o acumulado é soma do fluxo líquido mês a mês, sem saldo inicial de conta corrente.

---

## 2. Fontes de dados

### 2.1 Contas a Receber

| Item | Detalhe |
|------|---------|
| **Nome** | Contas a Receber Nomus |
| **Model Prisma** | `NomusAccountsReceivable` |
| **Service** | `financeAccountsReceivableDashboard.ts`, `financeCashFlowDashboard.ts`, `financeCashFlowLedger.ts` |
| **Endpoint de carga** | Indireto via `GET /api/finance/cash-flow/dashboard` (`prisma.nomusAccountsReceivable.findMany`) |
| **Conceito** | Títulos a receber / já recebidos (caixa) |

**Campos principais usados no fluxo:**

| Campo | Uso |
|-------|-----|
| `balanceReceivable` | Saldo em aberto; **previsto** (`projected`) |
| `amountReceived` | Valor já recebido; **realizado** (`realized`) |
| `amountReceivable` | Valor nominal do título (carteira YTD, contexto) |
| `dueDate` | Data de vencimento — data de movimento no **previsto** |
| `settlementDate` | Data de baixa/liquidação — data de movimento no **realizado** |
| `competenceDate` | Data de emissão/competência — alternativa se `dateBase=issue` |
| `sourceInvoiceId`, `sourceInvoiceNumber` | Origem Com NF / Sem NF |
| `suspendCollection` | Exclui do previsto se cobrança suspensa |
| `status` (Nomus) | Armazenado como `nomusStatus`; aberto/fechado derivado de `balanceReceivable` |

**Regra de aberto:** `isFinanceArOpen(row)` ⇔ `balanceReceivable > 0`.

### 2.2 Contas a Pagar

| Item | Detalhe |
|------|---------|
| **Nome** | Contas a Pagar Nomus |
| **Model Prisma** | `NomusAccountsPayable` |
| **Service** | `financeAccountsPayableDashboard.ts`, `financeCashFlowDashboard.ts`, `financeCashFlowLedger.ts` |
| **Endpoint** | Via `GET /api/finance/cash-flow/dashboard` |
| **Conceito** | Obrigações a pagar / já pagas (caixa) |

**Campos principais:**

| Campo | Uso |
|-------|-----|
| `balancePayable` | Saldo em aberto — **previsto** |
| `amountPaid` | Valor pago — **realizado** |
| `amountPayable` | Valor nominal (carteira YTD) |
| `dueDate` | Vencimento — previsto |
| `paymentDate` ?? `settlementDate` | Liquidação — realizado (prioriza `paymentDate`) |
| `competenceDate` | Se `dateBase=issue` |
| `suspendPayment` | Exclui do previsto |
| `documentNumber`, `sourceInvoiceId` | Documento (não usado no filtro “origem NF” do fluxo) |

**Regra de aberto:** `isFinanceApOpen(row)` ⇔ `balancePayable > 0`.

### 2.3 Faturamento

| Item | Detalhe |
|------|---------|
| **Model** | `NomusNfe`, `SalesOrder` (módulo Faturamento) |
| **Entra no cálculo do fluxo?** | **Não** |
| **Relação indireta** | Título AR pode referenciar NF via `sourceInvoiceId` / `sourceInvoiceNumber` (filtro “Com NF”) |

---

## 3. Filtros da tela

Filtros em `FinanceCashFlowPage` → query `buildFinanceCashFlowDashboardQuery` → `parseFinanceCashFlowDashboardFilters` → `buildFinanceCashFlowDashboard`.

| Filtro (UI) | Parâmetro API | Valores | AR | AP | Faturamento | Fluxo |
|-------------|---------------|---------|----|----|-------------|-------|
| **Ano** | `year` | 4 dígitos | Limita escopo por vencimento/liquidação | Idem | Não afeta | Define `seriesYear` e bounds do período |
| **Mês** | `month` | 1–12 ou vazio | Idem | Idem | Não afeta | Exige ano; filtra bucket mensal |
| **Empresa** | `companyName` | texto | `companyName` contains | Idem | — | Portfolio + período |
| **Visão** | `viewMode` | `projected` \| `realized` \| `combined` | Define fatia previsto/realizado | Idem | — | Motor central em `financeCashFlowLedger.ts` |
| **Data base** | `dateBase` | `due` \| `settlement` \| `issue` | Data do movimento no previsto | Idem | — | Realizado ignora (força `settlement` na UI) |
| **Status** | `status` | `all` \| `open` \| `settled` \| `overdue` | `classifyFinanceArTitle` | `classifyFinanceApTitle` | — | Portfolio |
| **Cliente** | `customerName` | texto | `personName` | — | — | Só entradas |
| **Fornecedor** | `supplierName` | texto | — | `personName` | — | Só saídas |
| **CNPJ/CPF** | `personCnpj` | texto | Ambos lados | Ambos | — | Portfolio |
| **Forma pagamento** | `paymentMethodName` | texto | Sim | Sim | — | Portfolio |
| **Conta bancária** | `bankAccountName` | texto | Sim | Sim | — | Portfolio |
| **Origem do recebível** | `invoiceIssued` | `all` \| `yes` \| `no` | `hasFinanceArSourceInvoice` | **Não aplica** | — | Só AR |

**Modos de visão (detalhe):**

- **Previsto (`projected`)** — default; `dateBase` default `due`.
- **Realizado (`realized`)** — UI desabilita data base e usa liquidação; `normalizeFinanceCashFlowUiFilters` força `dateBase: settlement`.
- **Realizado + Previsto (`combined`)** — processa fatias `projected` e `realized` sem duplicar o mesmo saldo (título aberto entra no previsto; recebido/pago com data entra no realizado).

**Origem do recebível:**

- **Tudo** — sem filtro extra.
- **Com NF** — `sourceInvoiceId != null` OU `sourceInvoiceNumber` preenchido.
- **Sem NF** — ausência dos dois.
- Classificação: `classifyFinanceArReceivableOrigin` → `WITH_NFE` \| `WITHOUT_NFE` (sem `UNKNOWN` explícito).
- Deduplicação: se mesmo cliente+vencimento+valor tem versão com e sem NF, **mantém com NF** (`deduplicateFinanceArRows`).

---

## 4. Cards / KPIs da tela

### 4.0 Visão executiva anual (`executiveSummary` — topo da tela)

Bloco principal em `FinanceCashFlowExecutiveSummaryPanel`. Independente do **mês** filtrado para métricas anuais; o recorte **Período filtrado** espelha `cards.inflowAmount` / `outflowAmount` / `netFlowAmount`.

| Card (UI) | Campo | Conceito | Fórmula | Fonte | Data |
|-----------|-------|----------|---------|-------|------|
| **Recebido YTD** | `receivable.receivedYtd` | Caixa já recebido no ano | `SUM(amountReceived)` | `NomusAccountsReceivable` | `settlementDate` 01/01 → corte |
| **A receber até 31/12** | `receivable.openFromTodayToYearEnd` | Saldo em aberto futuro no ano | `SUM(balanceReceivable)` | AR | `dueDate` hoje → 31/12 |
| **Estimativa AR do ano** | `receivable.estimatedYearTotal` | Entrada total estimada | Recebido YTD + A receber até 31/12 | AR | Misto |
| **Pago YTD** | `payable.paidYtd` | Caixa já pago no ano | `SUM(amountPaid)` | `NomusAccountsPayable` | `paymentDate` ?? `settlementDate` |
| **A pagar até 31/12** | `payable.openFromTodayToYearEnd` | Saldo em aberto futuro no ano | `SUM(balancePayable)` | AP | `dueDate` hoje → 31/12 |
| **Estimativa AP do ano** | `payable.estimatedYearTotal` | Saída total estimada | Pago YTD + A pagar até 31/12 | AP | Misto |
| **Saldo realizado YTD** | `net.realizedYtd` | Caixa líquido realizado | Recebido YTD − Pago YTD | AR + AP | Liquidação |
| **Saldo projetado restante** | `net.projectedRemaining` | Fluxo futuro no ano | A receber até 31/12 − A pagar até 31/12 | AR + AP | Vencimento |
| **Estimativa líquida anual** | `net.estimatedYearNet` | Resultado anual previsto | Estimativa AR − Estimativa AP | AR + AP | Misto |

**Período filtrado** (`executiveSummary.period`): espelha `cards` — entradas/saídas/saldo/acumulado do recorte mês/ano conforme `viewMode`.

**Linha do tempo mensal** (`executiveSummary.monthlyTimeline`): por mês — recebido, a receber (aberto por vencimento), entradas estimadas, pago, a pagar, saídas estimadas, saldo líquido, acumulado.

**Ano passado:** quando `hoje > 31/12` do ano selecionado, `openFromTodayToYearEnd` = 0 (sem projeção futura).

**Origem Com NF / Sem NF:** afeta apenas AR (`invoiceIssued`).

**Service:** `buildFinanceCashFlowExecutiveSummary` (`financeCashFlowExecutiveSummary.ts`).

### 4.1 Visão Geral — KPIs do período (`cards` / `executiveSummary.period`)

| Card (UI) | Campo | Conceito | Fórmula | Fonte | Conferência AR/AP |
|-----------|-------|----------|---------|-------|-------------------|
| **Entradas do período** | `inflowAmount` | Caixa entrada no período | `SUM` movimentos AR no período (série mensal) | `buildFinanceCashFlowMonthlySeries` | Modo previsto: ≈ AR em aberto no período; realizado: ≈ recebido por `settlementDate` |
| **Saídas do período** | `outflowAmount` | Caixa saída | Idem AP | Idem | Modo previsto: ≈ AP em aberto; realizado: ≈ pago |
| **Saldo líquido** | `netFlowAmount` | Resultado do período | `inflowAmount − outflowAmount` | `sumPeriodAmounts` | `netCashFlow` na reconciliação |

Exibidos no bloco **Período filtrado** do painel executivo (`data-testid="cash-flow-executive-summary"`).

### 4.2 Carteira e posição (payload `cards` — usados em painéis YTD, risco, CFO)

| Card / métrica | Campo | Conceito | Fórmula |
|----------------|-------|----------|---------|
| Recebíveis em aberto (escopo) | `totalReceivableOpen` | Saldo aberto AR nas linhas filtradas | `SUM(balanceReceivable)` onde `isFinanceArOpen` |
| Pagáveis em aberto (escopo) | `totalPayableOpen` | Saldo aberto AP | `SUM(balancePayable)` onde `isFinanceApOpen` |
| Posição líquida carteira | `netCashPosition` | Superávit/déficit projetado | `totalReceivableOpen − totalPayableOpen` |
| Status posição | `netCashPositionStatus` | `surplus` \| `deficit` | Sinal de `netCashPosition` |
| Cobertura de caixa | `cashCoverageRatio` | AR aberto / AP aberto | `totalReceivableOpen / totalPayableOpen` (null se AP=0 e AR>0) |
| Necessidade de caixa | `cashNeedAmount` | Para zerar déficit | `abs(netCashPosition)` se déficit; senão 0 |
| Vencidos a receber | `overdueReceivableAmount` | AR aberto vencido | `SUM(balanceReceivable)` status `overdue` |
| Vencidos a pagar | `overduePayableAmount` | AP aberto vencido | Idem |
| Impacto vencidos | `overdueCashImpact` | Pressão de caixa vencida | `overdueReceivable + overduePayable` |
| Saídas / entradas % | `outflowToInflowPercent` | Dependência de entrada | `outflow/inflow × 100` |
| Meses saldo negativo | `negativeBalanceMonthsCount` | Meses com líquido < 0 | Contagem na série filtrada |
| Saldo acumulado | `accumulatedBalance` | Fluxo acumulado no ano | Soma cumulativa de `netFlowAmount` mês a mês |
| Registros AR/AP | `arRecords`, `apRecords` | Linhas no escopo | `filteredAr.length`, `filteredAp.length` |
| Última sync | `lastSyncAt` | MAX `syncedAt` no escopo | Não é sync global Nomus |

**Service:** `buildFinanceCashFlowDashboard` → `buildNetCashPositionMetrics` (`financeCashFlowIntelligence.ts`).

### 4.3 Bloco YTD (`executiveYtd`)

Independente do **mês** filtrado (`buildYtdDashboardFilters` remove `month`). Inclui:

- Carteira YTD (aberto, vencidos, meses negativos).
- **Recebido YTD** por `settlementDate` (`buildYtdReceivedComparison`) — comparativo com mesmo intervalo ano anterior.
- Totais carteira: `totals.receivable` / `totals.payable` (nominal, recebido/pago, aberto).

### 4.4 CFO / Risco

| Métrica | Origem |
|---------|--------|
| Score de saúde 0–100 | `buildCashHealthScore` |
| Alertas / oportunidades / ações | `buildCashFlowExecutiveInsights` |
| Necessidade conservadora / crítica | `buildConservativeScenario`, `buildStressScenario` |
| Horizontes 3/6/12 meses | `cashForecast.horizons` |

---

## 5. Gráficos

### 5.1 Fluxo mensal — `FinanceCashFlowMonthlyChart`

| Item | Valor |
|------|-------|
| **Nome UI** | Posição Líquida Mensal — Receber x Pagar |
| **Eixo X** | `monthLabel` (Jan–Dez) |
| **Séries** | Barras: `inflowAmount` (verde), `outflowAmount` (vermelho); linha: `accumulatedBalance` |
| **Fórmula** | Por mês: entradas/saídas conforme `viewMode`; líquido = entradas − saídas; acumulado = soma cumulativa |
| **Granularidade** | Mensal, ano = filtro ano ou ano corrente |
| **Modo realizado** | Meses futuros: valores `null` (sem projeção) |

**Nota:** Tooltip exibe “A receber” / “A pagar”, mas os valores são **movimentos do período** (`inflowAmount`/`outflowAmount`), não carteira aberta — ver inconsistência INC-01.

### 5.2 Cenários — `FinanceCashFlowScenarioChart`

| Série | Origem |
|-------|--------|
| Base | `cashForecast.monthlyPoints.projectedNet` |
| Conservador | Fator 80% recebíveis abertos + 50% vencidos AR |
| Crítico (stress) | Fator 60% / 30% + +10% despesas AP |

### 5.3 Calendário — `FinanceCashFlowCalendar`

| Item | Valor |
|------|-------|
| **Granularidade** | Diária no mês filtrado (ou mês de referência) |
| **Campos** | `dailyCalendar[]`: `inflowAmount`, `outflowAmount`, `netAmount` |
| **Service** | `buildCashFlowDailyCalendar` |

### 5.4 YTD tendência — `FinanceCashFlowYtdSummary` / gráfico embutido

Série `executiveYtd.trend.monthlyNetSeries` + séries de recebido acumulado por liquidação.

---

## 6. Tabelas / listagens

| Listagem | Conteúdo | Colunas principais | Ordenação |
|----------|----------|-------------------|-----------|
| Maiores entradas previstas | `largestProjectedInflows` | cliente, valor, vencimento, atraso | Valor DESC, top 10 |
| Maiores saídas previstas | `largestProjectedOutflows` | fornecedor, valor, vencimento | Idem |
| Vencidos a receber | `overdueReceivables` | Idem | Idem |
| Pagamentos vencidos | `overduePayables` | Idem | Idem |
| Top clientes | `topCustomers` | nome, valor aberto, % carteira | Valor DESC |
| Top fornecedores | `topSuppliers` | Idem | Idem |
| Detalhado (`FinanceCashFlowDetailTable`) | União críticos inflow/outflow | lado, pessoa, datas, valor | Na overview |
| Abas futuras | `accumulated`, `detailed`, `inflows`, `outflows` | — | **Desabilitadas** (fase posterior) |

**Paginação:** não há — listas truncadas (top 5–10 na UI).

**Exportação:** ver seção 15.

---

## 7. Bloco de conciliação

**Componentes:** `FinanceCashFlowReconciliationPanel`, `buildCashFlowReconciliation` (`financeCashFlowLedger.ts`), `buildFinanceCrossModuleReconciliation` (`financeCrossModuleReconciliation.ts`).

### O que compara

| Linha | Fluxo | Referência | OK quando |
|-------|-------|------------|-----------|
| Entradas | `cards.inflowAmount` | `ledgerPeriod.inflow` | `|delta| < 0,01` |
| Saídas | `cards.outflowAmount` | `ledgerPeriod.outflow` | Idem |
| Saldo líquido | `netCashFlow` | `ledger.inflow − ledger.outflow` | Idem |
| Carteira AR | `totalReceivableOpen` | `arDash.cards.totalOpenAmount` | Idem |
| Carteira AP | `totalPayableOpen` | `apDash.cards.totalOpenAmount` | Idem |

### Fórmulas

```
deltaVsLedger (entradas) = cashFlowInflow − ledgerInflow
deltaOpenVsAr = cashFlowOpenPortfolio − arDashboardOpen
deltaOpenVsAp = cashFlowOpenPortfolio − apDashboardOpen
```

### Alertas automáticos (`notes`)

- Divergência interna cards × ledger.
- Carteira fluxo × dashboard AR/AP.
- Modo realizado: card “Recebido” do AR pode divergir (AR filtra por vencimento; fluxo usa `settlementDate`).
- Títulos em aberto sem `dueDate` não entram no fluxo do período previsto.

**Faturamento:** mencionado apenas como contexto excluído.

---

## 8. Modo Previsto (`viewMode=projected`)

| Regra | Implementação |
|-------|---------------|
| Entradas | `balanceReceivable` de títulos com `isFinanceArOpen`, não suspensos, valor > 0 |
| Data | `dueDate` (ou `competenceDate` se `dateBase=issue`) |
| Saídas | `openAmount` saneado (`resolveFinanceApOpenAmount`), não `suspendPayment` |
| Data AP | `dueDate` / competência |
| Status excluídos | Liquidados e baixas especiais não entram no previsto |
| Vencidos | Entram com saldo em aberto; classificação `overdue` separada nos KPIs |
| Sem data | Sem `dueDate` (previsto): **não entra no movimento do período** |
| Zerados | `amount <= 0` ignorados |

---

## 9. Modo Realizado (`viewMode=realized`)

| Regra | Implementação |
|-------|---------------|
| Entradas | `amountReceived > 0` **e** `settlementDate != null` |
| Data AR | Liquidação (UI força `dateBase=settlement`) |
| Saídas | `realizedAmount` saneado (`resolveFinanceApRealizedAmount`) com data efetiva (`resolveFinanceApEffectivePaymentDate`) |
| Data AP | Pagamento/liquidação; **baixas sem numerário/forçadas usam `dueDate`** |
| Parciais | Valor pago parcial em `realizedAmount`; saldo remanescente no previsto via `openAmount` |
| Meses futuros | Série mensal com `null` (sem dados futuros) |

---

## 10. Modo Realizado + Previsto (`viewMode=combined`)

| Regra | Implementação |
|-------|---------------|
| Fatias | `cashFlowViewModeSlices` → `["projected", "realized"]` |
| Anti-duplicidade | Mesmo título: parte realizada soma em `realizedAmount`; saldo aberto soma em `openAmount` — não soma nominal duas vezes |
| Saldo período | Soma das duas fatias no bucket mensal |
| Parcial | Pode aparecer nas duas fatias (recebido histórico + saldo futuro) |

---

## 11. Origem do recebível

| Filtro | Identificação |
|--------|---------------|
| **Com NF** | `hasFinanceArSourceInvoice` |
| **Sem NF** | Sem `sourceInvoiceId` e sem `sourceInvoiceNumber` |
| **Deduplicação** | `deduplicateFinanceArRows` — prefere `WITH_NFE` |
| **Escopo** | Apenas entradas (AR); AP não tem este filtro |

---

## 12. Fórmulas principais (referência código)

```
// Ledger — financeCashFlowLedger.ts
Entradas previstas (linha)     = balanceReceivable  (se aberto, não suspenso)
Entradas realizadas (linha)    = amountReceived     (se > 0 e settlementDate)
Saídas previstas (linha)       = balancePayable
Saídas realizadas (linha)      = amountPaid

Entradas período               = SUM(entradas linha) no ano/mês da data de movimento
Saídas período                 = SUM(saídas linha)   idem
Saldo líquido período          = Entradas período − Saídas período
Saldo acumulado (mês M)        = Σ Saldo líquido (jan..M) no ano da série

Carteira AR aberta (escopo)    = SUM(balanceReceivable) linhas filtradas abertas
Carteira AP aberta (escopo)    = SUM(balancePayable)
Posição líquida carteira       = Carteira AR − Carteira AP

Cenário conservador inflow     = inflow × fator (80% aberto, 50% vencido AR)
Cenário stress                 = 60% / 30% + AP × 1,1
```

---

## 13. Regras de negócio

1. Faturamento / NF-e de vendas **não** alimenta fluxo.
2. Aberto = saldo saneado (`openAmount` via `financeAccountsPayableRules.ts`).
3. Cancelados/liquidados (saldo ≤ 0) não entram no **previsto**.
4. Realizado exige data de liquidação preenchida.
5. Previsto usa vencimento (default) ou competência.
6. Origem Com/Sem NF afeta **somente AR**.
7. Fluxo usa **valores financeiros**, não contagem de títulos nos KPIs principais.
8. Exportação e cards usam o mesmo `buildFinanceCashFlowDashboard`.
9. Saneamento gerencial remove intercompany, fantasma, agenda PC (AP).
10. Deduplicação AR evita dobrar pedido sem NF + título com NF.
11. `combined` soma previsto + realizado sem duplicar nominal.
12. YTD ignora filtro de mês.
13. Sem saldo bancário inicial (`hasInitialBankBalance: false`).

### Regra de Contas a Pagar no Fluxo de Caixa

Fonte única: `src/lib/financeAccountsPayableRules.ts` (`normalizeAccountsPayableTitle`).

| Situação | Data efetiva | Valor realizado | Em aberto |
|----------|--------------|-----------------|-----------|
| AP normal pago | `paymentDate` → `settlementDate` → `dueDate` | `amountPaid` (ou `amountPayable` se baixado sem valor pago) | 0 |
| AP em aberto | `dueDate` (previsto) | 0 | `balancePayable` |
| Baixa sem numerário / forçada | **`dueDate` obrigatoriamente** | `amountPaid > 0` ? `amountPaid` : `amountPayable` | 0 |
| Cancelado (`CANCELLED`, `CANCELADO`, `ERROR`, …) | — | excluído das métricas | excluído |

O Fluxo de Caixa (`financeCashFlowLedger.ts`, resumo executivo, YTD, CFO) consome os helpers `resolveFinanceApEffectivePaymentDate`, `resolveFinanceApRealizedAmount` e `resolveFinanceApOpenAmount` — mesma regra da tela Contas a Pagar.

---

## 14. Regras de saneamento

| Regra | Função |
|-------|--------|
| Intercompany (Lazarios, Koppetel, SM) | `isFinanceInternalGroupPerson` |
| Título fantasma AR | `isFinanceArGhostTitle` |
| Agenda pedido compra AP | `isFinanceApPurchaseOrderAgenda` |
| Baixa sem numerário / forçada AP | `normalizeAccountsPayableTitle` / `detectApSettlementKind` |
| Pré-NF substituída | `deduplicateFinanceArRows` |
| NaN/Infinity | `roundMoney`, `safeRatio`, `financeCashFlowMetricsAreFinite` |
| Valores negativos em movimento | Ignorados se `amount <= 0` |
| Contagem exibida | `dataSanitization` / `FinanceManagementSanitizationNote` |

---

## 15. Exportação

| Item | Detalhe |
|------|---------|
| **Endpoint** | `GET /api/finance/cash-flow/export?format=csv&…` |
| **Função** | `buildFinanceCashFlowExportCsv` |
| **Arquivo** | `fluxo-caixa-{ano}-{data}.csv` |
| **Colunas mensais** | tipo, ano, mês, entradas, saídas, fluxo_liquido, saldo_acumulado, status_mes, qtd_entradas, qtd_saidas, cenários |
| **Linhas extras** | necessidade_caixa, horizonte_12m, conferencia_entradas/saidas/saldo |
| **Filtros** | Mesmos do dashboard (`buildFinanceCashFlowExportQuery`) |
| **Bate com tela** | Sim — mesmo payload |

---

## 16. Endpoints

| Método | Rota | Parâmetros | Service | Uso na tela |
|--------|------|------------|---------|-------------|
| GET | `/api/finance/cash-flow/dashboard` | Query: filtros seção 3 | `loadCashFlowRows` + `buildFinanceCashFlowDashboard` | Carregamento principal |
| GET | `/api/finance/cash-flow/export` | Idem + `format=csv` | Idem + `buildFinanceCashFlowExportCsv` | Botão Exportar |

**Permissões:** `financeCashFlowPermissions.ts` — view: `finance.view`, `finance.accountsReceivable.view`, `finance.accountsPayable.view`, etc.; export: inclui `.export`.

**AR/AP standalone (conferência manual):**

- `GET /api/finance/accounts-receivable/dashboard` (e export)
- `GET /api/finance/accounts-payable/dashboard` (e export)

---

## 17. Como validar manualmente

### Previsto + mês + Tudo

1. AR → ano/mês, status aberto → anotar **Em aberto** (`totalOpenAmount`).
2. AP → mesmo período → **Em aberto**.
3. Fluxo → Visão **Previsto**, mesmo ano/mês, Origem **Tudo**.
4. Conferir: **Entradas** ≈ AR em aberto do período; **Saídas** ≈ AP em aberto; **Saldo** = diferença.
5. Painel **Conferência do período** → badges “Conferido”.

### Realizado

1. AR → filtrar títulos baixados no mês (ou usar card recebido com atenção à data).
2. Fluxo → **Realizado**, mesmo mês.
3. Entradas ≈ soma `amountReceived` com `settlementDate` no mês (entre linhas do escopo).

### Realizado + Previsto

1. Escolher mês com títulos abertos e baixados.
2. Fluxo → **Realizado + Previsto**.
3. Entradas = recebidos no mês + saldos abertos com vencimento no mês (sem dobrar nominal).

### Com NF / Sem NF

1. Fluxo → Origem **Com NF** → comparar com AR com filtro NF emitida = sim.
2. Repetir **Sem NF**.

### Pós-remoção de filtros

1. Limpar filtros → totais devem ampliar escopo.
2. Exportar CSV e comparar soma `entradas` com tela.

---

## 18. Inconsistências encontradas

| ID | Descrição | Arquivo | Impacto | Esperado | Atual | Correção | Prioridade |
|----|-----------|---------|---------|----------|-------|----------|------------|
| INC-01 | Tooltip do gráfico mensal diz “A receber” / “A pagar” mas plota movimentos do período | `FinanceCashFlowCharts.tsx` | Interpretação errada no modo realizado | Rótulos “Entradas” / “Saídas” | “A receber” / “A pagar” | Ajustar labels do tooltip | P2 |
| INC-02 | Modo realizado: card Recebido do AR usa critério de vencimento; fluxo usa `settlementDate` | `financeCashFlowLedger.ts` / AR dashboard | Divergência esperada documentada em `reconciliation.notes` | Alinhar ou documentar na UI AR | Nota só no painel conferência | Tooltip no AR ou KPI alinhado | P1 |
| INC-03 | Abas Acumulado, Detalhado, Entradas, Saídas desabilitadas | `FinanceCashFlowPage.tsx` | UX incompleta | Abas funcionais | `PHASE1_FINANCE_CASH_FLOW_TABS` | Implementar fase 2 | P2 |
| INC-04 | `totalReceivableOpen` no fluxo é carteira das **linhas no escopo do período**, não carteira global | `financeCashFlowDashboard.ts` | Usuário pode comparar com AR sem mesmo escopo | Documentar / rotular “no escopo” | Label genérico “carteira” | Clarificar UI | P1 |
| INC-05 | Reconciliação cross-module em `combined` não exige igualdade inflow=AR open | `financeCrossModuleReconciliation.ts` | Validação parcial | Regra explícita combined | Só ledger | Documentar + testes | P2 |

---

## 19. Melhorias recomendadas

| ID | Melhoria | Prioridade |
|----|----------|------------|
| M-01 | Tooltip em cada KPI com fórmula e campos (`FinanceCashFlowKpiCard.hint` expandido) | P1 |
| M-02 | Botão “Como este número é calculado” abrindo drawer com fórmula | P1 |
| M-03 | Conferência AR/AP sempre visível (já na overview — manter) | — |
| M-04 | Exportação com aba/linha de metadados de fórmulas | P2 |
| M-05 | Legenda fixa: Caixa ≠ Faturamento (`FINANCE_CASH_FLOW_NOT_BILLING_SCOPE` mais destacado) | P1 |
| M-06 | Habilitar abas Detalhado / Entradas / Saídas com drill-down por título | P2 |
| M-07 | Integração futura saldo bancário (`hasInitialBankBalance`) | P3 |
| M-08 | Ícone de origem Nomus + timestamp sync por card | P3 |

---

## 20. Entrega final — mapa resumido

### Arquivos analisados

**UI:** `FinanceCashFlowPage.tsx`, `FinanceCashFlowCharts.tsx`, `FinanceCashFlowReconciliationPanel.tsx`, `FinanceCashFlowKpiCard.tsx`, `FinanceCashFlowCalendar.tsx`, `FinanceCashFlowCfoPanel.tsx`, `FinanceCashFlowYtdSummary.tsx`, `FinanceCashFlowRiskTab.tsx`, `FinanceCashFlowDetailTable.tsx`, `FinanceCashFlowScenarioChart.tsx`, `FinanceCashFlowCashNeedPanel.tsx`, `FinanceCashFlowRecommendations.tsx`, componentes `bi/*`.

**Lib:** `financeCashFlowDashboard.ts`, `financeCashFlowDashboardTypes.ts`, `financeCashFlowLedger.ts`, `financeAccountsPayableRules.ts`, `financeCashFlowRowFilters.ts`, `financeCashFlowForecast.ts`, `financeCashFlowCfoDiagnostics.ts`, `financeCashFlowExecutiveYtd.ts`, `financeCashFlowIntelligence.ts`, `financeCashFlowExport.ts`, `financeCashFlowRoutes.ts`, `financeCashFlowDisplay.ts`, `financeCrossModuleReconciliation.ts`, `financeAccountsReceivableDashboard.ts`, `financeAccountsPayableDashboard.ts`, `financeAccountsReceivableDeduplication.ts`, `financeInternalGroupExclusions.ts`, `financeFilterScope.ts`.

**Testes:** `financeAccountsPayableRules.test.ts`, `financeCashFlowDashboard.test.ts`, `financeCashFlowReconciliation.test.ts`, `financeCrossModuleReconciliation.test.ts`, `financeCashFlowForecast.test.ts`, `financeCashFlowCfoDiagnostics.test.ts`, `financeCashFlowExport.test.ts`, `financeCashFlowValidation.test.ts`, `financeCashFlowPageFilters.test.ts`.

### Pipeline de dados (resumo)

```
Nomus sync → Prisma (AR/AP)
  → GET /api/finance/cash-flow/dashboard
  → parseFinanceCashFlowDashboardFilters
  → loadCashFlowRows (Prisma where + map)
  → filterCashFlowArRowsScoped / filterCashFlowApRowsScoped
  → buildFinanceCashFlowDashboard
  → FinanceCashFlowPage (tabs, KPIs, gráficos, reconciliação)
```

---

*Documento gerado por auditoria de código. Regras financeiras não foram alteradas.*
