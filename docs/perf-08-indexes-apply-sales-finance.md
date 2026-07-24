# PERFORMANCE 08 — Aplicação de índices aprovados (Pedidos + Financeiro)

Implementa **somente** os índices **P1 recomendados** do [PERF 06](./perf-06-indexes-sales-finance.md).  
Sem alteração de regras de negócio, consultas, layout, colunas ou dados. Sem commit/push/deploy neste passo.

## 1. Confirmação pré-migration (por índice)

| Índice | Consulta beneficiada | Já existia? | Redundância | Volume | Impacto leitura | Impacto escrita |
|--------|----------------------|-------------|-------------|--------|-----------------|-----------------|
| `SalesOrder_createdAt_issueDate_idx` `(createdAt DESC, issueDate DESC)` | `GET /api/sales-orders` ORDER BY + paginação | Não (`createdAt` sem índice) | Não (não cobre UNIQUE) | Crescente (sync Nomus) | Alto no sort da lista | Baixo–médio (insert/update sync) |
| `SalesOrder_externalSellerId_idx` | Filtro vendedor + seller-options | Não | Não | Idem | Alto quando filtro ativo | Baixo (coluna estável) |
| `NomusAccountsReceivable_open_dueDate_idx` parcial `dueDate` WHERE `balanceReceivable > 0` | AR aberto / horizonte / CF / due-radar | Não (só `dueDate`/`syncedAt` full) | Não substitui full `dueDate`; parcial bem menor | Carteira sync | Alto em WHERE saldo aberto | Médio (updates de baixa/saldo) |
| `NomusAccountsPayable_open_dueDate_idx` parcial `dueDate` WHERE `balancePayable > 0` | AP aberto / CF / due-radar | Não | Idem AR | Idem | Alto | Médio |

### Não implementados neste passo (justificativa)

| Candidato PERF 06 | Motivo |
|-------------------|--------|
| AR/AP `(syncedAt, dueDate)` WHERE balance > 0 (P2) | Condicionado a EXPLAIN de cutoff caro; full `syncedAt` + parcial open já cobrem o caminho comum; evita 2 índices extras na escrita do sync |
| `SalesOrder (status, issueDate)` (opcional) | Overlap com singles existentes; sem EXPLAIN obrigando |
| `NomusNfe` parcial autorizada (opcional) | Predicado enum/status a validar; não P1 |
| P3 presença / NfeLink válido | Opcionais / predicado sensível |

## 2. Migration

Pasta: `prisma/migrations/20260804120000_perf08_sales_finance_read_indexes/`

- Somente `CREATE INDEX IF NOT EXISTS` (4 índices)
- Nomes alinhados ao PERF 06
- Sem `ALTER` / `UPDATE` / `DELETE` / `DROP INDEX` / constraints
- Sem `CREATE INDEX CONCURRENTLY` (Prisma roda migration em transação)

Schema Prisma (`SalesOrder`):

- `@@index([createdAt(sort: Desc), issueDate(sort: Desc)])`
- `@@index([externalSellerId])`

Parciais AR/AP ficam **só no SQL** (Prisma não declara `WHERE` em `@@index`), padrão já usado no projeto (ex.: índice parcial de cotação oficial).

## 3. Compatibilidade

| Item | Status |
|------|--------|
| `schema.prisma` | Índices btree SalesOrder adicionados |
| Histórico migrations | Nova pasta após `20260803120000_*` |
| Banco vazio / testes | Migration aditiva `IF NOT EXISTS` |
| Aplicação local (`migrate deploy`) | **PENDING** — `localhost:5432` indisponível (P1001) neste ambiente |
| Produção | **Não executar neste passo** |
| Rollback operacional | `DROP INDEX IF EXISTS` dos 4 nomes (ver §7) |

## 4. Testes e medição

```bash
npx tsx --test src/lib/financeSalesIndexPerf08.test.ts
npx prisma validate
# local, se DATABASE_URL disponível:
npx prisma migrate deploy
# depois: scripts/perf-06-explain-prep.sql + npm run perf:baseline:sales-finance
```

### Plano servidor (antes/depois)

1. Em staging: capturar `EXPLAIN (ANALYZE, BUFFERS)` dos cenários P1 em `scripts/perf-06-explain-prep.sql`.
2. Aplicar migration em janela de baixo tráfego.
3. `ANALYZE "SalesOrder"; ANALYZE "NomusAccountsReceivable"; ANALYZE "NomusAccountsPayable";`
4. Reexecutar EXPLAIN e `perf:baseline:sales-finance` com `INDUSCOST_PERF_BASELINE=1`.
5. Comparar: Seq Scan → Index/Bitmap Scan; `dbMs` / buffers; totais de UI inalterados.

## 5. Riscos

| Risco | Mitigação |
|-------|-----------|
| Lock em `CREATE INDEX` (não concurrent) | Janela curta; staging primeiro; produção: considerar CONCURRENTLY manual fora do Prisma se volume exigir |
| Sync Nomus um pouco mais lento | Só 4 índices; parciais menores que full em balance |
| Predicado parcial vs NULL Decimal | `balance > 0` trata NULL como falso — alinhado ao filtro Prisma |

## 6. Plano de aplicação segura

1. Staging → `npx prisma migrate deploy` → `ANALYZE` nas 3 tabelas → EXPLAIN + baseline.
2. Validar UI Pedidos/AR/AP (totais e ordem iguais).
3. Produção em janela de baixo tráfego (migration transacional; se lock for problema, aplicar os 4 `CREATE INDEX CONCURRENTLY` manualmente e marcar migration como aplicada com cuidado operacional — fora do fluxo padrão Prisma).
4. Não fazer deploy automático sem revisão.

## 7. Rollback operacional (somente índices)

```sql
DROP INDEX IF EXISTS "SalesOrder_createdAt_issueDate_idx";
DROP INDEX IF EXISTS "SalesOrder_externalSellerId_idx";
DROP INDEX IF EXISTS "NomusAccountsReceivable_open_dueDate_idx";
DROP INDEX IF EXISTS "NomusAccountsPayable_open_dueDate_idx";
```

Reverter também as duas linhas `@@index` em `SalesOrder` no `schema.prisma` se a migration for desfeita no histórico.

## 8. Confirmações

- **Sem alteração de dados** (só metadados de índice).
- **Sem alteração de consultas** para “forçar” índice.
- **Nenhum commit, push ou deploy** neste passo.
