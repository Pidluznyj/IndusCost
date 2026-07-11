# Validação PD 02339 — Mapa de Atendimento

**Projeto:** IndusCost / My Industry  
**Run:** `1dc2ead7-533d-4ad4-bc4c-621061fa5623`  
**Pedido:** PD 02339 (Britânia)  
**Valor oficial do pedido:** R$ 158.000,00  
**Script:** `tmp-audits/validate-pd02339-fulfillment-map.ts`  
**Atualizado:** 2026-07-11

> Read-only. Não altera Fluxo de Caixa, Contas a Receber, Comissões nem Relatório Presidencial.

---

## 1. Problema original

A Central de Inteligência misturava **status financeiro** com **atenção operacional** e **alertas de vínculo**.

No PD 02339 havia NFs/documentos de saída cujo **cabeçalho total** (soma dos valores líquidos das notas) era **maior** que o valor do pedido. Isso gerava a impressão errada de que o pedido “valeria” a soma das NFs, ou que a carteira deveria incluir esse total.

Perguntas que a maturidade financeira sozinha não respondia:

- Todos os itens do pedido foram entregues?
- Em quais documentos/NFs?
- Quanto excedeu o pedido?
- Quais itens do documento não pertencem a este pedido?

---

## 2. O que o mapa mostrou

O **Mapa de Atendimento** (`buildOrderFulfillmentMap`) separa:

| Eixo | Exemplo PD 02339 (fixture / run) |
|------|----------------------------------|
| Financeiro | Tipicamente `FIN_FATURADO_SEM_CR` se não houver CR nos fatos; ou `FIN_CR_ABERTO` / `FIN_RECEBIDO` se houver títulos |
| Operacional | `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` quando itens 100% + quantidade excedente |
| Alertas | `NF_CABECALHO_MAIOR_PEDIDO`, `DIVERGENCIA_PRECO`, `QUANTIDADE_EXCEDENTE_DOCUMENTO`, `PRODUTO_FORA_DO_PEDIDO`, … |

Resumo típico:

- Valor do pedido permanece **R$ 158.000**.
- Valor atribuído (qtde capped × preço do pedido) **≤ R$ 158.000**.
- Cabeçalho NF total **>** pedido → risco, não carteira.
- Itens do pedido com pedida / atendida / saldo / %.
- Documentos com valor atribuído vs fora; excedentes e produtos fora listados.

---

## 3. Por que não usar cabeçalho de NF como carteira

1. O cabeçalho é o **total da nota**, que pode incluir outros pedidos, fretes, impostos ou produtos não deste PD.
2. A carteira comercial do pedido é a **promessa** (R$ 158.000), não a soma das notas vinculadas.
3. Somar cabeçalhos **duplica / infla** leitura e pode coexistir com CR já aberto sobre outra base.
4. Atendimento operacional usa **linhas de documento** alocadas ao saldo do item — nunca o total do cabeçalho como “valor atendido”.

Regra: cabeçalho = **referência de risco** (`NF_CABECALHO_MAIOR_PEDIDO`). Valor atribuído = atendimento item a item pelo **preço do pedido**.

---

## 4. Como ler o resultado do script

```bash
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
```

1. **Fonte:** `DB` (run real) ou `FIXTURE` (se banco indisponível).
2. **Status financeiro vs operacional:** eixos separados — alerta técnico não troca o financeiro.
3. **Tabela de itens:** pedida ≤ atendida capped; % ≤ 100%; saldo ≥ 0.
4. **Tabela de documentos:** atribuído vs fora; excedentes; fora do pedido.
5. **CR:** só aparece se existir nos fatos; o script **não inventa** título.
6. **PASS/FAIL:** exige sem duplicidade de valor, cabeçalho sem inflar pedido, e atendimento item a item visível.

### Interpretação rápida

| Situação | Leitura |
|----------|---------|
| `OP_TOTALMENTE_ATENDIDO` | Itens 100% pelo saldo do pedido |
| `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` | Itens 100% **e** sobrou quantidade/produto no doc |
| `OP_PARCIALMENTE_ATENDIDO` | Ainda há saldo |
| Excedente SIM | Não aumenta carteira |
| Fora do pedido SIM | Produto no doc que não está no PD |
| CR ausente | Não inventar — financeiro `FIN_FATURADO_SEM_CR` ou `FIN_SEM_CR` |

Contrato completo: [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md).
