# PERFORMANCE 06 — Análise de índices (Pedidos + Financeiro)

**Somente análise.** Nenhuma migration criada. Nenhum índice aplicado. Nenhum código funcional alterado. Sem commit/push/deploy.

Fontes: `prisma/schema.prisma`, `server.ts` (`GET /api/sales-orders`), `salesOrdersListSummary.ts`, `salesOrderLinkedNfe.ts`, `financeAccountsReceivableDashboard.ts` / Management, `financeAccountsPayableDashboard.ts`, `financeBillingNfeList.ts`, `financeCashFlowRoutes.ts`, `financeDueRadarRoutes.ts` (reusa loaders AR/AP).

Tabelas Prisma sem `@@map` → nomes físicos `"SalesOrder"`, `"NomusAccountsReceivable"`, etc.

---

## Resumo executivo

| Prioridade | Tabela | Índice sugerido | Consulta beneficiada | Risco |
|---|---|---|---|---|
| P1 | `SalesOrder` | `(createdAt DESC, issueDate DESC)` | Lista + aggregate (`ORDER BY createdAt, issueDate`) | Baixo |
| P1 | `SalesOrder` | `(externalSellerId)` | Filtro/groupBy vendedor | Baixo |
| P1 | `NomusAccountsReceivable` | parcial `(dueDate)` WHERE `balanceReceivable > 0` | AR aberto / horizonte / CF / daily-radar | Baixo–médio |
| P1 | `NomusAccountsPayable` | parcial `(dueDate)` WHERE `balancePayable > 0` | AP aberto / CF / daily-radar | Baixo–médio |
| P2 | `NomusAccountsReceivable` | parcial `(syncedAt, dueDate)` WHERE `balanceReceivable > 0` | Cutoff sync + sort | Médio |
| P2 | `NomusAccountsPayable` | parcial `(syncedAt, dueDate)` WHERE `balancePayable > 0` | Cutoff sync + sort | Médio |
| P2 | `SalesOrder` | `(status, issueDate)` | Lista padrão (≠ CANCELLED + período) | Baixo |
| P2 | `NomusNfe` | parcial autorizada `(xmlDhEmi DESC, dataProcessamento DESC)` | Billing Documentos | Médio (enum/status) |
| P3 | `SalesOrder` | parcial presença + sort | Flag exclusão `MISSING_CONFIRMED` | Médio (predicado) |
| P3 | `SalesOrderNfeLink` | parcial vínculo válido | Filtro Com/Sem NF (`EXISTS`) | Médio |

---

## 1. Índices atuais relevantes (schema)

### `SalesOrder`
- UNIQUE: `proposalId`, `orderCode`
- INDEX: `customerId`, `status`, `issueDate`, `sourcePresenceStatus`, `lastSeenAt`, `lastSyncRunId`, `externalSalesOrderId`, `payloadHash`
- **Ausentes vs consultas:** `createdAt`, `externalSellerId`

### `SalesOrderNfeLink`
- UNIQUE: `[salesOrderId, nfeExternalId]`
- INDEX: `salesOrderId` (**redundante** com leading do UNIQUE), `nfeExternalId`, `nfeNumber`, `nfeKey`, `dataProcessamento`, `externalSalesOrderId`

### `SalesOrderItem`
- INDEX: `salesOrderId`, `proposalItemId`, `productId`, …

### `NomusAccountsReceivable` / `NomusAccountsPayable`
- UNIQUE: `externalId`
- INDEX: `dueDate`, `status`, nomes/CNPJ, invoice, `syncedAt`, presença…
- **Ausentes vs consultas abertas:** `balanceReceivable` / `balancePayable` (usados em WHERE, sem índice)

### `NomusNfe`
- UNIQUE: `externalId`
- INDEX: `dataProcessamento`, `xmlDhEmi`, `status`, `billingClassification`, `isMarketSale`, `numero`, `xmlDestCnpjCpf`, …

### `AccountsPayableCostCenterAllocation`
- UNIQUE: `[accountsPayableId, costCenterId]` → lookup por título já coberto

---

## 2. Consultas críticas → campos

### A. `GET /api/sales-orders` (+ aggregate)
| | |
|---|---|
| **Tabela** | `SalesOrder` (+ EXISTS `SalesOrderNfeLink`, opcional `Customer`) |
| **WHERE** | `status` (eq ou `<> CANCELLED`); `issueDate` range; `customerId`; `externalSellerId` / `nomusSellerName`; presença `sourcePresenceStatus`; busca OR (orderCode, NF, cliente…); `nfeLinks` some/none |
| **ORDER BY** | `createdAt DESC`, `issueDate DESC` |
| **GROUP BY** | — (aggregate `_count` / `_sum`) |
| **Seletividade** | Ano corrente + ≠ cancelados: média; vendedor: alta; busca ILIKE: baixa (btree fraco) |
| **Volume** | Crescente com sync Nomus (milhares–dezenas de milhares) |
| **Índice atual** | `status`, `issueDate`, `customerId` — **não cobre sort por `createdAt`** |
| **Sugestão** | Ver P1 `createdAt+issueDate`, `externalSellerId`, P2 `status+issueDate` |
| **Escrita** | Baixa–média (insert/update sync) |
| **Redundância** | Não duplica UNIQUE |

### B. Linked NFe da página
| | |
|---|---|
| **WHERE** | `SalesOrderNfeLink.salesOrderId IN (…)`; `NomusNfe.externalId IN (…)` |
| **Índice atual** | UNIQUE link + UNIQUE NFe — **suficiente** |
| **Sugestão** | Nenhuma obrigatória; parcial “vínculo válido” opcional (P3) |

### C. AR management / horizonte / CF / due-radar / daily-radar
| | |
|---|---|
| **Tabela** | `NomusAccountsReceivable` |
| **WHERE típico aberto** | `balanceReceivable > 0` (+ `dueDate` range; `syncedAt >= cutoff`; presença; overdue + `suspendCollection`) |
| **ORDER BY** | `dueDate ASC` |
| **Índice atual** | `dueDate`, `syncedAt` — **filtro de saldo não indexado** |
| **Sugestão** | Parciais P1/P2 em `balanceReceivable > 0` |

### D. AP (mesmo padrão)
| | |
|---|---|
| **WHERE aberto** | `balancePayable > 0` (+ sync/presença/dueDate) |
| **ORDER BY** | `dueDate ASC` |
| **Sugestão** | Parciais P1/P2 espelhadas |

### E. Billing NF-e list
| | |
|---|---|
| **WHERE** | Ano/mês em `xmlDhEmi` (ou fallback `dataProcessamento`); autorizada: `status=4`, `isMarketSale=true`, `billingClassification=MARKET_REVENUE` |
| **ORDER BY** | `xmlDhEmi DESC`, `dataProcessamento DESC` |
| **Índice atual** | Colunas isoladas |
| **Sugestão** | Parcial autorizada P2 |

### F. Busca textual / contains
| | |
|---|---|
| **Campos** | `personName`, `companyName`, `nomusSellerName`, SKU, etc. |
| **Veredito** | **Não recomendar btree** — baixa seletividade para `contains`/ILIKE. Futuro: `pg_trgm` GIN (fora deste escopo btree). |

---

## 3. Recomendados / opcionais / não recomendados

### Recomendados (aplicar em passo futuro, após EXPLAIN)

1. **`SalesOrder (createdAt DESC, issueDate DESC)`** — sort da listagem sem índice hoje.  
2. **`SalesOrder (externalSellerId)`** — filtro e opções de vendedor.  
3. **AR parcial open `(dueDate)` WHERE `balanceReceivable > 0`**.  
4. **AP parcial open `(dueDate)` WHERE `balancePayable > 0`**.  
5. **AR/AP `(syncedAt, dueDate)` WHERE balance > 0** — se EXPLAIN mostrar filtro de cutoff caro.

### Opcionais

6. `SalesOrder (status, issueDate)` — AND frequente; parcial overlap com singles.  
7. `NomusNfe` parcial autorizada + sort.  
8. `SalesOrder` parcial presença + sort (só se flag de exclusão ligada em produção).  
9. `SalesOrderNfeLink` parcial vínculo válido para EXISTS Com NF.  
10. AR overdue parcial com `suspendCollection IS NOT TRUE`.

### Não recomendados

| Ideia | Motivo |
|-------|--------|
| Índice btree em `companyName`/`personName` para contains | Já existem; não ajudam ILIKE `%x%` |
| Novo índice só em `SalesOrderNfeLink.salesOrderId` | Prefixo do UNIQUE |
| Índice em `NomusNfe.externalId` / AR·AP `externalId` | Já UNIQUE |
| Índice em `balance*` sozinho sem parcial | Baixa seletividade se muitos títulos com saldo |
| Dezenas de compostos “empresa+status+data” sem coluna empresa tipada | `companyName` texto — não inventar FK inexistente |
| `pg_trgm` neste passo | Escopo/ops separado |

---

## 4. SQL conceitual (não aplicar agora)

```sql
-- P1
CREATE INDEX IF NOT EXISTS "SalesOrder_createdAt_issueDate_idx"
  ON "SalesOrder" ("createdAt" DESC, "issueDate" DESC);

CREATE INDEX IF NOT EXISTS "SalesOrder_externalSellerId_idx"
  ON "SalesOrder" ("externalSellerId");

CREATE INDEX IF NOT EXISTS "NomusAccountsReceivable_open_dueDate_idx"
  ON "NomusAccountsReceivable" ("dueDate" ASC)
  WHERE "balanceReceivable" > 0;

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_open_dueDate_idx"
  ON "NomusAccountsPayable" ("dueDate" ASC)
  WHERE "balancePayable" > 0;

-- P2
CREATE INDEX IF NOT EXISTS "NomusAccountsReceivable_open_syncedAt_dueDate_idx"
  ON "NomusAccountsReceivable" ("syncedAt", "dueDate")
  WHERE "balanceReceivable" > 0;

CREATE INDEX IF NOT EXISTS "NomusAccountsPayable_open_syncedAt_dueDate_idx"
  ON "NomusAccountsPayable" ("syncedAt", "dueDate")
  WHERE "balancePayable" > 0;

CREATE INDEX IF NOT EXISTS "SalesOrder_status_issueDate_idx"
  ON "SalesOrder" ("status", "issueDate");

CREATE INDEX IF NOT EXISTS "NomusNfe_authorized_market_xmlDhEmi_idx"
  ON "NomusNfe" ("xmlDhEmi" DESC, "dataProcessamento" DESC)
  WHERE "status" = 4
    AND "isMarketSale" = true
    AND "billingClassification" = 'MARKET_REVENUE';

-- P3 (opcional)
CREATE INDEX IF NOT EXISTS "SalesOrder_present_createdAt_issueDate_idx"
  ON "SalesOrder" ("createdAt" DESC, "issueDate" DESC)
  WHERE "sourcePresenceStatus" <> 'MISSING_CONFIRMED';

CREATE INDEX IF NOT EXISTS "SalesOrderNfeLink_valid_for_invoice_filter_idx"
  ON "SalesOrderNfeLink" ("salesOrderId")
  WHERE "dataProcessamento" IS NOT NULL
    AND ("nfeStatus" IS NULL OR "nfeStatus" <> 7);
```

---

## 5. Migration que seria necessária (futuro — **não criada**)

Em passo posterior (não agora):

1. Adicionar `@@index` / índices parciais via SQL raw em migration Prisma (parciais exigem SQL).  
2. `prisma migrate` em staging.  
3. Validar com `EXPLAIN (ANALYZE, BUFFERS)` vs baseline.  
4. Só então produção em janela de baixo tráfego (`CREATE INDEX CONCURRENTLY` preferível).

Arquivo de preparação read-only: `scripts/perf-06-explain-prep.sql`.

---

## 6. Como validar antes/depois

1. Em **staging/local** (nunca produção neste passo):  
   - `EXPLAIN (FORMAT TEXT) …` dos cenários em `scripts/perf-06-explain-prep.sql`  
   - Com autorização: `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`  
2. Comparar: Seq Scan → Index Scan/Bitmap; buffers hit/read; tempo.  
3. Reexecutar `npm run perf:baseline:sales-finance` com `INDUSCOST_PERF_BASELINE=1`.  
4. Conferir totais/listagens inalterados (mesmos filtros).

---

## 7. Riscos

| Risco | Mitigação |
|-------|-----------|
| Escrita sync Nomus mais lenta | Preferir poucos parciais P1; medir write em staging |
| Predicado parcial ≠ query (NULL em Decimal) | Confirmar `balance > 0` trata NULL como falso (igual Prisma) |
| Enum/`status` NFe divergente | Validar valores reais (`4`, `MARKET_REVENUE`) antes de parcial billing |
| Índices redundantes acumulados | Após P1, reavaliar singles pouco usados com `pg_stat_user_indexes` |
| Sort `createdAt` sem estatísticas | `ANALYZE "SalesOrder"` após criar índice |

---

## 8. Confirmação

- **Nenhuma migration criada.**  
- **Nenhum índice aplicado no banco.**  
- **Nenhum código funcional alterado neste passo** (apenas documentação + script EXPLAIN prep).  
- **Nenhum commit, push ou deploy.**
