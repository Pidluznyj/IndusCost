# OP-14.2 — Runbook: reparo de datas + probe do seletor incremental

Rotina segura para preencher datas de Ordens de Produção já armazenadas (~21k) a partir do `rawJson`, sem consultar a API Nomus, e validar o seletor RSQL `dataHoraEdicao` antes de confiar no incremental.

Pré-requisito: OP-14.1 (schema + mapper oficial).

Mapeamento:

| Campo Nomus (`rawJson`) | Coluna IndusCost |
|-------------------------|------------------|
| `dataHoraCriacao` | `openedAt` |
| `dataHoraLiberacao` | `releasedAt` |
| `dataHoraInicialPlanejada` | `plannedAt` |
| `dataHoraEntrega` | `deliveryAt` |
| `dataHoraEdicao` | `nomusUpdatedAt` |

**Não alterados pelo reparo:** `closedAt`, `rawJson`, `payloadHash`, vínculos, `firstSeenAt`, `lastSeenAt`, `lastChangedAt`, `syncedAt`.

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
- `counters.fieldsToFill.*` (`openedAt`, `releasedAt`, `plannedAt`, `deliveryAt`, `nomusUpdatedAt`)
- `counters.invalidDates` / `skippedInvalid`
- `counters.unchanged`
- `samples[]` (antes/depois + `closedAtPreserved`)
- nenhuma escrita (`updated` deve ser 0)

---

## 3. Validação dos totais

Antes do apply:

1. Comparar `wouldUpdate` com a expectativa de cobertura nula (ex.: OPs com `openedAt IS NULL`).
2. Amostrar 3–5 `externalId` do preview e conferir no `rawJson` os campos `dataHora*`.
3. Confirmar que amostras **não** propõem mudança de `closedAt`.

Consulta útil (cobertura atual):

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE "openedAt" IS NULL) AS opened_null,
  count(*) FILTER (WHERE "releasedAt" IS NULL) AS released_null,
  count(*) FILTER (WHERE "plannedAt" IS NULL) AS planned_null,
  count(*) FILTER (WHERE "deliveryAt" IS NULL) AS delivery_null,
  count(*) FILTER (WHERE "nomusUpdatedAt" IS NULL) AS edited_null
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
SELECT "externalId", "openedAt", "releasedAt", "plannedAt", "deliveryAt", "nomusUpdatedAt", "closedAt", "payloadHash"
FROM "NomusProductionOrder"
WHERE "externalId" = 30347;
```

`closedAt` e `payloadHash` devem permanecer iguais ao pré-reparo.

---

## 6. Probe do seletor incremental (`dataHoraEdicao`)

Campo no payload **não** implica aceite na query RSQL. Probe read-only (1 página, sem gravação, sem avançar estado):

```bash
npm run sync:nomus:production-orders:probe-selector
# ou
npm run probe:nomus:production-orders:selector -- --selector=dataHoraEdicao
npm run probe:nomus:production-orders:selector -- --selector=dataHoraCriacao
```

Classificação:

| Status | Significado | Ação |
|--------|-------------|------|
| `ACCEPTED` | HTTP 200 na query com o seletor | Pode setar homologação `accepted` e usar `date_filter` |
| `REJECTED` | 400/422 (campo/filtro inválido) | Setar `rejected`; incremental usa fallback limitado auditado |
| `INCONCLUSIVE` | 429, 5xx, auth, timeout | Não declarar sucesso; repetir probe; não avançar homologação |

Após ACCEPTED:

```bash
export NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION=dataHoraEdicao:accepted
```

Após REJECTED:

```bash
export NOMUS_PRODUCTION_ORDERS_INCREMENTAL_SELECTOR_HOMOLOGATION=dataHoraEdicao:rejected
```

---

## 7. Validação do hook automático (pós Pedidos de Venda)

1. Rodar um apply de Pedidos de Venda em ambiente controlado **ou** inspecionar logs do orquestrador.
2. Confirmar soft-fail: falha do incremental de OP **não** derruba o sync de pedidos.
3. Confirmar que o hook chama **incremental apply** (nunca backfill) com overlap 72h.
4. Se o seletor estiver `REJECTED`, o resumo deve registrar fallback / rejeição — não sucesso silencioso de `date_filter`.

---

## 8. Rollback

1. Parar novos applies de reparo.
2. Restaurar dump da seção 1 **ou** reverter colunas de data a partir do backup (não há “undo” automático no código).
3. `rawJson` permanece intacto no reparo bem-sucedido — o pior caso típico é reexecutar o reparo após restaurar colunas, não um backfill completo.

---

## 9. Riscos residuais

- **Seletor RSQL não homologado:** incremental pode cair em `limited_page_window` (cobertura parcial); monitorar resumos.
- **Datas inválidas no `rawJson`:** contam como inválidas; campos ficam null — não inventa valores.
- **`closedAt` legado:** reparo não corrige encerramento; se estiver errado, exige rotina separada.
- **Concorrência:** lock compartilhado evita corrida com backfill/incremental, mas preview/apply longos ainda competem pelo lock.
- **Overlap 72h:** registros editados fora da janela + falha de seletor podem atrasar a convergência até o próximo ciclo/fallback.

---

## Comandos rápidos

```bash
npm run repair:nomus:production-orders:dates:preview -- --only-null-dates
npm run repair:nomus:production-orders:dates:apply -- --only-null-dates --checkpoint-file=/tmp/op-dates.ckpt.json
npm run sync:nomus:production-orders:probe-selector
npm run sync:nomus:production-orders:incremental:preview
```
