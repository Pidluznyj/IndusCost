# OP-14.2 — Runbook: reparo de datas + empresa + probe do seletor incremental

Rotina segura para preencher datas e empresa de Ordens de Produção já armazenadas (~21k) a partir do `rawJson`, sem consultar a API Nomus, e validar o seletor RSQL `dataHoraEdicao` antes de confiar no incremental.

Pré-requisito: OP-14.1 (schema + mapper oficial).

## Campos atualizados pelo reparo

| Campo Nomus (`rawJson`) | Coluna IndusCost |
|-------------------------|------------------|
| `dataHoraCriacao` | `openedAt` |
| `dataHoraLiberacao` | `releasedAt` |
| `dataHoraInicialPlanejada` | `plannedAt` |
| `dataHoraEntrega` | `deliveryAt` |
| `dataHoraEdicao` | `nomusUpdatedAt` |
| `empresa` / `idEmpresa` (e aliases) | `companyName` / `externalCompanyId` |

**Não alterados pelo reparo:** `closedAt`, `rawJson`, `payloadHash`, vínculos, `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `syncedAt`.

Garantias: paginado, idempotente, preview sem escrita, apply auditável, retomável (`--checkpoint-file` / `--after-externalId`), lock compartilhado `date-repair`.

---

## 1. Backup necessário

Antes do `apply` em produção:

1. Snapshot lógico da tabela `NomusProductionOrder` (ou backup do Postgres gerenciado).
2. Confirmar volume aproximado: `SELECT count(*) FROM "NomusProductionOrder";`
3. Garantir que **não** há backfill/incremental de OP em execução (o reparo usa o lock compartilhado `date-repair`).

Sugestão de dump focado (ajuste schema/host):

```bash
pg_dump "$DATABASE_URL" -t '"NomusProductionOrder"' -F c -f nomus_production_order_pre_date_repair.dump
```

---

## 2. Preview (sem escrita)

```bash
npm run repair:nomus:production-orders:dates:preview -- --only-null-dates
# amostra limitada:
npm run repair:nomus:production-orders:dates:preview -- --only-null-dates --limit=100 --batch-size=50
```

Alias: `npm run sync:nomus:production-orders:repair-dates:preview`.

Conferir no JSON de saída:

- `counters.scanned` (total lido)
- `counters.wouldUpdate` (total que seria alterado)
- `counters.fieldsToFill.*` (`openedAt`, `releasedAt`, `plannedAt`, `deliveryAt`, `nomusUpdatedAt`, `externalCompanyId`, `companyName`)
- `counters.invalidDates` / `skippedInvalid`
- `counters.unchanged`
- `samples[]` (antes/depois + `closedAtPreserved`)
- nenhuma escrita (`updated` deve ser 0)

---

## 3. Validação dos totais

Antes do apply:

1. Comparar `wouldUpdate` com a expectativa de cobertura nula (ex.: OPs com `openedAt IS NULL` ou `companyName IS NULL`).
2. Amostrar 3–5 `externalId` do preview e conferir no `rawJson` os campos `dataHora*` e `empresa`.
3. Confirmar que amostras **não** propõem mudança de `closedAt`.

Consulta útil (cobertura atual):

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE "openedAt" IS NULL) AS opened_null,
  count(*) FILTER (WHERE "releasedAt" IS NULL) AS released_null,
  count(*) FILTER (WHERE "plannedAt" IS NULL) AS planned_null,
  count(*) FILTER (WHERE "deliveryAt" IS NULL) AS delivery_null,
  count(*) FILTER (WHERE "nomusUpdatedAt" IS NULL) AS edited_null,
  count(*) FILTER (WHERE "companyName" IS NULL) AS company_null,
  count(*) FILTER (WHERE "externalCompanyId" IS NULL) AS company_id_null
FROM "NomusProductionOrder";
```

---

## 4. Apply (com retomada)

```bash
npm run repair:nomus:production-orders:dates:apply -- \
  --only-null-dates \
  --batch-size=200 \
  --checkpoint-file=/var/tmp/op-date-repair.checkpoint.json
```

Retomada após interrupção: o mesmo comando relê o checkpoint (`lastProcessedExternalId`) ou use `--after-externalId=N`.

Um registro:

```bash
npm run repair:nomus:production-orders:dates:apply -- --externalId=30347
```

Resumo apply esperado: `scanned`, `updated`, `unchanged`, `invalid`/`skippedInvalid`, `errors`, `durationMs`, `exitCode` (0 se sem erros).

A rotina é **idempotente**: segunda execução não deve alterar as mesmas linhas.

---

## 5. SQL de cobertura após reparo

Repetir a consulta da seção 3. Esperado: queda forte em `*_null` para campos presentes no `rawJson`.

Sanidade pontual:

```sql
SELECT "externalId", "openedAt", "releasedAt", "plannedAt", "deliveryAt", "nomusUpdatedAt",
       "externalCompanyId", "companyName", "closedAt", "payloadHash"
FROM "NomusProductionOrder"
WHERE "externalId" = 30347;
```

`closedAt` e `payloadHash` devem permanecer iguais ao pré-reparo.

---

## 6. Probe do seletor incremental (`dataHoraEdicao`)

`dataHoraEdicao` existe no payload e alimenta `nomusUpdatedAt`, mas **não** se assume que o Nomus aceita o campo como seletor RSQL.

```bash
npm run sync:nomus:production-orders:probe-selector
```

Resultados: `ACCEPTED` | `REJECTED` | `INCONCLUSIVE`.
Persistir homologação via `NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION`.
Em rejeição ou sync incompleto: **não** avançar o estado incremental.

---

## 7. Pós-apply na UI

Após o apply (e deploy se necessário):

1. Grid: abertura (`openedAt`), planejada (`plannedAt`), entrega (`deliveryAt`), empresa (`companyName`).
2. Detalhe/API: mesmos campos normalizados — sem ler `rawJson` no frontend para datas.
3. Conferir OP 05800 - 003 e OP 05967 - 001 (quantidade `0,002925`).
