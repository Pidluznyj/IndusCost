# Ordens de Produção Nomus — Operações (OP-12)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Endpoint** | `GET /rest/ordens` |
| **Status** | Operacional (sync + lock + auditoria) |
| **Data** | 2026-07-16 |

Documentos irmãos:

- [`api-contract.md`](./api-contract.md) — contrato RSQL / payload
- [`current-state.md`](./current-state.md) — inventário da plataforma
- [`target-architecture.md`](./target-architecture.md) — arquitetura-alvo
- [`release-candidate.md`](./release-candidate.md) — **regressão OP-14 / RC**
- [`../integrations/nomus-production-orders-sync.md`](../integrations/nomus-production-orders-sync.md) — resumo da integração

---

## 1. Arquitetura

```text
Cron / shell (flock .flock)
        │
        ▼
npm sync:nomus:production-orders:{incremental|backfill}:{preview|apply}
        │
        ├─ Lock Node JSON (serializa backfill ↔ incremental)
        ├─ Respeito ao lock global Nomus (manual × automático)
        ├─ Cliente HTTP nomusRestClient → GET /rest/ordens
        ├─ Mapper / persist (cabeçalho + itensPedido)
        ├─ Reconcile FKs locais (sem API, se apply)
        └─ IntegrationRun + log [nomus-production-orders]

Pós Pedidos de Venda (apply OK)
        └─ runNomusProductionOrdersAfterSalesOrdersSync → incremental apply (soft-fail; 1×; sem backfill)
```

Princípios:

1. Fonte oficial: `/rest/ordens` (não inferir do raw do pedido).
2. Vínculo só por `itensPedido[].idPedido` + `itensPedido[].id`.
3. UI/API de produto **não** consultam Nomus na abertura.
4. Sync não altera Pedido, item, NF-e, AR/AP, Fluxo, Comissões, BOM.
5. Idempotência por `externalId` e `(productionOrderExternalId, externalSalesOrderItemId)`.

---

## 2. Models

| Model | Papel |
|-------|--------|
| `NomusProductionOrder` | Cabeçalho OP (`externalId` único, `rawJson`, `payloadHash`, datas Nomus) |
| `NomusProductionOrderSalesLink` | Vínculo OP↔Pedido/Item; FKs locais opcionais; soft-absent (`isCurrent` / `removedAt`) |
| `SalesOrder` / `SalesOrderItem` | Destino de resolução (`externalSalesOrderId`, `nomusItemExternalId`) — **somente leitura** no sync OP |
| `IntegrationRun` | Ledger de execução (`target: production-orders`) |

Migration aditiva: `prisma/migrations/20260728120000_nomus_production_orders/`.

---

## 3. Endpoint

- Path: `ordens` → `GET {NOMUS_BASE_URL}ordens`
- Auth: `NOMUS_TOKEN` e/ou header custom (`NOMUS_AUTH_HEADER_*`)
- Paginação: `pagina`, `tamanhoPagina`, `query` (RSQL)
- Cliente: `src/lib/nomusProductionOrdersClient.ts` + `nomusRestClient.ts`

Detalhes: [`api-contract.md`](./api-contract.md).

---

## 4. Filtros (RSQL)

| Uso | Exemplo | Notas |
|-----|---------|--------|
| Nome | `nome=="OP 05800 - 003"` | Confirmado |
| Id externo | `id==30347` | Confirmado |
| Pedido | `itensPedido.idPedido==2530` | Nested — pode falhar; fallback por IDs locais |
| Item | `itensPedido.id==11324` | Nested — idem |
| Incremental data | `dataAlteracao>=…;dataAlteracao<=…` | Preferido; alt. `dataAbertura` |

Rejeitados como seletor de janela incremental: `dataHoraEdicao`, `dataHoraCriacao`, `id`, `nome` (só consulta pontual).

---

## 5. Parsing

| Entrada | Saída |
|---------|--------|
| `"15.400"` | `15400` |
| `"15.000"` | `15000` |
| Datas `dd/MM/yyyy HH:mm:ss` | `America/Sao_Paulo` |
| Campos desconhecidos | Preservados em `rawJson`; não quebram o mapper |

Fixture real: OP `30347` / `OP 05800 - 003` / pedido `2530` / item `11324`.

---

## 6. Modos

| Modo | Escrita | Uso |
|------|---------|-----|
| `preview` | Não | Planejamento / DRY RUN |
| `apply` | Sim (transações pequenas por OP) | Produção |

Alias legado: `sync:nomus:production-orders:dry` → preview (SyncV1).

---

## 7. Backfill

- Script: `scripts/nomusProductionOrdersBackfill.ts`
- Página a página, checkpoint em arquivo (`NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE`)
- Limites: `--max-pages`, `--hard-max-pages`, interrupção segura (SIGINT)
- **Não** entra no orquestrador/cron por padrão — execução explícita
- Lock compartilhado com incremental

```bash
npm run sync:nomus:production-orders:backfill:preview
npm run sync:nomus:production-orders:backfill:apply -- --cursor-file=/tmp/op-backfill.cursor
```

---

## 8. Incremental

- Script: `scripts/nomusProductionOrdersIncremental.ts`
- Estado de último sucesso em arquivo (`NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_FILE`)
- Overlap padrão **72h**; seletor preferido `dataAlteracao`
- Seletor rejeitado → fallback **limitado e auditado** (nunca full scan silencioso)
- Falha **não** avança estado; sucesso avança e grava filtro/cutoff

```bash
npm run sync:nomus:production-orders:incremental:preview
npm run sync:nomus:production-orders:incremental:apply -- --overlap-hours=72
```

---

## 9. Consulta pontual

- Script: `scripts/nomusProductionOrdersLookup.ts`
- Filtros: `--name`, `--external-id`, `--sales-order-external-id`, `--sales-order-item-external-id`
- Não percorre toda a base (`max-pages` limitado)
- Mostra pedido/item locais resolvidos e pendências

```bash
npm run sync:nomus:production-orders:lookup:preview -- --name="OP 05800 - 003"
npm run sync:nomus:production-orders:lookup:apply -- --external-id=30347
```

SyncV1 pontual (legado unificado):

```bash
npm run sync:nomus:production-orders:preview -- --externalId=30347
npm run sync:nomus:production-orders:apply -- --name="OP 05800 - 003"
```

---

## 10. Reconciliação

- Resolve FKs em vínculos já armazenados **sem** consultar a API
- Não modifica `SalesOrder` / `SalesOrderItem`
- Comando dedicado:

```bash
npm run sync:nomus:production-orders:reconcile
# equivalente a:
# npm run sync:nomus:production-orders:lookup:apply -- --reconcile-unresolved
```

Preview de reconcile (sem escrita de FK):

```bash
npm run sync:nomus:production-orders:lookup:preview -- --reconcile-unresolved
```

---

## 11. Lock / concorrência

| Camada | Path / env |
|--------|------------|
| Node JSON | `NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE` (default `/tmp/induscost-nomus-production-orders.lock`) |
| Shell flock | mesmo path + sufixo `.flock` via `scripts/runNomusProductionOrdersSync.sh` |
| Global | `NOMUS_SYNC_LOCK_FILE` — bloqueia OP manual se pedidos/daily ativos (`NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK=1`) |

Impede: dois backfills; dois incrementais; backfill+incremental; manual conflitante com automático.

Lock ativo → `BLOCKED` / `SKIPPED`, exit `0`, **sem** API. Não mata processo válido. PID morto → reclaim.

---

## 12. Logs e auditoria

- Prefixo canônico: `[nomus-production-orders]` (e sufixos `-backfill`, `-incremental`, `-lookup`, `-client`)
- Métricas: tipo, modo, início/fim, status, cutoff, páginas, recebidas, criadas/atualizadas/inalteradas/inválidas, vínculos, resolvidas/pendentes/desativadas, erros, 429, duração, mensagem
- `IntegrationRun` (`target: production-orders`) — best-effort
- **Não** logar: token, `Authorization`, cabeçalhos secretos; URLs redigidas (`redactNomusUrlForLog`)

---

## 13. Rate limit

- `fetchNomusJson`: retries em 429/5xx; `tempoAteLiberar` / `Retry-After` + margem
- Contagem de 429 no backfill (`rateLimitCount`) e auditoria (`rateLimit429`)
- Env: `NOMUS_MAX_RETRIES`, timeout do client OP

---

## 14. Rollback

O sync OP **não** tem “undo” automático de payload. Procedimento operacional:

1. Parar runners (não matar mid-page se possível — preferir SIGINT no backfill).
2. Restaurar backup do banco (passo 2 do deploy) **se** a migration ou apply corrompeu dados.
3. Reverter migration só com plano DBA (`prisma migrate resolve` / down manual) — **não** improvise em produção.
4. Cursor/estado incremental: preservar arquivos; se necessário, restaurar do backup ou reiniciar bootstrap com overlap maior.
5. Reexecutar `preview` → validar → `apply` idempotente.

Dados de negócio (Pedido/NF-e/AR) **não** são alterados pelo sync OP — rollback de OP afeta só stage `NomusProductionOrder*`.

---

## 15. Comandos de produção

### npm

```bash
npm run sync:nomus:production-orders:preview
npm run sync:nomus:production-orders:apply
npm run sync:nomus:production-orders:backfill:preview
npm run sync:nomus:production-orders:backfill:apply
npm run sync:nomus:production-orders:incremental:preview
npm run sync:nomus:production-orders:incremental:apply
npm run sync:nomus:production-orders:reconcile
npm run sync:nomus:production-orders:lookup:preview -- --name="OP 05800 - 003"
npm run sync:nomus:production-orders:lookup:apply -- --external-id=30347
npm run test:nomus:production-orders
```

### Shell (mesmo padrão AR/NF-e)

```bash
# strategies: incremental|backfill ; modes: preview|dry|apply
bash scripts/runNomusProductionOrdersSync.sh incremental apply
bash scripts/runNomusProductionOrdersSync.sh backfill preview
```

### Variáveis úteis

| Env | Uso |
|-----|-----|
| `NOMUS_BASE_URL` / `NOMUS_TOKEN` | Auth |
| `NOMUS_PRODUCTION_ORDERS_PAGE_CURSOR_FILE` | Checkpoint backfill |
| `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_STATE_FILE` | Estado incremental |
| `NOMUS_PRODUCTION_ORDERS_SYNC_LOCK_FILE` | Lock Node |
| `NOMUS_PRODUCTION_ORDERS_RESPECT_GLOBAL_LOCK` | `1` (default) / `0` |
| `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC` | `false` desliga pós-pedidos |
| `NOMUS_SYNC_LOG_DIR` | Logs do shell runner |

---

## 16. Critérios de validação

| Critério | Como verificar |
|----------|----------------|
| Preview não grava | Contagens DB estáveis; banner DRY RUN |
| Apply idempotente | 2ª execução → `unchanged` dominante |
| Vínculo oficial | Fixture 05800: pedido 2530 / item 11324 |
| Pendências | `reconcile` preenche FKs sem API |
| Lock | 2ª execução simultânea → `BLOCKED`, exit 0 |
| Incremental | Estado só avança em sucesso; overlap 72h |
| Segredos | Logs sem token/Authorization |
| Suite | `npm run test:nomus:production-orders` verde |

Caso real mínimo: `lookup:preview --name="OP 05800 - 003"` ou `--external-id=30347`.

---

## 17. Roteiro de deploy (NÃO executar daqui)

Ordem sugerida no **servidor** (fora do Cursor):

1. **Checar sync ativo** — status runners AR/pedidos/OP; não iniciar se lock global/OP ocupado.
2. **Backup** — dump Postgres (stage + IntegrationRun).
3. **Migration** — `npx prisma migrate deploy` (aditiva OP).
4. **Prisma generate** — `npx prisma generate`.
5. **Build** — build da app conforme pipeline do ambiente.
6. **Restart** — reiniciar processo Node/serviço.
7. **Backfill preview** — `npm run sync:nomus:production-orders:backfill:preview` (janela curta).
8. **Backfill apply** — com cursor file e `max-pages` controlado; monitorar logs/429.
9. **Validação** — OP 05800 pontual; contagens; vínculos; IntegrationRun.
10. **Incremental** — `incremental:preview` → `incremental:apply` com overlap 72h.
11. **Idempotência** — reexecutar incremental/apply; esperar `unchanged` / sem avanço indevido de estado em falha.
12. **Rollback** — se falha grave: parar runners → restaurar backup → (opcional) resolver migration → revalidar preview.

Este documento **não** autoriza execução automática desses passos a partir do ambiente de desenvolvimento/Cursor.
