# TRIB-08 — Release candidate: aba Tributos do Pedido

**Escopo:** revisão integral TRIB-01 → TRIB-07, fixtures equivalentes ao PD 02781,
correção residual de contrato e evidências de release.

**Não afirma validação do PD 02781 em produção.** O Cursor não tem acesso ao banco
do servidor; a auditoria read-only no servidor permanece obrigatória.

---

## 1. Causa raiz do empty state (TRIB-01 → TRIB-05)

Sintoma observado:

> Tributos documentais indisponíveis para este pedido.

Causa técnica comprovada no código (não dependia de NF/XML do PD 02781):

1. Frontend liberava a aba (SUPER_ADMIN bypass ou `effectivePermissions` com
   `detail.view` / `invoice.view`).
2. Backend montava o detalhe com bag crua `permissions` (sem role /
   `effectivePermissions`).
3. Gate fiscal negava quando a bag tocava `sales_orders.*` sem
   `sales_orders.detail.view` nem `sales_orders.invoice.view`.
4. API devolvia `fiscalTaxes: null`.
5. UI mapeava `null` para empty genérico em vez de denied / unavailable.

Correções: alinhar autoridade da sessão no BE (TRIB-05), contrato
`available | unavailable | partial | error` + `fiscalTaxesAccess`, e estados
explícitos no FE (TRIB-06) sem alterar o layout do modal.

---

## 2. Fluxo corrigido (Pedido → Tributos)

```text
Pedido (detalhe)
  → gate canViewSalesOrderFiscalTaxesFromAuth(role + effectivePermissions)
  → loadSalesOrderRelatedNfes (fontes oficiais, read-only)
       1. SalesOrderNfeLink
       2. Documento de Saída (idNfe / O2C stockDocumentIdNfe)
       3. OrderToCashAuditFact.nfeExternalId
       4. Referência oficial por item
  → dedupe por nfeExternalId + conflitos / canceladas
  → NomusNfeFiscalSummary + NomusNfeTaxLine (documental)
  → consolidação HEADER (sem inventar rate×base; sem “impostos pagos”)
  → attachSalesOrderFiscalTaxesContract
       • unavailable = sem NF válida (HTTP 200)
       • partial = NF válida com lacunas (valores disponíveis seguem)
       • available = composição utilizável
       • error = falha técnica real
  → SalesOrderTributosTab (loading | denied | error | empty | unavailable | partial | available)
```

Garantias:

- NF cancelada: auditoria sim, totais não.
- Zero documental ≠ ausente (`0` permanece `0`; `null` = não informado).
- Sem chamadas HTTP ao Nomus no caminho de leitura / auditoria.
- Sem alteração das regras fiscais oficiais (parser / classificação).

### Correção residual TRIB-08

`attachSalesOrderFiscalTaxesContract` usava `payload.nfes.map(n => n.source)`
para detectar `partial`. `payload.nfes` inclui NF ativa inelegível a totais
(`isValidForTotals === false`) com `source: MISSING`, o que forçava `partial`
mesmo com NF válidas completas. Agora só fontes de NF com
`isValidForTotals` entram na resolução de status.

---

## 3. Checklist de validação (código)

| Item | Resultado |
|------|-----------|
| Resolução de NF por fontes oficiais | PASS (resolver + fixtures) |
| Deduplicação | PASS |
| Exclusão operacional de NF cancelada | PASS |
| Consolidação tributária documental | PASS |
| Diferenciação zero × ausente | PASS |
| Contrato da API | PASS (+ fix `isValidForTotals`) |
| Permissão da aba | PASS |
| Estados do frontend | PASS |
| Layout preservado / viewports 1366×768 e 1920×1080 | PASS (shell de teste) |
| Script read-only | PASS (scan estático) |
| Ausência de chamadas Nomus HTTP | PASS (scan) |
| Ausência de alteração nas regras fiscais oficiais | PASS (revisão de escopo) |

---

## 4. Fixtures equivalentes ao PD 02781

Arquivo: `src/lib/sales-orders/salesOrderTributosPd02781Fixtures.ts`

Cenários sintéticos (não são dados de produção):

| Id | Caso |
|----|------|
| `directLink` | Vínculo direto `SalesOrderNfeLink` |
| `stockDocumentOnly` | Somente Documento de Saída |
| `o2cOnly` | Somente Order-to-Cash |
| `validNfWithTaxes` | NF válida com tributos |
| `partialNf` | NF sem summary fiscal |
| `cancelledNf` | NF cancelada |
| `orderWithoutNf` | Pedido sem NF |

Teste: `src/lib/sales-orders/salesOrderTributosReleaseCandidate.test.tsx`

---

## 5. Commits TRIB (referência)

| TRIB | Hash (prefixo) | Tema |
|------|----------------|------|
| 01 | `4fad101` | Diagnóstico empty state |
| 02 | `4a55e23` | Plano de correção |
| 03 | `a78a1dd` | Resolver único de NF |
| 04 | `a234164` | Consolidação documental |
| 05 | `189121b` | Contrato API + permissão |
| 06 | `db86370` | Estados FE / layout |
| 07 | `368974f` | Auditoria read-only |
| 08 | *(este commit / ver `git log -1 --grep=TRIB-08`)* | Release candidate |

---

## 6. Testes e build

Direcionados:

```bash
npx tsx --test \
  src/lib/sales-orders/salesOrderTributosReleaseCandidate.test.tsx \
  src/lib/sales-orders/salesOrderTaxesAudit.test.ts \
  src/lib/sales-orders/salesOrderFiscalTaxesContract.test.ts \
  src/lib/sales-orders/salesOrderTributosTabUi.test.tsx \
  src/lib/sales-orders/salesOrderRelatedNfeResolver.test.ts \
  src/lib/sales-orders/salesOrderDocumentaryTaxes.test.ts
```

Suite e build:

```bash
npm test
npm run build
git diff --check
```

---

## 7. Limitações que dependem do servidor

- Existência e conteúdo real do pedido **PD 02781** no banco.
- Qualidade/completude de `NomusNfeFiscalSummary` e links O2C/DS persistidos.
- Sessão real do usuário (bag vs `effectivePermissions`) no ambiente.
- Viewports reais no browser (os testes cobrem shell + markup + classes; não
  substituem QA visual manual no servidor/staging).

---

## 8. Comando da auditoria (servidor)

```bash
npm run audit:sales-order:taxes -- --order=PD02781
```

Ver runbook: `docs/sales-orders/taxes-audit-runbook.md`.

O auditor é read-only: sem escrita no banco, sem Nomus HTTP, sem imprimir
credenciais da `DATABASE_URL`.
