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
3. **Dois cards acima desse gráfico**: prazo médio do **período selecionado** × as
   **mesmas datas do ano anterior**, com selo "melhor/pior" (menos dias = recebimento
   mais rápido = melhor). Sem Mês: acumulado de 01/01 até a data de referência da tela
   (ano encerrado = ano inteiro); com Mês: o mês (cortado na data se estiver em
   andamento). Mesmo cálculo e mesma regra de cobertura do card da listagem (seção
   "Período selecionado × mesmo período do ano anterior" do documento do KPI).
4. **Os dois gráficos existentes foram mantidos** ("R$ Pedido Venda e % Margem por mês" e
   "Realizado vs Projetado"). "Realizado vs Projetado" agora vem de um endpoint leve e
   aparece sem esperar a margem; enquanto a margem calcula, o gráfico mensal de margem
   mostra "Carregando margem mensal…" no lugar (sem a tela pular de posição).
5. **Data de referência = dia civil local** do navegador. Antes era o dia UTC
   (`toISOString`), que em Brasília vira o dia seguinte depois das 21h.

## Por que a tela demorava

| Causa | Efeito | Correção |
| --- | --- | --- |
| Cada mudança de filtro disparava a consulta completa na hora, sem cancelar a anterior | Trocar Ano e Mês gerava 2 cargas pesadas em paralelo; digitar no campo de produto gerava uma carga por tecla | Rascunho × aplicado + Pesquisar; `AbortController` em todas as consultas |
| A rota `GET /api/sales-orders/results` calculava também a série anual de margem comercial usada **só** pelo gráfico da listagem (servido pelo charts-cache) | Motor de margem completo sobre **todos os pedidos do ano** a cada requisição, mesmo com filtro de um único mês | Opção `includeListMarginChartSeries: false` na rota da tela; o charts-cache e os scripts de auditoria continuam com o padrão (série incluída) |
| As duas apurações de margem da mesma população (margem gerencial e margem comercial dos KPIs) calculavam, cada uma, a config Nomus, o contexto de custo (produto, custo versionado, tabela de preço) e o contexto fiscal | Mesmo trabalho pesado duas vezes por requisição | Contexto calculado **uma vez** no motor do Resultado e repassado à margem comercial (`precomputedMarginContext`, opcional e aditivo). Mesmos pedidos, mesma política de custo, contexto só lido: resultado idêntico (teste de equivalência) |
| O contexto de margem extraía os itens do JSON do Nomus **duas vezes por item** (casamento + status) | Custo quadrático no nº de itens do pedido; em base sintética (3.000 pedidos, 19.500 itens): ~400 ms só nisso | Itens extraídos **uma vez por pedido** e repassados ao casamento; status do item pelo mesmo casamento (`resolveMatchedNomusRawItemStatus`). Em base sintética: ~31 ms, saída idêntica. Vale para todas as telas que usam o contexto de margem |
| "Realizado vs Projetado" só aparecia depois de toda a margem | Gráfico rápido esperando o motor mais lento | Endpoint leve `GET /api/sales-orders/results/projection`: mesmo escopo e mesmo bundle de vendas, sem motor de margem e sem o JSON do Nomus (2 consultas de pedidos). Números idênticos aos do dashboard (teste); se falhar, a tela usa os do dashboard |
| Reabrir a tela ou repetir a mesma pesquisa recalculava tudo | Espera repetida para a mesma resposta | Cache curto em memória (5 min, até 30 respostas por tipo) com chave = filtros exatamente como vieram + dia + carimbo de atualização dos pedidos (último sync/alteração). Sync novo ⇒ chave nova ⇒ recalcula. Requisições idênticas simultâneas compartilham o mesmo cálculo. Erro não é cacheado |

Nenhum número exibido na tela Resultado mudou com as correções de desempenho. As regras
de margem, custo e imposto não mudaram: mudou só quantas vezes o mesmo contexto é
calculado.

**Limites conhecidos.** A primeira carga de uma pesquisa nova continua limitada pelo
motor de margem (uma passada, agora). Alterações fora dos pedidos (custo, tabela de
preço, imposto) aparecem em até 5 minutos por causa do cache; sync de pedidos invalida
na hora. O cache é por processo do servidor.

## Diagnóstico de lentidão

- Cabeçalho `Server-Timing` nas respostas de `/api/sales-orders/results` e `/projection`
  (DevTools › Rede › Tempo): `scope`, `orders`, `marginContext`, `taxContext`,
  `marginManagerial`, `marginCommercial`, `previousYear`, `total`, `cacheKey`, `request`.
- Cabeçalho `X-Sales-Order-Result-Cache`: `miss`, `hit`, `shared` (aguardou o mesmo
  cálculo em andamento) ou `bypass` (sem carimbo de atualização: calcula sem cache).
- Requisição acima de 3 s registra `[sales-order-result] … lento` no log com as fases.

## Validação pendente (homologação)

A equivalência foi provada com banco falso (mesmas funções, mesmas entradas). A
certificação com dados reais precisa do banco de homologação:
`scripts/certSalesOrdersPerf.ts` roda o dashboard, a margem da listagem e a margem da
página, mede latência e emite a impressão digital do payload. Rodar em uma worktree da
`main` anterior (BASE) e nesta (FEATURE): as impressões digitais têm de ser iguais.

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
| `GET /api/sales-orders/results` | KPIs e margem mensal (+ projeção, reserva); sem a série anual da listagem; cache curto + Server-Timing | `commercial.sales_orders:view` |
| `GET /api/sales-orders/results/projection` | Realizado vs Projetado, KPIs de projeção e YoY — leve, sem margem; cache curto + Server-Timing | `commercial.sales_orders:view` |
| `GET /api/sales-orders/payment-term-monthly` | Prazo médio de recebimento mês a mês × ano anterior + cards do período (`month`, `asOfDate`) | `commercial.sales_orders:view` |
| `GET /api/sales-orders/product-filter-options?q=&limit=` | Dropdown de produto (SKU ou nome, produtos vendidos, 1 consulta) | `commercial.sales_orders:view` |
| `GET /api/sales-orders/seller-filter-options` | Dropdown de vendedor (já existia) | `commercial.sales_orders:view` |

Todas estáticas e registradas antes de `/api/sales-orders/:id`.

## Testes

- `src/lib/salesOrderResultPage.test.ts` — helpers de filtro (incl. data de referência
  local e `asOfDate` no SLA), estrutura da página (Pesquisar, dependências só dos filtros
  aplicados, 4 consultas canceláveis, projeção pelo endpoint leve com reserva),
  dropdowns, paridade visual com a listagem, rota sem a série anual, filtro de produto.
- `src/lib/salesOrderResultPerformance.test.ts` — cache (TTL, in-flight, erro não
  cacheado, chave estrita, limite), Server-Timing, equivalência com banco falso (margem
  comercial com contexto compartilhado = cálculo próprio, com menos leituras; projeção
  leve = dashboard, só 2 consultas e sem o JSON), status de item do JSON igual ao cálculo
  item a item, rotas (guarda, ordem, cache sem usuário).
- `src/lib/salesOrderResultReceivableTermChart.test.tsx` — render do gráfico e dos cards
  do período (dados, mês, vazio, carregando, erro, recarregando).
- `src/lib/salesOrderGrantedPaymentTerm.test.ts` e
  `src/lib/salesOrderGrantedPaymentTermSummary.wiring.test.ts` — série mensal e
  comparação do período (datas, 29/02, tendência, delta, cobertura baixa, Mês e
  `asOfDate` da tela, paridade com o card).

## Fora de escopo

Schema, migrations, sync Nomus, regras de margem, custo, imposto, DRE, comissões,
estoque, deploy. Próximos indicadores de resultado de venda serão tratados à parte.
