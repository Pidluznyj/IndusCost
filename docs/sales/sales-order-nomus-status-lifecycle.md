# Status e cancelamentos de Pedidos de Venda Nomus no IndusCost

Atualizado em 28/10/2026 — branch `fix/proposal-sales-order-link` (missão complementar ao vínculo Proposta × Pedido).

## 1. Campos reais da API Nomus (evidência)

Endpoint usado: `GET /pedidos?pagina&tamanhoPagina&dataEmissaoInicial&dataEmissaoFinal&dataVencimentoInicial&dataVencimentoFinal`
(`scripts/nomusSalesOrdersSyncV1.ts`). **Não há filtro de status**: pedidos com itens cancelados vêm na listagem
(PD 02130, único item com `status: 6`, chegou pelo sync — fixture `src/lib/fixtures/salesOrderPd02130SanitizedRaw.ts`).

| Informação | Campo | Evidência |
|---|---|---|
| Status de cada item | `itensPedido[].status` (código numérico) | real: 6 (PD 02130), 4 e 6 (PD 02207) |
| Códigos 1/2/3/5 | `1` aguardando liberação, `2` liberado, `3` parcial, `5` atendido com corte | contrato Status Pedidos (`NOMUS_SALES_ORDER_ITEM_STATUS_CODE_MAP`); confirmar com S2 |
| Quantidade pedida | `itensPedido[].quantidade` | real |
| Quantidade atendida | `quantidadeAtendida` / `quantidadeFaturada` | lidos pelo parser; confirmar com S2b |
| Quantidade cancelada | `quantidadeCancelada` | **não aparece no payload real** (fixture PD 02130) |
| Status do pedido (cabeçalho) | — | **sem evidência**: `status/situacao/situacaoPedido/statusPedido` só são lidos para exibição (S1 mostra o que existe) |
| Data / motivo de cancelamento, reativação, última alteração | — | **sem evidência** (S1b lista os campos, se existirem) |

Regras derivadas: cancelamento total = **todos os itens** com status 6; parcial = parte dos itens; corte = status 5;
reativação = item que deixa o status 6 numa leitura posterior. Valores de enum não comprovados não são usados para
decidir nada; o que a auditoria S1/S1b/S2 trouxer deve ser registrado aqui antes de virar regra.

Para coletar a evidência que falta sem chamar a API: rodar `scripts/audit-sales-order-nomus-status.sql` (seção 6).
Chamada real ao Nomus para um pedido cancelado inteiro só com autorização.

## 2. Interpretação de status (implementada)

`src/lib/sales/salesOrderNomusLifecycle.ts` — por pedido, a partir dos itens:

| Situação | Regra | Previsão de faturamento / carteira aberta |
|---|---|---|
| ABERTO | nenhum item cancelado/removido | valor do cabeçalho (como antes) |
| PARCIALMENTE_CANCELADO | parte dos itens cancelada ou fora do payload | soma do valor elegível dos itens ativos |
| COM CORTE | item status 5 | só a fração atendida do item (qtd atendida ÷ pedida; sem quantidade, nada) |
| TOTALMENTE_CANCELADO | todos os itens cancelados | **fora** |
| TODOS_FORA_DO_PAYLOAD | todos os itens saíram do pedido no Nomus | fora |
| SEM_ITENS | pedido local/legado | valor do cabeçalho |

- O valor parcial **soma** os itens ativos (não subtrai do cabeçalho): não há dupla subtração se o Nomus já tiver
  abatido o `valorTotal`. S5 mostra qual semântica o Nomus usa.
- Pedido, número do PV, itens, NF-e e vínculo com proposta **nunca são apagados**; `SalesOrder.status` continua sendo o
  fluxo de envio do IndusCost (o cancelamento do Nomus não reescreve o cabeçalho).
- Faturamento realizado (NF-e) não é filtrado por itens: faturamento ocorrido não some com cancelamento posterior.

## 3. Causas de inconsistência encontradas

1. Previsão de faturamento, drill-down do horizonte e carteira em aberto do CRM filtravam só `status <> 'CANCELLED'` —
   status que o sync nunca grava — e usavam o `totalNetValue` do cabeçalho: pedido com todos os itens cancelados no
   Nomus continuava na previsão pelo valor cheio; parcialmente cancelado, pelo valor contratado.
2. Status ausente ou código desconhecido numa leitura posterior sobrescrevia o item como ativo (reativação falsa).
3. Nenhum histórico: um cancelamento desfeito no Nomus apagava o rastro do cancelamento anterior.
4. Duas sincronizações do mesmo pedido podiam gravar itens ao mesmo tempo (sem lock por pedido no banco).

## 4. Código corrigido

- `src/lib/sales/salesOrderNomusLifecycle.ts` — regra única (TypeScript + SQL) de situação e valor elegível.
- `src/lib/financeBillingForecast.ts`, `src/lib/financeBillingHorizonDrilldown.ts`, `src/lib/crmSellerDashboardService.ts`
  (carteira em aberto) — usam a regra; realizado e "pedidos emitidos" (histórico) inalterados.
- `src/lib/salesOrderNomusSync.server.ts` — `shouldPreservePreviousNomusItemStatus`: status ausente/desconhecido não
  muda cancelado/cortado/atendido já gravado (o código bruto recebido fica gravado para auditoria).
- `src/lib/sales/salesOrderNomusStatusEvents.ts` + `salesOrderNomusItemSync.server.ts` — histórico
  `SalesOrderNomusStatusEvent` (ITEM_CANCELED, ITEM_REACTIVATED, ITEM_CUT, ITEM_STALE, ITEM_RETURNED, ITEM_STATUS_CHANGED,
  ITEM_STATUS_UNKNOWN_PRESERVED, ORDER_FULLY_CANCELED, ORDER_REACTIVATED) e lock consultivo por pedido do Nomus.
- `scripts/nomusSalesOrdersSyncV1.ts` — usa os módulos acima; relê o pedido depois do lock.

## 5. Migration

`20261102120000_proposal_sales_order_link_traceability` (a mesma do vínculo, ainda não aplicada em nenhum ambiente)
ganhou a tabela `SalesOrderNomusStatusEvent`. Aditiva; rollback em `docs/sales/proposal-sales-order-link.rollback.sql`.
Testada em PostgreSQL 17 descartável: aplicação, rollback e reaplicação com dados.

## 6. Auditoria somente leitura

`scripts/audit-sales-order-nomus-status.sql` (READ ONLY, `statement_timeout` 120 s, `lock_timeout` 3 s, PG12/PG17,
roda antes da migration; sem nome de cliente nem documento):
S0 alvo · S1 status de cabeçalho no payload · S1b campos de data/motivo/alteração · S2 status bruto × normalizado ×
bandeiras · S2b quantidades presentes (cancelamento parcial por quantidade) · S3 pedidos por situação (total, parcial,
cortados, atendidos com saldo, sem evidência) · S4 cancelados que a regra antiga mantinha na carteira/previsão ·
S5 `valorTotal` × itens · S6 exemplos para conferência · S7 histórico entre sincronizações (após a migration).

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql "host=<HOST_RDS> port=5432 dbname=teste_bi user=<USUARIO_LEITURA> sslmode=require" -X -v ON_ERROR_STOP=1 -f scripts/audit-sales-order-nomus-status.sql > auditoria-status-pedidos-prod.txt
```

```bash
PGOPTIONS='-c default_transaction_read_only=on' psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -d teste_bi_homolog -X -v ON_ERROR_STOP=1 -f scripts/audit-sales-order-nomus-status.sql > auditoria-status-pedidos-homolog.txt
```

Nenhuma correção histórica é necessária: as regras são aplicadas na leitura (previsão/carteira) a partir das bandeiras
que o sync já grava; não há dado a reescrever.

## 7. Módulos consumidores

| Módulo | Usa | Situação |
|---|---|---|
| Carteira / Kanban (motor de fluxo) | status dos itens | já correto (itens cancelados fora; todos cancelados → CANCELED) |
| Previsão de faturamento + horizonte | itens (novo) | **corrigido** |
| CRM — carteira em aberto por vendedor | itens (novo) | **corrigido**; pedidos emitidos (histórico) inalterado |
| Faturamento realizado / dashboards de NF | NF-e | inalterado (realizado não some) |
| Fluxo de caixa (cronograma efetivo) | bandeiras por item | já correto (cancelado/cortado/stale fora) |
| Contas a receber realizadas | títulos Nomus | não tocado pelo sync de status |
| Comissões | itens ativos | linhas canceladas/stale fora; pedido sem itens ativos não gera comissão; pagas preservadas |
| Vínculo Proposta × Pedido | política oficial | cancelamento não apaga vínculo (testado) |
| Reprocessamento pós-sync | pedidos atualizados | hooks rodam para pedidos com mudança de status (são atualizações) |

## 8. Testes (missão 1–20)

Unitários: `salesOrderNomusLifecycle.test.ts` (1, 2, 3, 4, 5, 9), `salesOrderNomusStatusEvents.test.ts` (2, 3, 5, 9, 10,
11, 12, stale/retorno), `salesOrderNomusSync.test.ts` (preservação do vínculo do item).
PostgreSQL 17 real: `salesOrderNomusStatus.pg17.integration.test.ts` (1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 15, 16, 17, 20 e a
auditoria antes/depois da migration).
Já existentes: 13/14 — `nomusSalesOrderSourceReconciliation.test.ts` ("10. payload parcial → sem ausência",
"1. recent-window nunca marca ausência", "12. 429 não recuperado → sem ausência"); 18/19 —
`nomusAccountsReceivableSourceReconciliation.test.ts` ("15. comissão paga preservada — patch de ausência sem campos
financeiros"), `nomusSourcePresencePolicy.test.ts` ("8. comissão paga / histórico não depende de presença operacional"),
`commissionReceiptCoverage.test.ts` ("reprocessar mantém as pendências já pagas e não libera a comissão duas vezes").

## 9. Pendências (dependem de dados reais ou de decisão)

- **Status de cabeçalho do Nomus**: sem evidência do campo/valores; decidir após S1.
- **Cancelamento parcial por quantidade** (`quantidadeCancelada`): ausente no payload real; o item continua ativo pelo
  valor inteiro até S2b provar o campo.
- **Data/motivo do cancelamento e última alteração**: sem evidência (S1b).
- **Comissão de item cortado**: o motor exclui a linha inteira (inclusive a parte atendida), enquanto
  `docs/sales/sales-order-item-status-rules.md` diz "não gera comissão sobre o cortado". Divergência de regra comercial:
  não alterada sem decisão (afetaria comissões já calculadas).
- **Pedido ausente confirmado** (MISSING_CONFIRMED, só em reconciliação completa com a flag): não dispara o recálculo do
  Kanban; comportamento anterior mantido.
- Pedido com valor de frete no cabeçalho e item cancelado: a previsão parcial soma só os itens (sem o frete).

## 10. Homologação

1. Rodar as duas auditorias (este documento e `proposal-sales-order-link.md`) e guardar a saída.
2. Aplicar a migration antes do código; implantar.
3. Rodar um sync de pedidos (janela recente) e conferir: S3/S4 em homologação, a previsão de faturamento de um pedido
   totalmente cancelado conhecido (some) e de um parcialmente cancelado (valor = itens ativos), e `S7` com os eventos.
4. No Nomus de homologação, cancelar e reativar um item de teste e sincronizar: esperar ITEM_CANCELED e depois
   ITEM_REACTIVATED, sem item duplicado.
