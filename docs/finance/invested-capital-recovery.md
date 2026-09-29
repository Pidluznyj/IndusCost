# Financeiro › Recuperação do Dinheiro Investido

Tela analítica **somente leitura** que responde, pedido a pedido e no consolidado, quanto do dinheiro
desembolsado nos Pedidos de Venda já voltou, quanto ainda está na rua e quanto do que entrou (ou vai entrar)
é retorno de capital ou ganho. Backend é autoridade: a tela e o PDF só enviam filtros e renderizam o DTO.

Referenciado por `src/lib/finance/salesOrderInvestedCapitalRecoveryMath.ts` e `…Snapshot.ts`.

## 1. Fontes oficiais (nada é recalculado aqui)

| Conceito | Fonte | Onde |
|---|---|---|
| População de PVs + custo industrial oficial | `loadSalesOrderIndustrialResultReportPayload` com `excludeEconomicGroupCustomers: true` (Lazarios/Koppetel/SM nunca entram) | `salesOrderInvestedCapitalRecoveryService.server.ts` |
| Vendido (`saleValue`) | `SalesOrder.totalNetValue` → `orderCommercialValue` | idem |
| Imposto | `calculateOfficialSalesOrderMarginsForOrders(...).marginSummary.taxAmount` (motor oficial de margem, com fallback na regra fiscal padrão) | idem |
| Recebido (`actualReceived`) | Σ `amountReceived` dos CR **reais** vinculados ao PV (`loadFinanceArManagementRowsFromPrisma` + `filterFinanceArOperationalPortfolioRows` + vínculo NF-e/pista). Nunca previsão, CR aberto ou NF | `…Snapshot.ts` |
| Falta receber (`outstandingReceivable`) | Σ `balanceReceivable` dos mesmos CR reais | idem |
| Status econômico | `computeInvestedCapitalRecoveryStatus` (SEM_RECUPERACAO / EM_RECUPERACAO / CAPITAL_RECUPERADO / DADOS_INSUFICIENTES) | `…Math.ts` |

`economicStatus` filtra a população inteira no servidor: cards, aging, top clientes, por cliente e tabela
refletem sempre a mesma população.

## 2. Capital investido e "capital válido"

- `investedCapital = round(custoIndustrialOficial + imposto)` só quando `costSourceStatus === "OK"`; senão `null`
  (DADOS_INSUFICIENTES, motivo preservado).
- **Capital válido** = `isValidInvestedCapital` (`> 0`). É a ÚNICA definição usada por status, KPIs de capital,
  totais comparáveis e agregação por cliente. Capital `0` não é "capital de zero": é dado insuficiente.
- **Decomposição custo + imposto** (`resolveInvestedCapitalComponents`): o imposto do motor de margem tem até
  6 casas. Ele é levado a centavos ANTES da subtração sobre o capital já arredondado, e o custo exibido é
  `capital − impostoCentavos`. Assim `industrialCost + totalTaxes === investedCapital` por PV e nos totais.
  (Antes, custo e imposto eram arredondados separadamente e, com fração exata de meio centavo — ex.: 12,5% de
  R$ 100,20 = 12,525 —, a soma ficava um centavo acima do capital.) O `investedCapital` em si não mudou.

## 3. Decomposição econômica por PV (matemática pura, centavos)

| Campo | Fórmula | Null quando |
|---|---|---|
| `capitalRecovered` | `MIN(recebido, capital)` | capital inválido |
| `moneyOnStreet` | `MAX(capital − recebido, 0)` | capital inválido |
| `realizedGain` | `MAX(recebido − capital, 0)` | capital inválido |
| `economicMargin` | `vendido − capital` (**pode ser negativa**) | capital inválido |
| `capitalReceivableCovered` | `MIN(faltaReceber, moneyOnStreet)` | capital inválido |
| `gainReceivable` | `MAX(faltaReceber − moneyOnStreet, 0)` | capital inválido |
| `capitalWithoutOpenReceivable` | `MAX(moneyOnStreet − faltaReceber, 0)` | capital inválido |

Ausência de custo nunca vira ganho: sem capital válido, todos os campos acima são `null`, e o recebido/CR aberto
desse PV continua contado apenas nos totais gerais.

Casos de referência (venda 100 / capital 60): recebido 75 e CR 25 → recuperado 60, ganho 15, na rua 0,
capital no CR 0, ganho a receber 25, sem CR 0, margem 40. Recebido 30 e CR 70 → 30 / 0 / 30 / 30 / 40 / 0 / 40.
Recebido 10 e CR 20 → 10 / 0 / 50 / 20 / 0 / 30 / 40. Capital 110, recebido 60, CR 40 → margem −10, recuperado 60,
na rua 50, capital no CR 40, ganho a receber 0, sem CR 10.

## 4. Totais comparáveis (`salesOrderInvestedCapitalRecoveryTotals.ts`)

Os KPIs históricos somam populações diferentes (venda e falta receber: todos os PVs; capital: só PVs com
capital válido), então `vendido − capital` não é margem de nada. Os totais comparáveis somam, em centavos
inteiros, **só os PVs com capital válido** e fecham entre si:

1. `investedCapitalAnalyzedTotal = capitalRecoveredTotal + moneyOnStreetToday`
2. `actualReceivedComparableTotal = capitalRecoveredTotal + realizedGainTotal`
3. `outstandingReceivableComparableTotal = capitalReceivableCoveredTotal + gainReceivableTotal`
   e `totalOutstandingReceivable = outstandingReceivableComparableTotal + outstandingReceivableUnclassifiedTotal`
4. `moneyOnStreetToday = capitalReceivableCoveredTotal + capitalWithoutOpenReceivableTotal`
5. `comparableSaleValueTotal = investedCapitalAnalyzedTotal + economicMarginTotal`
6. `investedCapitalAnalyzedTotal = totalIndustrialCostAnalyzed + totalTaxesAnalyzed`

`actualReceivedTotal` (todos os PVs) existe à parte, para o rodapé da tabela — nunca é misturado com o
comparável. `capitalRecoveredPercent` / `moneyOnStreetPercent` também vêm do backend. Os KPIs raiz do serviço
usam o mesmo acumulador em centavos (`sum`).

## 5. Por cliente (`salesOrderInvestedCapitalRecoveryByCustomer.ts`)

Só `aggregate(rows)` sobre os snapshots — nenhuma regra própria. Campos: sold, invoiced, industrialCost, taxes,
investedCapital, received, recoveredCapital, capitalAtRisk, realizedGain, potentialResult, **economicMargin,
outstandingReceivable, capitalReceivableCovered, gainReceivable, capitalWithoutOpenReceivable**. Cliente sem
nenhum PV com capital válido devolve `null` nos campos de capital.

## 6. Tela (blocos) e PDF

1. **Economia dos pedidos** — Vendemos · Capital investido · Margem econômica dos PVs · Dados insuficientes;
   fórmulas "Venda comparável = Capital investido + Margem econômica" e "Capital investido = Custo industrial + Imposto".
2. **O que já aconteceu** — Capital recuperado · Ganho já realizado · Total recebido (comparável) · Capital na rua;
   barra "Capital investido = Recuperado + Na rua" com percentuais; fórmula do recebido.
3. **O que ainda tem para entrar** — Falta receber · Capital a recuperar nos recebíveis · Ganho a receber ·
   Capital na rua sem CR aberto; fórmulas do CR aberto (com "Não classificado") e do capital na rua; aging e top clientes.
4. **Leitura gerencial** — Vendemos / Investimos / Capital na rua / Ganho a receber + contagens + prazo médio.
5. **Detalhamento por pedido** — tabela de auditoria com grupos de colunas iguais aos blocos; a linha abre o
   `SalesOrderDetailDialog` oficial.

Componentes nativos: `ExecutiveSummarySection` + `SummaryKpiGrid` + `FinanceExecutiveTotalizerCard`
(`MetricCard`, tons success/warning/danger/info), tooltips `FinanceBiCalcTooltip` com textos em
`financeKpiTooltips.ts` (`FINANCE_KPI_ICR_*`). Nomenclatura: **Margem econômica / Ganho realizado / Ganho a
receber** — nunca "Lucro" (lucro/EBITDA dependem de despesas que esta tela não mede).

O PDF (`InvestedCapitalRecoveryPrintDocument`) repete os blocos, as fórmulas em tabela e o rodapé da tabela com
os totais do DTO. Prazo médio realizado continua `null` até existir evidência canônica de data de saída
(`computeDaysToRecoverCapitalIfKnown`).

## 7. Escopo conhecido

- Aging/previsão usam só CR real em aberto vinculado ao PV (FIN-05 completo não wireado).
- CR carregado numa janela de 3 anos por vencimento (`AR_LOOKBACK_YEARS`).
- `populationDiagnostics` é diagnóstico temporário; falha nele não derruba a rota.

## 8. Testes

`salesOrderInvestedCapitalRecovery{Math,Snapshot,Totals,ByCustomer}.test.ts`, os quatro `*.wiring.test.ts`
(regras fixadas no fonte: filtros draft/applied, exclusão intercompany, imposto, totais e detalhe do pedido) e
`salesOrderInvestedCapitalRecoveryUi.test.tsx` (render estático das seções, do painel por cliente e dos PDFs).
Todos registrados em `scripts/unit-test-files.txt`.
