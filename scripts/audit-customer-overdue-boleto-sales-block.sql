-- READ ONLY — não executar pelo Cursor.
-- Auditoria da trava comercial de boleto vencido.
--
-- Autoridade de identidade financeira:
--   Customer."nomusExternalPersonId"  (Nomus idPessoa, gravado por scripts/nomusCustomersSyncV1.ts)
--     → NomusAccountsReceivable."personId"
-- SalesOrder."externalCustomerId" aparece SOMENTE como verificação de consistência.
-- Boleto: "paymentMethodId" = 10 (Boleto Bancário). O nome é só exibição.
--
-- Substituir :customer_id pelo UUID do cliente.

-- 1) Identidade primária do cliente
SELECT
  c.id AS customer_id,
  c."companyName",
  c."taxId",
  c.status AS cadastral_status,
  c."nomusExternalPersonId" AS primary_nomus_person_id
FROM "Customer" c
WHERE c.id = :customer_id;

-- 2) Evidência de consistência: IDs Nomus vistos nos pedidos do cliente.
--    Qualquer ID diferente de c."nomusExternalPersonId" = CONFLITO (fail closed).
SELECT
  so."externalCustomerId",
  COUNT(*) AS orders,
  MIN(so."issueDate") AS first_issue_date,
  MAX(so."issueDate") AS last_issue_date,
  BOOL_OR(so."externalCustomerId" IS DISTINCT FROM c."nomusExternalPersonId") AS diverges_from_customer
FROM "SalesOrder" so
JOIN "Customer" c ON c.id = so."customerId"
WHERE so."customerId" = :customer_id
  AND so."externalCustomerId" IS NOT NULL
GROUP BY so."externalCustomerId"
ORDER BY orders DESC;

-- 3) Resolução da identidade (espelha resolveCustomerFinancialIdentity)
SELECT
  c.id AS customer_id,
  c."nomusExternalPersonId",
  CASE
    WHEN c."nomusExternalPersonId" IS NULL THEN 'UNRESOLVED_IDENTITY'
    WHEN EXISTS (
      SELECT 1 FROM "SalesOrder" so
      WHERE so."customerId" = c.id
        AND so."externalCustomerId" IS NOT NULL
        AND so."externalCustomerId" <> c."nomusExternalPersonId"
    ) THEN 'UNRESOLVED_IDENTITY_CONFLICT'
    ELSE 'RESOLVED'
  END AS identity_resolution
FROM "Customer" c
WHERE c.id = :customer_id;

-- 4) Títulos de AR do personId primário (só faz sentido quando 3) = RESOLVED).
--    Lista bruta: a elegibilidade final é do motor oficial de AR
--    (filterOfficialArOverdueTitles), não deste SQL.
SELECT
  ar."externalId",
  ar."personId",
  ar."personName",
  ar."personCnpj",
  ar."dueDate",
  ar."paymentMethodId",
  ar."paymentMethodName",
  (ar."paymentMethodId" = 10) AS is_boleto_by_id,
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
JOIN "Customer" c ON c."nomusExternalPersonId" = ar."personId"
WHERE c.id = :customer_id
ORDER BY ar."dueDate" ASC NULLS LAST;

-- 5) Panorama global (diagnóstico, NÃO é a regra da aplicação):
--    clientes com boleto (ID 10) vencido e saldo bruto > 0.
SELECT
  c.id AS customer_id,
  c."companyName",
  c."nomusExternalPersonId",
  COUNT(ar."externalId") AS overdue_boletos_raw,
  SUM(ar."balanceReceivable") AS overdue_balance_raw,
  MIN(ar."dueDate") AS oldest_due_date
FROM "Customer" c
JOIN "NomusAccountsReceivable" ar ON ar."personId" = c."nomusExternalPersonId"
WHERE ar."paymentMethodId" = 10
  AND ar."dueDate" < CURRENT_DATE
  AND ar."balanceReceivable" > 0
GROUP BY c.id, c."companyName", c."nomusExternalPersonId"
ORDER BY overdue_balance_raw DESC;

-- 6) Catálogo de formas de pagamento no AR (diagnóstico do ID canônico)
SELECT
  ar."paymentMethodId",
  ar."paymentMethodName",
  COUNT(*) AS titles,
  COUNT(DISTINCT ar."personId") AS persons
FROM "NomusAccountsReceivable" ar
GROUP BY ar."paymentMethodId", ar."paymentMethodName"
ORDER BY titles DESC;
