# Rebuild do Fluxo de Pedidos (OP-56)

## Metadados

| Item | Valor |
|------|--------|
| Script | `scripts/rebuildSalesOrderFlow.ts` |
| Comando npm | `rebuild:sales-order-flow` |
| Motor | `recomputeSalesOrderFlow` (OP-54) + evidências locais (OP-49) |
| Tabelas gravadas | `SalesOrderItemFlowSnapshot`, `SalesOrderFlowSnapshot`, `SalesOrderFlowEvent` |
| Lock | `tmp/sales-order-flow-rebuild.lock` (somente `--apply`) |
| Checkpoint | `tmp/sales-order-flow-rebuild.checkpoint.json` |

## Objetivo

Reconstruir (ou pré-visualizar) os snapshots derivados do Kanban a partir da base **local** já sincronizada.

## O que grava / o que não grava

| Grava (apply) | Não grava |
|---------------|-----------|
| Snapshots de item/pedido | `SalesOrder` / `SalesOrderItem` |
| Eventos de timeline | OP (`NomusProductionOrder*`) |
| | Documento de saída |
| | NF-e / CR / Fluxo de caixa |

**Preview** (`--preview`): calcula e reporta contadores **sem escrita** (inclui `dryRun` no recompute). Checkpoint **não** avança em preview.

## Pré-requisitos

1. Migrações OP-52 / OP-55 aplicadas no ambiente alvo.
2. Dados locais de pedidos/itens/OP/docs/NF/O2C já sincronizados (sem chamar Nomus neste script).
3. Não executar apply em paralelo com outro rebuild do mesmo fluxo (lock próprio).

## Comandos

```bash
# Preview (default se omitir --apply)
npm run rebuild:sales-order-flow -- --preview
npm run rebuild:sales-order-flow -- --preview --from=2026-01-01 --to=2026-06-30

# Pedido específico
npm run rebuild:sales-order-flow -- --preview --order="PD 02596"
npm run rebuild:sales-order-flow -- --apply --order="PD 02596"

# Apply por período
npm run rebuild:sales-order-flow -- --apply --from=2026-01-01 --to=2026-12-31 --batch-size=50

# Incluir já concluídos (SHIPPED_COMPLETED)
npm run rebuild:sales-order-flow -- --apply --include-completed --from=2026-01-01 --to=2026-12-31

# Retomada
npm run rebuild:sales-order-flow -- --apply --resume-from="PD 02596"
npm run rebuild:sales-order-flow -- --apply --resume-from=<salesOrderId-uuid>
```

Equivalente direto:

```bash
npx tsx scripts/rebuildSalesOrderFlow.ts --preview
npx tsx scripts/rebuildSalesOrderFlow.ts --apply --from=2026-01-01 --to=2026-12-31
```

## Parâmetros

| Flag | Descrição |
|------|-----------|
| `--preview` | Sem escrita |
| `--apply` | Persiste snapshots/eventos |
| `--order=` | Filtro por `orderCode` |
| `--from=` / `--to=` | Filtro por `SalesOrder.issueDate` (UTC) |
| `--batch-size=N` | Tamanho do lote (default 50, max 500) |
| `--include-completed` | Inclui pedidos com snapshot `SHIPPED_COMPLETED` |
| `--resume-from=` | Retoma após UUID ou `orderCode` |
| `--checkpoint-file=` | Path do checkpoint (ou env `SALES_ORDER_FLOW_REBUILD_CHECKPOINT_FILE`) |
| `--lock-file=` | Path do lock (ou env `SALES_ORDER_FLOW_REBUILD_LOCK_FILE`) |
| `--max-batches=N` | Limite defensivo de lotes nesta execução |

## Lock

- Adquirido **somente** em `--apply`.
- Payload JSON: `token`, `pid`, `mode`, `startedAt`.
- Se o PID do holder não estiver vivo, o lock stale é removido.
- Segunda execução apply concorrente → `lockBlocked=true`, `exitCode=2`.

## Checkpoint e retomada

- Avança **somente** após um lote **completo** em apply (sucessos + erros isolados por pedido).
- Lote incompleto (abort/crash no meio) **não** avança o checkpoint.
- Retomada: lê checkpoint ou `--resume-from` e continua com `id > cursor`.

## Contadores e exit codes

Resumo impresso: `ordersSelected`, `ordersProcessed`, `created`, `updated`, `unchanged`, `errors`, `batchesCompleted`, `durationMs`, `checkpointAdvanced`, `lockBlocked`.

| exitCode | Significado |
|----------|-------------|
| 0 | Sucesso sem erros de pedido |
| 1 | Um ou mais pedidos falharam (erros isolados reportados) |
| 2 | Lock bloqueado ou argumentos inválidos |

## Idempotência

Segunda execução apply sobre o mesmo conjunto tende a `unchanged` (fingerprint OP-54/55). Eventos usam `dedupeKey` única.

## Procedimento seguro sugerido

1. `npm run rebuild:sales-order-flow -- --preview --from=… --to=…`
2. Revisar contadores / erros
3. `npm run rebuild:sales-order-flow -- --apply --from=… --to=…`
4. Em falha parcial: corrigir causa → `--resume-from` ou reaplicar (idempotente)
5. Não ocultar erros: `errorReport` lista `orderCode` + mensagem

## Restrições

- **Não** executar este script apontando para produção a partir do Cursor sem processo de release aprovado.
- O agente/Cursor **não** possui acesso ao banco de produção; testes cobrem mocks/local only.
