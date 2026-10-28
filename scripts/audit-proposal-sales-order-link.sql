-- Auditoria SOMENTE LEITURA do vinculo Proposta x Pedido de Venda (IndusCost / Nomus).
-- Documentacao, comandos por ambiente e leitura dos resultados: docs/sales/proposal-sales-order-link.md
--
-- Garantias:
--   * transacao READ ONLY (o PostgreSQL recusa qualquer escrita) encerrada com ROLLBACK;
--   * somente SELECT: so AccessShareLock; lock_timeout curto para nunca entrar na fila atras de uma migration;
--   * statement_timeout por consulta; compativel com PostgreSQL 12 e 17;
--   * nao depende das colunas/tabelas novas de rastreabilidade (roda antes da migration 20261102120000);
--   * saida sem nome de cliente e sem CPF/CNPJ completo (documento mascarado: 2 primeiros + 2 ultimos digitos);
--     payloads: so NOMES de chaves e tipos, nunca valores.
\set ON_ERROR_STOP on
\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '120s';
SET LOCAL lock_timeout = '3s';
SET LOCAL idle_in_transaction_session_timeout = '10min';

-- A0. Identificacao do alvo: conferir banco e versao ANTES de ler os resultados
--     (producao AWS = PostgreSQL 17 / teste_bi; homologacao = PostgreSQL 17 / teste_bi_homolog;
--      PostgreSQL 12 do servidor-01 e o banco LEGADO, nao e producao).
\echo '== A0. Alvo da auditoria'
SELECT current_database() AS banco, current_setting('server_version') AS versao,
       current_setting('transaction_read_only') AS somente_leitura, now() AS executado_em;

-- A1. Totais e % de pedidos vinculados, por origem e por mes de emissao (ultimos 18 meses).
\echo '== A1. Pedidos vinculados (total e por mes)'
SELECT coalesce(so."sourceSystem", 'INDUSCOST') AS origem,
       count(*) AS pedidos,
       count(so."proposalId") AS vinculados,
       round(100.0 * count(so."proposalId") / nullif(count(*), 0), 1) AS perc_vinculados
FROM "SalesOrder" so
GROUP BY 1 ORDER BY 1;

SELECT to_char(date_trunc('month', so."issueDate"), 'YYYY-MM') AS mes,
       count(*) AS pedidos_nomus,
       count(so."proposalId") AS vinculados,
       round(100.0 * count(so."proposalId") / nullif(count(*), 0), 1) AS perc_vinculados
FROM "SalesOrder" so
WHERE so."sourceSystem" = 'NOMUS' AND so."sourcePresenceStatus" = 'PRESENT'
GROUP BY 1 ORDER BY 1 DESC LIMIT 18;

-- Base comum: evidencia por produto LOCAL (cobre propostas do Nomus e criadas no IndusCost), mesmo cliente,
-- proposta emitida ate 1 dia depois do pedido (mesma regra de src/lib/sales/proposalSalesOrderLinkPolicy.ts).
\echo '== A2. Pedidos sem vinculo por motivo (regra oficial de inferencia)'
WITH o AS (
  SELECT so.id, so."orderCode", so."customerId", so."issueDate"
  FROM "SalesOrder" so
  WHERE so."sourceSystem" = 'NOMUS' AND so."sourcePresenceStatus" = 'PRESENT' AND so."proposalId" IS NULL
),
lines AS (
  SELECT o.id AS so_id, i.id AS item_id, i."productId"
  FROM o JOIN "SalesOrderItem" i ON i."salesOrderId" = o.id
  WHERE NOT i."nomusIsStale"
),
cand AS (
  SELECT DISTINCT l.so_id, l.item_id, pi."proposalId" AS pid
  FROM lines l
  JOIN o ON o.id = l.so_id
  JOIN "ProposalItem" pi ON pi."productId" = l."productId"
  JOIN "Proposal" p ON p.id = pi."proposalId" AND p."customerId" = o."customerId"
  WHERE p."commercialDate" IS NULL OR o."issueDate" IS NULL OR p."commercialDate" <= o."issueDate" + interval '1 day'
),
matched AS (SELECT so_id, count(DISTINCT item_id) AS n_lines FROM cand GROUP BY so_id),
inter AS (
  -- propostas presentes em TODAS as linhas que encontraram alguma proposta
  SELECT c.so_id, c.pid
  FROM cand c JOIN matched m ON m.so_id = c.so_id
  GROUP BY c.so_id, c.pid, m.n_lines
  HAVING count(DISTINCT c.item_id) = m.n_lines
),
per_order AS (
  SELECT o.id, o."issueDate",
    (SELECT count(*) FROM lines l WHERE l.so_id = o.id) AS linhas,
    coalesce((SELECT m.n_lines FROM matched m WHERE m.so_id = o.id), 0) AS linhas_com_candidato,
    (SELECT count(*) FROM inter x WHERE x.so_id = o.id) AS propostas_na_intersecao,
    (SELECT min(x.pid::text) FROM inter x WHERE x.so_id = o.id) AS proposta_unica,
    (SELECT count(*) FROM "Proposal" p WHERE p."customerId" = o."customerId") AS propostas_do_cliente
  FROM o
),
classified AS (
  SELECT po.*,
    CASE
      WHEN po.linhas = 0 THEN '0_pedido_sem_linhas'
      WHEN po.propostas_do_cliente = 0 THEN '1_cliente_sem_proposta_no_induscost'
      WHEN po.linhas_com_candidato = 0 THEN '2_produtos_em_nenhuma_proposta_do_cliente'
      WHEN po.propostas_na_intersecao = 0 THEN '3_linhas_apontam_para_propostas_diferentes'
      WHEN po.propostas_na_intersecao > 1 THEN '4_varias_propostas_cobrem_o_pedido'
      WHEN EXISTS (SELECT 1 FROM "SalesOrder" x WHERE x."proposalId"::text = po.proposta_unica)
        THEN '5_proposta_unica_ja_vinculada_a_outro_pedido'
      ELSE '6_inferencia_unica_disponivel'
    END AS motivo
  FROM per_order po
)
SELECT motivo, count(*) AS pedidos, min("issueDate")::date AS mais_antigo, max("issueDate")::date AS mais_recente
FROM classified GROUP BY motivo ORDER BY motivo;

-- A3. Vinculos potencialmente incorretos (vinculo existente que contraria a regra).
\echo '== A3. Vinculos potencialmente incorretos'
WITH linked AS (
  SELECT so.id, so."orderCode", so."customerId", so."issueDate", p.id AS pid, p."externalProposalCode",
         p."customerId" AS p_customer, p."commercialDate"
  FROM "SalesOrder" so JOIN "Proposal" p ON p.id = so."proposalId"
),
checks AS (
  SELECT l.*,
    (l.p_customer <> l."customerId") AS outro_cliente,
    (l."commercialDate" IS NOT NULL AND l."issueDate" IS NOT NULL
       AND l."commercialDate" > l."issueDate" + interval '1 day') AS proposta_posterior_ao_pedido,
    NOT EXISTS (
      SELECT 1 FROM "SalesOrderItem" i JOIN "ProposalItem" pi ON pi."productId" = i."productId" AND pi."proposalId" = l.pid
      WHERE i."salesOrderId" = l.id
    ) AS nenhum_produto_em_comum
  FROM linked l
)
SELECT count(*) AS vinculados,
       count(*) FILTER (WHERE outro_cliente) AS proposta_de_outro_cliente,
       count(*) FILTER (WHERE proposta_posterior_ao_pedido) AS proposta_posterior_ao_pedido,
       count(*) FILTER (WHERE nenhum_produto_em_comum) AS nenhum_produto_em_comum
FROM checks;

WITH linked AS (
  SELECT so.id, so."orderCode", so."customerId", so."issueDate", p.id AS pid, p."externalProposalCode",
         p."customerId" AS p_customer, p."commercialDate"
  FROM "SalesOrder" so JOIN "Proposal" p ON p.id = so."proposalId"
)
SELECT l."orderCode" AS pedido, l."externalProposalCode" AS proposta, l."issueDate"::date AS emissao_pedido,
       l."commercialDate"::date AS data_proposta,
       CASE WHEN l.p_customer <> l."customerId" THEN 'outro_cliente'
            WHEN l."commercialDate" > l."issueDate" + interval '1 day' THEN 'proposta_posterior'
            ELSE 'sem_produto_em_comum' END AS sinal
FROM linked l
WHERE l.p_customer <> l."customerId"
   OR (l."commercialDate" IS NOT NULL AND l."issueDate" IS NOT NULL AND l."commercialDate" > l."issueDate" + interval '1 day')
   OR NOT EXISTS (
     SELECT 1 FROM "SalesOrderItem" i JOIN "ProposalItem" pi ON pi."productId" = i."productId" AND pi."proposalId" = l.pid
     WHERE i."salesOrderId" = l.id)
ORDER BY l."issueDate" DESC NULLS LAST LIMIT 30;

-- A4. Vinculos desaparecidos: itens do pedido ainda apontam para item de proposta, mas o cabecalho perdeu o
--     proposalId (sintoma do sync antigo, que sobrescrevia o cabecalho com nulo).
\echo '== A4. Vinculos desaparecidos (item ligado a proposta, cabecalho sem proposta)'
WITH lost AS (
  SELECT so.id, so."orderCode", so."issueDate",
         count(DISTINCT pi."proposalId") AS propostas_nos_itens,
         min(pi."proposalId"::text) AS proposta_dos_itens
  FROM "SalesOrder" so
  JOIN "SalesOrderItem" i ON i."salesOrderId" = so.id AND i."proposalItemId" IS NOT NULL
  JOIN "ProposalItem" pi ON pi.id = i."proposalItemId"
  WHERE so."proposalId" IS NULL
  GROUP BY so.id, so."orderCode", so."issueDate"
)
SELECT count(*) AS pedidos,
       count(*) FILTER (WHERE propostas_nos_itens = 1) AS uma_proposta_nos_itens,
       count(*) FILTER (WHERE propostas_nos_itens = 1 AND EXISTS (
         SELECT 1 FROM "SalesOrder" x WHERE x."proposalId"::text = lost.proposta_dos_itens)) AS proposta_ocupada_por_outro_pedido
FROM lost;

WITH lost AS (
  SELECT so.id, so."orderCode", so."issueDate",
         count(DISTINCT pi."proposalId") AS propostas_nos_itens,
         min(pi."proposalId"::text) AS proposta_dos_itens
  FROM "SalesOrder" so
  JOIN "SalesOrderItem" i ON i."salesOrderId" = so.id AND i."proposalItemId" IS NOT NULL
  JOIN "ProposalItem" pi ON pi.id = i."proposalItemId"
  WHERE so."proposalId" IS NULL
  GROUP BY so.id, so."orderCode", so."issueDate"
)
SELECT l."orderCode" AS pedido, l."issueDate"::date AS emissao, l.propostas_nos_itens,
       (SELECT p."externalProposalCode" FROM "Proposal" p WHERE p.id::text = l.proposta_dos_itens) AS proposta_dos_itens
FROM lost l ORDER BY l."issueDate" DESC NULLS LAST LIMIT 30;

-- A5. Propostas com varios pedidos candidatos (mesmo cliente, produto em comum): cenario 1 proposta -> N pedidos.
\echo '== A5. Propostas com varios pedidos candidatos'
WITH pc AS (
  SELECT p.id AS pid, p."externalProposalCode", count(DISTINCT so.id) AS pedidos_candidatos,
         count(DISTINCT so.id) FILTER (WHERE so."proposalId" = p.id) AS vinculado
  FROM "Proposal" p
  JOIN "ProposalItem" pi ON pi."proposalId" = p.id
  JOIN "SalesOrderItem" i ON i."productId" = pi."productId" AND NOT i."nomusIsStale"
  JOIN "SalesOrder" so ON so.id = i."salesOrderId" AND so."customerId" = p."customerId"
  WHERE p."commercialDate" IS NULL OR so."issueDate" IS NULL OR p."commercialDate" <= so."issueDate" + interval '1 day'
  GROUP BY p.id, p."externalProposalCode"
)
SELECT count(*) FILTER (WHERE pedidos_candidatos > 1) AS propostas_com_varios_pedidos,
       max(pedidos_candidatos) AS maximo_pedidos_por_proposta
FROM pc;

WITH pc AS (
  SELECT p.id AS pid, p."externalProposalCode", count(DISTINCT so.id) AS pedidos_candidatos,
         count(DISTINCT so.id) FILTER (WHERE so."proposalId" = p.id) AS vinculado
  FROM "Proposal" p
  JOIN "ProposalItem" pi ON pi."proposalId" = p.id
  JOIN "SalesOrderItem" i ON i."productId" = pi."productId" AND NOT i."nomusIsStale"
  JOIN "SalesOrder" so ON so.id = i."salesOrderId" AND so."customerId" = p."customerId"
  WHERE p."commercialDate" IS NULL OR so."issueDate" IS NULL OR p."commercialDate" <= so."issueDate" + interval '1 day'
  GROUP BY p.id, p."externalProposalCode"
)
SELECT "externalProposalCode" AS proposta, pedidos_candidatos, vinculado > 0 AS tem_pedido_vinculado
FROM pc WHERE pedidos_candidatos > 1 ORDER BY pedidos_candidatos DESC LIMIT 20;

-- A6. Pedidos com varias propostas candidatas (mesmo cliente, produto em comum): cenario N propostas -> 1 pedido
--     ou cliente recorrente com o mesmo produto.
\echo '== A6. Pedidos com varias propostas candidatas'
WITH oc AS (
  SELECT so.id, so."orderCode", so."proposalId" IS NOT NULL AS vinculado, count(DISTINCT pi."proposalId") AS propostas_candidatas
  FROM "SalesOrder" so
  JOIN "SalesOrderItem" i ON i."salesOrderId" = so.id AND NOT i."nomusIsStale"
  JOIN "ProposalItem" pi ON pi."productId" = i."productId"
  JOIN "Proposal" p ON p.id = pi."proposalId" AND p."customerId" = so."customerId"
  WHERE p."commercialDate" IS NULL OR so."issueDate" IS NULL OR p."commercialDate" <= so."issueDate" + interval '1 day'
  GROUP BY so.id, so."orderCode", so."proposalId"
)
SELECT vinculado, count(*) FILTER (WHERE propostas_candidatas > 1) AS pedidos_com_varias_propostas,
       count(*) FILTER (WHERE propostas_candidatas = 1) AS pedidos_com_uma_proposta,
       max(propostas_candidatas) AS maximo
FROM oc GROUP BY vinculado ORDER BY vinculado;

-- A7. Propostas descartadas pelo sync, por motivo (ultimas execucoes registradas em IntegrationRun).
--     Antes desta versao: SKU inativo descartava a proposta inteira (ignored); cliente/produto nao resolvido bloqueava.
\echo '== A7. Propostas descartadas por motivo (ultimas 5 execucoes do sync de propostas)'
SELECT r."startedAt", r.mode, r.status,
       (r."summaryJson" -> 'summary' ->> 'totalRead')::int AS lidas,
       (r."summaryJson" -> 'summary' ->> 'blockedCount')::int AS bloqueadas,
       (r."summaryJson" -> 'summary' ->> 'ignoredInactiveSkuCount')::int AS descartadas_sku_inativo,
       (r."summaryJson" -> 'summary' ->> 'unresolvedCustomers')::int AS cliente_nao_resolvido,
       (r."summaryJson" -> 'summary' ->> 'unresolvedProducts')::int AS produto_nao_resolvido,
       CASE WHEN jsonb_typeof(r."summaryJson" -> 'summary' -> 'missingSkus') = 'array'
            THEN jsonb_array_length(r."summaryJson" -> 'summary' -> 'missingSkus') END AS skus_sem_cadastro
FROM "IntegrationRun" r
WHERE r.target = 'proposals' AND r.status <> 'SKIPPED'
ORDER BY r."startedAt" DESC NULLS LAST LIMIT 5;

SELECT reason AS motivo, count(*) AS propostas_no_preview
FROM (
  SELECT r."summaryJson" -> 'summary' -> 'blockedPreview' AS bp
  FROM "IntegrationRun" r
  WHERE r.target = 'proposals' AND r.status <> 'SKIPPED'
  ORDER BY r."startedAt" DESC NULLS LAST LIMIT 1
) last_run,
LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(last_run.bp) = 'array' THEN last_run.bp ELSE '[]'::jsonb END) b,
LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(b -> 'reasons') = 'array' THEN b -> 'reasons' ELSE '[]'::jsonb END) reason
GROUP BY reason ORDER BY 2 DESC;

-- A8. Clientes com documento equivalente (mesmos digitos, com ou sem mascara). Documento mascarado.
\echo '== A8. Clientes com CPF/CNPJ equivalente'
WITH d AS (
  SELECT c.id, regexp_replace(coalesce(c."taxId", ''), '[^0-9]', '', 'g') AS digits,
         c."nomusExternalPersonId"
  FROM "Customer" c
),
g AS (
  SELECT digits, count(*) AS clientes,
         count(DISTINCT "nomusExternalPersonId") AS ids_pessoa_nomus,
         sum((SELECT count(*) FROM "Proposal" p WHERE p."customerId" = d.id)) AS propostas,
         sum((SELECT count(*) FROM "SalesOrder" so WHERE so."customerId" = d.id)) AS pedidos
  FROM d WHERE length(digits) BETWEEN 11 AND 14
  GROUP BY digits HAVING count(*) > 1
)
SELECT count(*) AS grupos, coalesce(sum(clientes), 0) AS clientes_envolvidos,
       -- Grupo sem nenhum cliente com id de pessoa do Nomus: unico caso em que pedido NOVO ainda fica bloqueado
       -- (CUSTOMER_IDENTITY_CONFLICT) ate o cadastro ser saneado ou o id da pessoa ser gravado no cliente correto.
       count(*) FILTER (WHERE ids_pessoa_nomus = 0) AS grupos_que_podem_bloquear_pedido_novo,
       -- Grupo com mais de um id de pessoa do Nomus: o mesmo documento em pessoas diferentes no proprio Nomus.
       count(*) FILTER (WHERE ids_pessoa_nomus > 1) AS grupos_com_varias_pessoas_nomus
FROM g;

WITH d AS (
  SELECT c.id, regexp_replace(coalesce(c."taxId", ''), '[^0-9]', '', 'g') AS digits,
         c."nomusExternalPersonId"
  FROM "Customer" c
)
SELECT CASE length(digits) WHEN 11 THEN 'CPF' WHEN 14 THEN 'CNPJ' ELSE 'outro' END AS tipo,
       left(digits, 2) || repeat('*', length(digits) - 4) || right(digits, 2) AS documento_mascarado,
       count(*) AS clientes,
       count(DISTINCT "nomusExternalPersonId") AS ids_pessoa_nomus,
       sum((SELECT count(*) FROM "Proposal" p WHERE p."customerId" = d.id)) AS propostas,
       sum((SELECT count(*) FROM "SalesOrder" so WHERE so."customerId" = d.id)) AS pedidos
FROM d WHERE length(digits) BETWEEN 11 AND 14
GROUP BY digits HAVING count(*) > 1
ORDER BY count(*) DESC, 1 LIMIT 30;

-- A9. Referencia explicita nos payloads: chaves (e tipos) cujo NOME sugere proposta/pedido/origem.
--     Nenhum valor e exibido. Esta e a evidencia necessaria para habilitar NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS.
\echo '== A9. Chaves candidatas a referencia explicita nos payloads'
SELECT 'pedido' AS onde, k.key AS chave, jsonb_typeof(k.value) AS tipo, count(*) AS ocorrencias
FROM "SalesOrder" so, LATERAL jsonb_each(so."nomusRawResponse") k
WHERE so."sourceSystem" = 'NOMUS' AND jsonb_typeof(so."nomusRawResponse") = 'object'
  AND k.key ~* '(propost|orcament|cotac|origem|referenc|vincul|quotation|proposal)'
GROUP BY 1, 2, 3
UNION ALL
SELECT 'item do pedido', k.key, jsonb_typeof(k.value), count(*)
FROM "SalesOrder" so,
     LATERAL jsonb_array_elements(so."nomusRawResponse" -> 'itensPedido') it,
     LATERAL jsonb_each(it) k
WHERE so."sourceSystem" = 'NOMUS' AND jsonb_typeof(so."nomusRawResponse" -> 'itensPedido') = 'array'
  AND jsonb_typeof(it) = 'object' AND k.key ~* '(propost|orcament|cotac|origem|referenc|vincul|quotation|proposal)'
GROUP BY 1, 2, 3
UNION ALL
SELECT 'proposta', k.key, jsonb_typeof(k.value), count(*)
FROM "Proposal" p, LATERAL jsonb_each(p."externalRawPayload") k
WHERE p."sourceSystem" = 'NOMUS' AND jsonb_typeof(p."externalRawPayload") = 'object'
  AND k.key ~* '(pedido|origem|referenc|vincul|order)'
GROUP BY 1, 2, 3
UNION ALL
SELECT 'item da proposta', k.key, jsonb_typeof(k.value), count(*)
FROM "ProposalItem" pi, LATERAL jsonb_each(pi."externalRawPayload") k
WHERE jsonb_typeof(pi."externalRawPayload") = 'object'
  AND k.key ~* '(pedido|origem|referenc|vincul|order)'
GROUP BY 1, 2, 3
ORDER BY 1, 4 DESC;

-- A9b. Todas as chaves de primeiro nivel do pedido Nomus (nomes e frequencia), para conferir com o contrato lido.
SELECT k AS chave_pedido, count(*) AS ocorrencias
FROM "SalesOrder" so, LATERAL jsonb_object_keys(so."nomusRawResponse") k
WHERE so."sourceSystem" = 'NOMUS' AND jsonb_typeof(so."nomusRawResponse") = 'object'
GROUP BY k ORDER BY 2 DESC, 1;

ROLLBACK;
