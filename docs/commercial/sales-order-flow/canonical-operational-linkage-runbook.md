# Runbook — Vínculos canônicos Pedido → OP → DS → NF (KAN-LINK)

| Item | Valor |
|------|--------|
| Código | KAN-LINK-10 |
| Branch de origem | `feat/kanban-canonical-operational-links` |
| Computation | `sales-order-flow/v2` |
| Feature flag | `COMMERCIAL_SALES_ORDER_FLOW_ENABLED` |
| Caso de regressão (fixture) | PD 02757 · DS 4525 · NF-e 7394/2 |
| Exceção por pedido/cliente | **Proibida** |

## Objetivo

Operar auditoria e rebuild dos snapshots do Kanban após a adoção do grafo canônico de evidências (sem fuzzy match por cliente/valor/data).

## Comandos de auditoria (read-only)

```bash
# Pedido direcionado
npm run audit:sales-order:operational-links -- --order="PD 02757"

# Massa — pedidos operacionais (sem SHIPPED_COMPLETED)
npm run audit:sales-order:operational-links -- --active --limit=200

# Massa — todos os candidatos de rebuild
npm run audit:sales-order:operational-links -- --all --limit=500

# Relatório em pasta ignorada (não suja o git)
npm run audit:sales-order:operational-links -- --order="PD 02757" --json --markdown --output=tmp-audits/operational-links
```

- **Não grava no banco.** Não chama Nomus.
- Sem `--output`: só terminal (mesmo com `--json` / `--markdown`).
- `tmp-audits/` está no `.gitignore`.

## Comandos de rebuild (snapshots derivados)

```bash
# Preview direcionado (sem escrita)
npm run rebuild:sales-order-flow -- --preview --order="PD 02757"

# Apply direcionado
npm run rebuild:sales-order-flow -- --apply --order="PD 02757"

# Preview / apply em massa por período
npm run rebuild:sales-order-flow -- --preview --from=2026-01-01 --to=2026-12-31
npm run rebuild:sales-order-flow -- --apply --from=2026-01-01 --to=2026-12-31 --batch-size=50

# Incluir já concluídos (SHIPPED_COMPLETED)
npm run rebuild:sales-order-flow -- --preview --include-completed --order="PD 02757"
npm run rebuild:sales-order-flow -- --apply --include-completed --from=2026-01-01 --to=2026-12-31
```

Aliases: `rebuild:sales-order-flow:preview` / `rebuild:sales-order-flow:apply`.

Detalhes de lock/checkpoint: `docs/commercial/sales-order-flow/rebuild-runbook.md`.

## Tabelas alteradas pelo rebuild (`--apply`)

| Tabela | Operação |
|--------|----------|
| `SalesOrderItemFlowSnapshot` | replace/upsert por pedido |
| `SalesOrderFlowSnapshot` | upsert |
| `SalesOrderFlowEvent` | append com `dedupeKey` |

Observabilidade best-effort pode criar `IntegrationRun` (não é snapshot do Kanban).

## Tabelas / entidades protegidas (nunca escritas pelo fluxo)

- `SalesOrder`, `SalesOrderItem`
- `NomusProductionOrder*`, `NomusStockDocument*`, `NomusNfe*`
- `SalesOrderNfeLink` (lido; não escrito pelo rebuild)
- Financeiro (CR/AP), estoque, comissões, O2C facts

## Como verificar logs

| Fonte | Prefixo / local |
|-------|-----------------|
| Auditoria | `[sales-order-operational-linkage-audit]` |
| Rebuild | `[sales-order-flow-rebuild]` |
| Recompute pós-sync | logs de `salesOrderFlowRecomputeObservability` |
| App | stdout do processo Node / systemd journal no servidor |

Procure `computationVersion=sales-order-flow/v2`, contadores `created/updated/unchanged/errors` e badges `SNAPSHOT_DIVERGENT`.

## Validar PD 02757 após deploy

1. Confirmar syncs locais recentes (PV, OP, DS, NF) — **sem** re-sync automático neste runbook.
2. Auditoria:

```bash
npm run audit:sales-order:operational-links -- --order="PD 02757"
```

3. Preview + apply de snapshot:

```bash
npm run rebuild:sales-order-flow -- --preview --order="PD 02757"
npm run rebuild:sales-order-flow -- --apply --order="PD 02757"
```

4. Na UI do Kanban: abrir o pedido → painel **“Por que está nesta coluna?”**  
   Esperado (quando evidências locais existirem): DS `4525`, NF `7394/2 — autorizada`, origem por item, cobertura 00010/00020, **não** coluna “Aguardando Documento de Saída” por falha de vínculo.
5. Confirmar que o mesmo estágio aparece para um pedido genérico equivalente (sem hardcode).

## Interpretar warnings

| Sinal | Significado | Ação típica |
|-------|-------------|-------------|
| `DS_VALID_NOT_RECOGNIZED` | DS existe sem vínculo canônico ao item | Revisar refs `idPedido`/`idItemPedido` no DS |
| `NFE_VALID_WITHOUT_LINK` | NF autorizada sem vínculo ao pedido/item | Checar `SalesOrderNfeLink` / `idNfe` do DS |
| `OP_WITHOUT_LINK` | Residual produtivo sem OP | Abrir OP ou confirmar atendimento sem OP |
| `AMBIGUOUS_LINKS` | Ref aponta a mais de um alvo | Corrigir origem oficial; não forçar fuzzy |
| `SNAPSHOT_DIVERGENT` / `sales-order-flow/v1` | Snapshot antigo vs `v2` | Rebuild do pedido/período |
| Dupla contagem evitada | Warning informativo DS∪NF | Nenhuma — motor usa max pareado |
| `UNIT_CONVERSION_INCONSISTENT` | Unidade sem fator | Corrigir unidade; qty não inventada |
| Ausência de OP com DS/NF | Warning; estágio **não** volta para Aguardando OP | Esperado (evidência posterior prevalece) |

## Desfazer somente snapshots (se necessário)

Não há “rollback mágico” de eventos. Opções seguras:

1. **Reaplicar rebuild** do pedido (idempotente por fingerprint):

```bash
npm run rebuild:sales-order-flow -- --apply --order="PD 02757" --include-completed
```

2. Em emergência controlada (DBA): apagar snapshots/eventos **somente** das tabelas derivadas do pedido e rebuildar — **nunca** tocar SalesOrder/OP/DS/NF.

```sql
-- Exemplo ilustrativo (substituir :id). Executar só com aprovação.
-- DELETE FROM "SalesOrderFlowEvent" WHERE "salesOrderId" = :id;
-- DELETE FROM "SalesOrderItemFlowSnapshot" WHERE "salesOrderId" = :id;
-- DELETE FROM "SalesOrderFlowSnapshot" WHERE "salesOrderId" = :id;
```

Depois: `--apply --order=...`.

## Segurança operacional

- Nenhum script desta cadeia aponta automaticamente para produção: exige `DATABASE_URL` do ambiente e flags explícitas (`--apply`).
- Auditoria default não cria arquivos; `--output` deve ficar em pasta ignorada (`tmp-audits/`).
- Cursor/agente **não** deve executar `--apply` contra produção sem processo de release.

## Testes locais de regressão

```bash
npm run test:sales-order:kanban-canonical-linkage-matrix
npm run test:sales-order:kanban-canonical-evidence
npm run test:sales-order:output-document-links
npm run test:sales-order:production-order-links
npm run test:sales-order:operational-reconciliation
npm run test:sales-order:operational-diagnostics
npm run test:sales-order:operational-links
```
