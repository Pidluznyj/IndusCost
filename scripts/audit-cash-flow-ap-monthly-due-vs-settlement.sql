-- READ ONLY — não executar pelo Cursor/Claude. Para o responsável rodar na homologação.
-- Decompõe um mês da "Linha do tempo mensal" de Contas a Pagar por mês de VENCIMENTO (eixo
-- corporativo AP) versus mês de BAIXA, para explicar concentrações como junho/2026.
--
-- Substituir :year (ex.: 2026) e :month (ex.: 6).
-- A elegibilidade final (stale, grupo interno, agenda de pedido de compra, saldo saneado) é do
-- motor oficial; este SQL é diagnóstico bruto.

-- 1) Títulos com BAIXA no mês: onde está o vencimento de cada um?
SELECT
  date_trunc('month', ap."dueDate")::date        AS due_month,
  date_trunc('month', COALESCE(ap."paymentDate", ap."settlementDate"))::date AS settlement_month,
  ap.status,
  ap."sourcePresenceStatus",
  ap."suspendPayment",
  (UPPER(COALESCE(ap.description, '') || ' ' || COALESCE(ap.comments, '') || ' ' || COALESCE(ap.classification, ''))
     LIKE ANY (ARRAY['%BAIXA SEM NUMERARIO%', '%BAIXADA SEM NUMERARIO%'])) AS without_cash,
  (UPPER(COALESCE(ap.description, '') || ' ' || COALESCE(ap.comments, '') || ' ' || COALESCE(ap.classification, ''))
     LIKE ANY (ARRAY['%BAIXA FORCADA%', '%BAIXADA NA FORCA%', '%BAIXA MANUAL/FORCADA%', '%BAIXADA FORCADA%'])) AS forced,
  (UPPER(COALESCE(ap.description, '') || ' ' || COALESCE(ap.comments, '') || ' ' || COALESCE(ap.classification, ''))
     LIKE ANY (ARRAY['%CANCEL%', '%ERRO%'])) AS cancelled_marker,
  COUNT(*)                          AS titles,
  SUM(ap."amountPayable")           AS amount_payable,
  SUM(ap."amountPaid")              AS amount_paid,
  SUM(ap."balancePayable")          AS balance_payable
FROM "NomusAccountsPayable" ap
WHERE COALESCE(ap."paymentDate", ap."settlementDate") >= make_date(:year, :month, 1)
  AND COALESCE(ap."paymentDate", ap."settlementDate") <  (make_date(:year, :month, 1) + INTERVAL '1 month')
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
ORDER BY 1, 2;

-- 2) Títulos com VENCIMENTO no mês (eixo corporativo): status e quando foram baixados.
SELECT
  date_trunc('month', ap."dueDate")::date        AS due_month,
  date_trunc('month', COALESCE(ap."paymentDate", ap."settlementDate"))::date AS settlement_month,
  ap.status,
  ap."sourcePresenceStatus",
  COUNT(*)                          AS titles,
  SUM(ap."amountPayable")           AS amount_payable,
  SUM(ap."amountPaid")              AS amount_paid,
  SUM(ap."balancePayable")          AS balance_payable
FROM "NomusAccountsPayable" ap
WHERE ap."dueDate" >= make_date(:year, :month, 1)
  AND ap."dueDate" <  (make_date(:year, :month, 1) + INTERVAL '1 month')
GROUP BY 1, 2, 3, 4
ORDER BY 2 NULLS LAST;

-- 3) Baixas ATRASADAS que hoje caem no mês pela baixa mas pertencem a outro mês pelo vencimento.
SELECT
  ap."externalId",
  ap."personName",
  ap."dueDate",
  ap."paymentDate",
  ap."settlementDate",
  ap."amountPayable",
  ap."amountPaid",
  ap."balancePayable",
  ap.status,
  ap."sourcePresenceStatus",
  ap."syncedAt"
FROM "NomusAccountsPayable" ap
WHERE COALESCE(ap."paymentDate", ap."settlementDate") >= make_date(:year, :month, 1)
  AND COALESCE(ap."paymentDate", ap."settlementDate") <  (make_date(:year, :month, 1) + INTERVAL '1 month')
  AND date_trunc('month', ap."dueDate") <> date_trunc('month', COALESCE(ap."paymentDate", ap."settlementDate"))
ORDER BY ap."amountPaid" DESC NULLS LAST, ap."dueDate";
