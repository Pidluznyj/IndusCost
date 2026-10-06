# HOMOLOGATION_RUNBOOK — Snapshot completo de custo de produção

**Ambiente:** somente **homologação** (nunca produção).  
**Escopo:** validar publicação unitária/bulk com snapshot PUBLISHED completo e contrato comercial.  
**Deploy produção:** **proibido** neste roteiro.  
**SQL:** somente `SELECT` (read-only). Não rodar `UPDATE`/`DELETE`/`INSERT` manuais de status.

Branch de referência: `feat/production-cost-complete-snapshot-materialize`

---

## 0. Pré-requisitos

### 0.1 Acesso

- Usuário com permissões:
  - `pricing.generate_tables` **ou** `settings.price_tables.manage` (gerar DRAFT unitário)
  - permissões de publish de tabela de custo (mesmo conjunto de `PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS`)
- Cookie/sessão autenticada na UI de homologação.

### 0.2 Escolher SKUs (antes de qualquer publish)

Escolha **dois** produtos ACTIVE distintos (PRODUCT ou COMPONENT vendável):

| Alias | Uso |
|---|---|
| **SKU_A** / `PRODUCT_ID_A` | cenário unitário (será alterado e publicado) |
| **SKU_B** / `PRODUCT_ID_B` | proteção: LIVE muda, **sem** DRAFT/publish |

Anote também:

- `BASE_URL` = URL da homologação (ex.: `https://homolog.exemplo`)
- `EFFECTIVE_DATE` = `yyyy-mm-dd` do mês civil vigente (ex.: `2026-10-01`)
- `CODE` esperado da versão = `yyyy-mm` derivado da data (ex.: `2026-10`)

### 0.3 Baseline (obrigatório — registrar antes)

Na UI **Formação de Preço Unitária** (ou API detail):

```http
GET /api/pricing/unitary-formation/products/{PRODUCT_ID_A}?referenceDate={EFFECTIVE_DATE}
GET /api/pricing/unitary-formation/products/{PRODUCT_ID_B}?referenceDate={EFFECTIVE_DATE}
```

Preencher a tabela:

| Campo | SKU_A | SKU_B |
|---|---|---|
| LIVE unitProductionCost | ___ | ___ |
| PUBLISHED versionId | ___ | ___ |
| PUBLISHED revision | ___ | ___ |
| PUBLISHED unitProductionCost | ___ | ___ |
| LIVE ≠ PUBLISHED? | s/n | s/n |

SQL baseline (read-only):

```sql
-- Última PUBLISHED por code (ajuste :code)
SELECT
  v.id,
  v.code,
  v.revision,
  v.status,
  v."effectiveDate",
  v."supersedesVersionId",
  v."publishedAt",
  v."publishedBy",
  v."createdBy",
  (SELECT COUNT(*) FROM "ProductionCostTableItem" i WHERE i."costTableVersionId" = v.id) AS "itemsCount"
FROM "ProductionCostTableVersion" v
WHERE v.code = :code          -- ex. '2026-10'
  AND v.status = 'PUBLISHED'
ORDER BY v.revision DESC
LIMIT 5;
```

Anote `OLD_PUBLISHED_ID` e `OLD_REVISION` e `OLD_ITEMS_COUNT`.

---

## CENÁRIO A — Unitário (SKU_A)

### A.1 Mudar LIVE de A

Na engenharia/BOM/MP (fluxo normal de cadastro), altere algo que **mude o custo LIVE** de SKU_A  
(ex.: quantidade BOM, custo MP usada, etc.).

Reconfirme:

```http
GET /api/pricing/unitary-formation/products/{PRODUCT_ID_A}?referenceDate={EFFECTIVE_DATE}
```

**Esperado:** LIVE ≠ PUBLISHED antigo para A.  
Registrar `LIVE_A_NEW`.

### A.2 Gerar DRAFT A (candidato parcial — 1 item)

**UI:** Formação Unitária → produto A → gerar DRAFT de custo.

**API:**

```http
POST /api/pricing/unitary-formation/products/{PRODUCT_ID_A}/production-cost/draft
Content-Type: application/json

{ "effectiveDate": "YYYY-MM-DD" }
```

**Esperado (201):**

- `draftVersionId` = `CANDIDATE_DRAFT_ID` (anotar)
- versão `status: DRAFT`
- **1 item** (somente A)
- custo ≈ `LIVE_A_NEW`
- **não** altera nenhuma versão `PUBLISHED`

SQL:

```sql
SELECT v.id, v.code, v.revision, v.status,
       (SELECT COUNT(*) FROM "ProductionCostTableItem" i WHERE i."costTableVersionId" = v.id) AS items
FROM "ProductionCostTableVersion" v
WHERE v.id = :candidate_draft_id;

SELECT i."productCodeSnapshot", i."unitProductionCost"
FROM "ProductionCostTableItem" i
WHERE i."costTableVersionId" = :candidate_draft_id;
```

**Esperado SQL:** 1 linha de item; SKU = A.

### A.3 Publicar A

**UI:** publicar DRAFT unitário de A.

**API:**

```http
POST /api/pricing/unitary-formation/products/{PRODUCT_ID_A}/production-cost/publish
Content-Type: application/json

{ "draftVersionId": "{CANDIDATE_DRAFT_ID}" }
```

**Esperado (200):**

- `versionId` = `NEW_PUBLISHED_ID` (**≠** `CANDIDATE_DRAFT_ID`)
- `status: PUBLISHED`
- `alreadyPublished: false` (primeira vez)
- `snapshot.totalItems` ≈ população ACTIVE (PRODUCT+COMPONENT) — **não** 1
- `snapshot.changedCount = 1`
- `snapshot.carriedForwardCount = totalItems - 1` (aprox.)
- `snapshot.candidateDraftVersionId` = candidato
- custo de A no response = novo

### A.4 Validar nova PUBLISHED completa

```sql
SELECT
  v.id,
  v.code,
  v.revision,
  v.status,
  v."supersedesVersionId",
  v."publishedAt",
  v."publishedBy",
  (SELECT COUNT(*) FROM "ProductionCostTableItem" i WHERE i."costTableVersionId" = v.id) AS "itemsCount",
  v.notes
FROM "ProductionCostTableVersion" v
WHERE v.id = :new_published_id;
```

**Esperado:**

| Campo | Valor |
|---|---|
| status | `PUBLISHED` |
| revision | `OLD_REVISION + 1` (ou maior que OLD) |
| supersedesVersionId | `OLD_PUBLISHED_ID` |
| itemsCount | ≈ população ACTIVE (**>> 1**) |
| notes | contém `COMPLETE_SNAPSHOT_MATERIALIZATION` e `"completeness":"COMPLETE_MODERN"` |
| notes meta | `"changedCount":1` |

```sql
-- Exatamente uma PUBLISHED no code
SELECT status, COUNT(*) 
FROM "ProductionCostTableVersion"
WHERE code = :code
GROUP BY status;

-- OLD deve estar SUPERSEDED
SELECT id, status FROM "ProductionCostTableVersion" WHERE id = :old_published_id;
-- esperado: SUPERSEDED
```

**Candidato parcial NÃO vira PUBLISHED:**

```sql
SELECT id, status FROM "ProductionCostTableVersion" WHERE id = :candidate_draft_id;
-- esperado: DRAFT ou ARCHIVED (nunca PUBLISHED)
```

**PASS A:** nova PUBLISHED completa; A com custo novo; exatamente 1 PUBLISHED no `code`.

---

## CENÁRIO B — Proteção de outro LIVE (SKU_B)

> Executar **antes** do publish de A (passo A.3), ou em rodada separada com a mesma lógica.

### B.1 Antes de publicar A

1. Altere LIVE de SKU_B (mesmo tipo de mudança de engenharia).
2. **NÃO** gerar DRAFT B.  
3. **NÃO** publicar B.

Registrar `LIVE_B_NEW` e `PUBLISHED_B_OLD` (custo B na PUBLISHED vigente **antes** do publish de A).

### B.2 Após publicar A (A.3)

```sql
SELECT i."productCodeSnapshot", i."unitProductionCost"::numeric AS cost
FROM "ProductionCostTableItem" i
JOIN "Product" p ON p.id = i."productId"
WHERE i."costTableVersionId" = :new_published_id
  AND p.sku = :sku_b;   -- SKU_B
```

**Esperado:**

- custo B na nova PUBLISHED = `PUBLISHED_B_OLD` (**não** `LIVE_B_NEW`)
- LIVE B continua divergente do PUBLISHED (ok — ainda não foi aprovado)

**PASS B:** LIVE B alterado não vazou no snapshot ao publicar A.

---

## CENÁRIO C — Banco (comparação anterior × novo)

### C.1 Cabeçalho das versões

```sql
WITH params AS (
  SELECT
    :old_published_id::uuid AS old_id,
    :new_published_id::uuid AS new_id
)
SELECT
  v.id AS version,
  v.revision,
  v.status,
  v."supersedesVersionId" AS supersedes,
  (SELECT COUNT(*) FROM "ProductionCostTableItem" i WHERE i."costTableVersionId" = v.id) AS "itemsCount",
  -- counts do marcador JSON embutido em notes (pode ser null em legado)
  (v.notes::text ~ 'COMPLETE_SNAPSHOT_MATERIALIZATION') AS has_complete_marker,
  substring(v.notes from '"changedCount"[[:space:]]*:[[:space:]]*([0-9]+)') AS changed_count_notes,
  substring(v.notes from '"carriedForwardCount"[[:space:]]*:[[:space:]]*([0-9]+)') AS carry_forward_count_notes
FROM "ProductionCostTableVersion" v, params p
WHERE v.id IN (p.old_id, p.new_id)
ORDER BY v.revision;
```

**Esperado (nova):**

- `has_complete_marker = true`
- `changed_count_notes = 1`
- `carry_forward_count_notes = itemsCount - 1` (aprox.)
- `supersedes = old_id`

### C.2 Diff SKU a SKU (classificação)

```sql
WITH
old_v AS (
  SELECT i."productId", p.sku, i."unitProductionCost"::numeric AS cost
  FROM "ProductionCostTableItem" i
  JOIN "Product" p ON p.id = i."productId"
  WHERE i."costTableVersionId" = :old_published_id
),
new_v AS (
  SELECT i."productId", p.sku, i."unitProductionCost"::numeric AS cost
  FROM "ProductionCostTableItem" i
  JOIN "Product" p ON p.id = i."productId"
  WHERE i."costTableVersionId" = :new_published_id
),
joined AS (
  SELECT
    COALESCE(o.sku, n.sku) AS sku,
    COALESCE(o."productId", n."productId") AS "productId",
    o.cost AS old_cost,
    n.cost AS new_cost,
    CASE
      WHEN o."productId" IS NULL AND n."productId" IS NOT NULL THEN 'NEW'
      WHEN o."productId" IS NOT NULL AND n."productId" IS NULL THEN 'MISSING'
      WHEN ABS(o.cost - n.cost) > 0.000001 THEN 'CHANGED'
      ELSE 'UNCHANGED'
    END AS class
  FROM old_v o
  FULL OUTER JOIN new_v n ON n."productId" = o."productId"
)
SELECT class, COUNT(*) AS qty
FROM joined
GROUP BY class
ORDER BY class;

-- Detalhe: quem mudou
SELECT sku, old_cost, new_cost, class
FROM (
  SELECT
    COALESCE(o.sku, n.sku) AS sku,
    o.cost AS old_cost,
    n.cost AS new_cost,
    CASE
      WHEN o."productId" IS NULL THEN 'NEW'
      WHEN n."productId" IS NULL THEN 'MISSING'
      WHEN ABS(o.cost - n.cost) > 0.000001 THEN 'CHANGED'
      ELSE 'UNCHANGED'
    END AS class
  FROM (
    SELECT i."productId", p.sku, i."unitProductionCost"::numeric AS cost
    FROM "ProductionCostTableItem" i
    JOIN "Product" p ON p.id = i."productId"
    WHERE i."costTableVersionId" = :old_published_id
  ) o
  FULL OUTER JOIN (
    SELECT i."productId", p.sku, i."unitProductionCost"::numeric AS cost
    FROM "ProductionCostTableItem" i
    JOIN "Product" p ON p.id = i."productId"
    WHERE i."costTableVersionId" = :new_published_id
  ) n ON n."productId" = o."productId"
) d
WHERE class <> 'UNCHANGED'
ORDER BY class, sku;
```

**Esperado:**

| class | qty |
|---|---|
| CHANGED | **1** (somente SKU_A) |
| UNCHANGED | `itemsCount - 1` (aprox.) |
| NEW | 0 (salvo produto novo só no patch — não é o caso A) |
| MISSING | 0 |

**PASS C:** somente A = CHANGED.

---

## CENÁRIO D — Comercial

### D.1 Gerar / preview tabela comercial a partir do custo publicado

**UI:** Formação de Preço → preview-draft / generate-draft da price table desejada  
(usar a data que resolve a **nova** ProductionCost PUBLISHED).

APIs típicas:

```http
POST /api/price-tables/{priceTableId}/versions/preview-draft
POST /api/price-tables/{priceTableId}/versions/generate-draft
```

(parâmetros de margem/frete conforme tela — não alterar fórmulas neste roteiro)

### D.2 Validar população

```sql
-- Versão de preço gerada (ajuste filtro)
SELECT
  pv.id,
  pv."versionNumber",
  pv.status,
  pv."productionCostTableVersionId",
  (SELECT COUNT(*) FROM "PriceTableItem" pi WHERE pi."priceTableVersionId" = pv.id) AS price_items
FROM "PriceTableVersion" pv
WHERE pv."priceTableId" = :price_table_id
ORDER BY pv."versionNumber" DESC
LIMIT 3;
```

**Esperado:**

- `productionCostTableVersionId` = `NEW_PUBLISHED_ID`
- `price_items` ≈ população comercial normal (**não** 1)
- **Não** observar padrão legado: “1 custo encontrado / centenas SEM_CUSTO”

Consulta auxiliar de grid (UI/API):

```http
GET /api/pricing/commercial-published-prices?...
```

### D.3 Preço de A vs demais

```sql
SELECT
  pi.sku,
  pi."frozenTotalCost"::numeric AS frozen_cost,
  pi."salePrice"::numeric AS sale_price
FROM "PriceTableItem" pi
WHERE pi."priceTableVersionId" = :new_price_version_id
  AND pi.sku IN (:sku_a, :sku_b)
ORDER BY pi.sku;
```

Comparar com versão de preço **anterior** (mesma tabela, versionNumber − 1), se existir:

```sql
SELECT
  a.sku,
  old_i."frozenTotalCost"::numeric AS old_frozen,
  new_i."frozenTotalCost"::numeric AS new_frozen,
  old_i."salePrice"::numeric AS old_price,
  new_i."salePrice"::numeric AS new_price
FROM (VALUES (:sku_a), (:sku_b)) AS a(sku)
LEFT JOIN "PriceTableItem" old_i
  ON old_i."priceTableVersionId" = :old_price_version_id AND old_i.sku = a.sku
LEFT JOIN "PriceTableItem" new_i
  ON new_i."priceTableVersionId" = :new_price_version_id AND new_i.sku = a.sku;
```

**Esperado:**

| SKU | frozen / preço |
|---|---|
| A | **mudou** alinhado ao novo custo publicado |
| B (e demais amostrados) | **mesma base de custo** (frozen ≈ anterior; não puxou LIVE B) |

**PASS D:** população normal; só A reflete o novo custo.

---

## CENÁRIO E — Bulk (conjunto pequeno)

Escolher **N** produtos com DRAFT elegível (ex.: 2–5 SKUs), **sem** incluir B “sujo” do cenário B se quiser isolamento.

### E.1 Preview

```http
POST /api/products/production-cost/bulk-publish/preview
Content-Type: application/json

{ "productIds": ["id1", "id2", "..."] }
```

Anotar `draftVersionIdsByProduct` e elegíveis.

### E.2 Validate (chunks) — sem PUBLISHED

Para cada chunk (ex. até 25 ids):

```http
POST /api/products/production-cost/bulk-publish
Content-Type: application/json

{
  "confirm": true,
  "phase": "validate",
  "productIds": ["...chunk..."],
  "draftVersionIdsByProduct": { "...": "..." },
  "batchRunId": "{BATCH_RUN_ID}",
  "chunkIndex": 0,
  "chunkTotal": 1
}
```

**Esperado:** linhas `VALIDATED` / conflitos explícitos; **`completePublishedVersionId: null`**; nenhuma nova PUBLISHED.

### E.3 Finalize — um snapshot completo

```http
POST /api/products/production-cost/bulk-publish
Content-Type: application/json

{
  "confirm": true,
  "phase": "finalize",
  "productIds": ["id1", "id2", "..."],
  "draftVersionIdsByProduct": { "...": "..." },
  "batchRunId": "{BATCH_RUN_ID}"
}
```

**Esperado:**

- `completePublishedVersionId` preenchido
- `snapshot.changedCount = N` (aprovados no lote)
- `snapshot.carriedForwardCount = totalItems - N`
- `snapshot.totalItems` ≈ população ACTIVE
- uma única nova PUBLISHED no `code`

Reutilizar SELECT do cenário C com `old` = PUBLISHED anterior ao finalize e `new` = `completePublishedVersionId`.

**Esperado no diff:** exatamente os N SKUs do lote = CHANGED; restante UNCHANGED.

**PASS E:** N alterados; restante carry-forward; sem multi-PUBLISHED.

---

## Checklist final de homologação

| # | Critério | PASS? |
|---|---|---|
| A | Publish unitário gera PUBLISHED **completa** (não 1 item) | ☐ |
| A | Candidato parcial ≠ PUBLISHED | ☐ |
| A | OLD → SUPERSEDED; 1 PUBLISHED no code | ☐ |
| B | LIVE B alterado **não** entrou no snapshot | ☐ |
| C | Diff: somente A = CHANGED | ☐ |
| C | notes com `COMPLETE_MODERN` + changedCount=1 | ☐ |
| D | Tabela comercial com população normal | ☐ |
| D | Sem padrão 1 custo / centenas SEM_CUSTO | ☐ |
| D | Preço A mudou; outros mantêm base | ☐ |
| E | Bulk: N changed + carry-forward | ☐ |
| — | Nenhum UPDATE/DELETE manual em produção/homolog além da UI/API | ☐ |
| — | Nenhum deploy produção | ☐ |

---

## Evidências a anexar

1. Print/JSON do detail A/B antes e depois.  
2. Response do publish unitário (com `snapshot`).  
3. Resultado dos SELECTs C.1 e C.2.  
4. Preview/generate da price table + contagem de itens.  
5. Response bulk validate + finalize.

---

## Fora de escopo / não fazer

- Não alterar fórmulas de Formação de Preço, comissão, propostas, SalesOrder, Nomus, estoque, tesouraria, RH, projetos.
- Não forçar `UPDATE "ProductionCostTableVersion" SET status = 'PUBLISHED'`.
- Não publicar em produção.
- Não rodar backfill em massa nesta homologação (usar N pequeno no bulk).

---

## Contato de falha (BLOCK)

Se após publish unitário `itemsCount = 1` **ou** comercial mostrar centenas SEM_CUSTO: **bloquear homologação** e reabrir investigação da materialização (origem do snapshot), sem “patch” no resolver comercial.
