-- READ ONLY — não executar pelo Cursor.
-- Auditoria de identidade Customer → SalesOrder.externalCustomerId → AR.personId
-- para a trava comercial de boleto vencido.
--
-- Substituir :customer_id pelo UUID do cliente.

SELECT
  c.id AS customer_id,
  c.company_name,
  c.tax_id,
  c.status AS cadastral_status,
  c.nomus_external_person_id
FROM "Customer" c
WHERE c.id = :customer_id;

SELECT
  so."orderCode",
  so."customerId",
  so."externalCustomerId",
  so.status
FROM "SalesOrder" so
WHERE so."customerId" = :customer_id
ORDER BY so."issueDate" DESC;

SELECT
  ar."externalId",
  ar."personId",
  ar."personName",
  ar."personCnpj",
  ar."dueDate",
  ar."paymentMethodId",
  ar."paymentMethodName",
  ar."amountReceivable",
  ar."amountReceived",
  ar."balanceReceivable",
  ar."sourceInvoiceId",
  ar."sourceInvoiceNumber",
  ar."sourcePresenceStatus",
  ar."syncedAt",
  ar."settlementDate",
  ar."suspendCollection"
FROM "NomusAccountsReceivable" ar
WHERE ar."personId" IN (
  SELECT DISTINCT so."externalCustomerId"
  FROM "SalesOrder" so
  WHERE so."customerId" = :customer_id
    AND so."externalCustomerId" IS NOT NULL
)
ORDER BY ar."dueDate" ASC NULLS LAST;
