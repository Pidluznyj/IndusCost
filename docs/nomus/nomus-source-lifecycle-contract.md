# SYNC-02 — Contrato comum de ciclo de vida dos registros Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-02 |
| **Pré-requisito** | SYNC-01 (`docs/nomus/nomus-crud-reconciliation-audit.md`) |
| **Atualizado** | 2026-07-17 |
| **Natureza** | Infraestrutura e schema **somente** |
| **Fora de escopo** | Alterar sincronizadores, marcar ausentes, alterar consumidores, excluir dados |

---

## 0. Checklist (decisões)

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | A estrutura já existe parcialmente? | **Sim.** `NomusStockDocument` / `SalesOrderNfeLink` têm presença; CR/CP têm `payloadHash`+`syncedAt`; `IntegrationRun` é genérico. Pedido/CR/CP **não** tinham ciclo de vida canônico. |
| 2 | Reutilizar `lastSeenAt` / `presentInLastPayload` do Documento de Saída? | **Sim, o contrato de campos** — não o mark-absent desligado do stock. |
| 3 | Existe tabela de execução reutilizável? | `IntegrationRun` existe, mas é frouxa. Criamos **`NomusSourceSyncRun`** tipada para reconciliação (complementa, não substitui IntegrationRun). |
| 4 | Campos nas entidades vs tabela genérica? | **Campos nas entidades (opção A do SYNC-01)** — uma fonte de verdade por registro. |
| 5 | Evita duas fontes de verdade? | Status de presença só nas entidades oficiais; a run registra métricas/escopo, não duplica o status do registro. |

---

## 1. Arquitetura escolhida

1. **Enum** `NomusSourcePresenceStatus`: `PRESENT` | `MISSING_CANDIDATE` | `MISSING_CONFIRMED`
2. **Campos de lifecycle** em `SalesOrder`, `NomusAccountsReceivable`, `NomusAccountsPayable`
3. **Tabela** `NomusSourceSyncRun` com escopo, completude e contadores
4. **Kill switches** por entidade (env, fail-closed)
5. **Módulo puro** `src/lib/nomus/nomusSourceLifecycleContract.ts` — regras sem I/O

Sincronizadores **ainda não** escrevem nestes campos além dos defaults da migration.

---

## 2. Ciclo de vida

| Status | Significado |
|--------|-------------|
| **PRESENT** | Confirmado no último payload válido (ou inicialização técnica). |
| **MISSING_CANDIDATE** | Não apareceu em coleta completa; **não** retirar automaticamente dos consumidores. |
| **MISSING_CONFIRMED** | Ausência confirmada (lookup direcionado ou duas runs completas consecutivas) — **ainda não aplicado pelos syncers**. |

### Campos

| Campo | Pedido | CR | CP | Notas |
|-------|:------:|:--:|:--:|-------|
| `sourcePresenceStatus` | novo | novo | novo | default `PRESENT` |
| `presentInLastPayload` | novo | novo | novo | default `true` |
| `firstSeenAt` | novo | novo | novo | backfill `createdAt` |
| `lastSeenAt` | novo | novo | novo | backfill `updatedAt` / `syncedAt` |
| `missingSince` | novo | novo | novo | null |
| `missingConsecutiveRuns` | novo | novo | novo | default `0` |
| `sourceRemovedAt` | novo | novo | novo | null |
| `lastSyncRunId` | novo | novo | novo | FK opcional → `NomusSourceSyncRun` |
| `payloadHash` | **novo** | **já existia** | **já existia** | sem duplicar em CR/CP |

---

## 3. Execução (`NomusSourceSyncRun`)

Campos: `entityType`, `strategy`, `scope` (JSON), `startedAt`, `finishedAt`, `status`, `payloadComplete`, contadores (`pagesRead`, `rowsRead`, created/updated/unchanged, missing*, reactivated, `http429Count`, `errors`), `coveredFrom`/`coveredTo`.

Estados: `RUNNING` | `SUCCESS` | `FAILED` | `INCONCLUSIVE`.

**Regra dura (contrato puro):**

```
canReconcileAbsences ⇔ status === SUCCESS && payloadComplete === true
```

Além disso, a flag da entidade deve estar habilitada e o **escopo** do registro deve ser compatível com o da run.

---

## 4. Escopo

Escopos canônicos (helpers):

- `sales_orders_issue_date_window`
- `accounts_receivable_due_date_window`
- `accounts_payable_due_date_window` (eixo oficial = vencimento)

Escopos com `kind`/janela/`onlyPending` diferentes **não** são comparáveis.

---

## 5. Kill switches

| Env | Entidade | Default |
|-----|----------|---------|
| `NOMUS_SOURCE_RECONCILE_SALES_ORDERS_ENABLED` | Pedidos | **off** |
| `NOMUS_SOURCE_RECONCILE_AR_ENABLED` | CR | **off** |
| `NOMUS_SOURCE_RECONCILE_AP_ENABLED` | CP | **off** |

Valores que habilitam: `1`, `true`, `yes`, `on`, `enabled`. Qualquer outro / ausente = desabilitado.

CREATE/UPDATE dos syncers **não** dependem destas flags.

---

## 6. Migration

- Path: `prisma/migrations/20260803120000_nomus_source_lifecycle_contract/migration.sql`
- Aditiva; sem `DELETE` de dados comerciais; sem mudar `externalId`
- Defaults seguros + backfill técnico de timestamps

### Rollback lógico

Em emergência (somente se a migration já tiver sido aplicada e precisar reverter schema):

```sql
ALTER TABLE "SalesOrder" DROP CONSTRAINT IF EXISTS "SalesOrder_lastSyncRunId_fkey";
ALTER TABLE "NomusAccountsReceivable" DROP CONSTRAINT IF EXISTS "NomusAccountsReceivable_lastSyncRunId_fkey";
ALTER TABLE "NomusAccountsPayable" DROP CONSTRAINT IF EXISTS "NomusAccountsPayable_lastSyncRunId_fkey";

-- Remover índices/colunas SYNC-02 de SalesOrder, NomusAccountsReceivable, NomusAccountsPayable
-- (listar colunas: payloadHash só em SalesOrder se não houver outro uso; lifecycle cols)

DROP TABLE IF EXISTS "NomusSourceSyncRun";
DROP TYPE IF EXISTS "NomusSourceSyncRunStatus";
DROP TYPE IF EXISTS "NomusSourceSyncEntityType";
DROP TYPE IF EXISTS "NomusSourcePresenceStatus";
```

Documentar no PR operacional antes de executar em produção.

---

## 7. Código

| Arquivo | Papel |
|---------|--------|
| `src/lib/nomus/nomusSourceLifecycleContract.ts` | Contrato puro |
| `src/lib/nomus/nomusSourceReconciliationFlags.ts` | Kill switches |
| `src/lib/nomus/nomusSourceLifecycleContract.test.ts` | Testes |
| `prisma/schema.prisma` | Modelos/enums |
| Migration acima | SQL aditivo |

---

## 8. Critérios de aceite SYNC-02

- [x] Campos lifecycle nas três entidades oficiais
- [x] `payloadHash` só onde faltava (Pedido)
- [x] `NomusSourceSyncRun` com completude e escopo
- [x] Defaults PRESENT / present=true / missingRuns=0
- [x] Flags independentes fail-closed
- [x] Contrato rejeita status desconhecido
- [x] Payload incompleto não autoriza ausência
- [x] Escopos incompatíveis rejeitados
- [x] Sem alteração de sincronizadores / consumidores / deletes
- [x] Documentação + rollback lógico

## 9. Próximo passo (fora desta etapa)

Wiring nos syncers: tocar `lastSeenAt`/`PRESENT` no upsert; mark-absent só com `canMarkRecordMissingInRun` + flags on.
