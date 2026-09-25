# Comercial › Pedidos de Venda › Resultado (2026-09-25)

## O que mudou

1. **Filtros no padrão do sistema** (o mesmo da listagem de Pedidos de Venda):
   - os controles só alteram o rascunho; nada é consultado ao mudar um filtro;
   - **Pesquisar** aplica os filtros (e sempre recarrega); **Limpar filtros** volta para
     o ano corrente e todos os meses e recarrega;
   - quando o rascunho difere do aplicado, a barra avisa "Filtros alterados — clique em
     Pesquisar para atualizar.";
   - dropdowns com dados do servidor: Vendedor (vendedores da população aplicada, sem o
     próprio filtro de vendedor), Cliente (autocomplete), **Produto** (autocomplete por
     SKU ou nome de produtos que aparecem em pedidos de venda — substitui o campo de UUID
     digitado) e **Status CR** múltiplo (mesmo componente da listagem);
   - mesmas classes visuais da barra de filtros da listagem
     (`src/components/sales/salesOrderFilterBarStyles.ts`, com teste de paridade).
2. **Gráfico novo: Prazo médio de recebimento por mês**, 12 meses do ano filtrado × mesmo
   período do ano anterior (ver `docs/sales/sales-order-list-granted-payment-term.md`,
   seção "Série mensal"). Carrega por um endpoint leve e independente: aparece mesmo
   enquanto o resultado pesado ainda calcula, e uma falha nele não afeta o resto da tela.
3. **Os dois gráficos existentes foram mantidos** ("R$ Pedido Venda e % Margem por mês" e
   "Realizado vs Projetado").

## Por que a tela demorava

| Causa | Efeito | Correção |
| --- | --- | --- |
| Cada mudança de filtro disparava a consulta completa na hora, sem cancelar a anterior | Trocar Ano e Mês gerava 2 cargas pesadas em paralelo; digitar no campo de produto gerava uma carga por tecla | Rascunho × aplicado + Pesquisar; `AbortController` em todas as consultas |
| A rota `GET /api/sales-orders/results` calculava também a série anual de margem comercial usada **só** pelo gráfico da listagem (servido pelo charts-cache) | Motor de margem completo sobre **todos os pedidos do ano** a cada requisição, mesmo com filtro de um único mês — a parte mais cara da requisição | Opção `includeListMarginChartSeries: false` na rota da tela; o charts-cache e os scripts de auditoria continuam com o padrão (série incluída) |
| O motor de margem ainda roda duas vezes sobre a população filtrada (margem gerencial e margem comercial dos KPIs), e o select das regras carrega `nomusRawResponse` | Custo restante proporcional ao filtro | **Não alterado** nesta entrega: exige mexer no motor oficial de margem e certificar equivalência numérica com `scripts/certSalesOrdersPerf.ts` em homologação |

Nenhum número exibido na tela Resultado mudou com as correções de desempenho.

## Correção do filtro de produto

O bundle de vendas do motor comparava o UUID do produto com o `id` do **item** do pedido,
o que nunca casava: com produto selecionado, "Qtde Pedidos" ficava 0 e o gráfico
"Realizado vs Projetado" vazio. O filtro já está no where (pedidos que contêm o produto),
então o bundle deixou de receber `productId` e passou a usar o escopo do where. Com
produto selecionado, "R$ Pedidos" e a margem continuam no nível dos itens do produto (motor
de margem), e a projeção usa o valor dos pedidos que contêm o produto.

## Endpoints

| Rota | Uso | Guarda |
| --- | --- | --- |
| `GET /api/sales-orders/results` | KPIs, margem mensal e projeção (sem a série anual da listagem) | `commercial.sales_orders:view` |
| `GET /api/sales-orders/payment-term-monthly` | Prazo médio de recebimento mês a mês × ano anterior | `commercial.sales_orders:view` |
| `GET /api/sales-orders/product-filter-options?q=&limit=` | Dropdown de produto (SKU ou nome, produtos vendidos, 1 consulta) | `commercial.sales_orders:view` |
| `GET /api/sales-orders/seller-filter-options` | Dropdown de vendedor (já existia) | `commercial.sales_orders:view` |

Todas estáticas e registradas antes de `/api/sales-orders/:id`.

## Testes

- `src/lib/salesOrderResultPage.test.ts` — helpers de filtro, estrutura da página
  (Pesquisar, dependências só dos filtros aplicados, 3 consultas canceláveis), dropdowns,
  paridade visual com a listagem, rota sem a série anual, filtro de produto.
- `src/lib/salesOrderResultReceivableTermChart.test.tsx` — render do gráfico (dados,
  vazio, carregando, erro, recarregando).
- `src/lib/salesOrderGrantedPaymentTerm.test.ts` e
  `src/lib/salesOrderGrantedPaymentTermSummary.wiring.test.ts` — série mensal (paridade
  com o card, cobertura baixa sem barra, where canônico por ano sem o Mês, produto).

## Fora de escopo

Schema, migrations, sync Nomus, motor de margem, custo, imposto, DRE, comissões, estoque,
deploy. Próximos indicadores de resultado de venda serão tratados à parte.
