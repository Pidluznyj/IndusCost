# OP-01 — Arquitetura-alvo da integração de Ordens de Produção

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Prompt** | OP-01 |
| **Data** | 2026-07-16 |
| **Pré-requisito** | [`current-state.md`](./current-state.md), [`api-contract.md`](./api-contract.md) |

> Este documento **não** cria Prisma/migration/sync. Descreve o alvo e o que reutilizar vs. criar nos próximos prompts.

---

## 1. Princípios

1. Fonte oficial da OP: `GET /rest/ordens` (não inferir do raw do pedido).
2. Vínculo Pedido/Item **somente** por `itensPedido[].idPedido` e `itensPedido[].id`.
3. Telas e APIs de produto **nunca** consultam Nomus na abertura — só banco/APIs IndusCost.
4. Sync isolado: não mutar Pedido, item, NF-e, AR/AP, Fluxo, Comissões, Formação de Preço, BOM.
5. Idempotência por `externalId` (OP) e `(productionOrderExternalId, externalSalesOrderItemId)` (link).
6. YAGNI: reutilizar infra Nomus existente; não inventar `SyncState` se `IntegrationRun` + cursor arquivo bastam.

---

## 2. Componentes a reutilizar

| Componente | Path / símbolo | Uso OP |
|------------|----------------|--------|
| Cliente HTTP | `nomusRestClient.ts` (`fetchNomusJson`, headers, URL, redaction) | Já usado pelo sync OP v1 |
| Decimal pt-BR | `parseNomusPtBrNumber` / mapper OP | Quantidades `"15.400"` |
| Datas | `parseNomusBrDateTime` (quando campos de data forem confirmados no payload) | Incremental por data se API permitir |
| Cursor de página | padrão `nomusSalesOrdersPaginationCursor` | Backfill OP (já espelhado) |
| Preview/apply | estilo stock/AR (`preview`\|`apply`) | Já no CLI OP |
| Pós-hook Pedidos | bloco final `nomusSalesOrdersSyncV1.ts` | Já chama OP após apply |
| Lock global | flock sales-orders / daily | OP herda quando encadeado |
| Ledger | `IntegrationRun` | **Reutilizar** (ainda não wired na OP) |
| Resolução Pedido/Item | lookup por `externalSalesOrderId` / `nomusItemExternalId` | Já no repository OP |
| Testes puros | fixture OP 05800 + wiring source | Já em `nomusProductionOrders.test.ts` |
| Stage models | `NomusProductionOrder`, `NomusProductionOrderSalesLink` | **Já landados** — não recriar |

---

## 3. Componentes que realmente precisam ser criados (próximos prompts)

| Item | Motivo | Prioridade |
|------|--------|------------|
| Persistência `IntegrationRun` no sync OP | Observabilidade alinhada a AR/NF-e | Alta |
| Shell `runNomusProductionOrdersSync.sh` (+ opcional flock dedicado ou reuso global) | Operação/cron sem depender só do pós-pedido | Alta |
| API IndusCost read-only (lista/detalhe OP + links) | UI sem Nomus | Alta |
| UI (funil / gestão) lendo stage local | Substituir “OP indisponível” / raw embutido | Média |
| Unificar HTTP legado V1 → `nomusRestClient` | Dívida; **fora do caminho crítico OP** | Baixa |
| Timeout em `fetchNomusJson` | Infra transversal; coordenar com outros syncs | Média (global) |
| FK opcional Inventory → OP | Só quando inventário consumir stage | Baixa / futuro |
| Target no `nomusSyncOrchestrator` | Opcional se shell+pós-pedido bastarem | Baixa |

**Não criar neste roadmap:** segundo model paralelo de OP; sync que reescreva `SalesOrder`; consulta Nomus no browser.

---

## 4. Models (estado e proposta)

### 4.1 Já existentes (OP-02)

```text
NomusProductionOrder
  externalId @unique
  name, status, tipo, priority
  externalProductId, productCode, productDescription, productAdditionalInfo
  productConfigId, productConfigCode
  externalCompanyId, companyName
  quantity, unit, stockSector
  openedAt, closedAt, plannedAt, nomusUpdatedAt
  rawJson, payloadHash
  firstSeenAt, lastSeenAt, lastChangedAt, syncedAt

NomusProductionOrderSalesLink
  productionOrderId → NomusProductionOrder
  productionOrderExternalId
  externalSalesOrderId, externalSalesOrderItemId
  itemNumber, customerName, linkedQuantity, rawJson
  salesOrderId?, salesOrderItemId?
  isCurrent, firstSeenAt, lastSeenAt, removedAt
  @@unique([productionOrderExternalId, externalSalesOrderItemId])
```

Sem `SyncState` dedicado — incremental via cursor arquivo + `IntegrationRun`.

### 4.2 Relações propostas (sem migration nova agora)

- Manter FKs opcionais Pedido/Item (`onDelete: SetNull`) — Pedido pode ainda não existir no momento do sync.
- **Não** obrigar FK de `InventoryMovement.productionOrderId` até haver consumidor inventário.
- Opcional futuro: índice composto de consulta UI `(externalSalesOrderId, presentInLastPayload)`.

### 4.3 Proposta de evolução de campos (só se payload comprovado exigir)

| Campo candidato | Quando |
|-----------------|--------|
| `openedAt` / `closedAt` | Se API expuser datas estáveis para incremental |
| `externalCompanyId` | Se `empresa` vier como objeto com `id` |
| hash de payload | Se precisar detectar no-op de update |

Sem evidência → não adicionar.

---

## 5. Estratégia de sincronização

```text
Nomus GET /rest/ordens
  → mapNomusProductionOrderPayload (puro)
  → preview: planos create/update
  → apply: upsertNomusProductionOrder (transação)
       → resolve SalesOrder / SalesOrderItem por IDs externos
       → marca links ausentes (presentInLastPayload=false)
  → (alvo) persist IntegrationRun
  → log JSON resumido
```

Modos CLI já definidos:

| Modo | Uso |
|------|-----|
| `preview` | Dry-run |
| `apply` | Persistência |
| `incremental` | Janela de páginas limitada |
| `backfill` | Blocos + cursor arquivo |
| `point` | `--externalId` / `--name` / `--salesOrderExternalId` |

Encadeamento: após apply de Pedidos → `runNomusProductionOrdersAfterSalesOrdersSync` (env `NOMUS_PRODUCTION_ORDERS_AFTER_SYNC`).

---

## 6. Estratégia incremental

**Curto prazo (já implementável com o que existe):**

1. Pós-pedido: consulta pontual por `salesOrderExternalId` dos pedidos afetados (quando RSQL nested funcionar); senão fallback incremental por páginas.
2. Cron/shell: `incremental` com `maxPages` baixo (ex. 20) sob lock.
3. Backfill: cursor rotativo até esgotar catálogo.

**Médio prazo (se API confirmar filtro por data):**

- RSQL `dataAbertura` / campo oficial — espelhar AR/stock (`from`/`to`).
- Só após validação no servidor (Cursor não acessa produção).

**Não usar:** inferência por nome de OP no pedido, matching por SKU/qtde/cliente.

---

## 7. Riscos

| Risco | Mitigação |
|-------|-----------|
| RSQL `itensPedido.idPedido==N` não suportado | Fallback paginado; documentar resultado do teste no servidor |
| Pedido local ainda sem `externalSalesOrderId` | Link grava IDs externos; FK null até o pedido sincronizar |
| Dois stacks HTTP (legado vs rest client) | OP já no stack novo; unificar V1 depois |
| Sem timeout HTTP | Hang pode prender pós-pedido; adicionar timeout global |
| OP embutida no raw vs stage oficial | UI deve preferir stage; raw só legado até migração de telas |
| Migration não aplicada em produção | Deploy explícito no servidor — fora do Cursor |
| Concorrência OP + sales-orders | Preferir encadear sob mesmo flock; shell dedicado só com lock |
| Inventário `productionOrderId` solto | Não acoplar até haver requisito |

---

## 8. Ordem dos próximos passos

| # | Prompt / entrega | Depende de |
|---|------------------|------------|
| OP-01 | **Este** — auditoria + docs | — |
| OP-02 | Homologação no servidor: migrate deploy + preview pontual OP 05800 + smoke | OP-01 |
| OP-03 | `IntegrationRun` + shell/cron + runbook operacional | OP-02 |
| OP-04 | API read-only IndusCost (lista/detalhe/links por pedido) | OP-03 |
| OP-05 | UI funil/gestão consumindo stage (sem Nomus) | OP-04 |
| OP-06 | (Opcional) timeout HTTP + unificação cliente V1 | paralelo |
| OP-07 | (Opcional) inventário / FK Inventory | requisito inventário |

Cada prompt: YAGNI, checks/build, commit focado, **não** avançar sozinho.

---

## 9. Diagrama lógico

```text
┌─────────────┐     flock (global)      ┌──────────────────────────┐
│ Cron/shell  │ ───────────────────────▶│ nomusSalesOrdersSyncV1   │
│ Pedidos     │                         │ apply                    │
└─────────────┘                         └────────────┬─────────────┘
                                                     │ soft-fail
                                                     ▼
                                        ┌──────────────────────────┐
                                        │ production-orders sync   │
                                        │ /rest/ordens             │
                                        └────────────┬─────────────┘
                                                     │
                          ┌──────────────────────────┼──────────────────────────┐
                          ▼                          ▼                          ▼
               NomusProductionOrder     NomusProductionOrderSalesLink     (alvo) IntegrationRun
                          │                          │
                          │               resolve FKs│
                          │                          ▼
                          │                 SalesOrder / SalesOrderItem
                          ▼
                    APIs/UI IndusCost (somente leitura local)
```
