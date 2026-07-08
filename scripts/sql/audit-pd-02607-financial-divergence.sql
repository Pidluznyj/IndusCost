-- Auditoria PD 02607 — divergência financeira Pedido vs Contas a Receber
-- Rodar no PostgreSQL de produção (ajuste schema se necessário).

-- 1) Pedido PD 02607
SELECT
  so.id,
  so."orderCode",
  so."externalSalesOrderId",
  so."issueDate",
  so."totalGrossValue",
  so."totalNetValue",
  so."totalDiscount",
  so."paymentTerms",
  so."paymentMethod",
  c."companyName" AS customer
FROM "SalesOrder" so
LEFT JOIN "Customer" c ON c.id = so."customerId"
WHERE so."orderCode" ILIKE '%02607%'
   OR so."externalSalesOrderCode" ILIKE '%02607%';

-- 2) Itens do pedido
SELECT
  so."orderCode",
  soi."skuSnapshot",
  soi."productNameSnapshot",
  soi.quantity,
  soi."negotiatedPrice",
  soi."totalNetValue",
  soi."totalCost",
  soi."marginValue"
FROM "SalesOrderItem" soi
JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
WHERE so."orderCode" ILIKE '%02607%'
ORDER BY soi."skuSnapshot";

-- Soma itens
SELECT
  so."orderCode",
  SUM(soi."totalNetValue"::numeric) AS items_net_sum,
  SUM(soi."totalCost"::numeric) AS items_cost_sum
FROM "SalesOrderItem" soi
JOIN "SalesOrder" so ON so.id = soi."salesOrderId"
WHERE so."orderCode" ILIKE '%02607%'
GROUP BY so."orderCode";

-- 3) Parcelas no nomusRawResponse (JSON)
SELECT
  so."orderCode",
  so."nomusRawResponse" -> 'condicaoPagamento' -> 'valorTotalFinanceiro' AS valor_total_financeiro,
  so."nomusRawResponse" -> 'condicaoPagamentoParcelas' AS parcelas_root,
  so."nomusRawResponse" -> 'condicaoPagamento' -> 'condicaoPagamentoParcelas' AS parcelas_nested,
  so."nomusRawResponse" -> 'parcelas' AS parcelas_direct
FROM "SalesOrder" so
WHERE so."orderCode" ILIKE '%02607%';

-- 4) Títulos AR vinculados (descrição / NF)
SELECT
  ar."externalId",
  ar.description,
  ar."amountReceivable",
  ar."balanceReceivable",
  ar."amountReceived",
  ar."competenceDate",
  ar."dueDate",
  ar."sourceInvoiceId",
  ar."sourceInvoiceNumber",
  ar."personName",
  ar."companyName",
  ar."syncedAt"
FROM "NomusAccountsReceivable" ar
WHERE ar.description ILIKE '%PD 02607%'
   OR ar.description ILIKE '%02607%'
ORDER BY ar."dueDate", ar."externalId";

-- 5) NFes vinculadas ao pedido
SELECT
  so."orderCode",
  l."nfeExternalId",
  l."nfeNumber",
  l."nfeKey",
  n."valorLiquido" AS nfe_valor_liquido
FROM "SalesOrderNfeLink" l
JOIN "SalesOrder" so ON so.id = l."salesOrderId"
LEFT JOIN "NomusNfe" n ON n."externalId" = l."nfeExternalId"
WHERE so."orderCode" ILIKE '%02607%';

-- 6) AR por NF do pedido
SELECT
  ar."externalId",
  ar.description,
  ar."amountReceivable",
  ar."balanceReceivable",
  ar."dueDate",
  ar."sourceInvoiceId",
  ar."sourceInvoiceNumber"
FROM "NomusAccountsReceivable" ar
WHERE ar."sourceInvoiceId" IN (
  SELECT l."nfeExternalId"
  FROM "SalesOrderNfeLink" l
  JOIN "SalesOrder" so ON so.id = l."salesOrderId"
  WHERE so."orderCode" ILIKE '%02607%'
);

-- 7) Duplicidades (mesmo cliente / vencimento / valor)
SELECT
  ar."personName",
  ar."dueDate",
  ar."amountReceivable",
  COUNT(*) AS title_count,
  STRING_AGG(ar."externalId"::text, ', ' ORDER BY ar."externalId") AS external_ids,
  STRING_AGG(LEFT(ar.description, 80), ' | ') AS descriptions
FROM "NomusAccountsReceivable" ar
WHERE ar.description ILIKE '%02607%'
GROUP BY ar."personName", ar."dueDate", ar."amountReceivable"
HAVING COUNT(*) > 1;

-- 8) Comparação esperada (ajuste valores após inspecionar JSON de parcelas)
-- Esperado financeiro oficial: R$ 202.860,00 | Nomus CR observado: R$ 311.580,00
SELECT
  so."orderCode",
  so."totalNetValue"::numeric AS order_header_net,
  ar."amountReceivable"::numeric AS ar_nominal,
  ar."balanceReceivable"::numeric AS ar_open,
  ar."amountReceivable"::numeric - 202860 AS delta_vs_expected_financial,
  ROUND(
    ((ar."amountReceivable"::numeric - 202860) / NULLIF(202860, 0)) * 100,
    2
  ) AS pct_above_expected
FROM "SalesOrder" so
JOIN "SalesOrderNfeLink" l ON l."salesOrderId" = so.id
JOIN "NomusAccountsReceivable" ar ON ar."sourceInvoiceId" = l."nfeExternalId"
WHERE so."orderCode" ILIKE '%02607%';
