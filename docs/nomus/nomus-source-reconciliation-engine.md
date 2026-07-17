# SYNC-03 — Motor seguro de reconciliação de presença Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-03 |
| **Pré-requisitos** | SYNC-01, SYNC-02 |
| **Atualizado** | 2026-07-17 |
| **Natureza** | Motor **puro** (plano), sem integração aos sincronizadores |
| **Código** | `src/lib/nomus/nomusSourceReconciliationEngine.ts` |

---

## 0. Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Helper semelhante em Documento de Saída ou BOM? | **Documento de Saída:** `decideStockDocumentHeaderAction` / `planStockDocumentPersist` (hash → create/update/unchanged). **BOM:** sem equivalente de presença. |
| 2 | Maior parte como função pura? | **Sim.** `planNomusSourceReconciliation` — sem HTTP/Prisma/delete. |
| 3 | Respeita escopo da execução? | **Sim.** Ausência só com escopos compatíveis (`canMarkRecordMissingInRun`). |
| 4 | Proteção contra payload incompleto? | **Sim.** `payloadComplete !== true` → não avalia ausência; registros não retornados → `INCONCLUSIVE`. |
| 5 | Execução repetida idempotente? | **Sim.** Mesmo input → mesmo plano; após apply local, reexecução → `UNCHANGED`. |

---

## 1. Contrato de entrada

```ts
planNomusSourceReconciliation({
  entityType,           // SALES_ORDER | ACCOUNTS_RECEIVABLE | ACCOUNTS_PAYABLE
  scope,                // NomusSourceSyncScope da execução
  run,                  // status, payloadComplete, entityType, scope, id?
  found,                // { externalId, payloadHash }[]  — já coletados
  localRecords,         // snapshots locais (+ scope por registro)
  directedLookups?,     // { externalId, found }[] — consultas oficiais já resolvidas
  confirmation?,        // consecutiveCompleteMissesToConfirm (default 2), confirmViaDirectedLookup
  executedAt,
  reconciliationEnabled,// kill switch da entidade
  mode?,                // "preview" | "apply" (default preview)
})
```

**Não consultar HTTP dentro do motor.** Lookups direcionados entram prontos.

---

## 2. Algoritmo

1. Indexar `found` por `externalId`.
2. Para cada id retornado:
   - sem local → **CREATE** (`PRESENT`, limpa ausência);
   - local `MISSING_*` → **REACTIVATE**;
   - hash diferente → **UPDATE**;
   - hash igual → **UNCHANGED** (ainda atualiza `lastSeenAt` / `lastSyncRunId` no patch).
3. Ausência **somente** se: `SUCCESS` + `payloadComplete` + flag + `entityType` + escopo compatível.
4. Local no escopo e não retornado:
   - lookup `found: true` → `INCONCLUSIVE` (não ausentar);
   - lookup `found: false` **ou** `missingConsecutiveRuns+1 >= limiar` → **MISSING_CONFIRMED**;
   - senão → **MISSING_CANDIDATE** (`missingConsecutiveRuns = 1` na primeira).
5. Fora do escopo / outro `entityType` → **IGNORE_OUTSIDE_SCOPE**.
6. Payload incompleto / FAILED / INCONCLUSIVE → não incrementa ausência; locais cobertos não retornados → **INCONCLUSIVE**.

---

## 3. Proteção de escopo

- Comparação via `areNomusSourceSyncScopesCompatible` / `canMarkRecordMissingInRun`.
- `recent-window` e `full-reconciliation` com `from`/`to`/`strategy` diferentes **não** se misturam.
- Nunca inferir ausência de CR pela ausência do Pedido (nem CP por outra entidade).
- Nunca tratar consulta parcial (`payloadComplete: false`) como universo completo.

---

## 4. Confirmação de ausência

| Caminho | Condição |
|---------|----------|
| Candidato | 1ª miss completa no escopo |
| Confirmado (consecutivo) | 2ª miss completa (configurável, mín. 2) |
| Confirmado (direcionado) | Lookup oficial `found: false` |

Bloqueios: flag off, `FAILED`, `INCONCLUSIVE`, `payloadComplete: false`, escopo incompatível.

---

## 5. Reativação

`MISSING_CANDIDATE` ou `MISSING_CONFIRMED` que reaparece:

- `PRESENT`, `presentInLastPayload=true`;
- zera `missingSince`, `missingConsecutiveRuns`, `sourceRemovedAt`;
- atualiza hash/`lastSeenAt`/`lastSyncRunId`;
- item vai para `reactivated` (não para `updates`).

Histórico de execuções permanece nas runs (`NomusSourceSyncRun`) — o motor não apaga runs.

---

## 6. Preview vs apply

| Mode | Comportamento |
|------|----------------|
| `preview` | Plano completo; `lifecyclePatch = null` |
| `apply` | Mesmo plano + `lifecyclePatch` pronto para o syncer persistir |

O motor **nunca** persiste. Syncers (ticket futuro) consomem o plano.

---

## 7. Resultado

`creates`, `updates`, `unchanged`, `missingCandidates`, `missingConfirmed`, `reactivated`, `ignoredOutsideScope`, `inconclusive`, `reasons`, `counters` (`deletes` sempre `0`).

---

## 8. Testes

```bash
npm run test:nomus:source-reconciliation
npm run test:nomus:source-lifecycle
```

Cobertura: create, update, unchanged, 1ª/2ª ausência, lookup, reativação, incompleto, FAILED, 429/INCONCLUSIVE, fora de escopo, recent-window, full-reconciliation, mesmo externalId em entidades distintas, independência Pedido/CR/CP, idempotência, sem delete.
