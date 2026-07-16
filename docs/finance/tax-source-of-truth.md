# T01 — Fontes da verdade por camada fiscal

**Atualizado:** 2026-07-16  
**Complementa:** [tax-data-current-state.md](./tax-data-current-state.md), [tax-data-target-model.md](./tax-data-target-model.md)

## 1. As quatro camadas (nunca sinônimos)

| Camada | Nome | Definição | SoT hoje | SoT alvo |
|--------|------|-----------|----------|----------|
| **A** | Tributo **destacado** na NF | Valor documental extraído do XML/JSON da NF emitida | Agregado derivado `max(0, xmlVNF − valorLiquido)`; XML parcial em `xmlRaw` | `NfeTaxLine` + `NfeFiscalSummary` |
| **B** | Tributo **apurado** | Resultado da apuração por período (débitos, créditos, retenções, compensações) | **Inexistente** | `FiscalApurationPeriod` / `Line` |
| **C** | Tributo **recolhido** | Valor comprovadamente pago via guia/documento de arrecadação | **Inexistente** (AP genérico no máximo) | `FiscalPaymentGuide` + provas (+ AP opcional) |
| **D** | **Alocação gerencial** | Parcela de recolhimento/apuração atribuída a pedido/NF para análise | **Inexistente** | `FiscalAllocation` |

### Exemplos do que **não** fazer

| Errado | Correto |
|--------|---------|
| “Impostos do pedido = impostos pagos” | Pedido pode mostrar A (destacados das NFs) e D (alocado) em cards distintos |
| “DARF mensal = ICMS da NF X” | Guia (C) pode ser alocada (D) a várias NFs |
| “TaxRule 18% = ICMS destacado” | TaxRule é precificação; A vem do XML |
| “vNF − produtos = impostos pagos” | É no máximo aproximação da camada A |

## 2. SoT por pergunta de negócio

| Pergunta | Camada | Fonte oficial |
|----------|--------|---------------|
| Quanto de IPI saiu na NF 123? | A | Linha `taxCode=IPI` da NF (alvo); hoje só residual agregado |
| Qual o total da NF comparável ao pedido? | A (total) | `xmlVNF` / `vNF` — ver order-nfe-cr-financial-separation |
| Quanto de ICMS a empresa deve no mês? | B | Apuração do período |
| Quanto foi pago de DARF em março? | C | Guias com `paidAt` / comprovante |
| Quanto do DARF de março cai no PD 02457? | D | Alocações para o pedido |
| Qual imposto usei na margem do produto? | *(fora)* | `TaxRule` / estimado comercial — **não** A–D |

## 3. Precedência de fontes para a camada A

Ordem proposta ao popular `NfeTaxLine`:

1. **XML** (`NomusNfe.xmlRaw`) — preferencial.  
2. **JSON Nomus** (`rawPayload`) — se tag ausente no XML ou XML nulo.  
3. **Derivado residual** — apenas para gap residual documentado; nunca inventar ICMS/IPI separados.  
4. **SalesOrder.totalTaxes** — **não** usar para popular linhas da NF.

## 4. Relação com artefatos atuais

| Artefato atual | Camada | Observação |
|----------------|--------|------------|
| `NomusNfe.xmlVNF` / `valorLiquido` | A (totais) | Manter |
| `highlightedTaxesValue` | A (agregado frágil) | Deprecar display quando houver linhas |
| Item `vTotTrib` no JSON | A (aprox. item) | Preferir parse XML item |
| `SalesOrder.totalTaxes` | Comercial | Rotular na UI; fora das 4 camadas |
| `/taxes` TaxRule | Precificação | Fora das 4 camadas |
| `NomusAccountsPayable` | C (candidato) | Só após tipagem guia |
| O2C / Auditoria 360º | Consome A (+ operacional) | Não inventar B/C |

## 5. Auditoria e origem

Todo valor fiscal alvo deve carregar:

- `source` (`XML` / `NOMUS_JSON` / `MANUAL` / `DERIVED`)
- `sourcePath` ou referência de guia
- `parserVersion` / `importedAt`
- usuário (se manual)

Reprocessamento: novo `parserVersion` não apaga histórico sem trilha — preferir upsert idempotente por `(nomusNfeId, taxCode, scope, itemIndex)`.

## 6. Decisões pendentes

1. **Escopo F1:** apenas header `ICMSTot` ou já itens `det`?  
2. **Frete no residual:** frete destacado no vNF entra em “impostos destacados” na UI legada — manter caveat ou separar `vFrete` antes do residual?  
3. **Multi-CNPJ / filiais:** apuração por qual estabelecimento?  
4. **Guias:** sync automático a partir de Nomus AP vs cadastro manual no IndusCost?  
5. **Alocação default:** pro-rata `vNF` vs `vProd` vs só manual?  
6. **NFS-e / ISS:** mesmo modelo `NfeTaxLine` ou bounded context separado?  
7. **Permissões:** novo facet `finance.tax_apuration.*` vs reutilizar `taxes.*` (hoje precificação)?  
8. **Retenção na fonte vs destacado:** modelar `isWithheld` em linha?  
9. **Reforma:** quando começar a exigir tags IBS/CBS no parser (ambiente homologação)?  
10. **O2C rebuild:** deve passar a gravar `xmlVNF` em `nfeHeaderValue` ou manter `valorLiquido` e expor campo novo?

## 7. Checklist de revisão (anti-presunção)

- [x] Não presumir que `xmlVNF − valorLiquido` é integralmente imposto.  
- [x] Não presumir que tributo destacado está pago.  
- [x] Não presumir que TaxRule = fiscal documental.  
- [x] Não presumir que AP Nomus = guia tipada.  
- [x] XML integral disponível para backfill (`xmlRaw`).  
- [ ] Decisões 1–10 acima — produto/finanças.
