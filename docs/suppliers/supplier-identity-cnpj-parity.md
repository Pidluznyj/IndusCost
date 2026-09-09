# Fornecedor — paridade de identidade: CNPJ canônico, Pedidos Nomus e Desempenho

Data: 2026-09-08. Branch: `fix/supplier-cnpj-orders-performance-parity`.

## 1. Problema

1. **CNPJ ausente no cadastro** mesmo com o CNPJ conhecido no Contas a Pagar
   (AP) e no espelho de Pedidos Nomus. Causa raiz em
   `groupAccountsPayableSuppliers` (`src/lib/financeSupplierIdentity.ts`): a
   identidade do grupo era a do **primeiro título lido**; se ele não trazia
   `personCnpj`, o fornecedor nascia/ficava sem documento, mesmo com títulos
   posteriores trazendo o CNPJ. O rebuild ainda **copiava o AP às cegas**
   (`document = extracted.originalDocument`), o que podia apagar ou sobrescrever
   um documento existente.
2. **Aba Desempenho** do fornecedor (`FinanceSupplierCadastroDrawer`) só mostrava
   `PurchaseOrder` interno (FK `supplierId`). Os Pedidos Nomus do fornecedor não
   apareciam, embora a identidade oficial (alias Nomus / CNPJ) já existisse.
3. **Resolvedor Nomus** (`resolvePurchaseOrderSupplier`) contava aliases por
   linha, não por fornecedor: como o rebuild grava um alias por grafia de nome
   do mesmo `externalSupplierId`, fornecedores legítimos viravam “ambíguos”
   (`UNRESOLVED`) e a avaliação não consolidava.

## 2. Fonte única do documento

`FinancialSupplier.document` / `normalizedDocument` é a **única** fonte do CNPJ
exibido (lista Documento, perfil `GET /api/finance/suppliers/:id`, campo CNPJ e
`cnpjInput` do drawer). A grade de fornecedores usa o documento do cadastro
mestre e só cai para o documento visto no AP quando o cadastro não tem.

## 3. Reconciliação da identidade do grupo AP (ordem independente)

`reconcileSupplierGroupIdentity(records)` consolida **todos** os títulos do
grupo, determinística para qualquer permutação da entrada:

| Campo | Regra |
|---|---|
| `externalSupplierId` | único valor não nulo; >1 distinto → `null` + `CONFLICTING_EXTERNAL_IDS` |
| documento | exatamente **um** documento normalizado distinto → adotado (grafia canônica: a mais curta, dígitos vencem máscara); >1 → `null` + `CONFLICTING_DOCUMENTS` + `documentCandidates` |
| nome | o mais longo observado (empate lexicográfico) |
| `source` / `warnings` / `confidence` | melhor origem, união, recalculada |

`FinanceSupplierApGroup` ganhou `documentCandidates: string[]` e
`documentConflict: boolean`. **Nunca se inventa documento.**

## 4. Preenchimento seguro (plano de remediação)

`planSupplierDocumentEnrichment({ existing, group, index, nomusDocumentsByExternalId })`
(`src/lib/financeSupplierRebuild.ts`) classifica cada grupo:

| Ação | Quando |
|---|---|
| `SAFE_FILL` | cadastro **sem** documento; exatamente **um** candidato válido (11/14 dígitos) na evidência AP ∪ Pedidos Nomus; grupo amarrado a **este** fornecedor por um `externalSupplierId` **exclusivo** dele; nenhum outro cadastro dono do documento **em qualquer status** |
| `NO_CHANGE` | cadastro já tem o mesmo documento, ou não há evidência nova |
| `CONFLICT` | candidatos distintos; documento existente diferente da evidência; documento já pertencente a outro fornecedor (**nunca merge**); `externalSupplierId` reivindicado por dois cadastros |
| `UNRESOLVED` | sem evidência, documento inválido, sem vínculo oficial (nome sozinho **nunca** autoriza), ou sem índice de matching (fail closed) |

**Posse é independente de status.** `buildSupplierMatchIndex` continua ignorando
`MERGED`/`INACTIVE` para *escolher* fornecedor, mas passou a expor dois mapas
apurados sobre **todos** os cadastros — `documentOwnerIds` (documento no cadastro
ou em alias) e `externalIdOwnerIds`. Um CNPJ guardado por um cadastro inativo
continua sendo dele: preencher o mesmo CNPJ em outro fornecedor criaria a
duplicidade que a regra proíbe e desligaria a chave por documento dos Pedidos
Nomus (que conta donos em qualquer status).

**Alias é aditivo.** `upsertFinancialSupplierAliases` roda uma vez por título do
grupo; um título sem CNPJ não pode mais apagar (`COALESCE`) o documento que
outro título já gravou no alias — esse documento é evidência de posse.

Evidência adicional: `loadNomusOrderSupplierDocuments` (uma consulta agregada
`groupBy(supplierExternalId, supplierTaxId)` no espelho Nomus — leitura pura).

Aplicação (`upsertFinancialSupplierFromGroup`):

- só escreve `document`/`normalizedDocument` em `SAFE_FILL`; **nunca** apaga nem
  sobrescreve um documento existente;
- fornecedor `MANUAL` continua `stats_only` (nome/status/origem intocados) mas
  recebe o preenchimento **aditivo** do documento em `SAFE_FILL`;
- cada preenchimento gera auditoria `DOCUMENT_ENRICH` em
  `FinancialCostCenterAuditLog` (antes/depois + evidência);
- criação com conflito de documentos nasce sem documento e `NEEDS_REVIEW`.

A prévia `GET /api/finance/suppliers/rebuild-from-ap-preview` devolve
`items[].documentEnrichment` e os contadores `documentSafeFills`,
`documentConflicts`, `documentUnresolved` (+ warning `DOCUMENT_CONFLICTS:n`). O
apply (`rebuild-from-ap-apply`, confirmação textual) é o **único** caminho de
remediação — não há backfill separado nem migration.

## 5. Pedidos Nomus na aba Desempenho

`GET /api/supplier-performance/suppliers/:supplierId/nomus-orders`
(guard = `finance.suppliers:view` **e** `operations.purchases:view`, feature
flag `SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED`). Implementação:
`src/lib/purchasing/supplierNomusOrders.server.ts`.

Chaves seguras (mesma ordem do resolvedor oficial):

1. `FinancialSupplierAlias.externalSupplierId` **exclusivo** do fornecedor;
   ids aliasados também a outro fornecedor são conflito e ficam de fora;
2. a **coluna** `FinancialSupplier.normalizedDocument` do próprio cadastro,
   quando **um só** cadastro a possui (a contagem só é comparável quando a
   própria linha entra nela; coluna vazia → chave desligada);
   pedidos com `supplierExternalId` aliasado a outro fornecedor são excluídos
   (o resolvedor prioriza o alias);
3. **nunca** por nome; `FALLBACK`/`UNRESOLVED` nunca atribuem.

População = `OR(chave 1, chave 2) ∧ periodWhere` reaproveitando o núcleo da
worklist (`buildNomusSupplierEvaluationWorklistFromWhere`): contagem, elegíveis,
avaliações e página — sem consulta por pedido, paginação no servidor. A página
é verificada por `resolveNomusOrderSuppliersBatch`; linha que não resolva para
este fornecedor com identidade segura é descartada (`identity.excludedOnPage`).

UI (`SupplierNomusOrdersSection.tsx`): seção “Pedidos Nomus” com selo
**Origem**, KPIs próprios da origem Nomus e avaliação inline na mesma régua da
worklist (PUT `/api/supplier-performance/nomus-orders/:id`). A seção interna
passa a se chamar “Pedidos IndusCost” com o mesmo selo. **Não existe nota
consolidada única**: as origens não têm chave entre si e não se somam.

Observação: o selo da lista (`loadSupplierEvaluationListSummaries`) já
mesclava avaliações internas e Nomus antes desta mudança; comportamento
preservado e documentado como existente.

## 6. Auditoria SQL (somente leitura)

`scripts/audit-financial-supplier-cnpj-order-identity.sql` — seções A–G:
fornecedores sem documento, evidência AP por pessoa, CNPJ duplicado, evidência
do espelho Nomus, pedidos atribuíveis por chave, alias compartilhado e prévia de
remediação (`SAFE_FILL | NO_CHANGE | CONFLICT | UNRESOLVED`). Não executa
escrita; não foi executado nesta entrega.

## 7. Testes

- `src/lib/financeSupplierIdentityReconcile.test.ts` — ordem independente, conflito determinístico.
- `src/lib/financeSupplierDocumentEnrichment.test.ts` — SAFE_FILL/NO_CHANGE/CONFLICT/UNRESOLVED, MANUAL aditivo, CNPJ duplicado, nome nunca, evidência Nomus, idempotência.
- `src/lib/purchasing/supplierNomusOrders.server.test.ts` — chaves, exclusões, período, paginação, nº fixo de consultas, verificação da página.
- `src/components/supply-chain/supplier-performance/SupplierNomusOrdersSection.test.tsx` — selo de origem, KPIs Nomus, avaliação inline, paridade das telas.
- `src/lib/nomus/nomusPurchaseOrder360.test.ts` — alias por fornecedor distinto.
- `src/lib/purchasing/supplierPerformanceAccess.test.ts` — nova rota nas guardas.

Scripts: `npm run test:finance:supplier-identity`, `npm run test:supplier-performance`.

## 8. Ajustes após a revisão adversarial (2026-09-09)

Uma revisão em quatro frentes com verificação adversarial confirmou 12 achados;
todos foram corrigidos nesta branch:

1. **Posse de documento em qualquer status** (alta) — o guarda usava o índice de
   matching, que ignora `MERGED`/`INACTIVE`, e deixava passar CNPJ duplicado.
2. **Exclusividade do `externalSupplierId`** — id reivindicado por dois cadastros
   agora é `CONFLICT` (`AMBIGUOUS_EXTERNAL_SUPPLIER_ID`), como no resolvedor.
3. **Alias aditivo** — título sem CNPJ não apaga mais o documento do alias.
4. **Importação de não classificados** — o índice de posse passou a vir de uma
   consulta real (documento próprio, documento de alias e id Nomus), não de uma
   linha só.
5. **Representante de alias determinístico** — o CNPJ exibido não depende mais da
   ordem em que o banco devolveu as linhas.
6. **Chave por documento** — exige a coluna `normalizedDocument` preenchida; antes,
   um cadastro com `document` e coluna vazia podia herdar a população de outro.
7. **Rascunho × revisão** — a seção Nomus resemeia o rascunho quando a avaliação
   gravada muda de revisão, eliminando o *lost update* silencioso.
8. **SQL de auditoria** — seção G confere posse em qualquer status e em alias, e
   as seções B/D descartam documento zerado (como `normalizeSupplierDocument`).
9. **Guarda de teste vazia** — a asserção de "sem consulta externa automática"
   passou a casar o símbolo real (`loadCnpj`).

Cada item tem teste de regressão nas suítes citadas na seção 7.
