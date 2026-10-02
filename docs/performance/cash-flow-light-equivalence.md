# Fluxo de Caixa — equivalência legacy × light (Prompt 2)

Data: 2026-10-02  
Branch: `perf/cash-flow-light-hardening`  
HEAD inicial da missão: `ab39ab435ade27297fe25210847701cdeb194f79`

## Veredito

**NÃO APROVADO.**

O shadow live, o comparativo de agregados (dashboard, anual, radar) e a auditoria do teto de 80 em dados reais não rodaram. PostgreSQL `localhost:5432` / `induscost` está inacessível (P1001). Não há Postgres instalado nesta máquina. Não houve fallback para banco remoto, homologação ou produção.

Sem essa prova, a flag não foi promovida e os consumers não foram alinhados (Prompt 3 não executado).

## O que a fronteira compara

O runner já existente é `scripts/runCashFlowLightProjectionShadow.ts`.

```text
LEGACY  getOrderFullAudit
        → buildEffectiveScheduleInputFromAudit
        → buildSalesOrderEffectiveFinancialSchedule

LIGHT   loadCashFlowOrderProjections
        → buildEffectiveScheduleInputFromAudit
        → buildSalesOrderEffectiveFinancialSchedule
```

O diff (`diffDeep`) exige igualdade estrutural. Dinheiro entra como escalar exato (`Prisma.Decimal` / `toFixed`), sem tolerância genérica de R$ 0,01. Campos de nome, CNPJ, comentário e raw payload ficam de fora do relatório.

A fronteira comparável inclui ids de pedido, itens que alimentam valor/status, documentos (id, NF, status, `dataDocumento`, `dataMovimentacao`, valor alocado), CR (id, NF, vencimento, valores, status) e `plannedReceivables` (parcela, datas, valores, `entryKind`, `replacedByRealCr`).

O input do motor, em `buildEffectiveScheduleInputFromAudit`, lê de cada CR apenas `externalId`, `sourceInvoiceId`, `dueDate` e os três valores. De cada documento lê NF, valor alocado, `dataDocumento` e `dataMovimentacao`.

## Prova que existe sem banco

Testes de caracterização já no repositório, não reexecutados contra dados vivos:

| Teste | O que trava |
|---|---|
| `cashFlowProjectionExecution.test.ts` | legacy chama audit e não chama o loader; light faz o inverso; default é legacy |
| `cashFlowShadowRunner.test.ts` | diff, fronteira e omissão de dado pessoal; importar o script não abre banco |
| `cashFlowNfeNumbersInertness.test.ts` | `nfeNumbers: []` não muda a primeira projeção |
| `cashFlowLightProjectionFeasibility.test.ts` | `stockDocumentItems: []` é inerte para o número |
| `cashFlowOrderProjectionLoader.test.ts` | ordem dos CR preservada; `dataMovimentacao` vem do fact quando há fact, não do stage |

Esses testes não substituem o shadow do portfólio real. Não contam pedidos comparados.

## Riscos conhecidos, revistos no código

### Ordem dos CR

O loader filtra `arRows` na ordem da consulta e documenta que agrupar por NF reordenava os títulos e divergia do shadow. O teste do loader cobre o caso. Sem reexecução live, o defeito antigo permanece classificado como corrigido no código, não revalidado neste volume.

### `dataMovimentacao`

Com fact, a data do documento e a data de movimentação saem de `fact.stockDocumentDate`. Sem fact, saem de `dataDocumento` / `movementDate` do stage. O comentário do loader registra que usar o stage direto zerou `dataMovimentacao` em 27 de 80 pedidos num shadow anterior. A regra atual do loader replica o audit. Não recontado aqui.

### `stockDocumentItems` e `nfeNumbers`

Continuam omitidos, com teste de inércia. O schedule não os lê. Se um builder passar a lê-los, o teste de inércia deve falhar.

### `referenceDate` versus `new Date()`

Os dois caminhos chamam `new Date()` dentro de `projectOrderAuditReceivables`. O audit 360º faz isso explicitamente. Trocar só o light para o `referenceDate` do caller afastaria o light do legado. Não foi alterado.

O status `OVERDUE` usa esse instante. Duas chamadas no mesmo request diferem milissegundos. Isso só muda o status se o vencimento cair exatamente entre elas. Não é divergência sistemática light × legacy.

### `nfeByExternalId`

O audit passa o mapa; o loader não. `linkedNfeIsCanceled` gera alerta no objeto de CR e não entra no input do schedule. Não foi "corrigido" porque a correção não muda o número do Fluxo e, sem banco, não dá para provar efeito colateral.

### Catch por pedido

Os dois modos engolem a falha de um pedido, logam `orderCode` e seguem. Esse é o contrato atual: um pedido quebrado não zera a tela. Transformar o catch em erro HTTP mudaria o resultado visível (de previsão parcial para falha total).

O que mudou, sem mudar número: cada catch incrementa `orderProjectionFailures` na telemetria de projeção. O contador não entra no payload HTTP.

### Run O2C

O audit busca o fact mais recente e depois os facts daquele run. O loader lê todos os facts do conjunto e escolhe o run de maior `createdAt` em memória. A regra de "run mais recente" é a mesma. O volume lido não é. Não foi reduzido: sem `EXPLAIN` e sem contagem de runs, cortar o histórico poderia escolher outro run.

## Teto de 80

`PORTFOLIO_ORDER_LIMIT` permanece 80. A contagem distinta foi implementada (`summarizeFinanceArPortfolioOrderLimit`) e coberta por teste da matemática (estouro da prioridade, reencontro na consulta secundária, complemento até o teto).

Em dados reais:

```text
candidateOrders: não medido
processedOrders: não medido
excludedByLimit: não medido
limite atingido: desconhecido
```

`legacy == light` não seria prova de forecast completo mesmo se o shadow tivesse passado. O valor potencial dos excluídos não foi inventado.

## Agregados

Dashboard, anual e radar legacy × light: **não comparados**. Sem linhas, não há entradas, saídas, saldo, YTD, timeline, ranges, tops nem reconciliação para declarar iguais.

## Divergências

```text
divergências iniciais encontradas em dados: nenhuma (shadow não rodou)
divergências corrigidas no loader: nenhuma nesta fase
divergências restantes: desconhecidas até o shadow live
```

Nenhum motor financeiro foi editado para forçar igualdade.

## Gate

```text
shadow estrutural live = NÃO EXECUTADO
shadow monetário live  = NÃO EXECUTADO
dashboard              = NÃO EXECUTADO
annual                 = NÃO EXECUTADO
radar                  = NÃO EXECUTADO
```

Status: **NÃO APROVADO**.
