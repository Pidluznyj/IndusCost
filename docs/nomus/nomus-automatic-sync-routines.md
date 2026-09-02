# SYNC-07 — Rotinas automáticas no CRUD canônico Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-07 (roteamento canônico; ops presence permanece em SYNC-07 policy) |
| **Pré-requisitos** | SYNC-01…06 |
| **Atualizado** | 2026-08-03 |
| **Escopo** | Entradas automáticas/manuais → `runNomus*Sync` · **sem** novo sincronizador/agendador · **sem** mudança de consumidores |

---

## Checklist

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Rotinas automáticas? | Pedidos ~2h; CR/CP `17 */2`; Propostas `37 * * * *` (SYNC-07); daily comercial (customers/products/bom/proposals, 02:00) |
| 2 | Onde registradas? | crontab host + `package.json` + spawn admin |
| 3 | cron + systemd + scheduler interno? | Só cron host; **sem** systemd Nomus; **sem** cron Node |
| 4 | npm/shell? | Ver matriz |
| 5 | Painel = mesmo serviço? | **Sim** — shell → npm → `runNomus*Sync` |
| 6 | Orquestrador diário? | Chama npm filhos; **não** inclui SO/AR/AP no `runNomusDailySync.sh` (propostas continua incluída, agora também horária) |
| 7 | Locks? | Global (daily/SO), AR, AP, entity canonical, reconcile, propostas (entity + probe do global) |
| 8 | Ignora lifecycle? | RECENT_WINDOW não avalia ausência (por contrato) |
| 9 | Hooks duplicados? | Mitigado: uma vez por run + correlationId; preview sem hooks |
| 10 | full_refresh parcial? | **Sim** — label ≠ COMPLETE; ausência fail-closed |

---

## Matriz

| Entidade | Disparador | Frequência | Script | Estratégia | Escrita | Lock | Serviço canônico |
|----------|------------|------------|--------|------------|---------|------|------------------|
| Pedidos | SCHEDULED_HOURLY | ~2h | `runNomusSalesOrdersSync.sh` | RECENT_WINDOW | sim | global + entity | `runNomusSalesOrdersSync` |
| Pedidos | CLI wide | ad-hoc | `runNomusSalesOrdersWideReconciliation.sh` | FULL_RECONCILIATION | sim | global + entity | idem |
| Pedidos | ORCHESTRATOR | manual `sync:nomus:all` | `nomusSyncOrchestrator.ts` | RECENT_WINDOW | sim | child | idem |
| CR | SCHEDULED_HOURLY | `17 */2` | `runNomusAccountsReceivableSync.sh` | FULL_RECONCILIATION* | sim | AR | `runNomusAccountsReceivableSync` |
| CR | ADMIN_PANEL | on demand | mesmo shell | idem | sim | AR | idem |
| CP | SCHEDULED_HOURLY | `17 */2` | `runNomusAccountsPayableSync.sh` | FULL_RECONCILIATION* | sim | AP | `runNomusAccountsPayableSync` |
| CP | ADMIN_PANEL | on demand | mesmo shell | idem | sim | AP | idem |
| Propostas | SCHEDULED_DAILY | `0 2 * * *` | `runNomusDailySync.sh` (via orquestrador, `--only=proposals`) | full scan (sem checkpoint — arquitetura atual não é incremental) | sim | propostas (entity) | `nomusProposalsSyncV1.ts` (`sync:nomus:proposals:apply`) |
| Propostas | SCHEDULED_HOURLY | `37 * * * *` | `runNomusProposalsHourlySync.sh` (SYNC-07) | full scan (idem) | sim | propostas (entity) + probe do lock global | idem |
| Recebimentos | SCHEDULED_DAILY | `50 3 * * *` | `runNomusReceivableReceiptsSync.sh` | full scan página 1→fim (endpoint sem parâmetro de janela comprovado) | sim | recebimentos (entity) | `nomusReceivableReceiptsSync.ts` (`sync:nomus:receipts:fullscan:apply`) |

\* Label legado `full_refresh_upsert` **não** prova completude.

---

## Serviços canônicos

```
runNomusSalesOrdersSync
runNomusAccountsReceivableSync
runNomusAccountsPayableSync
```

Path: `src/lib/nomus/nomusCanonicalSync.server.ts`  
Contrato: `src/lib/nomus/nomusCanonicalSyncContract.ts`

Todo request declara: entity, strategy, mode, scope, sourceTrigger, allowMissing*, requestedBy, correlationId.

### Estratégias

| Strategy | CREATE/UPDATE/REACTIVATE | Ausência |
|----------|-------------------------------|----------|
| RECENT_WINDOW | sim | **nunca** |
| FULL_RECONCILIATION | sim | só payload COMPLETE + flag |
| TARGETED_LOOKUP | alvo | só o alvo, com flag |

---

## Rotina horária de Pedidos

- `strategy = RECENT_WINDOW`
- `allowMissingDetection = false`
- `allowMissingConfirmation = false`
- Cria/atualiza/reativa/lastSeenAt
- **Não** incrementa missing nem confirma ausência
- Pedidos fora da janela permanecem inalterados

---

## Orquestrador diário

Ordem oficial preservada: customers → products → bom-components → proposals (`runNomusDailySync.sh`).

`nomusSyncOrchestrator` pode incluir `sales-orders` com env explícito `RECENT_WINDOW` / `ORCHESTRATOR`.

Falha em uma etapa: registrada; **não** inventa payload completo; **não** confirma ausências.

---

## CR / CP automáticos

Escopo real: janela de vencimento + `apenasPendentes` (env).  
Automático inicia com ausência **off** (`ALLOW_MISSING_DETECTION=0`).  
CREATE/UPDATE/reativação de retornados ativos.

---

## Locks

| Nome | Path / uso |
|------|------------|
| `nomus-orchestrator-global` | flock daily + SO shells (`/tmp/induscost-nomus-sync-global.lock`) |
| `nomus-sales-orders` | entity canonical SO |
| flock CR (shell) | `/tmp/induscost-nomus-accounts-receivable.lock` (`NOMUS_AR_SYNC_LOCK_FILE`) |
| canonical CR (TS) | `/tmp/induscost-nomus-accounts-receivable.canonical.lock` (`NOMUS_ACCOUNTS_RECEIVABLE_CANONICAL_LOCK_FILE`) |
| flock CP (shell) | `/tmp/induscost-nomus-accounts-payable.lock` (`NOMUS_AP_SYNC_LOCK_FILE`) |
| canonical CP (TS) | `/tmp/induscost-nomus-accounts-payable.canonical.lock` (`NOMUS_ACCOUNTS_PAYABLE_CANONICAL_LOCK_FILE`) |
| propostas (TS, PID+token) | `/tmp/induscost-nomus-proposals.lock` (`NOMUS_PROPOSALS_SYNC_LOCK_FILE`) — dentro de `nomusProposalsSyncV1.ts`; único ponto de entrada (CLI, orquestrador diário, cron horário), então um só lock basta |
| flock Recebimentos (shell) | `/tmp/induscost-nomus-receivable-receipts.lock` (`NOMUS_RECEIPTS_SYNC_LOCK_FILE`) — exclusivo da entidade; **não** adquire o lock global (OP-04) |

OP-04: flock e lock canônico **não** compartilham pathname (evita autolock `SKIPPED_LOCKED`).
Colisão real (segunda execução da mesma entidade) → `SKIPPED_LOCKED` (não destrutivo).

Propostas segue o padrão mais recente (OP-11, Ordens de Produção): lock de
entidade PID+token (não mata processo vivo; PID morto é reclaimado) **e**
probe (não aquisição) do lock global diário/pedidos via
`probeGlobalNomusSyncLockHeld`. O runner diário (`runNomusDailySync.sh`) já
detém o lock global durante todo o pipeline — por isso ele exporta
`NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0` antes de chamar o passo de propostas,
evitando autolock; o cron horário roda com o default (`=1`, verifica).
Bloqueado por lock → sync devolve `status:"SKIPPED"` no JSON de stdout,
exit code 0 (não é falha), sem avançar nenhum estado. O orquestrador lê esse
campo e reporta o step como `SKIPPED` (não `SUCCESS`) no `IntegrationRun`.

---

## Hooks pós-sync

| Hook | SO | CR | CP | Preview |
|------|----|----|----|---------|
| commissionMaterialization | sim | sim | não | não |
| crmCommercialOwnerAutoAssign | sim | não | não | não |
| productionOrdersAfterSalesOrders | sim | não | não | não |
| salesOrderFlowRecompute | sim | não | não | não |

Uma vez por run; correlationId em env; falha de apply → não roda.

---

## Flags (independentes)

```
NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED
NOMUS_SOURCE_RECONCILE_AR_ENABLED
NOMUS_SOURCE_RECONCILE_AP_ENABLED
NOMUS_OPS_EXCLUDE_MISSING_*   # consumidores — não alterados aqui
```

Estado seguro inicial: CREATE/UPDATE on; ausência automática off/preview; ops exclude off.

---

## Painel

AR/AP: `NomusAccounts*SyncCard` → runners com `SOURCE_TRIGGER=ADMIN_PANEL`.  
Backend rejeita `allowMissingConfirmation` em estratégia incompatível (`sanitizeAdminMissingFlags`).

---

## Propostas — rotina horária (SYNC-07)

Propostas **não tem arquitetura incremental** hoje (sem checkpoint/janela —
diferente de Documentos de Saída, que tem `checkpoint_overlap`). Cada
execução é um full scan das propostas Nomus, limitado apenas por
`NOMUS_PROPOSAL_START_DATE` (piso fixo, opcional) e `NOMUS_MAX_PAGES`. Rodar
de hora em hora repete esse full scan 24x/dia — mesmo comportamento do sync
diário, só que mais frequente; é o custo aceito para atender ao requisito de
quase-tempo-real. Não foi criado um motor incremental novo (fora de escopo:
"reutilize a implementação oficial"). Se o volume/latência da API Nomus virar
problema, considerar (fora deste ticket) ajustar `NOMUS_PROPOSAL_START_DATE`
para uma janela mais curta ou pedir suporte a filtro incremental no endpoint
`propostas` do Nomus.

Instalação no crontab do host:

```bash
37 * * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusProposalsHourlySync.sh apply >> /var/log/induscost-nomus-proposals-cron.log 2>&1
```

### Robustez HTTP (timeout por tentativa)

Incidente real: em produção, uma execução ficou presa por mais de 20 minutos
com o processo Node vivo, ~0% de CPU, conexão HTTPS estabelecida com o Nomus
e sem log novo — o `fetch` original não tinha timeout nem `AbortSignal`, então
uma conexão que ficasse aberta sem responder nunca disparava o retry. O cron
horário ficou pausado até a correção abaixo.

Correção: `nomusProposalsSyncV1.ts` não reimplementa mais o fetch/retry
localmente — passou a usar o cliente HTTP compartilhado Nomus
(`src/lib/nomusRestClient.ts::fetchNomusJson`, o mesmo já usado por AR/AP/
NF-e/pedidos/Documentos de Saída). Esse cliente:

- cria um `AbortController` por tentativa e aborta em `NOMUS_HTTP_TIMEOUT_MS`
  (padrão **60000ms**; nunca fica sem timeout — ausente/inválido cai no
  padrão, nunca em "desligado"; limites: mínimo 1000ms, máximo 300000ms,
  fora da faixa é ajustado com aviso no log, nunca lança exceção nem vaza o
  valor bruto de env);
- trata timeout (`AbortError` interno) e erros transitórios de rede
  (`ECONNRESET`, `ETIMEDOUT`, `EAI_AGAIN`, `ECONNREFUSED`, `EPIPE`,
  `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT` — via `error.code`/
  `error.cause.code`) com o mesmo backoff exponencial já usado para HTTP
  429/5xx — nunca retry indiscriminado: erro HTTP 4xx permanente continua
  falhando na hora;
- preserva 100% do tratamento de HTTP 429 (`tempoAteLiberar`, `Retry-After`)
  e HTTP 5xx já existente;
- loga progresso estruturado por tentativa: `HTTP_START` / `HTTP_SUCCESS` /
  `HTTP_RETRY` (com motivo e próxima espera) / `HTTP_FAILED`, sempre com
  `logPrefix=[nomus-proposals]`, sem token/Authorization no log;
- o timer é sempre limpo (`clearTimeout` em `finally`) em sucesso, erro HTTP
  e timeout — nunca deixa um handle pendurado.

A chamada de `fetchPricingSnapshotUnitCost` (API interna do próprio
IndusCost, não do Nomus) também ganhou `AbortController`/timeout — o mesmo
sintoma (processo vivo, sem CPU, esperando HTTP para sempre) poderia
acontecer ali também, mesmo não sendo uma chamada Nomus.

Toda execução agora grava um `IntegrationRun` (`target="proposals"`) em
`SUCCESS`, `FAILED` ou `SKIPPED` — nunca fica `RUNNING` indefinidamente:

- **SKIPPED** — lock (próprio ou global) ocupado; `exitCode=0`,
  `success=false` (nunca conta como sincronização bem-sucedida);
- **SUCCESS** — dry-run ou apply concluído; contadores extraídos do próprio
  `summary`/`applied` já produzidos pelo motor (nada recalculado só para o
  registro);
- **FAILED** — qualquer erro real (inclusive timeout esgotado); gravado
  ANTES de relançar o erro, preservando `exitCode=1` para o shell/orquestrador.

O runner horário (`runNomusProposalsHourlySync.sh`) agora exporta
`NOMUS_PROPOSALS_RUNNER_LOG=$RUN_LOG` (mesma convenção de
`NOMUS_AR_RUNNER_LOG`), para o `IntegrationRun.logFile` apontar pro log real
da execução.

**Limite total do runner**: não implementado nesta correção — não há dados
históricos de duração normal desta rotina disponíveis nesta sessão (sem
acesso a produção) para calibrar um valor seguro sem arriscar matar
execuções longas legítimas. Recomendação: uma vez reativado o cron, coletar
alguns ciclos reais de duração (via os novos `IntegrationRun.durationMs`) e
só então avaliar um `timeout --signal=TERM --kill-after=30s` no runner
horário, calibrado pela duração observada + margem.

## Comandos manuais equivalentes

```bash
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:sales-orders:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-receivable:apply
NOMUS_CANONICAL_SOURCE_TRIGGER=CLI npm run sync:nomus:accounts-payable:apply
npm run sync:nomus:proposals:hourly:apply   # roda o runner horário localmente (log + orquestrador --only=proposals)
```

---

## Código

## Recebimentos — rotina diária (fonte da competência de comissão)

`NomusReceivableReceipt.receiptDate` (← Nomus `dataRecebimento`) é a fonte
**oficial da competência** da comissão. O `settlementDate` do Contas a Receber
permanece apenas como baixa administrativa/auditoria e não foi alterado.

### Por que full scan, e por que só uma vez ao dia

`GET /rest/recebimentos` aceita **apenas** `pagina` — 50 registros por página.
Não há parâmetro comprovado de `dataModificacao`, `dataRecebimento`, `since`,
cursor, id mínimo nem ordenação, e **a ordenação do endpoint não é**
**contratual**. Sem eixo incremental confiável, qualquer recorte seria
adivinhação: a rotina automática varre da página 1 até o fim real da paginação
e **nunca** usa `--since`.

Custo medido no full scan de produção de 02/09/2026: 96 páginas, 4.789
registros, ~12 minutos, 12 respostas HTTP 429 — todas recuperadas pelo
retry/backoff do cliente compartilhado. Esse custo é aceitável uma vez por
dia; a cada 2 horas não seria. Daí a janela isolada das **03:50**, entre o
daily das 02:00 e o AR/AP das :17/:47.

### Truncamento nunca passa por sucesso

Para uma fonte financeira, uma carga truncada que se apresenta como sucesso é
pior que nenhuma carga. O comando canônico passa `--require-full-scan`, e o
script só termina em `exit 0` quando consegue **provar** a cobertura:

| Condição | `status` | exit |
|----------|----------|------|
| começou na página 1, sem recorte, terminou em página vazia ou fim de paginação | `SUCCESS` | 0 |
| parou por `maxPages`, `--page`, `--startPage` ou `--since` | `INCOMPLETE` | 1 |
| qualquer erro de gravação (`erros_gravacao > 0`) | `FAILED` | 1 |
| completa, porém com IDs locais ausentes na origem | `SUCCESS_WITH_WARNINGS` | 0 (1 com `--fail-on-missing`) |

Os bloqueios ficam em `varredura_bloqueios` no resumo JSON
(`STARTED_AFTER_FIRST_PAGE`, `SINGLE_PAGE`, `STOPPED_BY_MAX_PAGES`,
`SINCE_WINDOW_APPLIED`, `STOPPED_BY_SINCE`, `NO_TERMINAL_PAGE`).

Execução manual recortada (`--page 3`, `--since`) continua terminando em 0:
sem `--require-full-scan` o contrato antigo é preservado.

### Ausência na origem: audita, nunca apaga

Só quando há **prova de varredura completa**, o script compara os IDs locais
com os IDs devolvidos pela origem e reporta `ausentes_na_origem` +
`ausentes_na_origem_ids` (amostra de até 50), com um `ALERTA` no log.

**Nada é apagado, nenhum estorno é inventado, nenhuma comissão é alterada.**
O payload não expõe `deleted`, `cancelled` nem status de estorno — sem
contrato documental que prove semântica de exclusão, apagar um recebimento
seria inventar um fato financeiro. Mesma disciplina do lifecycle canônico:
detecção ≠ confirmação.

É **aviso** por padrão (exit 0) e não falha: a condição pode ser permanente, e
um cron que falha toda noite vira alerta ignorado e acaba desligado. Quem
quiser escalar para falha operacional usa `--fail-on-missing`.

Um payload que passou a falhar o mapeamento continua contando como
**observado** na origem — senão a reconciliação geraria alarme falso.

### Idempotência

Identidade canônica: `externalId` (o `recebimentos.id` do Nomus).
Inexistente → create; `payloadHash` mudou → update; igual → unchanged.

`syncedAt` é atualizado **também** nos `unchanged`, de propósito: ele significa
"registro reobservado na origem nesta varredura", não "registro alterado". Com
o full scan diário, é justamente essa marca que dá evidência de frescor da
carga inteira — inclusive das linhas que não mudaram. Não trocar por
micro-otimização sem substituir essa evidência por outra.

### Cron a instalar (após deploy e validação)

> **Ainda NÃO instalado.** Instalar apenas após deploy e uma execução
> `preview` validada no servidor.

```bash
50 3 * * * root INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusReceivableReceiptsSync.sh apply >> /var/log/induscost-nomus-receipts-cron.log 2>&1
```

Não existe fonte versionada do cron neste repositório — o agendamento vive em
`/etc/cron.d/induscost-production` no host, e esta seção é a referência
versionada dele.

**Correção operacional pendente no host:** `/etc/cron.d/induscost-production`
contém um comentário afirmando que o arquivo "não é lido automaticamente".
Isso é **falso** — foi comprovado que o cron processa esse arquivo. O
comentário deve ser corrigido no mesmo passo de deploy, antes que alguém
confie nele e edite o arquivo achando que não tem efeito.

---

| Peça | Path |
|------|------|
| Contrato | `src/lib/nomus/nomusCanonicalSyncContract.ts` |
| Gateway | `src/lib/nomus/nomusCanonicalSync.server.ts` |
| Testes | `src/lib/nomus/nomusCanonicalSyncContract.test.ts` |
| Runbook lifecycle | `docs/nomus/nomus-source-reconciliation-runbook.md` |
| Propostas — constantes/lock | `src/lib/nomusProposalsSyncConstants.ts`, `src/lib/nomusProposalsSyncLock.ts` (+ `.test.ts`) |
| Propostas — script oficial (reusado) | `scripts/nomusProposalsSyncV1.ts` (+ `nomusProposalsSyncV1Wiring.test.ts`) |
| Propostas — runner horário | `scripts/runNomusProposalsHourlySync.sh` |
| Propostas — auditoria (IntegrationRun) | `src/lib/nomusProposalsIntegrationRun.ts` (+ `.test.ts`) |
| Cliente HTTP compartilhado (timeout/retry central) | `src/lib/nomusRestClient.ts` (+ `.test.ts`) |
| Recebimentos — runner diário | `scripts/runNomusReceivableReceiptsSync.sh` |
| Recebimentos — script oficial | `scripts/nomusReceivableReceiptsSync.ts` |
| Recebimentos — lógica pura + testes | `src/lib/nomus/nomusReceivableReceiptsSyncLogic.ts` (+ `.test.ts`) |
