# Pedidos de Venda — KPI "Prazo médio de recebimento" (2026-09)

## Objetivo

Na tela **Comercial → Pedidos de Venda**, a seção inicial de KPIs deixou de exibir
**Imposto a pagar** e **Custo estimado** e passou a exibir **Prazo médio de
recebimento** (em dias) dos pedidos atualmente filtrados.

Ordem visual (grid responsivo existente, `SystemTotalizerCard`):

| Sem permissão econômica | Com permissão econômica |
| --- | --- |
| Pedidos filtrados · Valor vendido · Prazo médio de recebimento · Ticket médio | Pedidos filtrados · Valor vendido · Prazo médio de recebimento · Ticket médio · Margem comercial |

Os cálculos de imposto/custo **não** foram removidos do sistema: motor de margem,
`SalesOrderListMarginSummary`, relatórios, abas Custos/Tributos, DRE, comissões e
Gestão de Pedidos continuam iguais. Apenas os dois cards saíram deste overview.

## Histórico da definição

- Versão inicial (2026-09-25, manhã): "Prazo médio concedido" lido apenas de
  `SalesOrder.paymentTerms` (parser fail-closed). Em homologação o card ficou
  "Indisponível": nenhuma condição dos pedidos filtrados era interpretável.
- Versão atual (2026-09-25, revisão do usuário): o SLA conta entre a **data de
  emissão da NF-e** e a **data (vencimento) do título do Contas a Receber**.
  O parser de `paymentTerms` permanece apenas como fallback declarado para pedidos
  ainda sem títulos.

## Definição

```
prazo do título  = vencimento do título (NomusAccountsReceivable.dueDate)
                   − emissão da NF-e de origem (NomusNfe.xmlDhEmi; fallback dataProcessamento)
prazo do pedido  = Σ (valor do título × prazo do título) ÷ Σ valor dos títulos válidos
prazo médio geral = Σ (SalesOrder.totalNetValue × prazo do pedido) ÷ Σ totalNetValue dos pedidos resolvidos
```

- Cadeia canônica (a mesma do filtro "Status CR" e do cronograma de pagamento da
  exportação): `SalesOrder → SalesOrderNfeLink` (só NF-e válidas: processadas e não
  canceladas) `→ NomusNfe.xmlDhEmi` e `NomusAccountsReceivable.sourceInvoiceId`.
- Peso entre pedidos **obrigatoriamente** por `SalesOrder.totalNetValue > 0`
  (nunca média simples, nunca `abs()`; zero/negativo fica em `zeroOrNegativeOrders`).
- Título válido: tem vencimento e emissão da NF-e, valor (`amountReceivable`) > 0,
  prazo ≥ 0 e ≤ 730 dias. Títulos inválidos são ignorados e contados em `titlesIgnored`.
- Pedido sem título válido: usa `SalesOrder.paymentTerms` quando interpretável
  (`30/60` → 45; `À vista` → 0; regras do parser abaixo). Senão fica fora da média e
  aparece em `unrecognizedTerms` e na cobertura.
- Não usa `settlementDate`, `amountReceived`, atraso ou data real de recebimento.
  `paymentMethod` nunca define prazo.

Exemplo: pedido A (R$ 10.000) com NF emitida em 01/09 e títulos de R$ 5.000 vencendo
em 01/10 e 31/10 → 45 dias; pedido B (R$ 90.000) com título único a 60 dias → 60;
média geral = (10.000×45 + 90.000×60) ÷ 100.000 = **58,5 dias**.

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
coveragePercent = valor líquido positivo dos pedidos com prazo resolvido
                  ÷ valor líquido positivo total dos pedidos filtrados × 100
```

| Qualidade | Regra (constantes exportadas) |
| --- | --- |
| `FULL` | cobertura ≥ 95% |
| `PARTIAL` | 80% ≤ cobertura < 95% |
| `LOW` | 0 < cobertura < 80% |
| `UNAVAILABLE` | nenhum pedido resolvido / sem população válida |

A classificação usa o valor exato (sem arredondar); a UI arredonda só para exibir.
`sources` informa quanto do valor vendido foi resolvido por títulos do CR e quanto pela
condição comercial.

## Comportamento visual (card `sales-order-list-average-payment-term-card`)

| Qualidade | Valor | Subtítulo | Tone |
| --- | --- | --- | --- |
| FULL | `47,8 dias` | `Cobertura: 98,2% do valor vendido` | info |
| PARTIAL | `47,8 dias` | `Cobertura parcial: 89,4%` | warning |
| LOW | `Cobertura insuficiente` | `Cobertura: 54,1%` | warning |
| UNAVAILABLE | `Indisponível` | `Sem títulos ou condições de pagamento suficientes` | neutral |
| falha do endpoint | `Indisponível` | `Não foi possível carregar o indicador.` | neutral |

Tooltip (ícone de ajuda): "Dias entre a emissão da NF-e e o vencimento dos títulos do
Contas a Receber vinculados ao pedido, ponderados pelo valor dos títulos; média geral
ponderada pelo valor líquido dos pedidos filtrados. Pedidos sem títulos usam a condição
comercial de pagamento quando interpretável (ex.: 30/60 = 45 dias). Não mede atraso nem
data real de recebimento." Em cobertura parcial/baixa acrescenta a exclusão; quando há
cobertura, acrescenta "Fonte: títulos do CR em X% do valor vendido; condição comercial em Y%."

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
  "coveragePercent": 96.4,
  "orderCoveragePercent": 95.1,
  "quality": "FULL",
  "totalOrders": 120,
  "weightedPopulationOrders": 118,
  "coveredOrders": 112,
  "uncoveredOrders": 6,
  "zeroOrNegativeOrders": 2,
  "totalWeightedSalesAmount": 1250000,
  "coveredSalesAmount": 1205000,
  "uncoveredSalesAmount": 45000,
  "sources": {
    "receivableTitles": { "orders": 98, "salesAmount": 1080000, "salesSharePercent": 86.4, "weightedAverageDays": 48.9 },
    "commercialTerms": { "orders": 14, "salesAmount": 125000, "salesSharePercent": 10.0, "weightedAverageDays": 38.7 }
  },
  "titlesUsed": 240,
  "titlesIgnored": 3,
  "source": "NomusAccountsReceivable.dueDate - NomusNfe.xmlDhEmi | SalesOrder.paymentTerms",
  "methodology": "Prazo por título = vencimento do título do Contas a Receber menos a data de emissão da NF-e de origem, ...",
  "unrecognizedTerms": [
    { "paymentTerms": "50% entrada + 50% 30 dias", "orderCount": 4, "salesAmount": 30000, "reason": "AMBIGUOUS_WEIGHTS", "reasonLabel": "Peso das parcelas indeterminado (%, entrada, sinal…)" }
  ]
}
```

`unrecognizedTerms` lista (top 20 por valor vendido) os pedidos sem título válido e sem
condição interpretável, agrupados por texto da condição.

## Frontend

`SalesOrdersModule.tsx`: estados `paymentTermSummary` / `paymentTermSummaryLoading`;
fetch com `getSalesOrderGrantedPaymentTermSummaryUrl(q)` usando a **mesma** query string
dos filtros aplicados e o mesmo `AbortSignal` da carga da lista. Fail-soft: erro no KPI
é logado no console e o card mostra "Indisponível"; a lista e os demais cards não são
afetados. O KPI não depende de `showMarginEconomics`.

## Testes

- `src/lib/salesOrderGrantedPaymentTerm.test.ts` — parser (fallback), dias civis,
  prazo por título e por pedido, média geral (57; 58,5; à vista; fontes mistas; 80%;
  zero/negativo; títulos inválidos; UNAVAILABLE), bordas de qualidade, apresentação.
- `src/lib/salesOrderGrantedPaymentTermSummary.wiring.test.ts` — paridade do `where`
  com a listagem (Prisma fake), cadeia NF-e → títulos, queries constantes, ausência de
  raw/escrita, rota antes de `/:id`, permissão, fail-soft da UI, cards.
- `src/lib/salesOrderGrantedPaymentTermCard.test.tsx` — render real do card nos estados
  FULL/PARTIAL/LOW/UNAVAILABLE/falha/loading.

## Fora de escopo / não alterado

Schema Prisma, migrations, sync Nomus, motor de margem, custo, imposto, DRE, comissões,
estoque, cron, deploy.
