# SalesOrderOperationalEvidenceGraph (KAN-LINK-02)

Contrato canônico de evidências operacionais PV ↔ item ↔ OP ↔ DS ↔ NF para o Fluxo de Pedidos / Kanban.

| Item | Valor |
|------|--------|
| Código | KAN-LINK-02 |
| Versão | `sales-order-operational-evidence/v1` |
| Implementação | `src/lib/sales/salesOrderOperationalEvidenceContract.ts` · `salesOrderOperationalEvidenceGraph.ts` |
| Motor de estágio | **Inalterado** — `resolveSalesOrderItemFlow` / `resolveSalesOrderFlow` |
| Papel deste contrato | Estruturar vínculos, validade e coberturas por item; **alimentar** o motor via `adaptOperationalEvidenceItemToMotorAllocations` |

Auditoria de origem: `docs/audits/kanban-operational-linkage-current-state.md` (KAN-LINK-01).

---

## Precedência dos vínculos

Menor rank = maior força. Direto sempre prevalece sobre hint.

| Rank | sourceType | Significado |
|------|------------|-------------|
| 1 | `DIRECT_EXTERNAL_ID` | ID interno/externo oficial diretamente relacionado |
| 2 | `DIRECT_ORDER_REFERENCE` / `DIRECT_ORDER_ITEM_REFERENCE` | Campo oficial Nomus com Pedido / item |
| 3 | `SALES_ORDER_NFE_LINK` | Vínculo persistido canônico |
| 4 | `OUTPUT_DOCUMENT_REFERENCE` / `NFE_REFERENCE` | Cadeia oficial DS → NF → Pedido |
| 5 | `PRODUCTION_ORDER_REFERENCE` | Referência normalizada inequívoca (ex.: OP) |
| 6 | `PRODUCTION_LABEL_REFERENCE` / `DESCRIPTION_HINT` | Hint textual controlado / rótulo |
| 99 | `UNRESOLVED` / `AMBIGUOUS` | Sem vínculo ou ambíguo |

---

## Proibições (nunca prova automática)

Não criar vínculo só por: mesmo cliente, mesmo valor, mesmo produto, mesma data, mesma quantidade ou proximidade temporal.

Esses sinais podem gerar `SalesOrderOperationalAuditAlert` com `provesLink: false`.

---

## Validade

- **Documento de saída:** `VALID` · `CANCELLED` · `RETURN` · `TRANSFER` · `WITHOUT_NFE` · `PROCESSING` · `UNKNOWN`
- **NF-e:** `AUTHORIZED` · `CANCELLED` · `REJECTED` · `VOIDED` · `UNKNOWN`

Somente evidências com vínculo elegível **e** validade que avança (`VALID`/`WITHOUT_NFE` para DS; `AUTHORIZED` para NF) entram na cobertura do Kanban. Hint e ambíguo **não** avançam estágio.

---

## Granularidade

Cobertura e inconsistências são **por item**. Um DS pode atender parte do pedido, vários itens, pedidos distintos ou linhas repetidas do mesmo produto; OPs podem cobrir residual parcial ou inexistir se o item foi atendido sem produção.

---

## Auditoria read-only (KAN-LINK-03)

```bash
npm run audit:sales-order:operational-links -- --order="PD 02757"
npm run audit:sales-order:operational-links -- --active --limit=100
npm run audit:sales-order:operational-links -- --order="PD 02757" --json --markdown --output=tmp-audits/operational-links
```

- Sem `--output`: só terminal (não cria arquivo).
- JSON/Markdown só com `--json` / `--markdown`.
- Exit `0` sem divergência crítica; `1` com crítica; `2` erro técnico.
- Garantias: `databaseWrites=false`, `nomusCalls=false`.

---

## Resolvedor DS → Pedido/item (KAN-LINK-04)

Implementação: `src/lib/sales/salesOrderOutputDocumentLinkResolver.ts` + integração em `salesOrderFlowEvidence*.ts` / `salesOrderItemFlowAllocations.ts`.

**Precedência:** idPedido → codigoPedido → idItemPedido/sequência → SalesOrderNfeLink → DS→NF autorizada → hint inequívoco → sem vínculo.

**Multi-pedido / item:** linhas resolvidas independentemente; produto só se inequívoco no pedido; ambíguo = cobertura ORDER_LEVEL / AMBIGUOUS sem rateio.

**Sem migration:** refs lidas do `rawJson` na carga; DS com vínculo direto entra no pack mesmo sem NF sincronizada.

---

## Resolvedor OP → Pedido/item (KAN-LINK-05)

Implementação: `src/lib/sales/salesOrderProductionOrderLinkResolver.ts` + integração em `resolveSalesOrderItemFlowFromEvidence`.

**Campos oficiais:** `itensPedido[].idPedido`, `itensPedido[].id`, `item`/`sequencia`, `quantidade`, FK `NomusProductionOrderSalesLink`, status da OP, nome/identificação (etiqueta PD inequívoca).

**Precedência:** idPedido → idItem → etiqueta inequívoca (+ item) → vínculo persistido → referência normalizada → sem vínculo.  
Não prova: produto, qty, cliente, data, máquina, molde.

**Cobertura:** compara OP à `remainingFulfillment` (residual). OP parcial ≠ ausência. `remainingFulfillment=0` → OP não obrigatória; DS/NF avançados não regridem para Aguardando OP.

---

## Reconciliação Pedido → OP → DS → NF (KAN-LINK-06)

Implementação: `src/lib/sales/salesOrderOperationalEvidenceReconciler.ts`  
Anexada automaticamente em `buildSalesOrderOperationalEvidenceGraph` (`item.reconciliation` + `graph.reconciliation`).

**Modelo:** unifica evidências **sem cadeia artificial**. Elos válidos:

- Pedido → OP → DS → NF → envio
- Pedido → atendimento sem OP → DS → NF
- Pedido → OP → DS (sem NF ainda)
- Pedido → NF (sem OP)

Ausência de elo intermediário **não apaga** evidência posterior.

**Fórmulas (por item):**

```
activeObligation = ordered − cut − canceled   (ou obligation.active)
remainingFulfillment = max(0, activeObligation − fulfilled)
productionCoverage  → OP vs remainingFulfillment
documentedCoverage  → DS vs activeObligation
invoicedCoverage    → NF vs activeObligation
shippedCoverage     → envio/proxy NF vs activeObligation
chainCoveredQuantity = DS∪NF sem dupla contagem (pares DS↔idNfe contam 1×)
```

**Precedência de cobertura:** envio/NF → documento → (OP só se residual exigir) → atendimento sem OP.  
Documento/NF **não** prova OP; ausência de OP **não** invalida DS/NF.

**Diagnóstico no contrato:** `linkStatus`, `coverageStatus`, `sourceSummary`, `warnings`, `unresolvedEvidence`, `operationalEvidenceTimeline`.

**Devoluções/cancelamentos:** evidência preservada na timeline com `operational=false`; não avança cobertura.

**Unidades:** só converte com fator comprovado; senão `INCONSISTENT` (evidência visível, sem conclusão indevida).
