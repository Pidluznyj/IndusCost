# Executive Summary

STATUS FINAL: NÃO APROVADO

A arquitetura do modo light está no código e o default operacional continua legacy. A flag `INDUSCOST_CASH_FLOW_LIGHT_PROJECTION` só liga com o valor exato `"1"`. Sem banco local, o shadow legacy × light, o comparativo de agregados e o benchmark before/after não rodaram. Isso impede aprovar a promoção da flag para teste funcional com números reais.

Produção não foi alterada. Não houve deploy, migration, restart, mudança de cron, env ou AWS.

Branch: `perf/cash-flow-light-hardening`
HEAD da documentação: ver o commit deste arquivo.
Base da missão: `ab39ab435ade27297fe25210847701cdeb194f79`

# Arquitetura anterior

Com a flag ausente, os handlers do Fluxo de Caixa chamavam `getOrderFullAudit` por pedido, até `PORTFOLIO_ORDER_LIMIT = 80`, com concorrência 8. O audit carrega o pedido inteiro (fiscal, margem, comissão, evidências) e só então o schedule usa `buildEffectiveScheduleInputFromAudit` + `buildSalesOrderEffectiveFinancialSchedule`.

Dashboard, anual e radar já tinham populações diferentes e continuam assim. Não existe `CashFlowBaseContext`.

# Gargalo

O caminho quente, com a flag desligada, é o Full Audit por pedido. O comentário do código fala em cerca de 28 consultas por pedido. Isso é teto de desenho, não um `queryCount` medido. Spotlight e a segunda query de YTD também estão no JSON do dashboard. Nenhum dos três foi cronometrado nesta máquina: PostgreSQL `localhost:5432` / `induscost` recusou a conexão (P1001). Não há Postgres, Docker nem WSL com distro aqui. Banco remoto, homologação e produção não foram usados.

# Arquitetura final

Os nove handlers HTTP do Fluxo resolvem `resolveCashFlowProjectionMode()`:

- dashboard
- export CSV
- audit
- annual-comparison
- daily-radar
- daily-radar/cost-centers
- daily-radar/cost-centers/titles
- daily-radar/export-data
- daily-radar/export.xlsx

Flag diferente de `"1"`: todos seguem legacy. Flag `"1"`: todos usam `loadCashFlowOrderProjections` e os mesmos builders do schedule. Não há fallback silencioso de light para `getOrderFullAudit`.

No light, cliente e portfólio são selecionados em paralelo, os ids são unidos e o loader roda uma vez. O merge mantém a regra anterior: o contexto de portfólio sobrescreve o de cliente. Relatório executivo, tesouraria, rotas de Contas a Receber, detalhe do pedido, comissão e auditoria 360º não leem a flag e permanecem legacy.

Falha de um pedido continua isolada (o restante do forecast permanece) e incrementa `orderProjectionFailures`. O contador não entra no payload HTTP.

# Legacy × Light

A fronteira comparável é o schedule:

```text
LEGACY  getOrderFullAudit → buildEffectiveScheduleInputFromAudit → buildSalesOrderEffectiveFinancialSchedule
LIGHT   loadCashFlowOrderProjections → os mesmos dois builders
```

O runner é `scripts/runCashFlowLightProjectionShadow.ts`. Dinheiro é comparado como escalar exato, sem tolerância de centavo.

Nesta missão o runner não executou contra dados.

```text
orders compared:     não executado
titles compared:     não executado
schedules compared:  não executado
mismatches:          desconhecido
```

Zero divergências não foi provado. Status do shadow: não executado.

# Divergências encontradas

Nenhuma divergência de dado foi observada, porque o shadow não rodou. Nenhuma foi corrigida no motor financeiro. Divergências restantes: desconhecidas até o shadow live.

Riscos já caracterizados em teste de unidade, e não recontados em carteira real: ordem dos CR, `dataMovimentacao` vinda do fact, omissão inerte de `stockDocumentItems` e `nfeNumbers`, `new Date()` nos dois caminhos, `nfeByExternalId` ausente no light (não entra no input do schedule).

# Correções

Não houve correção de fórmula. O que mudou:

- uma flag para todos os handlers HTTP do Fluxo, para tela, export, audit e radar não divergirem de fonte quando o light for ligado;
- uma chamada do loader light quando cliente e portfólio se sobrepõem;
- telemetria `fullAuditCalls`, `lightLoaderCalls`, `lastProjectionMode`, `orderProjectionFailures`;
- matemática testável do teto de 80, sem inventar valor dos pedidos excluídos.

# Consumers

| Superfície | Mesma flag do dashboard | Comparado em dados |
|---|---|---|
| Dashboard | sim | não executado |
| Export do dashboard | sim | não executado |
| Anual | sim | não executado |
| Radar | sim | não executado |
| Export do radar | sim | não executado |
| Audit | sim | não executado |
| Centros de custo do radar | sim | não executado |

Relatório executivo, tesouraria e 360º ficam de fora de propósito.

Precedência do motor, coberta por teste de schedule e não por carteira viva: CR real substitui documento de saída válido, que substitui a previsão residual do pedido. PV + NF + DS + CR não são somados. `arRealizedOnlyRows` alimenta só o realizado de baixa fora do ano filtrado. No AP, `dueDate` continua o eixo oficial; `settlementDate` é baixa administrativa; `paymentDate` e `scheduleDate` não substituem o vencimento nesse eixo.

# Spotlight

Não foi separado do dashboard. Não há antes/depois de conteúdo. Valores, centros, fornecedores, meses e anos do spotlight não foram alterados por esta missão.

# Receipts

`loadCashFlowArCanonicalCash` continua com duas leituras: eventos de recebimento e soma YTD. A janela YTD usa meia-noite local e a coluna `receiptDate` é `DATE`. Fundir as duas em memória poderia mudar o centavo. Não foi fundido.

# AP concurrency

O `findMany` de contas a pagar continua depois da projeção de pedidos. Não foi paralelizado: não houve medição de pool e o risco de piorar a disputa de conexões ficou sem prova.

# O2C facts

O loader light ainda lê todos os runs e escolhe o de `createdAt` mais recente em memória, a mesma regra do audit. O volume lido não foi reduzido. Sem `EXPLAIN`, um recorte poderia escolher outro run.

# Performance before/after

Não medido. O script oficial `npm run perf:cash-flow:baseline` falha em `resolveNomusArReportSyncCutoffFromPrisma` com P1001.

```text
Metric                 Before        After         Delta
Dashboard ms           não medido    não medido    —
Dashboard queries      não medido    não medido    —
Annual ms              não medido    não medido    —
Annual queries         não medido    não medido    —
Radar ms               não medido    não medido    —
Radar queries          não medido    não medido    —
Full audit calls       não medido    não medido    —
Payload                não medido    não medido    —
```

Contrato de código, com a flag `"1"`, no enrich que tem cliente e portfólio sobrepostos: `fullAuditCalls = 0` e `lightLoaderCalls = 1`. Isso está no teste `cashFlowProjectionExecution.test.ts`. Não é tráfego real.

`dbMs` da instrumentação soma operações Prisma e pode ultrapassar o tempo de parede quando há query paralela. Espera de pool não é coletada.

# Query count

Não há contagem de runtime. O teto 80 × ~28 não é o `queryCount` de uma abertura.

# PORTFOLIO_ORDER_LIMIT

```text
configuredLimit:              80
maximumCandidatesObserved:    não medido
maximumProcessed:             não medido
limitReached:                 desconhecido
excludedOrders:               não medido
```

O limite não foi aumentado. `legacy == light` não provaria forecast completo: os dois caminhos compartilham o teto.

# Testes

Suíte focada de fluxo, schedule, reconciliação, regras de AR e regras de AP, em 2026-10-02:

```text
tests 477
pass 477
fail 0
```

Inclui precedência CR sem documento (não soma CR + parcela do pedido), entrega parcial, golden do schedule, flag, execução light sem Full Audit, teto de 80, reconciliação de caixa, YTD, radar, export do radar e paridade canônica realizada.

`npm run lint` (`tsc --noEmit`) sai com código 2. 1373 erros `error TS`. Nenhum está nos arquivos novos desta branch. Os dois erros em `src/lib/financeCashFlowRoutes.ts` (`validation.error` em `DailyRadarCustomPeriodValidation`) estão em linhas que o diff da branch não altera. Classificação: PREEXISTING. NEW nos arquivos desta missão: 0.

`npm run build` (Vite) concluiu com exit 0 em 21,70s. O aviso de chunk acima de 500 kB é o bundle existente (`main`), não um artefato desta missão.

`git diff --check` na árvore commitada, depois da limpeza de espaço no fim de linha destes documentos: sem erro de whitespace.

# Riscos restantes

1. Shadow live não executado. Ligar a flag em homologação antes disso pode publicar forecast diferente do legacy sem que a tela e o CSV discordem entre si — os dois passariam a usar a fonte light juntos.
2. Teto de 80 pode estar cortando pedidos. A quantidade e o valor excluído são desconhecidos. O valor não foi estimado.
3. Benchmark ausente. Não há prova de que o light é mais rápido nesta base, só o desenho (lote contra N auditorias).
4. Spotlight e a segunda query de YTD continuam no caminho do dashboard.
5. Lint oficial do repositório já falha por erros anteriores a esta missão.

# Rollback

Operacional, não é fallback de runtime. Para voltar ao Full Audit no Fluxo:

```text
remover INDUSCOST_CASH_FLOW_LIGHT_PROJECTION
ou definir qualquer valor que não seja exatamente 1
```

Reiniciar o processo depois da mudança de env. `"true"`, `"yes"`, `"on"` e valor ausente já significam legacy. Código de 360º, comissão e relatório executivo não depende dessa variável.

Rollback de código: permanecer em `main` (`ab39ab435ade27297fe25210847701cdeb194f79` na abertura desta missão) ou não fazer merge desta branch.

# Homologação

Não implantado.

O roteiro oficial encontrado (`docs/fleet/deploy-servidor.md` e `scripts/fleetServerDeployValidate.sh`) faz `git pull` de `origin/main` em `/opt/induscost` e pode reiniciar o processo na porta 3000. Esse host é descrito como produção/homologação no mesmo caminho. Exigiria merge em `main` ou alcançaria o servidor compartilhado. Por isso não foi executado.

Na segunda-feira, antes de qualquer flag:

```text
npx tsx scripts/runCashFlowLightProjectionShadow.ts --limit=80
npm run perf:cash-flow:baseline
```

Somente contra o banco local ou de homologação já isolado. Se o shadow não for zero divergências não explicadas, manter a flag fora de `"1"`.

Deploy de homologação, se e somente se o destino for um checkout que não é produção e o procedimento não for merge em `main`:

```text
git fetch origin
git checkout perf/cash-flow-light-hardening
```

Não usar `./scripts/fleetServerDeployValidate.sh` enquanto ele puxa `origin/main` em `/opt/induscost`.

# Auditoria independente de fechamento

Releitura do código em 2026-10-02, sem usar o relatório anterior como prova. HEAD de código da missão: `fbd071d`. Este arquivo é documentação.

## O que o código confirma

- Não existe `CashFlowBaseContext`, `CashFlowReadModel` nem cache financeiro novo desta missão.
- Não há migration nem índice criado pela missão.
- `resolveCashFlowProjectionMode()` aparece nove vezes, uma em cada handler HTTP do Fluxo: audit, dashboard, export, annual-comparison, daily-radar, cost-centers, titles, export-data, export.xlsx. Todos passam o modo ao loader. Os loaders nascem `"legacy"`.
- Relatório executivo, tesouraria, rotas de Contas a Receber, detalhe do pedido e comissões não leem a flag. `getOrderFullAudit` permanece nesses módulos.
- O ramo light de `buildFinanceArEffectiveContextsFromLightProjection` e `buildLightOrderContextGroups` não chama `getOrderFullAudit` e não tem `catch` que volte ao legacy. Falha de pedido incrementa `orderProjectionFailures` e segue nos demais.
- Cliente e portfólio no light viram uma união e uma chamada de `loadCashFlowOrderProjections`.
- Dashboard usa filtros da página mais janela de baixa. Annual usa `createAnnualComparisonBaseFilters` e o ano da query só escolhe o gráfico. Radar usa carteira aberta, sem período, e `arRealizedOnlyRows` vazio.
- Annual e radar no frontend usam `useSectionVisible` (`IntersectionObserver`) e `AbortController`. O dashboard também aborta o fetch ao trocar filtro.
- `cf:dashboard` continua sendo o fim do JSON do dashboard, que ainda inclui o spotlight. A métrica não foi redefinida.
- Spotlight, a segunda query de YTD, o `findMany` de AP depois da projeção e a leitura de todos os runs O2C permanecem. Sem medição, não foram alterados.
- Export CSV e audit da tela usam `loadCashFlowRows` com a mesma flag do dashboard. O CSV é `buildFinanceCashFlowExportCsv` do mesmo payload do builder, com o YTD canônico injetado na rota, no mesmo campo que a tela grava em `cashReceivedYtd`.

## O que não foi comprovado

`127.0.0.1:5432` responde `ECONNREFUSED`. Não há `psql`, `pg_ctl` nem Docker nesta máquina. `DATABASE_URL` aponta para `localhost` / `induscost`. Banco remoto, homologação e produção não foram acessados. Um shadow em banco vazio não seria população representativa e não seria aceito como zero divergências.

```text
orders compared: não executado
schedules compared: não executado
mismatches: desconhecido
benchmark before/after: não medido
PORTFOLIO_ORDER_LIMIT em dados: não medido (configurado = 80)
```

Por isso o status permanece NÃO APROVADO. A única dependência externa restante é um PostgreSQL local ou de homologação isolada, com a carteira real, para shadow e benchmark.
