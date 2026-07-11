# Validação — Mapa de Atendimento PD 02339

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → Inteligência / Auditoria  
**Pedido:** PD 02339 (Britânia)  
**Valor oficial:** R$ 158.000,00  
**Run preferida:** `1dc2ead7-533d-4ad4-bc4c-621061fa5623`  
**Script:** `tmp-audits/validate-pd02339-fulfillment-map.ts`  
**Atualizado:** 2026-07-11

> Read-only. Não altera Fluxo de Caixa, Contas a Receber oficial, Comissões nem Relatório Presidencial.

---

## 1. Problema original

A leitura da carteira misturava três coisas diferentes:

1. **Financeiro** — já virou CR / caixa?  
2. **Operacional** — os itens do pedido foram entregues?  
3. **Alerta técnico** — cabeçalho de NF maior, excesso, produto fora.

No PD 02339, NFs/documentos vinculados tinham **cabeçalho total maior** que R$ 158.000. Sem o mapa, a impressão errada era: “o pedido vale a soma das notas” ou “a carteira deve incluir esse total”.

---

## 2. Como o mapa resolve

O motor `buildOrderFulfillmentMap`:

- casa **item a item** (`externalProductId`);
- limita atendimento ao **saldo do pedido** (cap ≤ 100%);
- calcula valor atribuído = qtde capped × **preço do pedido**;
- separa **excedente** e **produto fora**;
- mantém cabeçalho NF como **referência de risco**;
- classifica eixos `FIN_*`, `OP_*` e alertas técnicos de forma independente;
- gera **conclusão executiva** em português.

```bash
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
```

O script carrega (quando DB disponível): SalesOrder, itens, fatos da run, links NF, NomusNfe, NomusStockDocument(+itens), CRs (`NomusAccountsReceivable` / fatos). Se o banco estiver offline, usa fixture com a mesma lógica e CR de referência.

---

## 3. Resultado esperado

| Check | Esperado |
|-------|----------|
| Pedido encontrado | PD 02339 |
| Valor | R$ 158.000,00 |
| Itens | ≥ 1 (tipicamente 4) |
| Docs/NFs | vinculados |
| Valor atribuído | ≤ R$ 158.000 |
| % atendimento | ≤ 100 |
| Cabeçalho | pode ser > pedido, mas **não infla** carteira |
| CR | cobertura presente (`crCoverageExiste`) |
| Eixos | financeiro + operacional + alertas separados |
| Conclusão | texto legível, sem JSON cru |
| Critério | **PASS total · FAIL=0** |

---

## 4. Como interpretar financeiro × operacional × alerta

| Eixo | Pergunta | Exemplo PD 02339 |
|------|----------|------------------|
| **Financeiro** | Já é CR / recebido? | `FIN_CR_ABERTO` se houver título; `FIN_FATURADO_SEM_CR` se só NF/doc |
| **Operacional** | Itens entregues? | frequentemente `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` |
| **Alerta** | Risco de vínculo? | `NF_CABECALHO_MAIOR_PEDIDO`, `DIVERGENCIA_PRECO`, excesso, produto fora |

**Regra:** alerta **não** troca o status financeiro e **não** soma carteira.

Leitura correta em reunião:

- “Pedido operacionalmente atendido (com excesso no documento).”  
- “Financeiro ainda é CR aberto / ou faturado sem CR — **não é caixa** até a baixa.”  
- “Cabeçalho da NF é maior: isso é risco técnico, não receita extra do PD.”

---

## 5. Cuidado com cabeçalho de NF

1. Cabeçalho = total da nota (pode misturar outras linhas / remessas).  
2. Carteira do pedido = **R$ 158.000** (promessa comercial).  
3. Valor atribuído = atendimento item a item pelo preço do pedido.  
4. Se cabeçalho > atribuído/pedido → `NF_CABECALHO_MAIOR_PEDIDO` + `hasHeaderInflationRisk`.  
5. **Nunca** use soma de cabeçalhos como valor do pedido ou do forecast de carteira.

---

## 6. O que olhar quando houver baixa recente

1. Conferir **frescor** da run (sync de Contas a Receber + rebuild da conciliação).  
2. No mapa: `receivedValue` / `settlementDate` em `receivablesCoverage`.  
3. Status financeiro deve migrar para `FIN_RECEBIDO` quando aberto ≈ 0 e recebido > 0.  
4. Alertas técnicos (cabeçalho, excesso, fora) **podem permanecer** — baixa não “apaga” risco de vínculo.  
5. Se a baixa não aparecer: não inventar no mapa; pedir sync CR + rebuild e reexecutar o script.

---

## 7. Documentos relacionados

- [`portfolio-cash-forecast-audit-requirements.md`](./portfolio-cash-forecast-audit-requirements.md)  
- [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md)  
- [`pd02339-fulfillment-validation.md`](./pd02339-fulfillment-validation.md) (histórico)
