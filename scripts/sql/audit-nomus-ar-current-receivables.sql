-- =============================================================================
-- Validação AR vigente vs obsoletos (Contas a Receber / NomusAccountsReceivable)
-- Rodar no PostgreSQL de produção — read-only
-- =============================================================================

-- 1) PD 02719 — listar títulos, vigente e obsoletos
WITH pd_titles AS (
  SELECT
    nar."externalId",
    nar."companyId",
    nar."companyName",
    nar."personId",
    nar."personName",
    nar.description,
    nar."amountReceivable",
    nar."balanceReceivable",
    nar."amountReceived",
    nar."dueDate",
    nar."createdAtNomus",
    nar."modifiedAtNomus",
    nar."syncedAt",
    nar."sourceInvoiceId",
    nar."sourceInvoiceNumber",
    nar."settlementDate",
  regexp_match(lower(nar.description), 'pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?') AS parcel_match
  FROM "NomusAccountsReceivable" nar
  WHERE nar.description ILIKE '%Pedido PD 02719%'
),
ranked AS (
  SELECT
    *,
    'PD ' || lpad((parcel_match)[1], 5, '0') AS order_code,
    ((parcel_match)[2])::int AS installment_number,
    COALESCE(((parcel_match)[3])::int, 0) AS total_installments,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE("companyId"::text, lower(COALESCE("companyName", ''))),
        COALESCE("personId"::text, lower(COALESCE("personName", ''))),
        'PD ' || lpad((parcel_match)[1], 5, '0'),
        ((parcel_match)[2])::int,
        COALESCE(((parcel_match)[3])::int, 0)
      ORDER BY
        COALESCE("modifiedAtNomus", '1970-01-01'::timestamptz) DESC,
        COALESCE("createdAtNomus", '1970-01-01'::timestamptz) DESC,
        "syncedAt" DESC,
        "externalId" DESC
    ) AS recency_rank
  FROM pd_titles
  WHERE parcel_match IS NOT NULL
    AND "sourceInvoiceId" IS NULL
    AND ("sourceInvoiceNumber" IS NULL OR btrim("sourceInvoiceNumber") = '')
)
SELECT
  "externalId",
  description,
  "amountReceivable",
  "balanceReceivable",
  "dueDate",
  "modifiedAtNomus",
  "createdAtNomus",
  CASE WHEN recency_rank = 1 THEN 'VIGENTE' ELSE 'OBSOLETO_CANDIDATO' END AS status_gerencial,
  CASE
    WHEN recency_rank > 1
      AND COALESCE("amountReceived", 0) > 0 THEN 'PROTEGIDO: amountReceived'
    WHEN recency_rank > 1 AND "settlementDate" IS NOT NULL THEN 'PROTEGIDO: settlementDate'
    WHEN recency_rank > 1 THEN 'OBSOLETO_SEGURO'
    ELSE 'VIGENTE'
  END AS classificacao
FROM ranked
ORDER BY "externalId";

-- Soma bruta vs vigente PD 02719
WITH pd_titles AS (
  SELECT *
  FROM "NomusAccountsReceivable" nar
  WHERE nar.description ILIKE '%Pedido PD 02719%'
    AND nar."sourceInvoiceId" IS NULL
    AND (nar."sourceInvoiceNumber" IS NULL OR btrim(nar."sourceInvoiceNumber") = '')
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      ORDER BY
        COALESCE("modifiedAtNomus", '1970-01-01'::timestamptz) DESC,
        COALESCE("createdAtNomus", '1970-01-01'::timestamptz) DESC,
        "syncedAt" DESC,
        "externalId" DESC
    ) AS recency_rank
  FROM pd_titles
)
SELECT
  SUM("balanceReceivable") AS soma_bruta,
  SUM(CASE WHEN recency_rank = 1 THEN "balanceReceivable" ELSE 0 END) AS soma_vigente,
  SUM(CASE WHEN recency_rank > 1 AND COALESCE("amountReceived", 0) = 0 AND "settlementDate" IS NULL THEN "balanceReceivable" ELSE 0 END) AS soma_obsoletos_seguros
FROM ranked;


-- 2) Todos os grupos AR duplicados por pedido/parcela
WITH parsed AS (
  SELECT
    nar.*,
    regexp_match(lower(nar.description), 'pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?') AS parcel_match
  FROM "NomusAccountsReceivable" nar
  WHERE nar.description ~* 'pedido\s+pd\s*[- ]?0*\d+'
    AND nar."sourceInvoiceId" IS NULL
    AND (nar."sourceInvoiceNumber" IS NULL OR btrim(nar."sourceInvoiceNumber") = '')
),
grouped AS (
  SELECT
    COALESCE("companyId"::text, lower(COALESCE("companyName", ''))) AS company_key,
    COALESCE("personId"::text, lower(COALESCE("personName", ''))) AS person_key,
    'PD ' || lpad((parcel_match)[1], 5, '0') AS order_code,
    ((parcel_match)[2])::int AS installment_number,
    COALESCE(((parcel_match)[3])::int, 0) AS total_installments,
    COUNT(*) AS title_count,
    array_agg("externalId" ORDER BY "externalId") AS external_ids,
    SUM("balanceReceivable") AS gross_balance
  FROM parsed
  WHERE parcel_match IS NOT NULL
  GROUP BY 1, 2, 3, 4, 5
  HAVING COUNT(*) > 1
)
SELECT * FROM grouped ORDER BY gross_balance DESC, order_code, installment_number;


-- 3) Conflitos AR protegidos (obsoleto candidato com recebimento/NF/baixa)
WITH parsed AS (
  SELECT
    nar.*,
    regexp_match(lower(nar.description), 'pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?') AS parcel_match
  FROM "NomusAccountsReceivable" nar
  WHERE nar.description ~* 'pedido\s+pd\s*[- ]?0*\d+'
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE("companyId"::text, lower(COALESCE("companyName", ''))),
        COALESCE("personId"::text, lower(COALESCE("personName", ''))),
        'PD ' || lpad((parcel_match)[1], 5, '0'),
        ((parcel_match)[2])::int,
        COALESCE(((parcel_match)[3])::int, 0)
      ORDER BY
        COALESCE("modifiedAtNomus", '1970-01-01'::timestamptz) DESC,
        COALESCE("createdAtNomus", '1970-01-01'::timestamptz) DESC,
        "syncedAt" DESC,
        "externalId" DESC
    ) AS recency_rank
  FROM parsed
  WHERE parcel_match IS NOT NULL
    AND "sourceInvoiceId" IS NULL
    AND ("sourceInvoiceNumber" IS NULL OR btrim("sourceInvoiceNumber") = '')
)
SELECT
  "externalId",
  description,
  "personName",
  "amountReceivable",
  "amountReceived",
  "settlementDate",
  "sourceInvoiceId",
  "sourceInvoiceNumber",
  CASE
    WHEN COALESCE("amountReceived", 0) > 0 THEN 'amountReceived'
    WHEN "settlementDate" IS NOT NULL THEN 'settlementDate'
    WHEN "sourceInvoiceId" IS NOT NULL THEN 'sourceInvoiceId'
    WHEN "sourceInvoiceNumber" IS NOT NULL AND btrim("sourceInvoiceNumber") <> '' THEN 'sourceInvoiceNumber'
  END AS protection_reason
FROM ranked
WHERE recency_rank > 1
  AND (
    COALESCE("amountReceived", 0) > 0
    OR "settlementDate" IS NOT NULL
    OR "sourceInvoiceId" IS NOT NULL
    OR ("sourceInvoiceNumber" IS NOT NULL AND btrim("sourceInvoiceNumber") <> '')
  )
ORDER BY "externalId";


-- 4) Impacto global: total AR bruto vs vigente (pedidos sem NF duplicados)
WITH parsed AS (
  SELECT
    nar.*,
    regexp_match(lower(nar.description), 'pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?') AS parcel_match
  FROM "NomusAccountsReceivable" nar
),
ranked AS (
  SELECT
    *,
    CASE
      WHEN parcel_match IS NOT NULL
        AND "sourceInvoiceId" IS NULL
        AND ("sourceInvoiceNumber" IS NULL OR btrim("sourceInvoiceNumber") = '')
      THEN ROW_NUMBER() OVER (
        PARTITION BY
          COALESCE("companyId"::text, lower(COALESCE("companyName", ''))),
          COALESCE("personId"::text, lower(COALESCE("personName", ''))),
          'PD ' || lpad((parcel_match)[1], 5, '0'),
          ((parcel_match)[2])::int,
          COALESCE(((parcel_match)[3])::int, 0)
        ORDER BY
          COALESCE("modifiedAtNomus", '1970-01-01'::timestamptz) DESC,
          COALESCE("createdAtNomus", '1970-01-01'::timestamptz) DESC,
          "syncedAt" DESC,
          "externalId" DESC
      )
      ELSE 1
    END AS recency_rank
  FROM parsed
),
flags AS (
  SELECT
    "balanceReceivable",
    CASE
      WHEN parcel_match IS NOT NULL
        AND "sourceInvoiceId" IS NULL
        AND ("sourceInvoiceNumber" IS NULL OR btrim("sourceInvoiceNumber") = '')
        AND recency_rank > 1
        AND COALESCE("amountReceived", 0) = 0
        AND "settlementDate" IS NULL
      THEN true
      ELSE false
    END AS is_safe_obsolete
  FROM ranked
)
SELECT
  SUM("balanceReceivable") AS total_ar_bruto,
  SUM(CASE WHEN NOT is_safe_obsolete THEN "balanceReceivable" ELSE 0 END) AS total_ar_vigente,
  SUM(CASE WHEN is_safe_obsolete THEN "balanceReceivable" ELSE 0 END) AS diferenca_obsoletos
FROM flags;


-- 5) Fluxo de Caixa setembro/2026 — PD 02719 (apenas vigente deve aparecer)
WITH pd_titles AS (
  SELECT
    nar.*,
    regexp_match(lower(nar.description), 'pedido\s+pd\s*[- ]?0*(\d+)\s*[-–—]\s*parcela\s*(\d+)(?:\s+de\s+(\d+))?') AS parcel_match
  FROM "NomusAccountsReceivable" nar
  WHERE nar.description ILIKE '%Pedido PD 02719%'
),
ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY
        COALESCE("companyId"::text, lower(COALESCE("companyName", ''))),
        COALESCE("personId"::text, lower(COALESCE("personName", ''))),
        'PD ' || lpad((parcel_match)[1], 5, '0'),
        ((parcel_match)[2])::int,
        COALESCE(((parcel_match)[3])::int, 0)
      ORDER BY
        COALESCE("modifiedAtNomus", '1970-01-01'::timestamptz) DESC,
        COALESCE("createdAtNomus", '1970-01-01'::timestamptz) DESC,
        "syncedAt" DESC,
        "externalId" DESC
    ) AS recency_rank
  FROM pd_titles
  WHERE parcel_match IS NOT NULL
    AND "sourceInvoiceId" IS NULL
)
SELECT
  "externalId",
  description,
  "dueDate",
  "balanceReceivable",
  CASE WHEN recency_rank = 1 THEN 'INCLUI_FLUXO' ELSE 'EXCLUIDO' END AS fluxo_caixa_set_2026
FROM ranked
WHERE "dueDate" >= '2026-09-01' AND "dueDate" < '2026-10-01'
ORDER BY "externalId";
