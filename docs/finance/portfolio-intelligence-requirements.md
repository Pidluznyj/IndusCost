# Central de Inteligência da Carteira — Requisitos

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira (camada **paralela** / read-only)  
**Atualizado:** 2026-07-10  
**Status:** requisitos + classificador + analytics + **API HTTP read-only**. UI: etapa seguinte.

> Complementa: [`portfolio-reconciliation-architecture.md`](./portfolio-reconciliation-architecture.md), [`portfolio-reconciliation-handoff.md`](./portfolio-reconciliation-handoff.md), [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md) (eixos financeiro / operacional / alertas + mapa item a item).

---

## 1. Objetivo

Classificar cada pedido da conciliação materializada em:

1. **Um status principal único** (maturidade operacional)
2. **Tags de alerta** (múltiplas)
3. **Índice de confiança** 0–100 + rótulo
4. Resumo executivo, evidências e ação recomendada

A central responde: o que virou NF / documento / CR / recebimento; o que é carteira futura, presente, vencida/bloqueada; divergência técnica; confiança.

**Não** substitui Contas a Receber, Fluxo de Caixa, Faturamento, Comissões nem Relatório Presidencial.  
**Não** usa dados de comissão.

---

## 2. Fontes de dados (somente leitura)

| Fonte | Uso |
|-------|-----|
| `PortfolioReconciliationFact` / Run | Evidência materializada (prioridade) |
| `SalesOrder` / Item | Valor oficial, datas, condição de pagamento, vendedor (join on-read) |
| `SalesOrderNfeLink` / `NomusNfe` | Já refletidos na fato |
| `NomusStockDocument` / Item | Já refletidos na fato |
| CR Nomus (via fato rateada) | Aberto / recebido / vencimentos |
| `PortfolioCustomerPaymentRule` | Só se já aplicado na forecast da fato |

Se dado não existir: **"Informação não disponível na importação atual."**

---

## 3. Status principais (únicos por pedido)

Prioridade (primeira que casar vence):

| # | Status | Regra resumida |
|---|--------|----------------|
| 1 | `RECEBIDO` | Recebimento/baixa cobre o pedido (aberto ≤ 0 e recebido > 0) |
| 2 | `CR_ABERTO` | CR aberto > 0 e ainda não totalmente recebido |
| 3 | `FATURADO_SEM_CR` | NF e/ou documento de saída / alocação, sem CR |
| 4 | `CARTEIRA_FUTURA_PROVAVEL` | Sem NF/doc/CR; previsão **> 30 dias** à frente |
| 5 | `CARTEIRA_PRESENTE_ATENCAO` | Sem NF/doc/CR; previsão nos **próximos 30 dias** ou vencida há **≤ 60 dias** |
| 6 | `CARTEIRA_VENCIDA_BLOQUEADA` | Sem NF/doc/CR; previsão/pedido vencido há **> 60 dias** (ou antigo sem evolução) |
| 7 | `SEM_EVIDENCIA` | Dados insuficientes para classificar |

**Importante:** status principal **não** duplica valor nos cards — cada pedido entra em **um** bucket de maturidade. Tags não mudam o status.

Ex.: CR aberto + divergência técnica → status `CR_ABERTO` + tag `DIVERGENCIA_TECNICA`.

---

## 4. Tags de alerta (múltiplas)

| Tag | Quando |
|-----|--------|
| `DIVERGENCIA_TECNICA` | Status/alerta técnico (OVER_LINKED, AMBIGUOUS, DATA_QUALITY, etc.) |
| `NF_SEM_DOCUMENTO` | Tem NF, sem documento de saída |
| `DOCUMENTO_SEM_CR` | Tem documento/alocação, sem CR |
| `NF_CABECALHO_MAIOR_PEDIDO` | Soma cabeçalhos NF > valor do pedido |
| `DIVERGENCIA_PRECO` | PRICE_MISMATCH / alerta de preço |
| `SEM_CONDICAO_PAGAMENTO` | Condição de pagamento ausente na importação |
| `VINCULO_INCOMPLETO` | Vínculo parcial / HEADER_ONLY / incompleto |
| `PEDIDO_ANTIGO_SEM_EVOLUCAO` | Pedido antigo sem NF/doc/CR |

---

## 5. Indicador de confiança

| Situação | Faixa |
|----------|-------|
| RECEBIDO | 100 |
| CR_ABERTO | 85–95 |
| NF/documento sem CR | 60–75 |
| Pedido futuro sem NF/CR | 55–70 |
| Presente / atenção | 40–60 |
| Vencido sem NF/doc/CR | 5–30 |
| Antigo sem evidência | 5 |

Rótulos: `ALTA` (≥80) | `MEDIA` (60–79) | `BAIXA` (30–59) | `MUITO_BAIXA` (<30).

Ajustes evidenciais: − divergência técnica, − cabeçalho > pedido, − sem condição pagamento, − dias vencidos; + alocação itemizada, + CR, + recebimento.

---

## 6. Services

### Classificador
Arquivo: `src/lib/finance/portfolioMaturityClassification.ts`

Funções puras:

- `classifyPortfolioOrder(input)`
- `calculateOrderConfidence(input)`
- `buildOrderEvidenceTags(input)`
- `buildOrderExecutiveSummary(input)`
- `getMetricExplanation(metricKey)`

### Analytics / KPIs
Arquivo: `src/lib/finance/portfolioMaturityAnalytics.ts`

- Agrega `PortfolioReconciliationFact` por pedido
- Aplica o classificador
- Calcula `summaryCards`, `statusGroups`, `sellerKpis`, rows paginadas
- Auditoria Britânia: `tmp-audits/validate-portfolio-intelligence-britania.ts`

Sem migration. Sem alterar módulos oficiais.

---

## 7. Validação Britânia (run `1dc2ead7-…`)

| Esperado | Valor / pedidos |
|----------|-----------------|
| Pedidos | 31 |
| Total | R$ 3.324.636,50 |
| Sem NF/doc/CR | 13 / R$ 1.380.296,00 |
| Futura/presente | R$ 495.460,00 |
| Vencida/bloqueada | R$ 884.836,00 |
| Futuros (ex.) | PD 02607, PD 02740 → `CARTEIRA_FUTURA_PROVAVEL` |
| Presente (ex.) | PD 02739 → `CARTEIRA_PRESENTE_ATENCAO` |
| Antigos | PD 02159, 01604, 01953, 02092, 01954, 01955, 02080, 01603, 02158, 01562 → `CARTEIRA_VENCIDA_BLOQUEADA` |

---

## 8. DoR / DoD (classificador)

**DoR:** fato materializada; regras de status/tags/confiança acordadas; Britânia como fixture de referência.

**DoD deste passo:** service + testes unitários dos 10 cenários; checks verdes; sem alteração de AR/Fluxo/Comissões/Presidencial; commit/push.

---

## 9. Riscos conhecidos

- Cabeçalho NF ≠ valor do pedido (nunca carteira).
- Previsão ultrapassada ≠ título CR vencido.
- Vendedor/condição podem faltar na fato → join `SalesOrder` ou “Informação não disponível…”.
- Não inventar probabilidade de recebimento.
