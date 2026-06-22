# Regras técnicas — Inteligência de Matéria-Prima (Pedidos de Venda)

**Projeto:** IndusCost / My Industry  
**Tela:** Pedidos de Venda → Inteligência de Matéria-Prima  
**Rota:** `/sales-orders/material-demand`  
**Status:** Blueprint de evolução (documentação apenas — sem alteração de código neste passo)  
**Atualizado:** 2026-06-17

> Complementar: [`NOMUS_SALES_ORDER_STATUS_MAPPING.md`](./NOMUS_SALES_ORDER_STATUS_MAPPING.md), [`../commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md`](../commercial/SALES_ORDER_AS_COMMERCIAL_SOURCE.md), `src/lib/materialDemandPlannedRealized.ts`, `src/lib/systemDataLineageAudit.ts` (feature `material-demand`).

---

## 0. Problema e motivação

A tela já existe e estima consumo de matéria-prima a partir de **pedidos de venda** (`SalesOrder`) e **BOM** (`ProductBOM` / explosão open book). Hoje, quando o filtro ou a agregação dependem demais de **`expectedDeliveryDate`**, pedidos **já faturados** podem continuar entrando na necessidade futura e **superestimar compra**.

O Nomus **não fornece status real de produção** alimentado de forma confiável. A nova regra usa apenas evidências disponíveis no IndusCost:

| Evidência | Fonte |
|-----------|--------|
| Emissão do pedido | `SalesOrder.issueDate` |
| Faturamento / NF | `nomusRawResponse.nfes[].dataProcessamento` |
| Quantidade vendida | `SalesOrderItem.quantity` |
| Quantidade faturada (item) | `itensPedido[].quantidadeFaturada` (aliases em `salesOrderNomusRaw.ts`) |
| Valor faturado (fallback) | NF + `totalNetValue` quando quantidade por item ausente |
| Prazo padrão de faturamento | **14 dias** (constante de negócio) |
| Estrutura do produto | `ProductBOM` / `buildOpenBookRawMaterialExplosionPerUnit` |

**Princípio:** não alterar pedidos Nomus, sync nem registros oficiais — apenas **classificar e calcular** sobre dados existentes.

---

## 1. Objetivo da tela

A tela responde, para o período e filtros aplicados:

| Pergunta | Saída |
|----------|--------|
| Quanto provavelmente precisaremos de matéria-prima? | **Necessidade recomendada** (saldo vivo × BOM) |
| Quanto seria o cenário conservador? | **Necessidade conservadora** (todos os saldos não faturados elegíveis, com risco sinalizado) |
| Quais pedidos geram incerteza? | **Itens em revisão** + motivo |
| Quanto de saldo vendido está parado sem faturamento? | **Potencial de faturamento não realizado** + **Saldo crítico > 30 dias** |

Endpoints atuais (não alterar neste blueprint):

- `GET /api/sales-orders/material-demand/summary`
- `GET /api/sales-orders/material-demand/planned-vs-realized`

Componente UI: `ProductMaterialDemandDashboard` (`context="sales-orders"`).

---

## 2. Conceitos principais

| Conceito | Definição |
|----------|-----------|
| **Saldo não faturado** | `quantidadeVendida − quantidadeFaturada` (por item). Se quantidade faturada indisponível: estimar via `valorLíquidoVendido − valorFaturado` com **confiança menor**. |
| **Saldo vivo** | Saldo não faturado de pedidos/itens cuja **janela viva** ainda não expirou (ver §4). Entra na **necessidade recomendada**. |
| **Saldo envelhecido** | Saldo não faturado com janela viva **expirada**. Não entra na compra recomendada; vai para revisão/risco. |
| **Necessidade recomendada** | `Σ (saldoVivo × consumoUnitárioBOM)` por matéria-prima. |
| **Necessidade conservadora** | `Σ (saldoNãoFaturadoElegível × consumoUnitárioBOM)` incluindo itens em risco, **rotulados** como tal. |
| **Diferença por incerteza** | `necessidadeConservadora − necessidadeRecomendada` (valor e/ou quantidade). |
| **Potencial de faturamento não realizado** | Valor estimado de saldo antigo não atendido (`saldo × preço líquido unitário` ou valor líquido aberto). |
| **Itens em revisão** | Pedidos/itens sem BOM, fallback de valor, status ambíguo ou saldo envelhecido — exigem olhar humano antes de comprar. |

### Janelas de tempo (constantes)

| Constante | Valor | Uso |
|-----------|-------|-----|
| `BILLING_CYCLE_DAYS` | **14** | Prazo padrão para esperar NF após emissão ou após última NF parcial |
| `CRITICAL_AGING_DAYS` | **30** | Saldo fora da janela viva há mais de 30 dias → KPI crítico / potencial parado |

---

## 3. Regras de status estimado

Status calculados pelo motor (não persistidos no Nomus). Um item de pedido recebe **um** status principal; em caso de empate, priorizar o mais conservador para **compra recomendada**.

### 3.1 Atendido totalmente

| Campo | Regra |
|-------|--------|
| **Condição** | `quantidadeFaturada ≥ quantidadeVendida` **ou** valor faturado compatível com valor líquido total (tolerância documentada) quando só houver valor |
| **Tratamento** | **Não** entra na necessidade futura (recomendada nem conservadora automática) |

### 3.2 Aberto dentro do ciclo

| Campo | Regra |
|-------|--------|
| **Condição** | Pedido **sem NF processada** e `issueDate + 14 dias ≥ hoje` |
| **Tratamento** | Saldo = quantidade vendida inteira; entra na **necessidade recomendada** |

### 3.3 Aberto atrasado sem NF

| Campo | Regra |
|-------|--------|
| **Condição** | Pedido **sem NF** e `issueDate + 14 dias < hoje` |
| **Tratamento** | **Não** entra na compra recomendada; entra em **revisão/risco**; **pode** entrar no modo conservador |

### 3.4 Parcial atendido — saldo vivo

| Campo | Regra |
|-------|--------|
| **Condição** | `0 < quantidadeFaturada < quantidadeVendida` (ou equivalente em valor) **e** `ultimaDataNF + 14 dias ≥ hoje` |
| **Tratamento** | Necessidade recomendada apenas pelo **saldo restante** |

### 3.5 Parcial atendido — saldo envelhecido

| Campo | Regra |
|-------|--------|
| **Condição** | Parcial faturado **e** `ultimaDataNF + 14 dias < hoje` |
| **Tratamento** | **Não** entra na compra recomendada; **revisão**; se `diasForaDaJanela > 30`, contabiliza em **potencial de faturamento não realizado** |

### 3.6 Saldo crítico não atendido > 30 dias

| Campo | Regra |
|-------|--------|
| **Condição** | Existe saldo não faturado **e** `hoje − dataFimJanelaViva > 30` |
| **Tratamento** | **Não** entra automaticamente na compra recomendada; KPI de **potencial de faturamento parado** |

### 3.7 Sem BOM

| Campo | Regra |
|-------|--------|
| **Condição** | Produto sem estrutura válida (`ProductBOM` / explosão vazia) |
| **Tratamento** | **Não** calcular consumo; enviar para **itens em revisão** (já alinhado a `PLANNED_REALIZED_MISSING_BOM_WARNING`) |

### 3.8 Cancelado / finalizado

| Campo | Regra |
|-------|--------|
| **Condição** | `SalesOrder.status = CANCELLED` ou itens cancelados (cód. 6 Nomus / regras em `salesOrderNomusRaw.ts`) |
| **Tratamento** | **Não** gera necessidade |

### 3.9 Nomes parecidos / produção

| Regra | Detalhe |
|-------|---------|
| **Não inferir produção** | Sem OP confiável → não criar status “em produção” |
| **Não usar só `expectedDeliveryDate`** | Usar como prioridade logística, não como única base de consumo (§5) |

---

## 4. Cálculos

### 4.1 Saldo não faturado

```
saldoNaoFaturado = max(0, quantidadeVendida − quantidadeFaturada)
```

**Fallback (confiança `MEDIUM`):** quando `quantidadeFaturada` ausente por item:

```
proporcaoFaturada = min(1, valorFaturado / valorLiquidoVendido)
saldoNaoFaturado ≈ quantidadeVendida × (1 − proporcaoFaturada)
```

Reutilizar lógica existente em `resolveRealizedOrderItemQuantity` como referência; estender com flag `confidence: HIGH | MEDIUM`.

### 4.2 Datas e janelas

| Cenário | Fim da janela viva (`dataFimJanelaViva`) |
|---------|------------------------------------------|
| Sem NF | `issueDate + 14 dias` |
| Com NF parcial | `ultimaDataNF + 14 dias` (`extractProcessedNfeSummaries`) |
| Atendido total | N/A (saldo = 0) |

```
diasForaDaJanela = max(0, diasEntre(hoje, dataFimJanelaViva))   // se hoje > fim
saldoVivo = saldoNaoFaturado se hoje ≤ dataFimJanelaViva senão 0
```

### 4.3 Potencial não realizado

```
potencialNaoRealizado = saldoNaoFaturadoAntigo × precoLiquidoUnitario
```

Alternativa: `valorLiquidoAbertoEstimado` quando unidade/preço unitário incertos.

Aplicar quando status ∈ { aberto atrasado sem NF, parcial envelhecido, saldo crítico > 30 dias }.

### 4.4 Necessidade de matéria-prima

Por item de produto com BOM válida:

```
consumoMP = saldoQuantidade × explosaoBOM.quantidadePorUnidade   // por MP
```

Agregações:

| Modo | Fórmula |
|------|---------|
| **Recomendado** | `Σ consumoMP(saldoVivo)` |
| **Conservador** | `Σ consumoMP(saldoNaoFaturadoElegível)` com flag `atRisk: true` onde aplicável |
| **Diferença incerteza** | conservador − recomendado |

### 4.5 Confiabilidade da estimativa

Score derivado (exemplo):

- `HIGH`: quantidade faturada por item + BOM completa + NF com `dataProcessamento`
- `MEDIUM`: fallback valor ou BOM parcial
- `LOW`: sem NF, sem BOM, ou saldo só por valor com divergência

---

## 5. Período do relatório

### 5.1 Problema atual

`MaterialDemandDateBasis` suporta `issueDate` e `expectedDeliveryDate`. **Não** usar apenas `expectedDeliveryDate` como única base de consumo futuro.

### 5.2 Janela estimada de consumo (por pedido/item)

| Situação | Início | Fim |
|----------|--------|-----|
| Sem NF | `issueDate` | `issueDate + 14 dias` |
| Parcial com NF | `ultimaDataNF` | `ultimaDataNF + 14 dias` |
| Atendido total | — | excluído do período futuro |

`expectedDeliveryDate`: usar como **indicador logístico** (ordenar, alertar atraso de entrega), **não** como substituto da janela de faturamento.

### 5.3 Filtro de período do usuário

Quando `startDate` / `endDate` informados:

```
incluirItem = overlap(janelaEstimadaConsumo, [startDate, endDate]) ≠ ∅
```

Implementação sugerida: função pura `materialDemandConsumptionWindow(order, item)` retornando `{ start, end, basis }`.

---

## 6. Modos de cálculo

| Modo | Escopo de saldo | Uso |
|------|-----------------|-----|
| **Recomendado** (padrão) | Apenas **saldo vivo** | Compra operacional |
| **Conservador** | Todos os saldos não faturados elegíveis | Planejamento / stress; rotular riscos |
| **Enxuto** | Pedidos recentes (ex.: emissão ≤ 14 dias) | **Fase futura** — opcional |

Toggle na UI alinhado a `MaterialDemandInvoicingScope` existente (`all` | `invoiced` | `portfolio`), evoluindo para modo explícito `recommended` | `conservative`.

---

## 7. Cards (KPIs) necessários

| Card | Métrica |
|------|---------|
| Necessidade recomendada | Qtd/valor MP, modo recomendado |
| Necessidade conservadora | Qtd/valor MP, modo conservador |
| Diferença por incerteza | Δ conservador − recomendado |
| Itens em revisão | Contagem pedidos/itens + link para tabela |
| Potencial de faturamento não realizado | R$ saldo antigo não faturado |
| Saldo crítico > 30 dias | R$ ou qtd, pedidos fora da janela há > 30 dias |
| Itens sem BOM | Contagem produtos sem estrutura |
| Confiabilidade da estimativa | % HIGH / MEDIUM / LOW ou score único |

Reutilizar padrão visual de `MaterialDemandKpiGrid` / `MaterialDemandPlannedRealizedPanel`.

---

## 8. Tabelas necessárias

| Tabela | Conteúdo |
|--------|----------|
| **Estimativa por matéria-prima** | MP, unidade, necessidade recomendada, conservadora, custo, % do total |
| **Pedidos considerados** | Pedido, cliente, status estimado, saldo vivo, janela, MP impactada |
| **Saldos antigos não atendidos** | Pedidos com saldo crítico / potencial não realizado |
| **Itens em revisão** | Motivo: sem BOM, fallback valor, atrasado sem NF, parcial envelhecido |

Export CSV (fase 4): estender `materialDemandExport.ts` com colunas de status estimado e confiança.

---

## 9. Auditoria e explicação na UI

Textos obrigatórios (drawer / banner — alinhar a `materialDemandPlannedRealizedAuditCopy.ts`):

1. **Não existe status real de produção no Nomus** integrado a este cálculo.
2. A estimativa combina **pedido**, **NF** (`dataProcessamento`), **saldo vendido vs faturado** e janela de **14 dias**.
3. Saldos parciais **antigos** não distorcem a compra recomendada.
4. Saldos antigos viram **potencial de faturamento não realizado**, não demanda automática de MP.
5. Realizado fiscal ≠ baixa de estoque (`PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE`).

---

## 10. Fases de implementação

| Fase | Entrega | Arquivos-alvo (referência) |
|------|---------|----------------------------|
| **1** | Motor puro: status estimado, saldo vivo/envelhecido, janelas, agregação MP | Novo: `salesOrderRawMaterialIntelligence.ts` + testes |
| **2** | Endpoint/payload: estender summary e planned-vs-realized **ou** novo sub-recurso | `server.ts`, tipos em `materialDemandPlannedRealizedTypes.ts` |
| **3** | UI: cards, modos recomendado/conservador, tabelas | `ProductMaterialDemandDashboard.tsx`, `MaterialDemandDashboardPanels.tsx` |
| **4** | CSV, drawer auditoria, textos | `materialDemandExport.ts`, `materialDemandPlannedRealizedAuditCopy.ts` |
| **5** | Regressão: `materialDemandPlannedRealized.test.ts`, `materialDemandFilters.test.ts`, lint, build | CI local |

**Fora de escopo desta evolução:** alterar sync Nomus, schema `SalesOrder`, status de produção real, compras automáticas.

---

## 11. Decisões técnicas registradas

| # | Decisão | Motivo |
|---|---------|--------|
| D1 | Janela de faturamento = **14 dias** fixos | Prazo operacional padrão; sem dado Nomus de produção |
| D2 | Critério fiscal (NF + qtd/valor faturado) prevalece sobre `expectedDeliveryDate` para MP | Evita superestimar compra em pedidos já faturados |
| D3 | Fallback valor quando sem qtd faturada por item | Já usado em `resolveRealizedOrderItemQuantity`; confiança menor |
| D4 | Status estimado **calculado**, não gravado | Sem migration; reprodutível a partir de `SalesOrder` + raw |
| D5 | Modo conservador **separado** e rotulado | Não misturar risco com recomendação operacional |
| D6 | 30 dias para “crítico / potencial parado” | KPI gerencial distinto da janela de 14 dias |
| D7 | Reutilizar explosão BOM existente | `buildOpenBookRawMaterialExplosionPerUnit` — não duplicar motor de engenharia |
| D8 | Não criar hardcode por cliente/produto | Regras genéricas por evidência |

---

## 12. Referência rápida — estado atual vs alvo

| Aspecto | Hoje | Alvo |
|---------|------|------|
| Base de período | `issueDate` ou `expectedDeliveryDate` | Janela estimada de consumo (§5) |
| Previsto vs realizado | NF binária + portfolio | Saldo vivo + status estimado |
| Pedido faturado no prazo de entrega mas filtro por entrega futura | Pode inflar previsto | Excluído se atendido totalmente |
| KPI risco saldo parado | Parcial (`notInvoicedOrdersCount`) | Potencial não realizado + crítico 30d |
| Modos | `invoicingScope` | + recomendado / conservador |

---

## 13. Critérios de aceite da implementação (futura)

- [ ] Pedido 100% faturado não entra na necessidade recomendada.
- [ ] Pedido sem NF dentro de 14 dias da emissão entra com saldo total.
- [ ] Pedido sem NF após 14 dias não entra na recomendada; aparece em revisão.
- [ ] Parcial com NF recente: só saldo restante na recomendada.
- [ ] Parcial com NF antiga (> 14d): revisão + potencial não realizado se > 30d.
- [ ] Sem BOM: revisão, sem consumo automático.
- [ ] Cancelado: excluído.
- [ ] Filtro de período usa overlap com janela estimada, não só data de entrega.
- [ ] Testes unitários cobrem cada status §3 sem dados reais de cliente.
- [ ] Lint e build passam; nenhuma alteração em sync Nomus.
