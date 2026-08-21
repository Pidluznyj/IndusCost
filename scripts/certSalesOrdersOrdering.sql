-- ===========================================================================
-- CERTIFICAÇÃO — Pedidos de Venda: ambiguidade na escolha da versão vigente
--
-- A feature substituiu 4 consultas "ORDER BY ... LIMIT 1" por dia (uma por
-- faixa comercial) por UMA leitura das versões + escolha em memória. A escolha
-- em memória replica o ORDER BY do banco, incluindo NULLS FIRST no DESC.
--
-- Esta consulta responde à única pergunta que um teste com banco falso não
-- fecha: NOS DADOS REAIS, existe alguma data do período em que MAIS DE UMA
-- versão é candidata? Se não existir, a ordenação é irrelevante e a
-- equivalência é incondicional. Se existir, as linhas mostram exatamente onde.
--
-- SOMENTE LEITURA: transação READ ONLY + ROLLBACK.
-- ===========================================================================

\set ON_ERROR_STOP on
\timing off

BEGIN TRANSACTION READ ONLY;

\echo ''
\echo '=== [1] Tabelas comerciais ATIVAS (esperado: 4 faixas) ==='
SELECT code, id, status
FROM "PriceTable"
WHERE code IN ('ATACADO', 'VAREJO_1', 'VAREJO_2', 'VAREJO_3')
  AND status = 'ACTIVE'
ORDER BY code;

\echo ''
\echo '=== [2] População de datas distintas de emissao no ano avaliado ==='
SELECT
  count(*)                        AS pedidos,
  count(DISTINCT "issueDate")     AS datas_distintas,
  min("issueDate")                AS primeira,
  max("issueDate")                AS ultima
FROM "SalesOrder"
WHERE "issueDate" >= :'inicio'::timestamptz
  AND "issueDate" <  :'fim'::timestamptz;

\echo ''
\echo '=== [3] AMBIGUIDADE: datas com MAIS DE UMA versao candidata por faixa ==='
\echo '    (candidatas = status PUBLISHED/ARCHIVED e janela cobrindo a data)'
\echo '    zero linhas com max_candidatas > 1  =>  ordenacao irrelevante'
WITH tiers AS (
  SELECT id, code
  FROM "PriceTable"
  WHERE code IN ('ATACADO', 'VAREJO_1', 'VAREJO_2', 'VAREJO_3')
    AND status = 'ACTIVE'
),
datas AS (
  SELECT DISTINCT "issueDate" AS d
  FROM "SalesOrder"
  WHERE "issueDate" >= :'inicio'::timestamptz
    AND "issueDate" <  :'fim'::timestamptz
),
candidatas AS (
  SELECT
    t.code,
    d.d,
    count(v.id) AS n
  FROM tiers t
  CROSS JOIN datas d
  LEFT JOIN "PriceTableVersion" v
    ON v."priceTableId" = t.id
   AND v.status IN ('PUBLISHED', 'ARCHIVED')
   AND (v."effectiveFrom" IS NULL OR v."effectiveFrom" <= d.d)
   AND (v."effectiveTo"   IS NULL OR v."effectiveTo"   >  d.d)
  GROUP BY t.code, d.d
)
SELECT
  code,
  count(*)                                AS datas_avaliadas,
  count(*) FILTER (WHERE n = 0)           AS datas_sem_versao,
  count(*) FILTER (WHERE n > 1)           AS datas_ambiguas,
  max(n)                                  AS max_candidatas
FROM candidatas
GROUP BY code
ORDER BY code;

\echo ''
\echo '=== [4] Detalhe das datas ambiguas (vazio = nenhuma) ==='
WITH tiers AS (
  SELECT id, code
  FROM "PriceTable"
  WHERE code IN ('ATACADO', 'VAREJO_1', 'VAREJO_2', 'VAREJO_3')
    AND status = 'ACTIVE'
),
datas AS (
  SELECT DISTINCT "issueDate" AS d
  FROM "SalesOrder"
  WHERE "issueDate" >= :'inicio'::timestamptz
    AND "issueDate" <  :'fim'::timestamptz
),
candidatas AS (
  SELECT t.code, d.d, v.id, v.status, v."effectiveFrom", v."effectiveTo",
         v."publishedAt", v."versionNumber"
  FROM tiers t
  CROSS JOIN datas d
  JOIN "PriceTableVersion" v
    ON v."priceTableId" = t.id
   AND v.status IN ('PUBLISHED', 'ARCHIVED')
   AND (v."effectiveFrom" IS NULL OR v."effectiveFrom" <= d.d)
   AND (v."effectiveTo"   IS NULL OR v."effectiveTo"   >  d.d)
),
ambiguas AS (
  SELECT code, d FROM candidatas GROUP BY code, d HAVING count(*) > 1
)
SELECT c.code, c.d AS data_emissao, c.id AS versao, c.status,
       c."effectiveFrom", c."effectiveTo", c."publishedAt", c."versionNumber"
FROM candidatas c
JOIN ambiguas a ON a.code = c.code AND a.d = c.d
ORDER BY c.code, c.d,
         c.status DESC, c."effectiveFrom" DESC, c."publishedAt" DESC, c."versionNumber" DESC
LIMIT 100;

\echo ''
\echo '=== [5] Versoes com effectiveFrom NULL (onde NULLS FIRST poderia pesar) ==='
SELECT t.code, v.id, v.status, v."effectiveFrom", v."effectiveTo", v."versionNumber"
FROM "PriceTableVersion" v
JOIN "PriceTable" t ON t.id = v."priceTableId"
WHERE t.code IN ('ATACADO', 'VAREJO_1', 'VAREJO_2', 'VAREJO_3')
  AND v.status IN ('PUBLISHED', 'ARCHIVED')
  AND v."effectiveFrom" IS NULL
ORDER BY t.code, v."versionNumber";

\echo ''
\echo '=== [6] Confirmacao de unicidade (versionNumber por tabela) ==='
SELECT "priceTableId", "versionNumber", count(*) AS repeticoes
FROM "PriceTableVersion"
GROUP BY "priceTableId", "versionNumber"
HAVING count(*) > 1
LIMIT 10;

ROLLBACK;

\echo ''
\echo '=== FIM (ROLLBACK executado — nenhuma escrita) ==='
