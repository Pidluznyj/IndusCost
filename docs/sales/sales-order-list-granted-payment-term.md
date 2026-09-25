# Pedidos de Venda — KPI "Prazo médio de recebimento" (2026-09)

## Objetivo

Na tela **Comercial → Pedidos de Venda**, a seção inicial de KPIs deixou de exibir
**Imposto a pagar** e **Custo estimado** e passou a exibir **Prazo médio de
recebimento** (em dias) dos pedidos faturados do filtro atual.

Ordem visual (grid responsivo existente, `SystemTotalizerCard`):

| Sem permissão econômica | Com permissão econômica |
| --- | --- |
| Pedidos filtrados · Valor vendido · Prazo médio de recebimento · Ticket médio | Pedidos filtrados · Valor vendido · Prazo médio de recebimento · Ticket médio · Margem comercial |

Os cálculos de imposto/custo **não** foram removidos do sistema: motor de margem,
`SalesOrderListMarginSummary`, relatórios, abas Custos/Tributos, DRE, comissões e
Gestão de Pedidos continuam iguais. Apenas os dois cards saíram deste overview.

## Histórico da definição

- v1 (2026-09-25, manhã): "Prazo médio concedido" lido apenas de
  `SalesOrder.paymentTerms` (parser fail-closed). Em homologação o card ficou
  "Indisponível": nenhuma condição dos pedidos filtrados era interpretável.
- v2 (2026-09-25): o SLA conta entre a **data de emissão da NF-e** e o **vencimento do
  título do Contas a Receber**; o parser de `paymentTerms` vira fallback.
- v3 (2026-09-25): com "todos os meses" o card mostrava "Cobertura insuficiente 77,4%"
  porque a cobertura era medida sobre todo o valor vendido, e pedidos ainda sem NF-e
  não têm título para medir. Agora **só pedidos faturados** entram na média e na
  cobertura; a participação do faturado no valor vendido é informada à parte.

## Definição

```
prazo do título   = vencimento do título (NomusAccountsReceivable.dueDate)
                    − emissão da NF-e de origem (NomusNfe.xmlDhEmi; fallback dataProcessamento)
prazo do pedido   = Σ (valor do título × prazo do título) ÷ Σ valor dos títulos válidos
prazo médio geral = Σ (SalesOrder.totalNetValue × prazo do pedido) ÷ Σ totalNetValue dos pedidos
                    faturados resolvidos
```

- Cadeia canônica (a mesma do filtro "Status CR" e do cronograma de pagamento da
  exportação): `SalesOrder → SalesOrderNfeLink` (só NF-e válidas: processadas e não
  canceladas) `→ NomusNfe.xmlDhEmi` e `NomusAccountsReceivable.sourceInvoiceId`.
- **Faturado** = pedido com ao menos uma NF-e válida (mesma regra do filtro "Com NF").
  Pedidos sem NF-e não entram na média nem na cobertura (não há recebimento a medir);
  aparecem em `notInvoicedOrders` / `notInvoicedSalesAmount` e no rodapé do card
  ("Faturado: 77,4% do valor vendido").
- Peso entre pedidos **obrigatoriamente** por `SalesOrder.totalNetValue > 0`
  (nunca média simples, nunca `abs()`; zero/negativo fica em `zeroOrNegativeOrders`).
- Título válido: tem vencimento e emissão da NF-e, valor (`amountReceivable`) > 0,
  prazo ≥ 0 e ≤ 730 dias. Títulos inválidos são ignorados e contados em `titlesIgnored`.
- Pedido faturado sem título válido: usa `SalesOrder.paymentTerms` quando interpretável
  (`30/60` → 45; `À vista` → 0). Senão fica fora da média e aparece em
  `unrecognizedTerms` e na cobertura.
- Não usa `settlementDate`, `amountReceived`, atraso ou data real de recebimento.
  `paymentMethod` nunca define prazo.

Exemplo: pedido A (R$ 10.000) com NF emitida em 01/09 e títulos de R$ 5.000 vencendo
em 01/10 e 31/10 → 45 dias; pedido B (R$ 90.000) com título único a 60 dias → 60;
pedido C (R$ 50.000) ainda sem NF-e → fora da média. Média geral =
(10.000×45 + 90.000×60) ÷ 100.000 = **58,5 dias**, com "Faturado: 66,7% do valor vendido".

## Parser fail-closed (fallback, `parseGrantedPaymentTerm`)

Normalização apenas para comparação: trim, espaços múltiplos, acentos e caixa.

| Entrada | Dias |
| --- | --- |
| `À vista`, `A vista`, `AVISTA`, `0`, `0 dias`, `0 DDL` | 0 |
| `30`, `30 dias`, `30 DDL`, `28 DD` | 30 / 28 |
| `30/60`, `30 / 60`, `30-60`, `30+60` | 45 |
| `30/60/90`, `30-60-90`, `30 + 60 + 90`, `30/60/90 dias` | 60 |

Rejeitado com motivo: `MISSING` (vazio), `AMBIGUOUS_WEIGHTS` (`50% entrada + 50% 30 dias`,
`Entrada + 30/60`, `30 dias + sinal`), `NEGATIVE_DAYS`, `OUT_OF_RANGE` (> 365 dias),
`TOO_MANY_INSTALLMENTS` (> 24), `NON_INCREASING_SEQUENCE` (`30/30`, `60/30`),
`UNRECOGNIZED_FORMAT` (texto livre, `30 dias boleto`, `30 dfm`, `1x30`, `30,60`, `30/60-90`).
Nunca são extraídos números soltos de um texto livre e nunca é produzido `NaN`/`Infinity`.

## Cobertura e qualidade

```
coveragePercent      = valor líquido positivo dos pedidos FATURADOS com prazo resolvido
                       ÷ valor líquido positivo dos pedidos FATURADOS × 100
invoicedSharePercent = valor líquido positivo faturado ÷ valor líquido positivo total × 100
```

| Qualidade | Regra (constantes exportadas) |
| --- | --- |
| `FULL` | cobertura ≥ 95% |
| `PARTIAL` | 80% ≤ cobertura < 95% |
| `LOW` | 0 < cobertura < 80% |
| `UNAVAILABLE` | nenhum pedido faturado resolvido / sem população válida |

A classificação usa o valor exato (sem arredondar); a UI arredonda só para exibir.
`sources` informa quanto do valor faturado foi resolvido por títulos do CR e quanto pela
condição comercial. "Cobertura insuficiente" agora significa problema real de dados
(faturados sem título e sem condição), não ciclo natural de faturamento.

## Comportamento visual (card `sales-order-list-average-payment-term-card`)

| Qualidade | Valor | Subtítulo | Tone |
| --- | --- | --- | --- |
| FULL | `47,8 dias` | `Cobertura: 98,2% do valor faturado` | info |
| PARTIAL | `47,8 dias` | `Cobertura parcial: 89,4% do faturado` | warning |
| LOW | `Cobertura insuficiente` | `Cobertura: 54,1% do faturado` | warning |
| UNAVAILABLE | `Indisponível` | `Sem pedidos faturados no filtro` ou `Sem títulos ou condições de pagamento suficientes` | neutral |
| falha do endpoint | `Indisponível` | `Não foi possível carregar o indicador.` | neutral |

O card tem só valor + um subtítulo, como os demais (v4, 2026-09-25: a linha extra
"Faturado: X% do valor vendido" deixava o card mais alto que os outros e foi para o
tooltip). A faixa de cards usa a mesma altura para todos: o mais alto da linha (label em
duas linhas, badge de margem parcial) define a altura e os demais esticam
(`sales-order-list-summary-cards.css`).

Tooltip (ícone de ajuda), primeiro os números do filtro e depois a metodologia:

```
Faturado: 31,0% do valor vendido (pedidos sem NF-e ainda não entram na média).
Fonte: títulos do CR em 99,5% do valor faturado; condição comercial em 0,3%.
[LOW] Prazo calculado só sobre a parte coberta: 47,8 dias (não confiável).

Dias entre a emissão da NF-e e o vencimento dos títulos do Contas a Receber ...
[PARTIAL/LOW] Pedidos faturados sem título de CR e sem condição interpretável foram excluídos da média.
```

## API

`GET /api/sales-orders/payment-term-summary?<mesma query da listagem>`

- Autorização: `requireAppAuth` + `requireResource("commercial.sales_orders", "view")`
  (mesma da listagem; **não** exige permissão de margem/custo).
- Rota estática registrada em `server.ts` **antes** de `/api/sales-orders/:id`.
- População: `parseSalesOrderListQuery` → `resolveSalesOrderListSellerWhere` →
  `resolveSalesOrderListWhere`; `page`/`pageSize` são ignorados.
- Queries (constantes, sem N+1, sem `nomusRawResponse`/`rawPayload`, read-only):
  1. `salesOrder.findMany({ where, select: { id, totalNetValue, paymentTerms, nfeLinks: { where: NF válida, select: { nfeExternalId, dataProcessamento } } } })`
  2. `nomusNfe.findMany({ where: { externalId: { in } }, select: { externalId, xmlDhEmi, dataProcessamento } })`
  3. `nomusAccountsReceivable.findMany` via `loadSalesOrderListReceivablesByNfeExternalIds` (sourceInvoiceId in, sem rawPayload)

Resposta `{ paymentTermSummary: SalesOrderGrantedPaymentTermSummary }`:

```json
{
  "available": true,
  "weightedAverageDays": 47.84,
  "coveragePercent": 98.2,
  "orderCoveragePercent": 97.1,
  "quality": "FULL",
  "totalOrders": 908,
  "weightedPopulationOrders": 703,
  "coveredOrders": 683,
  "uncoveredOrders": 20,
  "zeroOrNegativeOrders": 2,
  "notInvoicedOrders": 203,
  "notInvoicedSalesAmount": 2726000,
  "positiveSalesAmount": 12064000,
  "invoicedSalesAmount": 9338000,
  "invoicedSharePercent": 77.4,
  "coveredSalesAmount": 9170000,
  "uncoveredSalesAmount": 168000,
  "sources": {
    "receivableTitles": { "orders": 680, "salesAmount": 9120000, "salesSharePercent": 97.7, "weightedAverageDays": 47.9 },
    "commercialTerms": { "orders": 3, "salesAmount": 50000, "salesSharePercent": 0.5, "weightedAverageDays": 38.7 }
  },
  "titlesUsed": 1540,
  "titlesIgnored": 6,
  "source": "NomusAccountsReceivable.dueDate - NomusNfe.xmlDhEmi | SalesOrder.paymentTerms",
  "methodology": "Prazo por título = vencimento do título do Contas a Receber menos a data de emissão da NF-e de origem, ...",
  "unrecognizedTerms": [
    { "paymentTerms": "50% entrada + 50% 30 dias", "orderCount": 4, "salesAmount": 30000, "reason": "AMBIGUOUS_WEIGHTS", "reasonLabel": "Peso das parcelas indeterminado (%, entrada, sinal…)" }
  ]
}
```

`unrecognizedTerms` lista (top 20 por valor vendido) os pedidos faturados sem título válido
e sem condição interpretável, agrupados por texto da condição.

### Série mensal (tela Resultado)

`GET /api/sales-orders/payment-term-monthly?<mesma query da tela Resultado>`

- Mesma autorização e mesmo módulo de rotas do card (rota estática antes de `/:id`).
- 12 meses do ano filtrado × os mesmos 12 meses do ano anterior. Para cada ano, o where
  é o canônico da listagem (`resolveSalesOrderListWhere`) com todos os filtros da tela,
  **exceto Mês**, mais o filtro opcional de produto da tela Resultado (pedidos que
  contêm o produto).
- Mês = emissão do pedido (`SalesOrder.issueDate`), a mesma base do filtro Ano/Mês. Cada
  mês usa exatamente o cálculo do card: o ponto de set/2026 é igual ao card filtrado em
  Ano 2026 + Mês Setembro com os mesmos demais filtros.
- A barra só aparece com qualidade FULL/PARTIAL (mesma regra do card); mês com cobertura
  baixa fica sem barra e o tooltip explica.
- Queries: 2 `salesOrder.findMany` (um por ano) + 1 `nomusNfe.findMany` + 1 títulos para a
  união das NF-e. Sem leitura por pedido, sem raw, read-only.

Resposta `{ paymentTermMonthly: SalesOrderGrantedPaymentTermMonthlySeries }` com `year`,
`previousYear`, `monthBasis`, `rows[12]` (`current`/`previous`: `chartDays`,
`weightedAverageDays`, `quality`, `coveragePercent`, `invoicedSharePercent`, contagens),
`currentYearSummary`, `previousYearSummary`, `periodComparison`, `source` e `methodology`.

### Período selecionado × mesmo período do ano anterior (cards do Resultado)

Dois cards acima do gráfico respondem "no acumulado estamos melhor ou pior?". Vêm no
mesmo endpoint (`periodComparison`), filtrando em memória as mesmas duas populações:
nenhuma consulta extra.

- **Período atual** (datas civis inclusivas, pela emissão do pedido):
  - sem Mês: 01/01 do ano filtrado até a data de referência (`asOfDate` da tela; ausente
    ou inválida = hoje). Ano já encerrado = ano inteiro;
  - com Mês: o mês inteiro; mês em andamento = até a data de referência;
  - período que ainda não começou fica inteiro (sem pedidos = sem número).
- **Ano anterior**: as **mesmas datas** um ano antes (29/02 vira 28/02), mesmos filtros.
- Cada lado usa exatamente o cálculo do card (`computeSalesOrderGrantedPaymentTermSummary`)
  e só mostra número com qualidade FULL/PARTIAL; LOW mostra "Cobertura insuficiente".
- **Delta** = dias do atual − dias do anterior, arredondado a 1 casa (a precisão exibida).
  Menos dias = recebimento mais rápido = **melhor** (selo verde "−5,0 dias vs 2025 ·
  melhor"); mais dias = **pior** (selo vermelho); igual = "Igual a 2025"; sem os dois
  números = "Sem base de comparação".
- Rótulos: "Prazo médio 2026 · acumulado" ou "Prazo médio Set/2026"; "Mesmo período 2025".
  O subtítulo traz as datas e a cobertura do faturado ("01/01 a 25/09/2026 · cobertura
  98,1% do faturado").
- As barras continuam 12 meses: o Mês da tela só afeta os cards.

## Frontend

`SalesOrdersModule.tsx`: estados `paymentTermSummary` / `paymentTermSummaryLoading`;
fetch com `getSalesOrderGrantedPaymentTermSummaryUrl(q)` usando a **mesma** query string
dos filtros aplicados e o mesmo `AbortSignal` da carga da lista. Fail-soft: erro no KPI
é logado no console e o card mostra "Indisponível"; a lista e os demais cards não são
afetados. O KPI não depende de `showMarginEconomics`.

## Testes

- `src/lib/salesOrderGrantedPaymentTerm.test.ts` — parser (fallback), dias civis,
  prazo por título e por pedido, só faturados na média, cenário "todos os meses"
  (77,4% faturado com FULL), média geral (57; 58,5; à vista; fontes mistas; 80%;
  zero/negativo; títulos inválidos; UNAVAILABLE), bordas de qualidade, apresentação.
- `src/lib/salesOrderGrantedPaymentTermSummary.wiring.test.ts` — paridade do `where`
  com a listagem (Prisma fake), cadeia NF-e → títulos, `invoiced` pela NF-e válida,
  queries constantes, ausência de raw/escrita, rota antes de `/:id`, permissão,
  fail-soft da UI, cards e rodapé.
- `src/lib/salesOrderGrantedPaymentTermCard.test.tsx` — render real do card nos estados
  FULL/PARTIAL/LOW/UNAVAILABLE (sem faturados × sem títulos)/falha/loading.
- Comparação do período (Resultado): datas (acumulado, ano encerrado/futuro, mês em
  andamento, 29/02), paridade com o card, tendência e delta, cobertura baixa, sem base,
  Mês e `asOfDate` da tela no loader, render dos dois cards
  (`src/lib/salesOrderResultReceivableTermChart.test.tsx`).

## Fora de escopo / não alterado

Schema Prisma, migrations, sync Nomus, motor de margem, custo, imposto, DRE, comissões,
estoque, cron, deploy.
