# T01 — Estado atual das fontes fiscais (IndusCost)

**Atualizado:** 2026-07-16  
**Escopo:** auditoria somente leitura — sem alteração funcional neste prompt.  
**Relacionado:** [order-nfe-cr-financial-separation.md](./order-nfe-cr-financial-separation.md), [tax-data-target-model.md](./tax-data-target-model.md), [tax-source-of-truth.md](./tax-source-of-truth.md), [tax-order-detail-plan.md](./tax-order-detail-plan.md)

## 1. Resumo executivo

| Área | Situação hoje |
|------|----------------|
| Persistência fiscal de NF-e | Header parcial em `NomusNfe` + XML integral (`xmlRaw`) + `rawPayload` Nomus |
| Impostos por item (normalizados) | **Inexistentes** no Prisma |
| Breakdown por tributo (ICMS/IPI/PIS/…) | **Inexistente** no schema; não extraído do XML |
| “Impostos destacados” na UI/relatórios | Derivado: `max(0, xmlVNF − valorLiquido)` |
| Financeiro → Tributos (`/taxes`) | Apenas **TaxRule/TaxComponent** (precificação %), não apuração/pagamento |
| Guias (DARF/GNRE/DAS/DAE/GPS) | **Não modeladas** |
| Tributo pago / comprovantes | **Não modelados** (exceto padrão de anexo em distrato PJ, fora do fiscal) |
| Reforma (IBS/CBS/IS) | **Zero** referências no código de NF-e |
| Reprocessamento histórico via XML | Dados possíveis (`xmlRaw` gravado); **ferramenta dedicada inexistente** |

**Regra de ouro já documentada no projeto:** não tratar `xmlVNF − valorLiquido` como “impostos pagos”, nem como breakdown oficial por tributo.

---

## 2. Inventário de entidades e módulos

### 2.1 Pedido de Venda

| Artefato | Path / modelo | Papel fiscal |
|----------|---------------|--------------|
| `SalesOrder` | `prisma/schema.prisma` | `totalTaxes`, `totalFreight` — totais comerciais sincronizados; **não** é breakdown SEFAZ |
| `SalesOrderItem` | idem | Sem colunas de imposto; `nomusRawItem Json?` |
| `SalesOrderNfeLink` | idem | Vínculo pedido ↔ NF Nomus (chave, status, `rawPayload`, `nomusNfeId` opcional) — **sem** campos de imposto |
| Sync pedido | `scripts/nomusSalesOrdersSyncV1.ts` | Extrai/upsert links NF via payload do pedido |
| Detalhe UI | `src/components/SalesOrdersModule.tsx` | Mostra `totalTaxes` do pedido |
| Métricas fiscais | `src/lib/sales/orderFiscalFinancialMetrics.ts` | Produtos / vNF / impostos destacados a partir de `NomusNfe` |
| Relatório comercial | `src/lib/sales/salesOrderReport*.ts` | Coluna “Impostos destacados NF” |

### 2.2 NF-e Nomus

| Artefato | Path / modelo | Papel fiscal |
|----------|---------------|--------------|
| `NomusNfe` | `prisma/schema.prisma` ~2528–2585 | Fonte documental principal |
| Parser XML | `src/lib/nomusNfeXmlParser.ts` | Extrai só `natOp`, `dhEmi`, `tpNF`, dest, `vProd`, `vDesc`, `vNF` |
| Mapper | `src/lib/nomusNfeMapper.ts` | Persistência + `valorLiquido = vProd − vDesc` |
| Sync | `scripts/nomusNfesSync.ts` + `src/lib/nomusNfesSync*.ts` | Preview/apply `/rest/nfes`; skip se `payloadHash` igual |
| Classificação | `src/lib/nomusNfeClassification.ts`, `nomusNfeBillingEligibility.ts` | Billing / venda mercado |
| Testes | `src/lib/nomusNfes.test.ts` | Fixtures XML **inline** (sem arquivos `.xml` standalone) |

**Campos persistidos relevantes em `NomusNfe`:**

- Identidade: `externalId`, `chave`, `numero`, `serie`, status/tipo/ambiente/protocolo…
- XML: `xmlRaw`, `xmlCancelamento`, `justificativaCancelamento`
- Parseados: `xmlNatOp`, `xmlDhEmi`, `xmlTpNF`, `xmlDestCnpjCpf`, `xmlVProd`, `xmlVDesc`, `xmlVNF`, `valorLiquido`
- Blob: `rawPayload` (JSON Nomus), `payloadHash`
- Flags: `billingClassification`, `isFiscalBilling`, `isMarketSale`, `xmlQualityAlert`

**Não existem** colunas: `vFrete`, `vSeg`, `vOutro`, `vII`, `vIPI`, `vICMS`, `vST`, `vFCP*`, `vPIS`, `vCOFINS`, `vTotTrib`, IBS, CBS, IS, nem tabela `NomusNfeItem`.

### 2.3 Documento de Saída / estoque

| Artefato | Path | Papel fiscal |
|----------|------|--------------|
| `NomusStockDocument` / `Item` | Prisma + `nomusStockDocumentsMapper.ts` | Evidência operacional; `idNfe` opcional; qty/valor — **sem impostos** |
| Sync | `scripts/nomusStockDocumentsSync.ts` | Preview/apply |

Usado em Order-to-Cash / Auditoria 360º como elo pedido → saída → NF, **não** como fonte de tributo.

### 2.4 Order-to-Cash Audit e Auditoria 360º

| Artefato | Path | Impostos |
|----------|------|----------|
| `OrderToCashAuditRun` / `Fact` | Prisma | `nfeHeaderValue` tipicamente `valorLiquido`; snapshots de item qty/valor; **sem** colunas de tributo |
| Builder | `src/lib/sales/orderToCashAuditBuilder.ts` | Não materializa breakdown fiscal |
| Auditoria 360º (live) | `src/lib/finance/orderFullAuditService.ts` + `OrderFullAuditDialog.tsx` | Header: impostos destacados; item: tenta `totalImpostos` / `impostos` / `vTotTrib` / `taxes` no **JSON** (`rawPayload`), não no XML |

**Drift conhecido:** fatos O2C centram em `valorLiquido`; Auditoria 360º / motor vinculado preferem `xmlVNF` + destacados.

### 2.5 Financeiro → Tributos

| Artefato | Path | Realidade |
|----------|------|-----------|
| Rota `/taxes` | `App.tsx`, label “Tributos” | UI `TaxModule.tsx` |
| `TaxRule` / `TaxComponent` | Prisma | Regras de **%** para precificação/margem (`VENDA`/`COMPRA`/…) |
| APIs | `server.ts` `/api/tax-rules` | CRUD de regras |

**Não** é módulo de apuração, guia ou pagamento fiscal.

### 2.6 Contas a Pagar / pagamentos / anexos

| Artefato | Path | Realidade |
|----------|------|-----------|
| `NomusAccountsPayable` | Prisma | Títulos genéricos Nomus (`documentNumber`, valores, datas, `rawPayload`) — **sem tipo guia** |
| Alocação CC | `AccountsPayableCostCenterAllocation` | Rateio gerencial de AP |
| Comprovante | `SupplierServiceTermination.paymentProof*` | Distrato PJ — **não** fiscal |
| DARF / GNRE / DAS / DAE / GPS | — | **Zero** modelos/UI |

Se Nomus sincronizar um título com descrição “DARF…”, aparece como AP comum — sem tipagem fiscal.

### 2.7 Proposta / precificação (estimado, não documental)

| Artefato | Campos | Camada |
|----------|--------|--------|
| `Proposal.totalTaxes` | Aggregate | Estimado comercial |
| `ProposalItem.taxesPerc` / `taxesValue` | Item | Estimado |
| `ProjectPricingItem.taxAmount*` | Snapshot de regra | Estimado |
| `PriceTableItem.frozenTaxCost` | Congelado | Estimado |
| `MaterialMarketQuote.taxValue` | Cotação compra | Fora de NF de venda |

---

## 3. Matriz de campos fiscais (XML / totais)

Legenda **disponível hoje:**

- `persistido` = coluna Prisma  
- `xml_raw` = só no texto `xmlRaw` (recuperável)  
- `json_raw` = eventual chave em `rawPayload` (não garantida)  
- `derivado` = calculado em runtime  
- `ausente` = não modelado / não lido  

| Campo | Origem SEFAZ típica | Disponível hoje | Header / item | Oficial / estimado | Migration | Backfill | Exibição recomendada |
|-------|---------------------|-----------------|---------------|--------------------|-----------|----------|----------------------|
| vProd | `ICMSTot` / `det` | persistido (`xmlVProd`); item só xml/json | H (P); I (xml) | oficial documental | — | reparse XML | Produtos brutos NF |
| vDesc | `ICMSTot` | persistido (`xmlVDesc`) | H | oficial | — | reparse | Desconto NF |
| vFrete | `ICMSTot` | xml_raw | H | oficial | col/linha tributo | reparse | Frete NF |
| vSeg | `ICMSTot` | xml_raw | H | oficial | idem | reparse | Seguro |
| vOutro | `ICMSTot` | xml_raw | H | oficial | idem | reparse | Outras despesas |
| vII | `ICMSTot` | xml_raw | H | oficial | idem | reparse | II |
| vIPI | `ICMSTot` / imposto item | xml_raw | H/I | oficial | idem | reparse | IPI destacado |
| vIPIDevol | `ICMSTot` | xml_raw | H | oficial | idem | reparse | IPI devolvido |
| vBC | `ICMSTot` / ICMS item | xml_raw | H/I | oficial | idem | reparse | Base ICMS |
| vICMS | idem | xml_raw | H/I | oficial | idem | reparse | ICMS |
| vICMSDeson | idem | xml_raw | H/I | oficial | idem | reparse | ICMS desonerado |
| vBCST | idem | xml_raw | H/I | oficial | idem | reparse | Base ST |
| vST | idem | xml_raw | H/I | oficial | idem | reparse | ICMS-ST |
| vFCP | idem | xml_raw | H/I | oficial | idem | reparse | FCP |
| vFCPST | idem | xml_raw | H/I | oficial | idem | reparse | FCP ST |
| vFCPSTRet | idem | xml_raw | H/I | oficial | idem | reparse | FCP ST ret. |
| vPIS | idem | xml_raw | H/I | oficial | idem | reparse | PIS |
| vCOFINS | idem | xml_raw | H/I | oficial | idem | reparse | COFINS |
| vISS | ISSQN (serviço) | xml_raw (se NF-e/NFS) | H/I | oficial | idem | reparse | ISS |
| vTotTrib | tot / item | json_raw ocasional; não parse XML | H/I | oficial se XML | linha | reparse | Carga tributária aprox. |
| vNF | `ICMSTot` | persistido (`xmlVNF`) | H | oficial | — | — | Total da NF |
| valorLiquido | derivado | persistido | H | oficial produtos | — | — | Produtos líquidos |
| impostos destacados (agregado) | derivado | derivado UI | H | **aproximação** (não breakdown) | preferir linhas | — | “Destacados (agregado)” com caveat |
| IBS / CBS / IS | reforma | ausente | — | futuro | modelar flexível | XML futuro | ocultar até schema |
| SalesOrder.totalTaxes | Nomus/comercial | persistido | pedido | estimado/comercial | não confundir com NF | — | “Impostos do pedido (comercial)” |
| TaxRule % | config | persistido | pricing | estimado | manter separado | — | só precificação |
| tributo pago (guia) | AP/banco | ausente | — | recolhido | novos modelos | import AP | tela futura |
| tributo apurado | apuração | ausente | período | apurado | novos modelos | — | tela futura |

---

## 4. XML integral e reprocessamento

| Pergunta | Resposta |
|----------|----------|
| Onde está o XML? | `NomusNfe.xmlRaw` (`Text`) |
| Cancelamento? | `xmlCancelamento` + justificativa |
| Dá para reprocessar histórico? | **Sim, em dados** (reler `xmlRaw`). **Não operacionalmente:** sync apply com mesmo `payloadHash` só atualiza `syncedAt`; não há job `reparse-nfe-xml` |
| Fixtures? | Strings XML em testes TypeScript; não há corpus `.xml` em disco |

---

## 5. Fontes de pagamento encontradas

| Fonte | Serve a tributo recolhido? |
|-------|----------------------------|
| `NomusAccountsPayable` | Potencial futuro se Nomus classificar guias; hoje genérico |
| Contas a Receber | Cobrança de cliente — **não** é imposto pago |
| Anexos distrato | Não fiscal |
| Módulo Tributos `/taxes` | Não |

**Conclusão:** não há fonte confiável de “tributo recolhido” no IndusCost hoje.

---

## 6. O que **não** deve ser confundido

1. `SalesOrder.totalTaxes` ≠ impostos da NF.  
2. `max(0, xmlVNF − valorLiquido)` ≠ soma oficial ICMS+IPI+… (pode incluir frete/outros no vNF).  
3. TaxRule ICMS% ≠ ICMS da NF emitida.  
4. Título AP com texto “imposto” ≠ guia tipada e comprovada.  
5. `vTotTrib` no item JSON ≠ apuração nem pagamento.

---

## 7. Arquivos-chave (índice)

```
prisma/schema.prisma                          NomusNfe, SalesOrder*, TaxRule*, AP, O2C
src/lib/nomusNfeXmlParser.ts                  parse header
src/lib/nomusNfeMapper.ts                     persistência
scripts/nomusNfesSync.ts                      sync Nomus
src/lib/sales/orderFiscalFinancialMetrics.ts  destacados
src/lib/salesOrderLinkedNfe.ts                vínculo valores
src/lib/finance/orderFullAuditService.ts      Auditoria 360º
src/components/TaxModule.tsx                  Tributos (regras)
docs/finance/order-nfe-cr-financial-separation.md
```
