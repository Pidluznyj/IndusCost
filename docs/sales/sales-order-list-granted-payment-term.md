# Pedidos de Venda — KPI "Prazo médio concedido" (2026-09)

## Objetivo

Na tela **Comercial → Pedidos de Venda**, a seção inicial de KPIs deixa de exibir
**Imposto a pagar** e **Custo estimado** e passa a exibir **Prazo médio concedido**:
o prazo médio de pagamento (em dias) que comercialmente estamos concedendo aos
clientes nos pedidos atualmente filtrados.

Nova ordem visual (grid responsivo existente, `SystemTotalizerCard`):

| Sem permissão econômica | Com permissão econômica |
| --- | --- |
| Pedidos filtrados · Valor vendido · Prazo médio concedido · Ticket médio | Pedidos filtrados · Valor vendido · Prazo médio concedido · Ticket médio · Margem comercial |

Os cálculos de imposto/custo **não** foram removidos do sistema: motor de margem,
`SalesOrderListMarginSummary`, relatórios, abas Custos/Tributos, DRE, comissões e
Gestão de Pedidos continuam iguais. Apenas os dois cards saíram deste overview.

## O que o indicador É e o que NÃO é

- **É**: a condição comercial de pagamento concedida no pedido (`SalesOrder.paymentTerms`).
- **NÃO é**: PMR/DSO, atraso real, data real de recebimento, comportamento financeiro
  pós-venda. Não usa `settlementDate`, `amountReceived`, CR, liquidação nem
  "vencimento − emissão".
- `SalesOrder.paymentMethod` (PIX/boleto/TED/cartão) **não** define prazo.

## Fórmula

```
prazo médio concedido =
  Σ (totalNetValue do pedido × prazo médio da condição do pedido)
  ÷ Σ totalNetValue dos pedidos com condição reconhecida
```

- Ponderação entre pedidos **obrigatoriamente** por `SalesOrder.totalNetValue`
  (nunca média simples por número de pedidos).
- Só valores líquidos **positivos** pesam (`totalNetValue > 0`, combinado por AND com o
  where canônico). Zero/negativo não entra no denominador e nunca vira `abs()`;
  são contados em `zeroOrNegativeOrders` para auditoria.
- Prazo médio da condição = média simples das parcelas quando os pesos não são
  explícitos: `30/60` → 45; `30/60/90` → 60; `28/56/84` → 56; `7/14/21/28` → 17,5;
  `À vista` → 0.

Exemplo: A = R$ 10.000 @ 30 dias, B = R$ 90.000 @ 60 dias → (10.000×30 + 90.000×60) ÷ 100.000 = **57 dias**.

## Parser fail-closed (`src/lib/salesOrderGrantedPaymentTerm.ts`)

Normalização apenas para comparação: trim, espaços múltiplos, acentos e caixa.

Reconhecido **somente** quando o texto completo é interpretável sem ambiguidade:

| Entrada | Dias |
| --- | --- |
| `À vista`, `A vista`, `AVISTA` | 0 |
| `0`, `0 dias`, `0 DDL` | 0 |
| `30`, `30 dias`, `30 DDL`, `28 DD` | 30 / 28 |
| `30/60`, `30 / 60`, `30-60`, `30+60` | 45 |
| `30/60/90`, `30-60-90`, `30 + 60 + 90`, `30/60/90 dias` | 60 |
| `0/30` | 15 |

Rejeitado (`recognized=false`, com `reason`):

| Motivo | Exemplos |
| --- | --- |
| `MISSING` | `null`, `""`, só espaços |
| `AMBIGUOUS_WEIGHTS` | `50% entrada + 50% 30 dias`, `Entrada + 30/60`, `30 dias + sinal`, `30/60 + antecipação` |
| `NEGATIVE_DAYS` | `-30`, `30/-60` |
| `OUT_OF_RANGE` | acima de 365 dias por parcela (`366`, `999999`) |
| `TOO_MANY_INSTALLMENTS` | mais de 24 parcelas |
| `NON_INCREASING_SEQUENCE` | `30/30`, `60/30`, `30+30+30` |
| `UNRECOGNIZED_FORMAT` | texto livre, `30 dias boleto`, `30 dfm`, `1x30`, `3x 30/60/90`, `30,60`, `30/60-90`, `à vista.` |

Deliberadamente **não** interpretado nesta versão (fail-closed, aparece na auditoria
`unrecognizedTerms` para decidir novas regras): condições com percentuais/entrada/sinal,
"DFM" (dias fora o mês), multiplicadores (`3x`), sufixos descritivos (`30 dias boleto`,
`após entrega`), vírgula como separador, decimais. Nunca são extraídos números soltos de
um texto livre e nunca é produzido `NaN`/`Infinity`.

## Cobertura e qualidade

```
coveragePercent = valor líquido positivo com paymentTerms reconhecido
                  ÷ valor líquido positivo total dos pedidos filtrados × 100
```

`orderCoveragePercent` (por quantidade) também é retornado, mas a cobertura principal
exibida é por **valor**.

| Qualidade | Regra (constantes exportadas) |
| --- | --- |
| `FULL` | cobertura ≥ 95% |
| `PARTIAL` | 80% ≤ cobertura < 95% |
| `LOW` | 0 < cobertura < 80% |
| `UNAVAILABLE` | nenhum valor reconhecido / sem população válida |

A classificação usa o valor exato (sem arredondar); a UI arredonda só para exibir.

## Comportamento visual (card `sales-order-list-average-payment-term-card`)

| Qualidade | Valor | Subtítulo | Tone |
| --- | --- | --- | --- |
| FULL | `47,8 dias` | `Cobertura: 98,2% do valor vendido` | info |
| PARTIAL | `47,8 dias` | `Cobertura parcial: 89,4%` | warning |
| LOW | `Cobertura insuficiente` | `Cobertura: 54,1%` | warning |
| UNAVAILABLE | `Indisponível` | `Sem condições de pagamento suficientes` | neutral |
| falha do endpoint | `Indisponível` | `Não foi possível carregar o indicador.` | neutral |

Tooltip (ícone de ajuda): "Média ponderada pelo valor líquido dos pedidos filtrados,
calculada a partir da condição comercial de pagamento. Ex.: 30/60 = 45 dias. Não
representa atraso ou prazo real de recebimento." Em cobertura parcial/baixa, acrescenta
que condições não reconhecidas foram excluídas da média.

## API

`GET /api/sales-orders/payment-term-summary?<mesma query da listagem>`

- Autorização: `requireAppAuth` + `requireResource("commercial.sales_orders", "view")`
  (mesma da listagem; **não** exige permissão de margem/custo).
- Rota estática registrada em `server.ts` **antes** de `/api/sales-orders/:id`
  (`registerSalesOrderGrantedPaymentTermRoutes`).
- População: `parseSalesOrderListQuery` → `resolveSalesOrderListSellerWhere` →
  `resolveSalesOrderListWhere` (idêntico ao GET da listagem: status, cliente, vendedor,
  período, ano/mês, busca, Com/Sem NF, status CR, faixa de valor, presença operacional,
  cancelados). `page`/`pageSize` são ignorados: a agregação é da população completa.
- Queries (constantes, sem N+1, sem `findMany`, sem `nomusRawResponse`, read-only):
  1. `salesOrder.groupBy({ by: ["paymentTerms"], where: AND(where, { totalNetValue: { gt: 0 } }), _count: { _all }, _sum: { totalNetValue } })`
  2. `salesOrder.aggregate({ where, _count: { _all } })`

Resposta `{ paymentTermSummary: SalesOrderGrantedPaymentTermSummary }`:

```json
{
  "available": true,
  "weightedAverageDays": 47.84,
  "coveragePercent": 96.4,
  "orderCoveragePercent": 95.1,
  "quality": "FULL",
  "totalOrders": 120,
  "weightedPopulationOrders": 118,
  "recognizedOrders": 112,
  "unrecognizedOrders": 6,
  "zeroOrNegativeOrders": 2,
  "totalWeightedSalesAmount": 1250000,
  "recognizedSalesAmount": 1205000,
  "unrecognizedSalesAmount": 45000,
  "source": "SalesOrder.paymentTerms",
  "methodology": "Média ponderada pelo valor líquido dos pedidos filtrados, usando SalesOrder.paymentTerms. Condições com múltiplos prazos usam média das parcelas. Condições não interpretáveis são excluídas e refletidas na cobertura.",
  "unrecognizedTerms": [
    { "paymentTerms": "50% entrada + 50% 30 dias", "orderCount": 4, "salesAmount": 30000, "reason": "AMBIGUOUS_WEIGHTS", "reasonLabel": "Peso das parcelas indeterminado (%, entrada, sinal…)" }
  ]
}
```

`unrecognizedTerms` é limitado ao top 20 por valor vendido (desc) e serve para decidir,
de forma deliberada, quais novas regras adicionar ao parser.

## Frontend

`SalesOrdersModule.tsx`: estados `paymentTermSummary` / `paymentTermSummaryLoading`;
fetch com `getSalesOrderGrantedPaymentTermSummaryUrl(q)` usando a **mesma** query string
dos filtros aplicados e o mesmo `AbortSignal` da carga da lista. Fail-soft: erro no KPI
é logado no console e o card mostra "Indisponível"; a lista e os demais cards não são
afetados. O KPI não depende de `showMarginEconomics`.

## Testes

- `src/lib/salesOrderGrantedPaymentTerm.test.ts` — parser (reconhecidos/rejeitados,
  NaN/Infinity), ponderação (57; 58,5; à vista = 0; 80%; zero/negativo; UNAVAILABLE),
  bordas de qualidade (94,9/95/79,9/80/0), apresentação e formatação.
- `src/lib/salesOrderGrantedPaymentTermSummary.wiring.test.ts` — paridade do `where`
  com a listagem (Prisma fake, filtros cliente/vendedor/ano-mês/status/NF/CR/faixa de
  valor), 2 queries constantes, ausência de findMany/nomusRawResponse/escrita, rota
  antes de `/:id`, permissão, fail-soft da UI, cards.
- `src/lib/salesOrderGrantedPaymentTermCard.test.tsx` — render real do card nos estados
  FULL/PARTIAL/LOW/UNAVAILABLE/falha/loading, ausência de Imposto/Custo, Margem mantida.

## Fora de escopo / não alterado

Schema Prisma, migrations, sync Nomus, motor de margem, custo, imposto, DRE, comissões,
estoque, cron, deploy.
