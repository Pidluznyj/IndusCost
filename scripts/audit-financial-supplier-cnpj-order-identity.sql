-- READ ONLY — não executar pelo Cursor. Somente SELECT; nenhum UPDATE/INSERT/DELETE.
-- Auditoria: paridade de identidade do fornecedor (CNPJ canônico) × Pedidos Nomus.
--
-- Fontes oficiais (nenhum cadastro paralelo):
--   FinancialSupplier            cadastro mestre (document / normalizedDocument)
--   FinancialSupplierAlias       vínculo oficial fornecedor ↔ Nomus (externalSupplierId = idPessoa)
--   NomusAccountsPayable         títulos AP (personId / personCnpj) — evidência de documento
--   NomusPurchaseOrder           espelho de pedidos Nomus (supplierExternalId / supplierTaxId)
--
-- Regra espelhada do código (src/lib/financeSupplierRebuild.ts → planSupplierDocumentEnrichment):
--   SAFE_FILL   cadastro sem documento + exatamente UM documento válido (11/14 dígitos) na
--               evidência (AP ∪ Pedidos Nomus) de um externalSupplierId EXCLUSIVO do
--               fornecedor + nenhum outro cadastro dono do documento em QUALQUER status
--               (inclusive inativo/mesclado e documento guardado em alias).
--   NO_CHANGE   cadastro já tem o mesmo documento (ou não há evidência nova).
--   CONFLICT    evidência com documentos distintos, documento existente diferente, ou
--               documento já pertencente a outro fornecedor.
--   UNRESOLVED  sem evidência / documento inválido / sem vínculo oficial (nome NUNCA autoriza).
--
-- Substituir :supplier_id pelo UUID do fornecedor nas seções que o usam (E, G).

-- ============================================================================
-- A) Fornecedores SEM documento no cadastro mestre (candidatos a remediação)
-- ============================================================================
SELECT
  fs.id,
  fs."displayName",
  fs.source,
  fs.status,
  fs.document,
  fs."normalizedDocument",
  COUNT(DISTINCT a."externalSupplierId") FILTER (WHERE a."externalSupplierId" IS NOT NULL) AS alias_nomus_ids,
  fs."titlesCount"
FROM "FinancialSupplier" fs
LEFT JOIN "FinancialSupplierAlias" a ON a."supplierId" = fs.id
WHERE fs."normalizedDocument" IS NULL
  AND fs.status IN ('ACTIVE', 'NEEDS_REVIEW')
GROUP BY fs.id
ORDER BY fs."titlesCount" DESC, fs."displayName";

-- ============================================================================
-- B) Evidência de documento no AP por externalSupplierId (idPessoa):
--    documentos normalizados distintos por pessoa; >1 = CONFLITO no próprio AP.
--    (Reproduz a reconciliação ORDEM-INDEPENDENTE de reconcileSupplierGroupIdentity:
--     o primeiro título lido não decide o documento.)
-- ============================================================================
WITH ap_docs AS (
  SELECT
    ap."personId",
    NULLIF(regexp_replace(COALESCE(ap."personCnpj", ''), '[^0-9]', '', 'g'), '') AS doc_digits,
    ap."externalId"
  FROM "NomusAccountsPayable" ap
  WHERE ap."personId" IS NOT NULL
)
SELECT
  "personId",
  COUNT(*)                                                         AS titles,
  COUNT(*) FILTER (WHERE doc_digits IS NULL)                       AS titles_without_document,
  COUNT(DISTINCT doc_digits) FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') AS distinct_documents,
  STRING_AGG(DISTINCT doc_digits, '|') FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') AS document_candidates,
  CASE
    WHEN COUNT(DISTINCT doc_digits) FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') > 1 THEN 'CONFLICTING_DOCUMENTS'
    WHEN COUNT(DISTINCT doc_digits) FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') = 1 THEN 'SINGLE_DOCUMENT'
    ELSE 'NO_DOCUMENT'
  END AS ap_document_state
FROM ap_docs
GROUP BY "personId"
ORDER BY distinct_documents DESC, titles DESC;

-- ============================================================================
-- C) CNPJ duplicado entre fornecedores (qualquer status): CONFLITO — nunca merge automático.
--    Também desliga a chave "documento único" do resolvedor de Pedidos Nomus.
-- ============================================================================
SELECT
  fs."normalizedDocument",
  COUNT(*) AS suppliers,
  STRING_AGG(fs.id::text || ' · ' || fs."displayName" || ' · ' || fs.source || '/' || fs.status, ' || ' ORDER BY fs."displayName") AS owners
FROM "FinancialSupplier" fs
WHERE fs."normalizedDocument" IS NOT NULL
GROUP BY fs."normalizedDocument"
HAVING COUNT(*) > 1
ORDER BY suppliers DESC, fs."normalizedDocument";

-- ============================================================================
-- D) Evidência de documento no espelho de Pedidos Nomus por supplierExternalId:
--    supplierTaxId normalizado; >1 distinto = CONFLITO (fonte adicional do SAFE_FILL).
--    Documento zerado ("00000000000000") NÃO é candidato: normalizeSupplierDocument
--    o descarta, então nunca gera conflito no motor — os filtros espelham isso.
-- ============================================================================
WITH po_docs AS (
  SELECT
    po."supplierExternalId",
    NULLIF(regexp_replace(COALESCE(po."supplierTaxId", ''), '[^0-9]', '', 'g'), '') AS doc_digits
  FROM "NomusPurchaseOrder" po
  WHERE po."supplierExternalId" IS NOT NULL
)
SELECT
  "supplierExternalId",
  COUNT(*)                                                                                   AS orders,
  COUNT(DISTINCT doc_digits) FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$')  AS distinct_documents,
  STRING_AGG(DISTINCT doc_digits, '|') FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') AS document_candidates
FROM po_docs
GROUP BY "supplierExternalId"
HAVING COUNT(DISTINCT doc_digits) FILTER (WHERE doc_digits IS NOT NULL AND doc_digits !~ '^0+$') > 1
ORDER BY distinct_documents DESC, orders DESC;

-- ============================================================================
-- E) Pedidos Nomus atribuíveis a UM fornecedor pelas chaves seguras
--    (espelha resolveSupplierNomusOrdersIdentity):
--    chave 1 = alias exclusivo; chave 2 = documento único, excluindo ids aliasados a outro.
-- ============================================================================
WITH me AS (
  SELECT fs.id, fs."normalizedDocument"
  FROM "FinancialSupplier" fs
  WHERE fs.id = :supplier_id
),
own_alias AS (
  SELECT DISTINCT a."externalSupplierId"
  FROM "FinancialSupplierAlias" a
  WHERE a."supplierId" = :supplier_id AND a."externalSupplierId" IS NOT NULL
),
shared_alias AS (
  SELECT DISTINCT a."externalSupplierId"
  FROM "FinancialSupplierAlias" a
  WHERE a."supplierId" <> :supplier_id
    AND a."externalSupplierId" IN (SELECT "externalSupplierId" FROM own_alias)
),
safe_alias AS (
  SELECT "externalSupplierId" FROM own_alias
  EXCEPT
  SELECT "externalSupplierId" FROM shared_alias
),
doc_unique AS (
  SELECT me."normalizedDocument"
  FROM me
  WHERE me."normalizedDocument" IS NOT NULL
    AND (SELECT COUNT(*) FROM "FinancialSupplier" f2 WHERE f2."normalizedDocument" = me."normalizedDocument") = 1
),
aliased_elsewhere AS (
  SELECT DISTINCT a."externalSupplierId"
  FROM "FinancialSupplierAlias" a
  WHERE a."supplierId" <> :supplier_id AND a."externalSupplierId" IS NOT NULL
)
SELECT
  CASE
    WHEN po."supplierExternalId" IN (SELECT "externalSupplierId" FROM safe_alias) THEN 'KEY_1_ALIAS'
    ELSE 'KEY_2_DOCUMENT'
  END AS attribution_key,
  COUNT(*)                        AS orders,
  MIN(COALESCE(po."issuedAt", po."firstSeenAt")) AS first_order,
  MAX(COALESCE(po."issuedAt", po."firstSeenAt")) AS last_order,
  COUNT(ev.id)                    AS evaluated_orders
FROM "NomusPurchaseOrder" po
LEFT JOIN "NomusPurchaseOrderSupplierEvaluation" ev ON ev."nomusPurchaseOrderId" = po.id
WHERE po."supplierExternalId" IN (SELECT "externalSupplierId" FROM safe_alias)
   OR (
     regexp_replace(COALESCE(po."supplierTaxId", ''), '[^0-9]', '', 'g') IN (SELECT "normalizedDocument" FROM doc_unique)
     AND (po."supplierExternalId" IS NULL
          OR po."supplierExternalId" NOT IN (SELECT "externalSupplierId" FROM aliased_elsewhere))
   )
GROUP BY attribution_key
ORDER BY attribution_key;

-- ============================================================================
-- F) Alias Nomus (externalSupplierId) compartilhado por mais de um fornecedor:
--    ambiguidade — o resolvedor devolve UNRESOLVED e a aba Desempenho não atribui.
-- ============================================================================
SELECT
  a."externalSupplierId",
  COUNT(DISTINCT a."supplierId") AS suppliers,
  STRING_AGG(DISTINCT fs."displayName", ' || ') AS supplier_names
FROM "FinancialSupplierAlias" a
JOIN "FinancialSupplier" fs ON fs.id = a."supplierId"
WHERE a."externalSupplierId" IS NOT NULL
GROUP BY a."externalSupplierId"
HAVING COUNT(DISTINCT a."supplierId") > 1
ORDER BY suppliers DESC, a."externalSupplierId";

-- ============================================================================
-- G) Prévia de remediação por fornecedor (classificação SAFE_FILL / NO_CHANGE /
--    CONFLICT / UNRESOLVED). Espelha planSupplierDocumentEnrichment, inclusive
--    a posse de documento em QUALQUER status (cadastro inativo/mesclado e
--    documento guardado em alias contam) e a exclusividade do alias Nomus.
--    Somente leitura: a aplicação real é o rebuild-from-ap-apply (auditado como
--    DOCUMENT_ENRICH), nunca este script.
-- ============================================================================
WITH alias_ids AS (
  SELECT a."supplierId", a."externalSupplierId"
  FROM "FinancialSupplierAlias" a
  WHERE a."externalSupplierId" IS NOT NULL
  GROUP BY a."supplierId", a."externalSupplierId"
),
alias_owners AS (
  SELECT ai."externalSupplierId", COUNT(DISTINCT ai."supplierId") AS owners
  FROM alias_ids ai
  GROUP BY ai."externalSupplierId"
),
supplier_alias AS (
  SELECT ai."supplierId", ai."externalSupplierId", ao.owners
  FROM alias_ids ai
  JOIN alias_owners ao ON ao."externalSupplierId" = ai."externalSupplierId"
),
evidence AS (
  -- Evidência de documento dos ids Nomus do fornecedor (AP + espelho de pedidos),
  -- ignorando documentos zerados como normalizeSupplierDocument faz.
  SELECT sa."supplierId", d.doc_digits, d.origin
  FROM supplier_alias sa
  JOIN LATERAL (
    SELECT NULLIF(regexp_replace(COALESCE(ap."personCnpj", ''), '[^0-9]', '', 'g'), '') AS doc_digits, 'AP' AS origin
    FROM "NomusAccountsPayable" ap WHERE ap."personId" = sa."externalSupplierId"
    UNION ALL
    SELECT NULLIF(regexp_replace(COALESCE(po."supplierTaxId", ''), '[^0-9]', '', 'g'), ''), 'NOMUS_PO'
    FROM "NomusPurchaseOrder" po WHERE po."supplierExternalId" = sa."externalSupplierId"
  ) d ON TRUE
  WHERE d.doc_digits IS NOT NULL AND d.doc_digits !~ '^0+$'
),
per_supplier AS (
  SELECT
    fs.id,
    fs."displayName",
    fs.source,
    fs."normalizedDocument" AS current_document,
    COUNT(DISTINCT e.doc_digits)                 AS distinct_candidates,
    MIN(e.doc_digits)                            AS candidate,
    STRING_AGG(DISTINCT e.doc_digits, '|')       AS candidates,
    STRING_AGG(DISTINCT e.origin, '|')           AS evidence_origins,
    (SELECT COUNT(*) FROM supplier_alias sa WHERE sa."supplierId" = fs.id AND sa.owners = 1) AS exclusive_aliases,
    (SELECT COUNT(*) FROM supplier_alias sa WHERE sa."supplierId" = fs.id AND sa.owners > 1) AS ambiguous_aliases
  FROM "FinancialSupplier" fs
  LEFT JOIN evidence e ON e."supplierId" = fs.id
  WHERE fs.status IN ('ACTIVE', 'NEEDS_REVIEW')
  GROUP BY fs.id
)
SELECT
  ps.id,
  ps."displayName",
  ps.source,
  ps.current_document,
  ps.candidates,
  ps.evidence_origins,
  ps.exclusive_aliases,
  ps.ambiguous_aliases,
  CASE
    WHEN ps.distinct_candidates > 1 THEN 'CONFLICT'
    WHEN ps.distinct_candidates = 0 AND ps.current_document IS NOT NULL THEN 'NO_CHANGE'
    WHEN ps.distinct_candidates = 0 THEN 'UNRESOLVED'
    WHEN ps.current_document = ps.candidate THEN 'NO_CHANGE'
    WHEN ps.current_document IS NOT NULL THEN 'CONFLICT'
    WHEN length(ps.candidate) NOT IN (11, 14) THEN 'UNRESOLVED'
    -- Posse do documento em QUALQUER status, no cadastro OU em alias.
    WHEN EXISTS (
      SELECT 1 FROM "FinancialSupplier" o
      WHERE o."normalizedDocument" = ps.candidate AND o.id <> ps.id
    ) OR EXISTS (
      SELECT 1 FROM "FinancialSupplierAlias" oa
      WHERE oa."normalizedDocument" = ps.candidate AND oa."supplierId" <> ps.id
    ) THEN 'CONFLICT'
    -- Id Nomus reivindicado por dois cadastros: identidade ambígua.
    WHEN ps.ambiguous_aliases > 0 THEN 'CONFLICT'
    WHEN ps.exclusive_aliases = 0 THEN 'UNRESOLVED'
    ELSE 'SAFE_FILL'
  END AS remediation,
  ps.candidate AS proposed_document
FROM per_supplier ps
WHERE ps.current_document IS NULL OR ps.distinct_candidates <> 1 OR ps.current_document <> ps.candidate
ORDER BY remediation, ps."displayName";
