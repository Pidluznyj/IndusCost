# Mirror oficial de Pedidos de Compra Nomus (PURCH-MIRROR-01)

Data: 2026-09-04 (branch `feat/nomus-purchase-orders-mirror`).

**Atualização (mesma data, mesma branch) — NOMUS-CRON-02**: o cron fixo
independente originalmente proposto (`27 */2 * * *`) foi abandonado com
base em diagnóstico real de produção (rate limit/concorrência entre jobs
Nomus). Pedidos de Compra agora é disparado como trigger pós-Contas a
Receber — ver seção 10 (reescrita) para a arquitetura completa, a
justificativa e o comando de cron NOT EXECUTED.

## 1. Objetivo e autoridade

A operação real de Pedido de Compra acontece no ERP Nomus. Este documento
descreve a fundação de dados de um **novo mirror read-only** do Nomus para
Pedidos de Compra, seguindo a mesma filosofia arquitetural do mirror de
Pedidos de Venda (`SalesOrder`/`SalesOrderItem`):

```
NOMUS (fonte oficial) → IndusCost (stage/mirror) → normalização →
regras derivadas → APIs de leitura → (futuro) UI/indicadores
```

**Decisão explícita, registrada no repositório (não só em memória de
agente): `NomusPurchaseOrder` NÃO é o `PurchaseOrder` interno.**

- `PurchaseOrder` / `PurchaseOrderItem` / `PurchaseReceipt`
  (`src/lib/purchasing/*`) continuam sendo o **workflow interno formal** de
  compras: solicitação → cotação → adjudicação → pedido → recebimento, com
  aprovação, snapshots comerciais e integração com estoque/inventário. Esse
  fluxo **não foi alterado, nem desabilitado, nem teve dados migrados** por
  esta entrega.
- `NomusPurchaseOrder` / `NomusPurchaseOrderItem` são um **espelho read-only**
  do que o Nomus considera "Pedido de Compra" — puramente informativo/
  analítico, sem nenhuma ligação automática com o workflow interno nesta
  primeira versão (nenhum vínculo automático entre os dois é criado aqui).

## 2. API Nomus — contrato

**Endpoint escolhido**: `GET {NOMUS_BASE_URL}/rest/pedidoscompra` (lista) e
`GET {NOMUS_BASE_URL}/rest/pedidoscompra/{id}` (detalhe).

**Justificativa**: o repositório não tem nenhum coletor ou fixture prévio de
Pedido de Compra Nomus (confirmado por busca exaustiva por
`pedidoscompra`/`pedidos-compra`/`ordemcompra` em `src/`, `scripts/`,
`docs/`). O caminho acima segue a mesma família REST usada por
`/rest/pedidos` (Pedidos de Venda, ver `src/lib/nomusSalesOrdersClient.ts`) e
pelos demais coletores do repositório (Contas a Receber/Pagar, NF-e, Ordens
de Produção) — todos usam a convenção `/rest/<recurso-plural-pt-br>`. Neste
ambiente de execução não havia acesso à internet/à conta real do Nomus para
validar contra a documentação Postman citada na missão
(`documenter.getpostman.com/.../22813773`), então **o endpoint acima é uma
inferência bem fundamentada, não uma confirmação**. Por isso o caminho é
configurável sem alterar código:

```
NOMUS_PURCHASE_ORDERS_LIST_PATH=rest/pedidoscompra     # default
NOMUS_PURCHASE_ORDERS_DETAIL_PATH=rest/pedidoscompra   # default (+ "/{id}")
```

Se o probe real (seção 9) revelar um caminho diferente (ex.:
`v1/pedidos-compras`), basta setar essas duas envs — nenhum código muda.

**Autenticação / paginação / retry**: reaproveita 100% de
`src/lib/nomusRestClient.ts` (já usado por todos os coletores do
repositório) — `Authorization: Bearer NOMUS_TOKEN` (ou par de header
genérico `NOMUS_AUTH_HEADER_NAME`/`VALUE`), timeout por tentativa
(`NOMUS_HTTP_TIMEOUT_MS`, default 60s), retry exponencial com jitter
implícito via backoff (`NOMUS_RETRY_BASE_MS`, `NOMUS_MAX_RETRIES`), e
tratamento especial de 429 (lê `tempoAteLiberar` do corpo ou header
`retry-after`). **Só GET é exposto por este cliente — não existe caminho de
código para POST/PUT/PATCH/DELETE do lado do mirror.**

**Paginação**: `?pagina=N&tamanhoPagina=M`, com fim detectado por
`totalPaginas`/`totalPages`/`paginas` no corpo, ou `hasMore`, ou (heurística
final) página vazia. `src/lib/nomus/nomusPurchaseOrdersClient.ts` implementa
detecção de página repetida (fingerprint das linhas) e erro explícito ao
atingir `maxPages` sem prova de fim — nunca para silenciosamente achando que
terminou.

**Campos confirmados**: nenhum — este ambiente não pôde validar contra a
conta real. Os nomes de campo em `nomusPurchaseOrderPayload.ts` (idPedido,
codigoPedido, idFornecedor, dataEmissao, itens[].idProduto, etc.) seguem a
convenção observada nos outros coletores Nomus do repositório (pt-BR,
`idX`/`dataX`/`valorX`) e são lidos com **múltiplos candidatos de chave por
campo** (fallback defensivo) — um campo ausente vira `null`, nunca é
inventado. **Todos os nomes de campo devem ser reconfirmados pelo probe real
antes do backfill real** (seção 9).

**Status brutos do pedido/item**: mapa histórico documentado na missão
(1=Aguardando liberação … 8=Devolvido totalmente) foi usado como hipótese de
trabalho no motor de classificação (seção 5), mas **não foi validado contra
a API real** nesta entrega. O motor preserva sempre o código bruto
(`nomusStatusCode`/`nomusItemStatusCode`, string) e cai em `MISTO` /
`UNKNOWN` para qualquer código fora de 1..8 — nunca adivinha.

**Incertezas explícitas (não resolvidas nesta entrega)**:
- Caminho exato do endpoint (`rest/pedidoscompra` é inferência).
- Existência de filtro de período nativo (`dataEmissaoInicio`/`dataEmissaoFim`
  ou similar) — não usado aqui; o filtro de janela de 12 meses é feito
  client-side sobre `dataEmissao` após buscar a lista completa.
- Existência de `updatedAt`/`modifiedSince`/cursor/ETag para sync
  incremental real — não confirmado; ver seção 6.
- Se o campo de status do pedido (cabeçalho) é sempre coerente com os
  status dos itens, ou se só os itens carregam status confiável — o motor
  de fase (seção 5) deriva exclusivamente dos **itens**, ignorando um
  eventual status de cabeçalho pouco confiável.
- Se parcelas/NF-es vêm embutidas no payload do pedido ou em endpoint
  separado — nesta versão, tudo que não é campo explicitamente materializado
  fica preservado em `rawPayload` (ver seção 8), sem CRUD dedicado.

## 3. Modelo de dados

`prisma/schema.prisma`:

- `NomusPurchaseOrder` (cabeçalho) — `externalId Int @unique` (chave natural
  do Nomus), snapshots de empresa/fornecedor/comprador, datas, condições de
  pagamento, valores (frete/seguro/outras despesas/desconto/subtotal/total,
  todos `Decimal(20,6)`), `nomusStatusCode` (bruto, string), `derivedStage`
  (enum `NomusPurchaseOrderDerivedStage`), `rawPayload Json?`, `payloadHash`,
  e o bloco de lifecycle de presença (`sourcePresenceStatus`,
  `presentInLastPayload`, `firstSeenAt`, `lastSeenAt`, `missingSince`,
  `missingConsecutiveRuns`, `sourceRemovedAt`, `lastSyncRunId`) — mesmo
  padrão de `SalesOrder`. Índices em `code`, `issueDate`,
  `externalSupplierId`, `financialSupplierId`, `externalBuyerId`,
  `derivedStage`, `syncedAt`, `sourcePresenceStatus`, `lastSeenAt`,
  `lastSyncRunId`, `payloadHash`.
- `NomusPurchaseOrderItem` (linhas) — FK `purchaseOrderId` (cascade delete
  só quando o **cabeçalho** é removido, o que este mirror nunca faz),
  `externalItemId Int?` (id de linha do Nomus quando existir),
  **`lineNumber Int` + `@@unique([purchaseOrderId, lineNumber])`** como
  chave natural estável — usada mesmo quando `externalItemId` está ausente
  (resolvida por `resolveNomusPurchaseOrderItemLineNumber`: usa a
  `sequencia` do payload quando presente, senão a posição 1-based no array
  de itens). Isso evita tanto UUID aleatório a cada sync (quebraria
  idempotência) quanto depender de um id que a API pode não fornecer.
  Snapshots de produto, quantidades (pedida/atendida/pendente), preço,
  desconto, total, status bruto do item, e vínculos opcionais
  `materialId`/`inventoryItemId` + `productMatchStatus`.
- Enums novos: `NomusPurchaseOrderSupplierMatchStatus` (MATCHED/UNMATCHED/
  AMBIGUOUS), `NomusPurchaseOrderProductMatchStatus` (MATCHED/UNMATCHED),
  `NomusPurchaseOrderDerivedStage` (8 valores, seção 5).
- `NomusSourceSyncEntityType` ganhou o valor `PURCHASE_ORDER` (aditivo —
  reaproveita `NomusSourceSyncRun`, o registro tipado de execução já usado
  por Pedidos de Venda/CR/CP, em vez de criar uma segunda plataforma de
  audit log).
- Relações reversas aditivas: `FinancialSupplier.nomusPurchaseOrders`,
  `Material.nomusPurchaseOrderItems`, `InventoryItem.nomusPurchaseOrderItems`.

**rawPayload**: sempre preservado (cabeçalho completo em
`NomusPurchaseOrder.rawPayload`, item individual em
`NomusPurchaseOrderItem.rawPayload`) — nunca só os campos materializados.

**payloadHash**: `stableNomusPurchaseOrderPayloadHash` (`nomusPurchaseOrderPayload.ts`)
— SHA-256 de uma canonicalização recursiva (chaves ordenadas) do payload
bruto. Não inclui nenhum campo de sync local (`syncedAt`, `lastSeenAt`) —
hash é da fonte, não da execução. Comprovado por teste: mesmo conteúdo em
ordem de chaves diferente → mesmo hash; item alterado → hash diferente;
mesmo payload rodado 2x → hash idêntico (idempotência).

## 4. Autoridade e side effects proibidos

O mirror **nunca**:
- cria/atualiza `PurchaseOrder`, `PurchaseOrderItem` ou `PurchaseReceipt`
  internos;
- cria `InventoryMovement` ou `AccountsPayable`;
- altera estoque ou custo;
- chama POST/PUT/PATCH/DELETE no Nomus (o cliente HTTP subjacente só expõe
  GET — não há caminho de código para outro verbo).

Provado em teste (`nomusPurchaseOrdersSync.test.ts`): o Prisma fake usado no
teste de integração é embrulhado num `Proxy` que **lança** para qualquer
acesso a um model fora da allowlist (`financialSupplierAlias`,
`nomusProductCatalog`, `material`, `inventoryItem`, `nomusPurchaseOrder`,
`nomusPurchaseOrderItem`) — incluindo explicitamente
`accountsPayable`/`purchaseOrder` (o modelo interno)/`purchaseReceipt`/
`inventoryMovement`. O teste
`"nunca acessa AccountsPayable/PurchaseOrder interno/PurchaseReceipt/InventoryMovement"`
roda o sync completo (apply) contra esse fake e passa.

## 5. Matching de fornecedor

Fluxo (`nomusPurchaseOrderSupplierMatch.ts`):
`Nomus.externalSupplierId → FinancialSupplierAlias.externalSupplierId →
FinancialSupplier`.

- Exatamente 1 `supplierId` distinto entre os aliases que batem no
  `externalSupplierId` → `MATCHED`.
- Nenhum alias → `UNMATCHED` (não bloqueia a importação — o pedido entra
  mesmo assim).
- Mais de um `supplierId` distinto entre os aliases → `AMBIGUOUS` (nunca
  escolhe "o primeiro").
- Múltiplos aliases apontando pro **mesmo** `supplierId` não é ambiguidade.
- Nunca casa por nome/CNPJ textual sem o bridge oficial do alias.

O índice (`buildNomusSupplierAliasIndex`) é montado **uma vez por lote**
(um único `findMany` com `externalSupplierId IN (...)`) — sem N+1.

## 6. Matching de produto/material

Prioridade (`nomusPurchaseOrderProductMatch.ts` +
`nomusExternalId.ts::normalizeNomusExternalId`):
1. `externalProductId` oficial do item Nomus, casado via bridge
   `NomusProductCatalog.externalProductId → Material.code` **ou**
   `InventoryItem.nomusProductId` direto.
2. Nenhuma correspondência → `UNMATCHED` (não bloqueia a importação).

`normalizeNomusExternalId` é a função canônica única de normalização de
qualquer id externo Nomus no mirror (fornecedor, produto, pedido, item):
nunca perde valor, nunca transforma inválido em `0`, nunca remove zeros de
um **código** alfanumérico (só de um número puro, onde "007" e "7" são o
mesmo id), nunca vira a string `"null"`/`"undefined"`. Resolve a
inconsistência observada no schema entre `NomusProductCatalog.externalProductId`
(`String`) e `SalesOrderItem.externalProductId` (`Int`) comparando sempre
pela mesma chave normalizada.

O índice de bridge (`buildNomusProductMatchIndex`) também é montado em lote
(3 queries no total por sync, não por item): `NomusProductCatalog.findMany`
+ `Material.findMany` (por `code`) + `InventoryItem.findMany` (por
`nomusProductId`).

## 7. Motor de fase derivada (`derivedStage`)

`classifyNomusPurchaseOrderStage` (`nomusPurchaseOrderStageEngine.ts`) é
**puro** — recebe só os status brutos dos itens, nunca escreve de volta no
Nomus, nunca substitui o status bruto (sempre preservado à parte).

| Situação dos itens | `derivedStage` |
|---|---|
| Sem itens | `MISTO` (`NO_ITEMS`) |
| Algum item com status fora de 1..8 | `MISTO` (`UNKNOWN_STATUS_PRESENT`) — nunca adivinha |
| Todos cancelados (6) | `CANCELADO` |
| Todos devolvidos (7 e/ou 8) | `DEVOLUCAO` |
| Todos atendidos totalmente (4) | `CONCLUIDO` |
| Só (4) e (5), com pelo menos um (5) | `ATENDIDO_COM_CORTE` |
| Mistura de pendente (1/2/3) com já-resolvido (4/5/6/7/8) | `PARCIALMENTE_ATENDIDO` |
| Todos liberados (2) | `LIBERADO` |
| Todos aguardando liberação (1) | `AGUARDANDO_LIBERACAO` |
| Só parciais (3) | `PARCIALMENTE_ATENDIDO` |
| Qualquer combinação não coberta acima | `MISTO` (`UNMAPPED_COMBINATION`) |

16 casos de tabela testados em `nomusPurchaseOrderStageEngine.test.ts`,
incluindo o caso explícito da missão ("item atendido + item liberado nunca
vira CONCLUIDO").

## 8. Source presence

Reaproveita o enum `NomusSourcePresenceStatus` (PRESENT/MISSING_CANDIDATE/
MISSING_CONFIRMED) e o motor genérico `planNomusSourceReconciliation`
(`nomusSourceReconciliationEngine.ts`) — mesmo motor usado por Pedidos de
Venda/CR/CP, com `entityType: "PURCHASE_ORDER"` adicionado ao contrato
(`nomusSourceLifecycleContract.ts`).

**Decisão desta primeira versão**: `reconciliationEnabled: false` — o mirror
ainda não confirma ausência (`MISSING_CONFIRMED`) automaticamente. Motivo:
confirmar ausência com segurança exige provar que uma execução cobriu o
universo completo (`payloadComplete=true`), o que por sua vez depende de
validar a paginação/filtro de período reais contra a API (seção 2, ainda com
incertezas). Habilitar isso é trabalho futuro, gated por uma flag dedicada
(seguindo o padrão `NOMUS_OPS_EXCLUDE_MISSING_*_ENABLED` dos outros
coletores) — **nunca a decisão de excluir um pedido "sumido" deve ser tomada
sem essa prova**. Enquanto isso, pedidos já importados nunca são apagados
fisicamente nem escondidos — o campo fica `PRESENT` indefinidamente até essa
segunda fase ser implementada.

## 9. Backfill de 12 meses

`resolveNomusPurchaseOrdersBackfillWindow` (`nomusPurchaseOrdersBackfillWindow.ts`)
— pura, testada: 12 **meses-calendário** retroativos a partir da data civil
America/Sao_Paulo de referência (não 365 dias corridos — testado
explicitamente atravessando um fevereiro bissexto). `from` = 00:00:00 SP do
primeiro dia; `to` = 23:59:59.999 SP do último dia (ambos convertidos para
UTC com o offset fixo -03:00 — SP não observa horário de verão desde 2019).

Estratégia de paginação: sem confirmação de filtro de período nativo na API
(seção 2), o backfill **pagina a listagem inteira** (bounded por
`--max-pages`, default 500) e filtra client-side por `dataEmissao` dentro da
janela. Detail é buscado com concorrência limitada (`--detail-concurrency`,
default 4) para todo pedido dentro da janela — nunca dispara N requisições
sem controle.

Todos os status são importados, incluindo cancelados/devolvidos/concluídos
históricos — não há filtro de status no backfill.

## 10. Agendamento — trigger pós-Contas a Receber (NOMUS-CRON-02)

`npm run sync:nomus:purchase-orders:sync:apply` (strategy `recent-window`,
sem janela de data — reprocessa a listagem completa a cada execução e
resolve create/update/unchanged por `payloadHash`, sem inventar cursor:
não há confirmação de `updatedAt`/`modifiedSince` no contrato desta API,
então a estratégia robusta adotada é uma **sincronização periódica
idempotente** (`periodic idempotent synchronization`) — listar tudo →
detail para create/update prováveis → resolver por hash — e explicitamente
**não** uma sincronização incremental real (não existe cursor/
`updatedSince` confirmado; ver seção 2). Runner:
`scripts/runNomusPurchaseOrdersSync.sh apply` — wrapper com lock de shell
próprio (`flock`, defesa em profundidade) por cima do lock de processo
(`nomusPurchaseOrdersSyncLock.ts`, arquivo em `os.tmpdir()`, portável
Windows/Linux — desvio deliberado do default POSIX-only `/tmp/...` dos
outros locks do repositório, que o CODEBASE_MAP.md já documenta como
pegadinha em dev Windows).

### 10.1 O que mudou e por quê

A proposta original desta missão era um **cron fixo independente**:
`27 */2 * * *` chamando `scripts/runNomusPurchaseOrdersSync.sh apply`
diretamente. **Essa estratégia foi ABANDONADA** com base em diagnóstico real
feito em produção (fora deste ambiente de execução, apenas observado —
nenhum acesso a produção/homologação foi feito nesta entrega):

- O cron Nomus real em produção tem, entre outros: `00 02 * * *` (daily),
  `17 */2 * * *` (Contas a Receber), `7 1-23/2 * * *` (NF-e), `47 */2 * * *`
  (Contas a Pagar), `17 * * * *` (Pedidos de Venda → Documentos de Saída),
  `37 * * * *` (Propostas), `50 3 * * *` (Recebimentos).
- NF-e faz full scan de ~160 páginas / ~8 mil registros, recebe HTTP 429
  regularmente (o cliente oficial espera o `tempoAteLiberar` informado pelo
  Nomus e tenta de novo) e a execução normalmente leva de ~8 a ~11 minutos,
  podendo chegar a ~17 minutos.
- Um Contas a Receber iniciado às 14:17 só terminou às 14:38:24 — mais que
  o dobro do esperado para um job de 2h.
- Conclusão: **escolher um minuto "aparentemente vazio" na grade de cron
  não garante ausência de concorrência.** Qualquer minuto fixo escolhido a
  priori é uma aposta, não uma garantia — os jobs vizinhos variam de
  duração e podem se sobrepor de forma imprevisível.

**Nova estratégia**: Pedidos de Compra deixa de ter cron próprio e passa a
ser disparado como **trigger** logo após o runner de Contas a Receber (que
já roda a cada 2h, `17 */2 * * *`) terminar:

```
cron AR (17 */2 * * *)
  → Accounts Receivable executa
  → AR termina (libera seus próprios recursos/lock)
  → dispara Purchase Orders
  → Purchase Orders adquire seu próprio lock de entidade
    (+ probe do lock global Nomus, ver 10.3)
  → sincroniza
  → libera lock
```

O horário passa a ser **consequência** do término do AR, não um minuto
fixo escolhido a priori. **O trigger é temporal/orquestracional — não
significa que Pedidos de Compra só roda se os dados do AR tiverem
mudado.** Ele dispara sempre que o AR concluiu tecnicamente nesta execução
(`SUCCESS` ou `SKIPPED` — ver 10.2), independente de o AR ter de fato
produzido linhas novas.

Implementação: `scripts/runNomusAccountsReceivableThenPurchaseOrdersSync.sh`
(novo wrapper). Segue o mesmo padrão conceitual já usado no host para
Pedidos de Venda → Documentos de Saída (etapa 1 termina → dispara etapa 2),
citado como precedente nesta missão. **Nota de auditoria**: uma busca
exaustiva neste repositório (código, scripts, `docs/`) não encontrou nenhum
wrapper `.sh` versionado nem documentado com esse nome ou equivalente
(`sales-then-ds`) — se ele existe, é um artefato do host, não versionado
neste repositório. O novo wrapper de AR→Pedidos de Compra foi desenhado
seguindo a mesma lógica conceitual (encadeamento sequencial simples, sem
lock próprio do wrapper, delegando a cada runner filho seu próprio lock),
não copiado de um arquivo real inspecionado.

### 10.2 Semântica de falha (auditada antes de decidir)

Runners auditados antes desta decisão: `runNomusAccountsReceivableSync.sh`,
`runNomusSalesOrdersSync.sh`, `runNomusStockDocumentsSync.sh`, além do
próprio `runNomusPurchaseOrdersSync.sh` (criado no commit `47707cd`).

`runNomusAccountsReceivableSync.sh` grava `EXIT_CODE=0` tanto em sucesso
real quanto quando o próprio lock de AR (`/tmp/induscost-nomus-accounts-receivable.lock`)
está ocupado por outra execução (`SKIPPED`) — os dois casos são
tecnicamente "exit 0", mas não são a mesma coisa. Decisão adotada no
wrapper:

| Resultado do AR nesta execução | Dispara Pedidos de Compra? | Por quê |
|---|---|---|
| `SUCCESS` (exit 0) | **Sim** | Ciclo concluído normalmente. |
| `SKIPPED` (exit 0, lock de AR ocupado por outra execução) | **Sim** | O trigger é temporal, não depende do AR ter produzido dados nesta execução específica; não é uma falha. |
| `FAILED` (exit != 0) | **Não** | Encadear uma nova chamada à API Nomus em cima de uma falha técnica ativa do AR poderia agravar a causa raiz (Nomus fora do ar, rede instável) ou disputar limite de taxa já sob pressão. |

Regras preservadas (nenhuma delas foi violada):
- **Comportamento do AR não foi alterado** — o wrapper chama
  `runNomusAccountsReceivableSync.sh` sem nenhuma modificação nesse script.
- **Exit code nunca é escondido** — o wrapper propaga o exit code do AR
  quando o AR falha, e o exit code de Pedidos de Compra quando o AR
  concluiu; ambos ficam gravados separadamente no log
  (`AR_EXIT_CODE=`/`PO_EXIT_CODE=`).
- **Falha de Pedidos de Compra nunca vira sucesso (nem falha) do AR** — o
  log grava explicitamente `CHAIN_RESULT=AR_OK_PO_FAILED` quando isso
  acontece, e uma linha própria confirma que o resultado do AR não foi
  reclassificado.
- Logs permitem distinguir os dois: `AR_EXIT_CODE=N` e `PO_EXIT_CODE=N`
  (ou `NOT_RUN` quando o AR falhou e Pedidos de Compra nem chegou a rodar)
  aparecem em linhas separadas, mais `CHAIN_RESULT` com um dos três valores
  (`AR_FAILED` | `AR_OK_PO_OK` | `AR_OK_PO_FAILED`).

### 10.3 Lock

Auditoria do lock global (`/tmp/induscost-nomus-sync-global.lock`,
`flock`, usado pelo sync diário e por Pedidos de Venda): **Contas a
Receber NÃO participa desse lock global** — usa um lock de entidade
próprio (`/tmp/induscost-nomus-accounts-receivable.lock`, shell) mais um
lock canônico próprio (`.../accounts-receivable.canonical.lock`, TS). Isso
está documentado em `docs/nomus/nomus-automatic-sync-routines.md` (tabela
de locks) e foi reconfirmado lendo o script real nesta missão. Ou seja: a
premissa "o AR já usa o lock global" **não se confirmou**. Seguindo a
instrução desta missão para esse cenário — não fazer uma refatoração ampla
de todos os coletores, e implementar a menor coordenação segura necessária,
documentando a limitação — nenhuma mudança foi feita no lock do AR.

O que foi feito no lado de Pedidos de Compra (menor mudança suficiente,
reaproveitando mecanismo já existente no repositório — o mesmo padrão do
precedente mais recente, Ordens de Produção/OP-11):

- **Lock de entidade** (`nomusPurchaseOrdersSyncLock.ts`, arquivo
  PID+token, self-heal de PID morto): inalterado, continua sendo a única
  proteção formal contra duas execuções de Pedidos de Compra em paralelo.
  Testado (`nomusPurchaseOrdersSyncLock.test.ts`).
- **Probe (não aquisição) do lock global Nomus**: adicionado a
  `acquireNomusPurchaseOrdersSyncLock`, reaproveitando a função já
  existente `probeGlobalNomusSyncLockHeld` (de
  `nomusProductionOrdersSyncLock.ts` — não foi reimplementada checagem de
  `flock`). Se o lock global estiver ocupado (sync diário ou Pedidos de
  Venda em andamento), a execução de Pedidos de Compra sai como `SKIPPED`
  (`GLOBAL_LOCK_HELD`, exit 0) em vez de disputar a API Nomus ao mesmo
  tempo. Controlável via `NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK` (default
  `1`). Como o AR não detém esse lock global, esse probe não coordena com o
  próprio AR — coordena com o sync diário/Pedidos de Venda, que ainda podem
  estar em andamento no mesmo horário por outros motivos.
- **Lock de shell** (`runNomusPurchaseOrdersSync.sh`): o arquivo próprio
  de defesa em profundidade foi renomeado de
  `/tmp/induscost-nomus-purchase-orders-sync-global.lock` para
  `/tmp/induscost-nomus-purchase-orders-shell.lock` — o nome antigo
  sugeria (incorretamente) ser o lock global compartilhado do ecossistema
  Nomus; não era, era só o lock de shell próprio de Pedidos de Compra. Pura
  correção de nomenclatura, sem mudança de comportamento (continua sendo
  só uma segunda camada por cima do lock de processo).

**Limitação documentada explicitamente**: não existe hoje nenhuma
coordenação direta entre o runner de AR e o de Pedidos de Compra além da
ordem de execução do wrapper (AR sempre roda antes, sequencialmente, dentro
do mesmo processo do wrapper — não há como o Pedidos de Compra desta cadeia
começar antes do AR terminar). Se um AR de um ciclo anterior (ex.: cron
anterior, ainda rodando por estar demorado) estiver ativo quando o wrapper
deste ciclo dispara, o `runNomusAccountsReceivableSync.sh` desta execução
sai como `SKIPPED` pelo próprio lock de AR — e, por decisão de 10.2, o
wrapper ainda assim dispara Pedidos de Compra (trigger temporal). Isso é
aceito conscientemente: não expandir o lock global para cobrir também o AR
seria uma refatoração maior, fora do escopo desta missão (que é
especificamente sobre o agendamento de Pedidos de Compra).

### 10.4 Rate limit / HTTP 429

Não foi implementado nenhum retry improvisado. `nomusPurchaseOrdersClient.ts`
já reaproveita 100% de `fetchNomusJson` (`src/lib/nomusRestClient.ts`) —
o mesmo cliente HTTP compartilhado usado por AR/AP/NF-e/Pedidos de
Venda/Documentos de Saída, com timeout por tentativa, retry exponencial e
tratamento de HTTP 429 (`tempoAteLiberar`/`Retry-After`). Confirmado por
auditoria de código nesta missão (`grep` por `429`/`retry`/`setTimeout`
em `nomusPurchaseOrdersClient.ts` e `nomusPurchaseOrdersSync.server.ts`):
não existe nenhuma implementação paralela de retry/backoff em nenhum dos
dois arquivos, nem no runner shell — nada para consolidar aqui.

Um probe real feito em produção (fora deste ambiente, apenas observado)
contra `/rest/pedidoscompra` retornou HTTP 429 com corpo `tempoAteLiberar`,
porque coincidiu com um sync de NF-e ativo. **Isso não valida nem invalida
o endpoint** — só confirma que o comportamento de 429 observado é
consistente com o já documentado para os demais coletores. Nenhum
parser/schema/status foi alterado só com base nesse 429 (ver seção 2).

### 10.5 Contrato Nomus — continua não validado

Nada na seção 2 (endpoint, paginação, campos, status brutos) foi
confirmado por um probe HTTP 200 real nesta missão — apenas observado um
429 (10.4). Em particular, `GET /rest/pedidoscompra/{id}` (detail-by-path-id)
continua sendo uma **hipótese não validada**: uma auditoria anterior desta
mesma missão constatou que esse padrão (id no path da URL) não tem nenhum
precedente nos demais coletores Nomus deste repositório — Ordens de
Produção e a resolução de bridge de clientes usam RSQL na própria listagem
(`query=id==N`), não um path `/recurso/{id}` separado (confirmado nesta
sessão: `id==` aparece em `nomusProductionOrdersClient.ts`,
`nomusProductionOrdersLookup.ts` e `nomusCustomerBridgeResolution.ts`, mas
em nenhum lugar como detail-by-path-id). Isso **não** foi "corrigido" para
`query=id==N` nesta entrega — trocar a estratégia de detail é uma decisão
de implementação do contrato, fora do escopo desta missão de
agendamento/orquestração. Nenhum dado real foi importado até hoje (nenhum
backfill/sync real foi executado, nem nesta entrega nem na anterior).

### 10.6 Cron — o que muda no host (NOT EXECUTED)

Nada foi instalado em `/etc/cron.d` nem em nenhum outro lugar do host nesta
entrega. Os comandos abaixo são a referência exata do que mudaria em
homologação/produção — **NOT EXECUTED**:

```bash
# ANTES (proposta original desta missão, já abandonada — nunca chegou a
# ser instalada):
# 27 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusPurchaseOrdersSync.sh apply >> /var/log/induscost-nomus-purchase-orders-cron.log 2>&1

# DEPOIS (esta entrega): o cron de AR (17 */2 * * *, já existente e ativo em
# produção) deixa de chamar runNomusAccountsReceivableSync.sh diretamente e
# passa a chamar o wrapper — que chama o AR primeiro, sem alterar seu
# comportamento, e encadeia Pedidos de Compra depois:
17 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusAccountsReceivableThenPurchaseOrdersSync.sh apply apply >> /var/log/induscost-nomus-ar-then-purchase-orders-cron.log 2>&1
```

Isso **substitui** a linha de cron do AR — não adiciona uma linha nova.
Contagem líquida de jobs Nomus no host permanece a mesma (nenhum job novo
é criado; o job de AR passa a apontar para o wrapper em vez do runner
direto). Antes de aplicar essa mudança em homologação/produção: validar o
wrapper com `preview`/`dry` no host, conferir que o log
`/var/log/induscost-nomus-ar-then-purchase-orders-cron.log` está sendo
escrito pelo usuário/cron correto, e só então trocar a linha no
`/etc/cron.d/induscost-production` (mesmo arquivo referenciado na seção de
Recebimentos de `docs/nomus/nomus-automatic-sync-routines.md` — inclusive o
alerta já registrado lá de que o comentário "não é lido automaticamente"
naquele arquivo é falso).

**Lock**: segunda execução concorrente do mesmo modo de Pedidos de Compra
recebe `SKIPPED` e sai com código 0 (não é erro) — testado em
`nomusPurchaseOrdersSyncLock.test.ts`, incluindo self-heal de lock de PID
morto e o novo probe de lock global (10.3).

## 11. API interna de leitura

`src/lib/purchasing/nomusPurchaseOrderReadRoutes.ts`, montada em `server.ts`
logo após as rotas do `PurchaseOrder` interno. Reaproveita a permissão já
existente `OPERATIONS_RESOURCE_KEYS.purchases` / `view` (nenhuma taxonomia
de permissão nova criada nesta primeira versão, já que ainda não há UI
dedicada).

- `GET /api/nomus/purchase-orders` — paginação (`page`/`pageSize`, máx.
  200/página), filtros `dateFrom`/`dateTo` (por `issueDate`),
  `companyId`/`supplierId`/`buyerId`/`productId` (ids externos Nomus),
  `stage` (derivedStage), `status` (código bruto Nomus), `code`
  (contains, case-insensitive), `sortBy`
  (`issueDate`|`totalValue`|`code`|`syncedAt`) + `sortDir`. Retorna pedido,
  fornecedor, empresa, comprador, emissão, previsão, valor total, contagem
  de itens, `derivedStage`, status bruto, `syncedAt`/`sourcePresenceStatus`
  (freshness).
- `GET /api/nomus/purchase-orders/:id` — aceita UUID local **ou**
  `externalId` numérico. Retorna cabeçalho completo, matching de
  fornecedor/produto, condições de pagamento, valores, itens com status
  brutos + `derivedStage`. **`rawPayload` nunca é exposto** por este
  endpoint (não há endpoint administrativo/auditoria dedicado nesta
  entrega — ver seção 12/pendências).
- 404 explícito quando o pedido não existe.

Toda a lógica de parsing de query e montagem de `where` é pura e testada
(`nomusPurchaseOrderReadRoutes.test.ts`) sem precisar de banco.

## 12. Performance

- Paginação bounded (`--max-pages`), nunca ilimitada.
- Detail com concorrência limitada (`mapWithBoundedConcurrency`, default 4
  simultâneas) — nunca dispara todas as requisições de uma vez.
- Matching de fornecedor/produto em lote: no máximo 4 queries por execução
  inteira (1 para aliases, 3 para o bridge de produto), independente do
  número de pedidos/itens — nunca uma query por item.
- Cada pedido é escrito em sua própria transação Prisma — nunca uma
  transação global dos 12 meses (erro em um pedido não corrompe os demais).
- Índices dedicados em todos os campos de filtro da API de leitura.

## 13. Comandos NOT EXECUTED (a rodar pelo usuário/deploy)

Todos abaixo assumem `NOMUS_BASE_URL`/`NOMUS_TOKEN` reais configurados em um
`.env` **local, nunca versionado**. Nenhum foi executado nesta entrega.

**A) Probe read-only — 1 página pequena:**
```bash
npx tsx scripts/probeNomusPurchaseOrders.ts
```

**B) Probe read-only — 1 página + 1 detail:**
```bash
npx tsx scripts/probeNomusPurchaseOrders.ts --with-detail
```

**C) Preview do backfill de 12 meses (zero writes):**
```bash
npm run sync:nomus:purchase-orders:backfill:preview
# equivalente: npx tsx scripts/nomusPurchaseOrdersSync.ts backfill --preview --months=12
```

**D) Apply do backfill de 12 meses:**
```bash
npm run sync:nomus:purchase-orders:backfill:apply
# equivalente: npx tsx scripts/nomusPurchaseOrdersSync.ts backfill --apply --months=12
```

**E) Sync recorrente normal (apply, janela recente):**
```bash
npm run sync:nomus:purchase-orders:sync:apply
# via runner com lock de host: bash scripts/runNomusPurchaseOrdersSync.sh apply
```

**F) Validação SQL pós-backfill (SOMENTE SELECT):**
```sql
-- Totais
SELECT count(*) AS total_pedidos FROM "NomusPurchaseOrder";
SELECT count(*) AS total_itens FROM "NomusPurchaseOrderItem";

-- Menor/maior data de emissão
SELECT min("issueDate") AS min_issue_date, max("issueDate") AS max_issue_date
FROM "NomusPurchaseOrder";

-- Pedidos por mês (detectar lacunas nos 12 meses)
SELECT date_trunc('month', "issueDate") AS mes, count(*)
FROM "NomusPurchaseOrder"
GROUP BY 1 ORDER BY 1;

-- Pedidos por derivedStage
SELECT "derivedStage", count(*) FROM "NomusPurchaseOrder" GROUP BY 1 ORDER BY 1;

-- Pedidos por status bruto Nomus
SELECT "nomusStatusCode", count(*) FROM "NomusPurchaseOrder" GROUP BY 1 ORDER BY 1;

-- Fornecedores matched/unmatched/ambiguous
SELECT "supplierMatchStatus", count(*) FROM "NomusPurchaseOrder" GROUP BY 1;

-- Produtos matched/unmatched (por item)
SELECT "productMatchStatus", count(*) FROM "NomusPurchaseOrderItem" GROUP BY 1;

-- externalId duplicado — esperado ZERO linhas
SELECT "externalId", count(*) FROM "NomusPurchaseOrder"
GROUP BY 1 HAVING count(*) > 1;

-- item externalId duplicado (por pedido) — esperado ZERO linhas
SELECT "purchaseOrderId", "lineNumber", count(*) FROM "NomusPurchaseOrderItem"
GROUP BY 1, 2 HAVING count(*) > 1;

-- rawPayload nulo — esperado ZERO salvo contrato confirmar campo opcional
SELECT count(*) FROM "NomusPurchaseOrder" WHERE "rawPayload" IS NULL;

-- última syncedAt
SELECT max("syncedAt") FROM "NomusPurchaseOrder";
```

## 14. Migration / rollback

Migration: `prisma/migrations/20260922120000_nomus_purchase_orders_mirror/migration.sql`
— **escrita manualmente** (não gerada por `prisma migrate dev`, porque este
ambiente de execução não tinha um Postgres local acessível — ver relatório
final da missão). `npx prisma validate` e `npx prisma generate` foram
executados com sucesso contra o schema resultante. **Antes de aplicar em
qualquer ambiente real**: rodar `prisma migrate dev` (ou `migrate deploy`)
localmente contra um Postgres de teste para confirmar que o SQL escrito à
mão bate exatamente com o que o Prisma geraria, e ajustar se necessário.

Rollback lógico: `DROP TABLE "NomusPurchaseOrderItem", "NomusPurchaseOrder"`
+ `DROP TYPE` dos 3 enums novos + reverter o `ALTER TYPE ... ADD VALUE
'PURCHASE_ORDER'` (Postgres não remove valor de enum nativamente — só é
seguro se nenhuma linha usar o valor).

## 15. Runbook rápido

1. Configurar `.env` local com `NOMUS_BASE_URL`/`NOMUS_TOKEN` reais (nunca
   commitar).
2. Rodar probe (A/B) e comparar as chaves de campo retornadas com as
   assumidas em `nomusPurchaseOrderPayload.ts` — ajustar candidatos de
   campo se necessário.
3. Rodar preview do backfill (C) e revisar o resumo (páginas, pedidos no
   período, matched/unmatched, erros).
4. Rodar apply do backfill (D).
5. Rodar as queries de validação (seção 13-F).
6. Só então avaliar instalar o cron de sync recorrente (seção 10) — após
   confirmar `CRON_JOBS` real do host.

## 16. Questões ainda não confirmadas

- Caminho exato do endpoint Nomus (list e detail).
- Nomes de campo exatos do payload (todos os candidatos em
  `nomusPurchaseOrderPayload.ts` são hipóteses fundamentadas, não
  confirmadas).
- Existência de filtro de período nativo, cursor, `updatedAt`/`ETag`.
- Validade do mapa de 8 status brutos documentado na missão.
- Se o `derivedStage` deve considerar algum status de cabeçalho além dos
  itens (hoje ignorado deliberadamente por falta de confiança confirmada).
- Volume real esperado em 12 meses (dimensiona `--max-pages`/`--page-size`
  padrão, hoje 500 páginas × 50 = 25.000 pedidos de teto).
