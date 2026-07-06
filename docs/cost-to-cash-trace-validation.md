# Validação final — Núcleo auditável Cost-to-Cash

> **Projeto:** IndusCost / My Industry  
> **Data:** 2026-07-06  
> **Escopo:** Matéria-prima → Componentes → BOM → Produto → Custo oficial → Preço publicado → Pedido Nomus → Comissão → AR → Recebimento → Comissão liberada → Fechamento congelado  
> **Regra:** read-only — sem apply de fechamento, sem alteração de dados, sem publicação automática.

---

## 1. Status geral

**APROVADO COM RESSALVAS**

| Camada | Resultado | Evidência |
|--------|-----------|-----------|
| Testes unitários | OK | 368 `test:commissions` + 45 `test:cost-to-cash-trace` |
| Build / bundle | OK | `build`, `check:frontend-server-imports`, `check:browser-bundle` |
| Implementação estática | OK | Scripts, APIs, tela, export, legado documentado |
| Validação ao vivo (DB) | **Pendente neste ambiente** | `DATABASE_URL` ausente — executar em homolog/prod |

**Ressalva:** dados reais (618.08AA, VAREJO_2, Gislene/jun-2026) exigem `.env` com PostgreSQL. Contrato, testes e wiring estão validados em código.

---

## 2. O que foi validado

### Regra-mãe do sistema

| Etapa | Fonte oficial |
|-------|---------------|
| Custo | Engenharia → publicação em `ProductionCostTable` |
| Preço | Custo publicado → tabela comercial congelada |
| Venda | Nomus (`SalesOrder`) |
| Comissão | Snapshot materializado da venda |
| Pagamento comissão | Recebimento AR (`settlementDate`) |
| Fechamento | Ledger congelado (`CommissionReceiptLedgerLine`) |

### Itens implementados (checklist)

| # | Item | Status |
|---|------|--------|
| 1 | Preview comissão sem 500 / sem `exclusionRuleId` | OK (código + testes) |
| 2 | Warning 618.08AA sem crítico se custo igual | OK (lógica + testes) |
| 3 | Aba Fonte do Preço no modal | OK |
| 4 | `audit-product-cost-trace` | OK |
| 5 | `audit-published-price-trace` | OK |
| 6 | `audit-sales-order-trace` | OK |
| 7 | `audit-commission-trace` | OK |
| 8 | Tela única read-only | OK |
| 9 | Export dossiê JSON/CSV | OK |
| 10 | Legado mapeado | OK — `docs/cost-to-cash-legacy-deactivation-plan.md` |
| 11 | Fechamento bloqueado sem confirmação | OK — `FECHAR COMISSAO` |
| 12 | Git limpo após scripts | OK — artefatos em `tmp/` |

---

## 3. Preview de comissão

**Endpoint:** `GET /api/commissions/receipt-closing/preview?year=2026&month=6`  
**Service:** `getReceiptClosingPreviewPage` → `loadCommissionReceiptPreview`

| Verificação | Resultado |
|-------------|-----------|
| Erro 500 `Unknown field exclusionRuleId` | **Removido** — `loadMaterializedSchedulesByReceivableId` usa `resolveMaterializedItemExclusionMeta` (lê `exclusionRuleId` de `ruleSnapshotJson`, não do Prisma select) |
| Teste estático | `commissionReceiptEngine.server.test.ts` — `assert.doesNotMatch(/exclusionRuleId:\s*true/)` |
| `NO_SCHEDULE` sem 500 | OK — `commissionReceiptClosingApi.test.ts` linha NO_SCHEDULE |
| `CUSTOMER_EXCLUDED` explícito | OK — cards e linhas com status/motivo |
| Apply bloqueado | OK — exige `FECHAR COMISSAO` |

**Script de validação (read-only):**

```bash
npx tsx scripts/validate-commission-receipt-closing.ts \
  --year=2026 --month=6 --compare-legacy \
  --nomus-base=808107.32 --nomus-commission=20926.56 \
  --json --csv --include-lines
```

Saída: `tmp/commission-receipt-closing-validation/` (gitignored).

**Ao vivo:** pendente `DATABASE_URL`. Em homolog, confirmar HTTP 200 na tela Comissões → Fechamento por Recebimento.

---

## 4. Produto 618.08AA — custo

**Lógica:** `resolveProductEngineeringCostWarning` (`productEngineeringCostWarning.ts`)

| Cenário | Comportamento |
|---------|---------------|
| `officialCost === calculatedCost` (tolerância 1e-6) | Sem `COST_DIFF_PENDING_PUBLICATION` |
| Hash técnico diferente, custo igual | `TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT` — aviso **info**, não crítico |
| UI | `ProductCostPublicationPendingCard` — variant `info` vs `attention` |

**Teste dedicado:** `productEngineeringCostWarning.test.ts` — caso `618.08AA — diferença zero sem alerta crítico`.

**Script:**

```bash
npx tsx scripts/audit-product-cost-trace.ts \
  --sku=618.08AA --json --csv \
  --include-bom --include-process --include-materials
```

**Saída esperada:** custo oficial, BOM, MP, processo HH/HM, alertas, `calculationMode` PUBLISHED ou DIAGNOSTIC.

**Ao vivo:** valores numéricos dependem do banco — rodar script acima com `.env`.

---

## 5. Preço 618.08AA — Varejo 2

**Script:**

```bash
npx tsx scripts/audit-published-price-trace.ts \
  --sku=618.08AA --table-code=VAREJO_2 --json --csv
```

**API:** `GET /api/audit/published-price-trace?sku=618.08AA&tableCode=VAREJO_2`

**Modal:** Formação de Preço → clique em preço publicado → aba **Fonte do Preço** (`PublishedPriceSourceTraceTab`)

| Campo | Fonte |
|-------|-------|
| SKU, tabela, versão, vigência, publicação | `PriceTableItem` + `PriceTableVersion` |
| Preço publicado | `salePrice` congelado |
| Custo usado | `costSnapshotJson` / `frozenTotalCost` |
| Imposto, margem, comissão | `formulaSnapshotJson` |
| Custo mais recente | `newerPublishedVersionWarning` |
| Indisponível | `PUBLISHED_TRACE_UNAVAILABLE_LABEL` |

**Regra:** modal consome `GET /api/pricing/published-price-source-trace` — **não recalcula** preço publicado.

---

## 6. Comissão junho/2026 — Gislene

**Script:**

```bash
npx tsx scripts/audit-commission-trace.ts \
  --year=2026 --month=6 --seller=GISLENE \
  --json --csv --include-lines
```

**API:** `GET /api/audit/commission-trace?year=2026&month=6&seller=GISLENE`

**Cobertura (testes `commissionTraceAudit.test.ts`):**

- Venda, pedido, NF, itens, regra, títulos AR, rateio, recebimento
- Baixa parcial proporcional
- `CUSTOMER_EXCLUDED` — final zerado, bruto mantido
- `NO_SCHEDULE` — status auditável, script não quebra
- Comparação Nomus quando `--nomusBase` / `--nomusCommission`

**Ao vivo:** totais e exceções dependem do banco materializado.

---

## 7. APIs e telas validadas

| Recurso | Rota / endpoint |
|---------|-----------------|
| Tela rastreabilidade | `/reports/cost-to-cash-trace` |
| API agregada | `GET /api/audit/cost-to-cash-trace` |
| Custo | `GET /api/audit/product-cost-trace?sku=` |
| Preço | `GET /api/audit/published-price-trace?sku=&tableCode=` |
| Venda | `GET /api/audit/sales-order-trace?orderNumber=` |
| Comissão trace | `GET /api/audit/commission-trace?year=&month=&seller=` |
| Preview fechamento | `GET /api/commissions/receipt-closing/preview?year=&month=` |
| Fonte preço modal | `GET /api/pricing/published-price-source-trace?priceItemId=` |

**Tela — filtros:** SKU, pedido, NF, cliente, vendedor, título AR, ano/mês.  
**Seções:** produto, custo, preço, venda, comissão, diagnósticos.  
**Read-only:** hook consome API; sem recálculo no frontend.

---

## 8. Scripts disponíveis

| Script | Propósito | CSV |
|--------|-----------|-----|
| `audit-product-cost-trace.ts` | Por que o produto custa X | `tmp/product-cost-trace/` |
| `audit-published-price-trace.ts` | Fonte do preço publicado | `tmp/published-price-trace/` |
| `audit-sales-order-trace.ts` | Margem real + custo oficial | `tmp/sales-order-trace/` |
| `audit-commission-trace.ts` | Venda → AR → comissão | `tmp/commission-trace/` |
| `validate-commission-receipt-closing.ts` | Preview vs legado/Nomus | `tmp/commission-receipt-closing-validation/` |
| `validate-cost-to-cash-trace.ts` | Checklist estático + live | — |

**Venda por período** (requer identificador se múltiplos pedidos):

```bash
# Por pedido (preferido)
npx tsx scripts/audit-sales-order-trace.ts --order-number=<codigo> --json --csv --include-items

# Por cliente + período (pode exigir desambiguação)
npx tsx scripts/audit-sales-order-trace.ts --customer=<nome> --year=2026 --month=6 --json --csv --include-items
```

**Regra crítica venda:** `SalesOrderItem.unitCost` Nomus ≠ custo industrial. Trace usa custo oficial IndusCost (`costSource` por item).

---

## 9. Export dossiê

| Formato | Origem | Destino |
|---------|--------|---------|
| JSON completo | Mesmo payload da tela (`CostToCashTraceApiPayload`) | Download browser |
| CSV resumido | Seções do payload | Download browser |
| Copiar diagnósticos | Clipboard | — |

**Git:** export browser não grava no repo. Scripts trace gravam em `tmp/` (`.gitignore`).

---

## 10. Pendências reais

1. **Smoke ao vivo** com `DATABASE_URL` em homolog/prod (618.08AA, VAREJO_2, Gislene/jun-2026).
2. **Tela Fechamento por Recebimento** — confirmar HTTP 200 manualmente após deploy.
3. **`audit-sales-order-trace --year --month`** — funciona com `--customer`; `--year --month` sozinho pode falhar se houver múltiplos pedidos (documentado acima).
4. **Batch integrado legado** (`/api/cost-price-margin/audit`) — ainda ativo; migrar consumidores para trace (ver legado).

---

## 11. Legado a inativar futuramente

Documento completo: `docs/cost-to-cash-legacy-deactivation-plan.md`

| Tag | Principais itens |
|-----|------------------|
| **KEEP** | Motor `src/lib/audit/*`, 4 scripts trace, receipt-closing, materialização |
| **LEGACY_READ_ONLY** | `commissionVisualAudit`, `audit-commission-visual-summary`, scripts hygiene |
| **DEPRECATED** | `recalculate-commissions.ts`, `audit-commission-apuracao.ts`, `POST /api/commissions/recalculate` |
| **REPLACE_WITH_TRACE_SERVICES** | `audit-cost-price-margin-integration`, `CostPriceMarginAuditPanel`, fallback live em margem |
| **CANDIDATE_REMOVE_LATER** | `dedupe-commission-persons.ts`, suites teste legado pós-cutover |

**Nenhum código removido nesta validação.**

---

## 12. Comandos executados (2026-07-06)

```bash
npm run test:commissions          # 368/368 OK
npm run test:cost-to-cash-trace   # 45/45 OK
npm run build                     # OK
npm run check:frontend-server-imports  # OK
npm run check:browser-bundle      # OK
npx tsx scripts/validate-cost-to-cash-trace.ts  # 10/10 OK (estático)
```

Scripts ao vivo: bloqueados por ausência de `DATABASE_URL` — mensagem amigável, exit ≠ crash silencioso.

---

## 13. Próximo passo recomendado (deploy)

```bash
# 1. Configurar .env com DATABASE_URL
# 2. Validação ao vivo
npm run validate:cost-to-cash-trace

npx tsx scripts/validate-commission-receipt-closing.ts \
  --year=2026 --month=6 --compare-legacy \
  --nomus-base=808107.32 --nomus-commission=20926.56 --json --csv --include-lines

npx tsx scripts/audit-product-cost-trace.ts --sku=618.08AA --json --csv --include-bom --include-process --include-materials
npx tsx scripts/audit-published-price-trace.ts --sku=618.08AA --table-code=VAREJO_2 --json --csv
npx tsx scripts/audit-commission-trace.ts --year=2026 --month=6 --seller=GISLENE --json --csv --include-lines

# 3. Build seguro
npm run build:safe

# 4. Smoke UI: /reports/cost-to-cash-trace + Comissões → Fechamento por Recebimento
```
