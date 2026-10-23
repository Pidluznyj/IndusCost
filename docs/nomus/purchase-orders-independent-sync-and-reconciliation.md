# Pedidos de Compra Nomus — sincronização independente e reconciliação de presença

Documento de arquitetura e operação. Registro do trabalho executado:
[`purchase-orders-sync-implementation-report.md`](purchase-orders-sync-implementation-report.md).

## 1. Problema (caso PC00637)

O pedido **PC00637** (ID Nomus **638**, emitido em 22/10/2026, fornecedor QUIMICOS E PLASTICOS IND. E COM. DE
PROD. DERIV., CNPJ 03.261.226/0001-34, parcelas planejadas R$ 31.114,39) foi **excluído no Nomus em 22/10** e
continuava **Aprovado** no IndusCost em 23/10.

Causa raiz, confirmada no código:

1. O sync (`scripts/nomusPurchaseOrdersSync.ts`) só fazia *upsert* do que a API devolvia. Pedido que some da
   API nunca era tocado: ficava com a última fase conhecida para sempre.
2. O agendamento dependia de Contas a Receber: o runner de CR chamava o de Compras **somente** quando CR
   terminava com sucesso (`NOMUS_PO_CHAIN_AFTER_AR`). Falha de CR = Compras parado, sem registro.
3. O runner antigo adquiria o lock global Nomus com `flock -n`: no mesmo minuto ele pularia Propostas/Pedidos
   de Venda (ou seria pulado), e o pulo saía com exit 0 sem nenhum registro.

O Nomus é a autoridade sobre a existência do pedido. Ausência, porém, **não é cancelamento** e não é prova
de exclusão: só uma varredura completa e confiável pode indicar ausência, e só uma segunda varredura
independente (ou uma consulta por ID com semântica validada) pode confirmá-la.

## 2. Componentes

| Peça | Arquivo |
|---|---|
| Serviço canônico (entrada única) | `runNomusPurchaseOrdersSync` em `src/lib/nomus/nomusCanonicalSync.server.ts` |
| Implementação (busca, upsert, presença, run) | `src/lib/nomus/nomusPurchaseOrderSyncService.server.ts` |
| Adapter puro de presença (completude, plano, guardas, eventos) | `src/lib/nomus/nomusPurchaseOrderSourceReconciliation.ts` |
| Motor de ausência (reusado, SYNC-03) | `src/lib/nomus/nomusSourceReconciliationEngine.ts` |
| Saúde/STALE (puro) | `src/lib/nomus/nomusPurchaseOrderSyncHealth.ts` |
| Rótulos e filtros (puro, UI + API) | `src/lib/nomus/nomusPurchaseOrderSyncUi.ts` |
| CLI | `scripts/nomusPurchaseOrdersSync.ts` |
| Runner shell (fino) | `scripts/runNomusPurchaseOrdersSync.sh` |
| Agenda (cron versionado) | `infra/cron/nomus-purchase-orders/induscost-nomus-purchase-orders.cron.template` |
| Instalador da agenda | `scripts/installNomusPurchaseOrdersCron.sh` |
| Painel (runner + rotas) | `src/lib/nomusPurchaseOrdersSyncRunner.ts`, `src/lib/nomusPurchaseOrdersSyncAdminRoutes.ts` |
| Painel (UI) | `src/components/NomusPurchaseOrdersSyncCard.tsx` (Configurações › Logs de Sincronização Nomus) |
| Auditoria somente leitura | `scripts/auditNomusPurchaseOrderPresence.ts` |
| Migration | `prisma/migrations/20261101120000_nomus_purchase_order_source_lifecycle/` |
| Rollback de schema (último recurso) | `docs/nomus/rollback/20261101120000_nomus_purchase_order_source_lifecycle.rollback.sql` |

Fluxo: `cron | CR (cadeia) | painel | CLI` → `runNomusPurchaseOrdersSync.sh` → `npm run
nomus:purchase-orders:<estratégia>:<modo> -- --trigger=<origem>` → CLI → `runNomusPurchaseOrdersSync`
(lock de entidade) → `executeNomusPurchaseOrdersSync`.

## 3. Agendamento

### 3.1 Fonte única

`NOMUS_PO_SCHEDULE_SOURCE` (no `.env` do app) decide **quem executa**; o cron e o encadeamento podem coexistir
instalados sem nunca rodarem os dois:

| Valor | Agenda própria (cron) | Encadeamento após CR |
|---|---|---|
| `chain` (padrão) | registra `SKIPPED` (`INDEPENDENT_SCHEDULE_INACTIVE_SOURCE_IS_CHAIN`) | executa |
| `independent` | executa | registra `SKIPPED` (`CHAIN_AFTER_AR_INACTIVE_SOURCE_IS_INDEPENDENT`) |

Painel, CLI e auditoria sempre executam (protegidos pelo lock de entidade). `NOMUS_PO_CHAIN_AFTER_AR=0`
remove o encadeamento do runner de CR depois da estabilização.

### 3.2 Agenda própria

Arquivo `/etc/cron.d/induscost-nomus-purchase-orders`, gerado pelo instalador a partir do template:

- **Incremental horário** — minuto **37**, `apply incremental`: janela de **45 dias** por emissão, upsert;
  nunca avalia ausência.
- **Reconciliação diária** — **03:37 America/Sao_Paulo**, `apply reconcile`: universo inteiro **sem filtro de
  datas** (os parâmetros `dataInicio`/`dataFim` não são comprovados). O instalador converte 03:37 BRT para a
  hora do host (`06:37 UTC` = `37 6`; host em BRT = `37 3`).

```bash
bash scripts/installNomusPurchaseOrdersCron.sh render
sudo INDUSCOST_APP_DIR=/opt/induscost bash /opt/induscost/scripts/installNomusPurchaseOrdersCron.sh install --environment=production
sudo bash /opt/induscost/scripts/installNomusPurchaseOrdersCron.sh verify
```

Homologação: agenda externa **desligada por padrão** — `install --environment=homolog` é recusado sem
`--allow-homolog`. `uninstall` move o arquivo para `/var/backups/induscost-cron/` (nada é apagado).

Minuto 37 também é usado por Propostas (horário). Os dois apenas **sondam** o lock global (não o adquirem),
então podem rodar em paralelo contra o Nomus; o cliente HTTP trata 429 (`tempoAteLiberar`/Retry-After) e o run
registra `http429Count`. Se o volume de 429 crescer, mova Compras para outro minuto livre (ex.: 41) no template.

### 3.3 Transição sem execução dupla

1. Deploy (migration antes do código). `NOMUS_PO_SCHEDULE_SOURCE` ausente = `chain`: comportamento atual.
2. Instalar o cron. Com `chain`, cada disparo do cron grava um run `SKIPPED` — prova que o cron dispara sem
   executar nada.
3. Trocar para `NOMUS_PO_SCHEDULE_SOURCE=independent` (sem restart: o CLI lê o `.env` a cada execução).
   A partir daí o cron executa e a cadeia de CR registra `SKIPPED`.
4. Após alguns dias estáveis: `NOMUS_PO_CHAIN_AFTER_AR=0`.

Rollback do agendamento: `NOMUS_PO_SCHEDULE_SOURCE=chain` (efeito no próximo disparo) e, se desejado,
`installNomusPurchaseOrdersCron.sh uninstall`.

## 4. Execução

- **Lock de entidade**: `/tmp/induscost-nomus-purchase-orders.canonical.lock` (`wx` + PID; lock de processo
  morto é recuperado). Path próprio, distinto do flock legado (OP-04). Ocupado → `SKIPPED_LOCKED`, registrado
  como run `SKIPPED` (`ENTITY_LOCK_HELD`).
- **Lock global Nomus** (`/tmp/induscost-nomus-sync-global.lock`, orquestrador diário/Pedidos de Venda): só
  sondado. Ocupado → espera até `NOMUS_PO_GLOBAL_LOCK_WAIT_SECONDS` (padrão 1800); estourou → run `SKIPPED`
  (`GLOBAL_LOCK_WAIT_TIMEOUT`), sem chamar o Nomus.
- **HTTP**: `fetchNomusJson` — timeout por tentativa (`NOMUS_HTTP_TIMEOUT_MS`, padrão 60 s), retry com backoff
  para 429/5xx/timeout/rede (`NOMUS_MAX_RETRIES`, `NOMUS_RETRY_BASE_MS`), respeitando `tempoAteLiberar`.
- **Paginação**: página 1 → página curta/vazia; teto `NOMUS_PO_INCREMENTAL_MAX_PAGES` (80) e
  `NOMUS_PO_RECONCILE_MAX_PAGES` (200 ≈ 10.000 pedidos).
- **Idempotência**: upsert por `externalId` + `payloadHash`; ausência nunca é contada duas vezes no mesmo run
  (`lastSyncRunId`).

Estados do run (`NomusSourceSyncRun`, `entityType=PURCHASE_ORDER`):

| Status | Quando | Conta como sucesso? | Saída do CLI |
|---|---|---|---|
| `RUNNING` | em execução (preso > 2 h = STALE no painel) | — | — |
| `SUCCESS` | todas as páginas lidas, sem falha | sim (se não for prévia) | 0 |
| `INCONCLUSIVE` | parcial ou anômala: limite de páginas, registro sem ID, página HTTP 200 sem lista (`MALFORMED_PAYLOAD_INCOMPLETE_SNAPSHOT`), universo vazio com pedidos locais (`EMPTY_UNIVERSE_WITH_LOCAL_RECORDS`), erro de persistência | não | 3 |
| `FAILED` | falha HTTP/rede não recuperada, erro inesperado | não | 1 |
| `SKIPPED` | lock ocupado, espera do global esgotada, fonte inativa | não | 0 |

`payloadComplete=true` só quando o universo declarado foi provado: varredura sem filtro, ou janela com filtro
consistente **e** semântica validada (`NOMUS_PO_DATE_FILTER_VALIDATED=1`). O incremental horário é `SUCCESS`
com `payloadComplete=false` por desenho (janela não prova universo).

Resumo do run (`summaryJson`): origem, atraso em relação ao horário oficial (`scheduleDelaySeconds`), fonte de
agendamento, janela, páginas/registros, 429, motivos de completude, contadores, guardas, alertas e amostras de
ausentes (ID e número do pedido). **Nunca** inclui URL, credencial, corpo de resposta ou valores financeiros.

## 5. Ciclo de vida de presença

Colunas novas em `NomusPurchaseOrder`: `sourcePresenceStatus` (PRESENT | MISSING_CANDIDATE | MISSING_CONFIRMED),
`presentInLastPayload`, `missingSince`, `missingConsecutiveRuns`, `sourceRemovedAt`, `lastSyncRunId`. Histórico
em `NomusPurchaseOrderPresenceEvent` (só transições: MISSING_CANDIDATE, MISSING_CONFIRMED, REACTIVATE).

Ausência só é avaliada quando **todas** as condições valem:

1. estratégia `FULL_RECONCILIATION` (incremental e consulta por ID nunca avaliam);
2. `NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED=1` e permissão canônica de detecção;
3. run `SUCCESS` com `payloadComplete=true`: página 1 até o fim, sem limite de páginas, sem falha HTTP não
   resolvida, sem registro sem ID, sem erro de persistência, escopo conhecido;
4. pedido dentro do universo coberto (na janela, se houver janela);
5. pedido não visto pelo mesmo run.

Transições:

- **1ª ausência** → `MISSING_CANDIDATE` (`missingConsecutiveRuns=1`). Continua na carteira.
- **2ª ausência** em execução distinta e após `NOMUS_PO_CONFIRM_MIN_HOURS_BETWEEN_MISSES` (padrão 20 h) →
  `MISSING_CONFIRMED` (`sourceRemovedAt`). Exige `NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED=1`; sem a flag fica
  candidata.
- **Consulta por ID** (opcional, `NOMUS_PO_DIRECTED_LOOKUP_ENABLED=1`): 200 com o mesmo ID protege o pedido
  (e sinaliza que a listagem omitiu um pedido existente); 404 só confirma com
  `NOMUS_PO_DIRECTED_LOOKUP_TRUST_404=1`, depois de validada em homologação; qualquer outra resposta é inconclusiva.
- **Guarda de volume** — limite = `min(NOMUS_PO_MAX_CONFIRMATIONS_PER_RUN=20,
  ceil(NOMUS_PO_MAX_CONFIRMATIONS_RATIO=5% × universo))`, mínimo 1:
  - ausências **novas** (PRESENT → candidata) acima do limite numa mesma varredura: **nada é gravado** (nem
    candidata) e o run gera o alerta crítico `MASS_ABSENCE_CANDIDATES_BLOCKED` — sumiço em massa é sinal de
    resposta anômala da API, não de exclusões;
  - confirmações acima do limite: todas ficam candidatas e o run gera o alerta crítico
    `MASS_ABSENCE_GUARD_TRIGGERED`.
  Uma exclusão em massa legítima exige subir o limite temporariamente, de forma consciente.
- **Reaparecimento** → `REACTIVATE`: volta a `PRESENT`, zera contadores, histórico preservado.
- Run `FAILED`/`INCONCLUSIVE`: presença intocada; nada é incrementado.

Nada é apagado: pedido, itens, avaliação de fornecedor, NF-e, documentos de entrada, parcelas, vínculos com
Contas a Pagar e pagamentos permanecem. Ausência não altera a fase (`stage`) nem cria cancelamento. Um pedido
`MISSING_CONFIRMED` **não recebe vínculo novo** com Contas a Pagar (`PURCHASE_ORDER_MISSING_IN_NOMUS`, 409); os
existentes ficam como estão — a propriedade financeira dos títulos não é recalculada por inferência.

Rótulos: "Ausente no Nomus — em verificação", "Ausente no Nomus — confirmado", "Cancelado no Nomus" (fase
oficial). "Excluído no Nomus" não é usado: só caberia com evidência oficial de exclusão, que a API não fornece.

## 6. Carteira, KPIs e consumidores

- Lista `/api/nomus/purchase-orders`: filtro `presence` = `ACTIVE` (padrão: exclui só o confirmado) | `MISSING` |
  `MISSING_CANDIDATE` | `MISSING_CONFIRMED` | `ALL`. O mesmo `where` alimenta total, paginação, KPIs e filtros
  pós-consulta (fiscal/financeiro/PMP). Linhas trazem `sourcePresenceStatus` e `missingSince`; a tabela mostra o
  selo ao lado da fase.
- Detalhe: banner de presença na aba Geral e "Histórico de presença no Nomus" na aba Nomus.
- Indicadores derivados (Performance de fornecedores, Qualidade das Condições de Compra/PMP, contagem elegível de
  avaliação): excluem `MISSING_CONFIRMED` quando `NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED=1`.
- Evidência de identidade de fornecedor (CNPJ visto em pedidos) não é filtrada: um pedido excluído continua
  sendo evidência de quem é o fornecedor.
- Não há exportação dedicada da lista de pedidos Nomus; impressões do detalhe usam a mesma rota.

## 7. Painel "Pedidos de Compra Nomus"

Configurações › Logs de Sincronização Nomus. Recurso `admin.settings.nomus_sync`:

| Endpoint | Ação |
|---|---|
| `GET /api/settings/nomus-sync/purchase-orders-status` | view |
| `GET /api/settings/nomus-sync/purchase-orders-runs` · `…-runs/:id` | view |
| `GET /api/settings/nomus-sync/purchase-orders-missing` | view |
| `POST /api/settings/nomus-sync/purchase-orders-run` (incremental agora) | execute → 202 / 409 |
| `POST /api/settings/nomus-sync/purchase-orders-reconcile-preview` (sem escrita de presença) | execute → 202 / 409 |
| `POST /api/settings/nomus-sync/purchase-orders-reconcile-apply` (autorizar ausências) | execute + **Super Admin** + frase `AUTORIZO AUSENCIAS PEDIDOS DE COMPRA` → 202 / 400 / 401 / 403 / 409 |

A autorização grava as ausências daquela execução mesmo com o modo só-prévia global (o processo recebe
`NOMUS_PO_RECONCILE_PREVIEW_ONLY=0`); chave mestra, flag de confirmação, intervalo e guarda de volume continuam
valendo. A prévia (`mode=preview`) não grava pedido novo nem presença; é registrada como `*_PREVIEW` e nunca
conta como sucesso.

O status mostra: situação geral (OK, em andamento, atrasada/STALE, falhou, inconclusiva), horas desde o último
sucesso real, fonte ativa, cron instalado, próximos disparos, flags, contagem por presença, métricas de 24 h
(execuções, puladas, falhas/parciais, 429), última execução, execuções recentes com motivo de pulo e motivos de
completude, alertas e lista de ausentes.

STALE: sem sucesso real há mais de `NOMUS_PO_STALE_HOURS` (padrão 3 h com agenda própria, 5 h com a cadeia) ou
run `RUNNING` preso há mais de 2 h. A observabilidade SYNC-09 passou a incluir `PURCHASE_ORDER` e ignora runs
`SKIPPED` e `*_PREVIEW`.

## 8. Flags

| Variável | Padrão | Efeito |
|---|---|---|
| `NOMUS_PO_SCHEDULE_SOURCE` | `chain` | fonte única: `chain` \| `independent` |
| `NOMUS_PO_CHAIN_AFTER_AR` | `1` | `0` remove o encadeamento do runner de CR |
| `NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED` | desligado | chave mestra da avaliação de ausência |
| `NOMUS_PO_RECONCILE_PREVIEW_ONLY` | `1` | ausência só no resumo do run; `0` grava presença |
| `NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED` | desligado | permite `MISSING_CONFIRMED` (senão só candidata) |
| `NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED` | desligado | indicadores derivados excluem confirmados |
| `NOMUS_PO_RECONCILE_SCOPE` | `full` | `window` = 12 meses (só com filtro validado prova universo) |
| `NOMUS_PO_DATE_FILTER_VALIDATED` | desligado | declara a semântica de `dataInicio`/`dataFim` validada |
| `NOMUS_PO_DIRECTED_LOOKUP_ENABLED` / `_MAX` | desligado / 20 | consulta por ID dos não encontrados |
| `NOMUS_PO_DIRECTED_LOOKUP_TRUST_404` | desligado | 404 por ID confirma ausência |
| `NOMUS_PO_CONFIRM_MIN_HOURS_BETWEEN_MISSES` | 20 | intervalo mínimo entre 1ª ausência e confirmação |
| `NOMUS_PO_MAX_CONFIRMATIONS_PER_RUN` / `_RATIO` | 20 / 0,05 | guarda de volume |
| `NOMUS_PO_RESPECT_GLOBAL_LOCK` / `NOMUS_PO_GLOBAL_LOCK_WAIT_SECONDS` | 1 / 1800 | espera pelo lock global |
| `NOMUS_PO_INCREMENTAL_MAX_PAGES` / `NOMUS_PO_RECONCILE_MAX_PAGES` | 80 / 200 | teto de páginas |
| `NOMUS_PO_STALE_HOURS` | 3 ou 5 | limite de defasagem do painel |
| `NOMUS_PURCHASE_ORDERS_CANONICAL_LOCK_FILE` | `/tmp/induscost-nomus-purchase-orders.canonical.lock` | lock de entidade |

## 9. Implantação em etapas

Processos oficiais (não há passo manual de migration: os dois aplicam `prisma migrate deploy` antes de subir o
código novo, o que já garante a ordem migration → código):

- **Homologação** (servidor-01): `induscost-deploy-homologacao`. O gate do deploy executa por completo todos os
  arquivos de teste alterados; os desta entrega passam 100% com as flags de presença ligadas e desligadas, e as duas
  suítes PostgreSQL 17 ficam puladas sem `COMMISSION_PG17_BIN`.
- **Produção** (AWS, `/opt/induscost`): `cd /opt/induscost && bash scripts/deploy-induscost.sh` (pull
  fast-forward da `main`, `prisma validate`, `prisma migrate deploy`, `prisma generate`, build e reinício em
  `NODE_ENV=production`). Fazer backup antes, como no checklist de release:
  `runuser -u postgres -- pg_dump -Fc -d <banco> -f /tmp/backup_pre_po_sync_$(date +%Y%m%d%H%M).dump`.

Antes de cada deploy, anotar o commit em execução (`git -C /opt/induscost log -1 --oneline`) para o rollback.

1. **Homologação — schema + código**: deploy oficial (migration `20261101120000`, aditiva: 2 valores de enum,
   6 colunas, 1 tabela; pedidos existentes ficam `PRESENT` com `presentInLastPayload=false` até a próxima
   leitura). Conferir `npx prisma migrate status` sem pendências.
2. **Homologação — leitura**: `npm run nomus:purchase-orders:audit-presence -- --external-id=638 --nomus-lookup
   --nomus-scan` (somente leitura) para registrar o estado real do 638, o comportamento do GET por ID para pedido
   excluído e o número de páginas do universo.
3. **Homologação — prévia**: painel › Prévia de reconciliação (ou `npm run nomus:purchase-orders:reconcile:preview
   -- --trigger=CLI`). Conferir que só os pedidos realmente excluídos aparecem como ausentes.
4. **Homologação — agenda**: `install --environment=homolog --allow-homolog` com `NOMUS_PO_SCHEDULE_SOURCE=chain`
   (runs `SKIPPED` provam o disparo) → `independent`.
5. **Homologação — ausência**: `NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED=1` mantendo só-prévia; depois
   autorizar pelo painel (Super Admin) para gravar candidatas; após a 2ª varredura em outro dia,
   `NOMUS_PO_RECONCILE_APPLY_CONFIRMED_ENABLED=1` e nova autorização.
6. **Produção**: mesma sequência, uma etapa por vez, com a prévia validada antes de cada flag.

## 10. Rollback

Operacional (preferido, sem tocar em dados):

- agenda: `NOMUS_PO_SCHEDULE_SOURCE=chain` e/ou `installNomusPurchaseOrdersCron.sh uninstall`;
- ausência: `NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED=0` (ou `NOMUS_PO_RECONCILE_PREVIEW_ONLY=1`);
- carteira: os confirmados reaparecem com o filtro `ALL`; `NOMUS_OPS_EXCLUDE_MISSING_PURCHASE_ORDERS_ENABLED=0`
  devolve os indicadores derivados;
- um pedido marcado por engano volta a `PRESENT` sozinho na próxima leitura em que o Nomus o devolver.

Código: o código anterior ignora as colunas novas (todas com padrão), então reverter o deploy é seguro com a
migration aplicada — **não** restaurar backup do banco por causa desta entrega (a migration é aditiva e o restore
descartaria dados gravados depois). Reversão de código em produção, seguindo o checklist de release:

```bash
cd /opt/induscost
git log --oneline -5                      # localizar o commit anotado antes do deploy
git checkout <commit_anterior>
npm install && npx prisma generate && NODE_ENV=production npm run build
# reiniciar como em scripts/deploy-server-main-update.sh (passo 14)
```

Depois, se a agenda própria estiver instalada: `sudo bash scripts/installNomusPurchaseOrdersCron.sh uninstall`
(o arquivo vai para `/var/backups/induscost-cron/`) — o código anterior não conhece o CLI novo. Para voltar à
`main`, `git checkout main && git pull --ff-only` no próximo deploy oficial.

Schema: `docs/nomus/rollback/20261101120000_…rollback.sql` é último recurso (exporta o histórico antes; remove só
colunas/tabela novas; nenhum pedido é apagado).

## 11. Validações pendentes de homologação

- Semântica de `GET pedidoscompra/{id}` para pedido excluído (404? 200 vazio?) — define se
  `NOMUS_PO_DIRECTED_LOOKUP_TRUST_404` pode ser ligada.
- Semântica de `dataInicio`/`dataFim` (campo de data filtrado) — define se `NOMUS_PO_RECONCILE_SCOPE=window` e
  `NOMUS_PO_DATE_FILTER_VALIDATED` podem ser usados.
- Tamanho real do universo e duração da varredura completa (limite de 200 páginas).
- Taxa de 429 no minuto 37 compartilhado com Propostas.

Diagnóstico individual do caso de referência: [`purchase-orders-pc00637-diagnosis.md`](purchase-orders-pc00637-diagnosis.md).
