# CRM Gestão Geral — fonte canônica e reconciliação com Pedidos de Venda

**Decisão (17/08/2026):** o cockpit do gestor comercial não tem régua própria.
Tudo que é PEDIDO vem da mesma implementação que a tela **Comercial > Pedidos
de Venda** usa. O que é RELACIONAMENTO é métrica do CRM e não reconcilia — por
definição, não por acidente.

## Onde cada regra mora (uma implementação só)

| Regra | Implementação canônica | Quem consome no CRM |
|---|---|---|
| População do pedido (status ≠ CANCELLED, presença Nomus, faixa de emissão meio-aberta `[gte, lt)`, filtros) | `buildSalesOrderListWhere` (`salesOrdersListSummary.ts`) | `crmCanonicalSalesOrderScope.server.ts` |
| Intercompany (grupo econômico) | `buildEconomicGroupCustomerMatchOr` / `buildEconomicGroupCustomerPrismaExclusion` (`financeInternalGroupExclusions.ts`) | mesmo adapter + `crmManagementOrderFacts.server.ts` |
| NF válida / faturado | `buildSalesOrderValidNfeLinkWhere` (via filtro `hasInvoice`) e `buildSalesOrderLinkedNfeContext` no motor | adapter (`hasInvoice`) e motor oficial |
| Período ano/mês | `resolveSalesOrderIssueDateRange` | adapter |
| Métricas (total, vendido, carteira, faturado, ticket) | `salesOrderRulesEngine` via `resolveOfficialScopedOrderMetrics` | `crmSalesOrderMetricsService.ts` |
| Follow-up de pedido em carteira | `crmOrderFollowUp.ts` (regra do CRM) | serviço do cockpit |

`crmOrderPortfolioSql.ts` **não contém mais regra de pedido**. Um teste de
guarda (`crmOrderPortfolioSql.test.ts`) falha se alguém reintroduzir status,
NF, intercompany ou período ali.

## O que a reimplementação anterior custava

O CRM tinha fragmentos SQL próprios. Eles divergiam do oficial em quatro
pontos — cada um capaz de quebrar a conferência:

1. **ERROR**: o CRM excluía; Pedidos de Venda conta (só CANCELLED sai).
2. **Borda de período**: o CRM fechava em `<= 23:59:59.999`; o oficial usa
   faixa meio-aberta `[gte, lt)`.
3. **Nome do grupo**: o CRM usava `LIKE 'SM%'`, que excluiria clientes
   legítimos começando com "SM"; o oficial casa `"SM Comercio"/"SM Comércio"`.
4. **NF**: o CRM exigia `presentInLastPayload` e ignorava o status cancelado
   em parte dos caminhos.

## Classes de indicador (não confundir)

- **TRANSACIONAL** — sai da população canônica e **tem que reconciliar no
  centavo**: total de pedidos, valor vendido, carteira (qtd e valor),
  faturado, ticket médio.
- **RELACIONAMENTO** — nasce do CRM, em janela móvel: contato 30/60/90 dias,
  follow-up atrasado/agendado, recência, risco, vínculo comercial, qualidade
  de `customerId`. **Não reconcilia com Pedidos de Venda e não deveria.**

Cada card declara sua classe (`kpiClass`) e a UI escreve isso no rodapé.

## Rankings: Top N ≠ reconciliação

`topCustomers` / `topCommercialOwners` são **recorte de exibição** (Top 10).
Afirmar "Σ Top 10 = valor vendido" é falso assim que houver mais de 10 grupos.
A reconciliação usa `customerRankingTotals` / `commercialOwnerRankingTotals`,
que agregam o ranking **completo**. `topProducts` soma valor de **linha** e
nunca fecha com o header — está documentado e testado como diferença legítima.

## Verificador (homologação, read-only)

```bash
npx tsx scripts/verify-crm-vs-sales-orders.ts
```

Compara, para o mesmo período, o lado oficial (construtor + motor de Pedidos
de Venda) com o lado CRM (serviço do cockpit) e imprime:

`indicador · valor PV · valor CRM · delta · OK/DIVERGENTE`

Cobre **total de pedidos, valor vendido, quantidade em carteira e valor em
carteira**, nos cenários ano corrente, mês atual, mês fechado e todos os anos
(`--year=`, `--month=`, `--all-years`, `--json`). Critério: **delta zero** —
R$ 0,00 para dinheiro, 0 para quantidade. Sai com código 1 se divergir.

Não escreve nada no banco; um teste de contrato trava isso.

## Limite conhecido

O cockpit carrega no máximo 20.000 pedidos por consulta. Quando o filtro
casa mais que isso, `sourceInfo.truncated` fica `true`, a tela mostra faixa
âmbar de "números subestimados" e o verificador emite AVISO — em vez de exibir
um total silenciosamente menor.
