-- READ ONLY — não executar pelo Cursor/Claude. Para o responsável rodar na homologação.
-- Semântica de caixa das baixas de Contas a Pagar: separa AP_SETTLED (título encerrado) de
-- AP_CASH_REALIZED (só amountPaid informado). Quantifica quanto do "realizado gerencial" não
-- tem evidência de caixa: baixa forçada (FORCED), baixa sem numerário (WITHOUT_CASH) e quitação
-- normal com amountPaid = 0.
--
-- Substituir :year (ex.: 2026).

WITH ap AS (
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
    ap."paymentMethodName",
    ap.description,
    ap.comments,
    ap.classification,
    UPPER(COALESCE(ap."paymentMethodName", '') || ' ' || COALESCE(ap.description, '') || ' ' ||
          COALESCE(ap.comments, '') || ' ' || COALESCE(ap.classification, '')) AS blob
  FROM "NomusAccountsPayable" ap
  WHERE ap."dueDate" >= make_date(:year, 1, 1)
    AND ap."dueDate" <  make_date(:year + 1, 1, 1)
),
classified AS (
  SELECT
    *,
    CASE
      WHEN blob LIKE ANY (ARRAY['%CANCEL%', '%ERRO%']) THEN 'CANCELLED'
      WHEN blob LIKE ANY (ARRAY['%BAIXA SEM NUMERARIO%', '%BAIXADA SEM NUMERARIO%']) THEN 'WITHOUT_CASH'
      WHEN blob LIKE ANY (ARRAY['%BAIXA FORCADA%', '%BAIXADA NA FORCA%', '%BAIXA MANUAL/FORCADA%', '%BAIXADA FORCADA%']) THEN 'FORCED'
      ELSE 'NORMAL'
    END AS settlement_kind,
    (COALESCE(ap."balancePayable", 0) <= 0) AS settled_by_balance,
    (COALESCE(ap."amountPaid", 0) > 0) AS has_amount_paid
  FROM ap
)

-- 1) Resumo por tipo de baixa: quanto está encerrado sem amountPaid informado
SELECT
  settlement_kind,
  settled_by_balance,
  has_amount_paid,
  COUNT(*)                                        AS titles,
  SUM(COALESCE("amountPayable", 0))               AS amount_payable,
  SUM(COALESCE("amountPaid", 0))                  AS amount_paid_evidence,
  SUM(CASE WHEN settled_by_balance AND NOT has_amount_paid THEN COALESCE("amountPayable", 0) ELSE 0 END)
                                                  AS inferred_as_realized_without_cash_evidence
FROM classified
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 2) Baixas FORCED: campos brutos para decidir a semântica de caixa
SELECT
  "externalId", "personName", "dueDate", "paymentDate", "settlementDate",
  "amountPayable", "amountPaid", "balancePayable", status, "sourcePresenceStatus",
  "paymentMethodName", description, comments, classification
FROM classified
WHERE settlement_kind = 'FORCED'
ORDER BY "amountPayable" DESC NULLS LAST;

-- 3) Quitações NORMAIS sem amountPaid (o motor gerencial infere amountPayable; o caixa não)
SELECT
  "externalId", "personName", "dueDate", "paymentDate", "settlementDate",
  "amountPayable", "amountPaid", "balancePayable", status, "sourcePresenceStatus", "paymentMethodName"
FROM classified
WHERE settlement_kind = 'NORMAL' AND settled_by_balance AND NOT has_amount_paid
ORDER BY "amountPayable" DESC NULLS LAST;

-- 4) WITHOUT_CASH com amountPaid > 0 (contradição a revisar)
SELECT
  "externalId", "personName", "dueDate", "settlementDate", "amountPayable", "amountPaid", "balancePayable", description
FROM classified
WHERE settlement_kind = 'WITHOUT_CASH' AND has_amount_paid
ORDER BY "amountPaid" DESC;
