# Relatório final — Central de Auditoria da Carteira e Fluxo Planejado

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Módulo** | Financeiro → Conciliação de Carteira → **Inteligência / Auditoria da Carteira** |
| **Data** | 2026-07-11 |
| **Tipo** | Relatório final de negócio + técnico (somente documentação) |
| **Status final** | **PRONTO** |
| **HEAD deste relatório** | `3cb8f74` |
| **Revalidação deste relatório** | Gates + scripts **PASS** (FIXTURE / motor puro) — alinhado à QA `d28d969`/`43f062c` |

> Relacionados:  
> [`portfolio-cash-forecast-audit-requirements.md`](./portfolio-cash-forecast-audit-requirements.md) ·  
> [`portfolio-cash-forecast-audit-qa-report.md`](./portfolio-cash-forecast-audit-qa-report.md) ·  
> [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md) ·  
> [`portfolio-intelligence-fulfillment-execution-report.md`](./portfolio-intelligence-fulfillment-execution-report.md)

---

## Resumo executivo

A Central de Auditoria da Carteira é uma **camada paralela e somente leitura** que mostra o caminho **Pedido → Documento de saída → NF → Contas a Receber → Baixa**, sem misturar previsão com dinheiro e sem deixar cabeçalho de NF parecer carteira.

**Regra-mãe:** planejar pelo pedido → confirmar pela entrega/documento → formalizar pelo CR → realizar pela baixa.

**Validação nesta data (FIXTURE / motor puro):**

| Gate / script | Resultado |
|---------------|-----------|
| `check:server-imports` | PASS |
| `check:frontend-server-imports` | PASS |
| `npm test` | PASS |
| `npm run build` | PASS |
| `check:browser-bundle` | PASS |
| PD 02339 | **PASS=15 FAIL=0** |
| Britânia | **PASS=65 FAIL=0** |
| Forecast audit | **PASS=11 FAIL=0** |

Não altera Fluxo de Caixa oficial, Contas a Receber oficial, Comissões, Relatório Presidencial, Precificação nem Engenharia/BOM.

---

# PARTE 1 — Negócio / Diretoria

## 1. Por que a tela existe

A reunião de carteira misturava três perguntas diferentes:

1. **Já virou dinheiro?** (CR / baixa)  
2. **Já saiu / foi faturado / foi atendido?** (documento, NF, itens)  
3. **Há risco técnico?** (NF maior que o pedido, produto errado, quantidade a mais)

Sem separar isso, “pedido aberto” vira “caixa mental”, e alerta de NF vira “mais receita”. A tela existe para **decidir com clareza**: cobrar comercial, limpar pedido antigo, faturar, gerar CR ou cobrar baixa — cada um no eixo certo.

## 2. Por que pedido não é caixa

Um pedido de venda (PD) é **compromisso comercial**, não dinheiro no banco.

Caixa exige:

- título em **Contas a Receber** (direito formalizado), e/ou  
- **baixa** (recebimento realizado).

Até lá, o valor do pedido pode estar em **futuro**, **atenção** ou **bloqueado**. A tela deixa isso explícito no aviso:

> Pedido de venda não é dinheiro confirmado…

## 3. Como o fluxo planejado nasce do pedido

O forecast (fluxo planejado de auditoria) nasce do **item do pedido**:

1. data prevista de entrega / faturamento (quando existir);  
2. condição de pagamento (quando existir);  
3. calendário do cliente (quando existir).

Sem condição de pagamento, a tela **não inventa prazo**: gera alerta e reduz confiança.

## 4. Como o fluxo evolui para documento, NF, CR e baixa

Hierarquia de evidência (a mais forte **substitui** a mais fraca no forecast):

```text
Pedido  →  Documento / NF  →  Contas a Receber  →  Baixa
 (previsão)   (entrega/fiscal)   (direito)           (caixa)
```

| Quando aparece… | O que muda na leitura |
|-----------------|------------------------|
| **Documento / NF** | Substitui previsão pura do pedido (ainda pode faltar CR) |
| **CR** | Substitui documento/pedido como âncora de vencimento |
| **Baixa** | Substitui CR → **caixa realizado** |
| **Pedido vencido sem evidência** | Vai para risco / bloqueio |

Esse forecast é **auditoria**, paralelo ao Fluxo de Caixa oficial — **não o substitui**.

## 5. Como a tela separa os quatro eixos

| Bloco | O que responde | Exemplos |
|-------|----------------|----------|
| **Financeiro confirmado** | Já é dinheiro ou título? | Recebido · CR aberto · Faturado sem CR |
| **Carteira operacional** | Ainda é pedido / planejamento? | Futuro · Presente/atenção · Vencido/bloqueado · Sem evidência |
| **Atendimento** | Entregamos o que vendemos? | % atendimento · parcial · não atendido |
| **Alertas técnicos** | Há risco de vínculo/quantidade? | Excesso · Produto fora · NF > pedido · Divergência |

Alertas técnicos levam o selo **“não soma carteira”** — não são dinheiro adicional.

## 6. Como a tela mostra se todos os itens foram entregues

No drawer do pedido, aba **Mapa de Atendimento** (primeira aba):

- lista **cada item** (SKU, qtde pedida, qtde atendida, restante, %);  
- status operacional resume: **totalmente atendido** (com ou sem excedente);  
- % de atendimento **não passa de 100%**.

## 7. Como a tela mostra entregas parciais

Quando só parte da quantidade do item aparece em documentos:

- status operacional = **parcialmente atendido**;  
- grid mostra restante e % < 100;  
- KPIs por vendedor contam pedidos parciais;  
- gargalo pode apontar “muitos pedidos parciais”.

## 8. Como a tela mostra excesso

Quando o documento manda **mais quantidade** do que o item pediu:

- o que cabe no pedido entra em “atendido” (até o teto);  
- o restante fica em **excesso** (alerta técnico);  
- cards/grid mostram quantidade/valor excedente com selo de alerta;  
- **não aumenta** o valor da carteira do pedido.

## 9. Como a tela mostra produto fora do pedido

Produto no documento que **não está** no PD:

- aparece em “produto fora do pedido”;  
- gera alerta técnico;  
- **não** fecha item inexistente nem aumenta valor do pedido.

É pista para conferir vínculo cruzado ou remessa errada.

## 10. Como a tela impede cabeçalho de NF de inflar carteira

NFs frequentemente têm valor de cabeçalho **maior** que o pedido. A Central:

- usa o **valor oficial do pedido** como base da carteira;  
- trata cabeçalho como **evidência fiscal / risco**;  
- valor atribuído ao pedido = cobertura item a item (capada);  
- alerta `NF_CABECALHO_MAIOR_PEDIDO` quando cabeçalho > pedido — **não soma** carteira.

Exemplo PD 02339: cabeçalho ~R$ 355.290 vs pedido R$ 158.000 — o pedido permanece R$ 158.000.

## 11. Como usar na reunião semanal (Comercial, PCP, Faturamento, Financeiro)

Roteiro sugerido (30–40 min):

1. **Filtro** no cliente / período / eixo de data (não misturar emissão de pedido com vencimento de CR).  
2. Bloco **Financeiro confirmado** — Financeiro fala de CR e baixas.  
3. Bloco **Carteira operacional** — Comercial/PCP olham futuro, atenção e bloqueados.  
4. Abrir sanfonas de risco (vencido/bloqueado) e **KPIs por vendedor** (gargalo).  
5. Abrir 2–3 pedidos no drawer: Mapa de Atendimento → itens → documentos → CR → frescor.  
6. Acordar ações: faturar, gerar CR, sincronizar baixas, limpar pedido antigo, corrigir vínculo.

## 12. Como interpretar confiança

Score **0–100**, ponderado por valor:

| Faixa | Leitura |
|-------|---------|
| **Alta (≈85–100)** | Evidência financeira forte (baixa / CR) |
| **Média (≈60–84)** | Planejamento ou faturamento com lacunas aceitáveis |
| **Baixa (≈35–59)** | Atenção / evidência fraca |
| **Muito baixa (≈0–34)** | Bloqueio / risco de superestimação |

Confiança é **operacional de auditoria**, não previsão perfeita de caixa.

## 13. Como interpretar pedido bloqueado

**Carteira vencida / bloqueada** = pedido antigo (ou vencido) **sem evolução suficiente** (sem NF/doc/CR).

- **Não tratar como caixa confiável.**  
- Prioridade: validar se ainda existe, cancelar, ou empurrar faturamento/CR.  
- É o principal risco de **superestimar** a carteira comercial.

## 14. Como interpretar CR aberto

**CR aberto** = direito financeiro formalizado, ainda não baixado.

- Já saiu do “só pedido”;  
- ainda **não** é caixa no banco;  
- forecast usa vencimento do CR (substitui previsão do pedido);  
- confiança tipicamente alta (~90).

## 15. Como interpretar baixa / caixa realizado

**Recebido / baixa** = dinheiro confirmado na conciliação.

- Substitui CR no forecast;  
- confiança máxima (~100);  
- se a baixa foi hoje/ontem e não aparece, olhar o painel de **frescor dos dados** (precisa sync de Contas a Receber + rebuild da run).

---

# PARTE 2 — Técnico / TI

## 1. Arquivos criados / alterados (camada de auditoria)

Principais entregas (não exaustivo de todo o histórico de conciliação):

| Área | Caminhos |
|------|----------|
| Motor de maturidade | `portfolioMaturityClassification.ts`, `portfolioMaturityAnalytics.ts` |
| Mapa de atendimento | `portfolioOrderFulfillmentMap.ts` |
| Forecast por maturidade | `portfolioCashForecastMaturity.ts` |
| Alertas operacionais | `portfolioOperationalDeviationAlerts.ts` |
| Frescor | `portfolioIntelligenceDataFreshness.ts` |
| API inteligência | `portfolioMaturityIntelligenceApi.ts`, rotas em `financePortfolioReconciliationRoutes` |
| Cliente | `financePortfolioReconciliationClient.ts` |
| Filtros / drilldown / copy | `portfolioIntelligenceFilters.ts`, `portfolioIntelligenceDrilldown.ts`, `portfolioIntelligenceUiCopy.ts`, `portfolioIntelligenceSellerKpiExplanations.ts` |
| UI | `src/components/finance/portfolio-reconciliation/PortfolioIntelligence*.tsx`, `PortfolioOrder*.tsx`, `PortfolioFulfillment*.tsx`, `PortfolioOperational*.tsx` |
| Docs | `docs/finance/portfolio-*-requirements.md`, `*-execution-report.md`, `*-qa-report.md` |
| Scripts | `tmp-audits/validate-pd02339-fulfillment-map.ts`, `validate-portfolio-intelligence-britania.ts`, `validate-portfolio-cash-forecast-audit.ts` |

## 2. Services criados (motores puros)

| Service | Função |
|---------|--------|
| `buildOrderFulfillmentMap` | Atendimento item a item + status FIN/OP + alertas |
| `buildPortfolioMaturityAnalytics` | Cards, grupos, rows, seller KPIs, totais |
| `buildPortfolioCashForecastMaturity` | Forecast paralelo por maturidade |
| `buildOperationalDeviationAlerts` | Alertas operacionais legíveis |
| `buildOrderDataFreshness` | Frescor / sync notice |
| `buildSellerKpis` / `resolveSellerMainBottleneck` | Qualidade por vendedor comercial do pedido |
| `portfolioMaturityIntelligenceApi` | Orquestra payload da API (read-only) |

UI **não** recalcula regra crítica — só exibe payload.

## 3. Payloads adicionados

Na listagem `/intelligence` e no detalhe do pedido:

- `cards`, `groups`, `rows`, `sellerKpis`, `totals`, `warnings`, `metricExplanations`  
- `cashForecast` (`lines`, `byMaturity`, `totals`, `warnings`)  
- No detalhe: `fulfillmentMap`, `operationalDeviationAlerts`, frescor / sync notices  
- Campos de row: `financialStatus`, `operationalStatus`, `fulfillmentPercent`, `excessQuantity`, `tagsAlerta`, etc.

## 4. Componentes frontend

| Componente | Papel |
|------------|-------|
| `PortfolioIntelligenceSection` | Orquestra tela, filtros, cards, sanfonas, KPIs, drawer |
| `PortfolioIntelligenceCards` | 3 blocos visuais |
| `PortfolioIntelligenceFiltersBar` | Filtros + chips + limpar |
| `PortfolioIntelligenceAccordions` | Sanfonas + grid |
| `PortfolioIntelligenceOrdersGrid` | Linhas com FIN/OP / alertas |
| `PortfolioIntelligenceOrderDrawer` | Drawer ~75vw; 1ª aba = Mapa |
| `PortfolioOrderFulfillmentMap` | Resumo + grids + conclusão |
| `PortfolioFulfillmentStatusCards` / Items / Documents / Receivables | Detalhe operacional |
| `PortfolioOrderDataFreshnessPanel` | Frescor |
| `PortfolioOperationalDeviationAlertsPanel` | Alertas operacionais |
| `PortfolioIntelligenceSellerKpis` | KPIs por vendedor (sem comissões) |
| `PortfolioIntelligenceHelpPopover` | Tooltips “?” |

## 5. Scripts de validação

```bash
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
npx tsx tmp-audits/validate-portfolio-cash-forecast-audit.ts
```

Preferência: run materializada no DB. Fallback: **FIXTURE** / motor puro.

## 6. Testes criados (principais)

- `portfolioOrderFulfillmentMap.test.ts`  
- `portfolioMaturityAnalytics.test.ts` / `portfolioMaturityClassification.test.ts`  
- `portfolioCashForecastMaturity.test.ts`  
- `portfolioOperationalDeviationAlerts.test.ts`  
- `portfolioIntelligenceDataFreshness.test.ts`  
- `portfolioIntelligenceFilters.test.ts` / `Drilldown` / `SellerKpis` / `Ui` / `MetricHelp`  
- `portfolioMaturityIntelligenceApi.test.ts`

## 7. Regras de cálculo (visão geral)

- **Um pedido = um status principal** (não duplica valor entre status exclusivos).  
- Alertas técnicos **coexistem** e **não somam** carteira.  
- Carteira total = Σ `orderValue` dos pedidos no filtro (uma vez cada).  
- Confiança média = Σ (score × valor) / Σ valor.

## 8. Regra de cap de quantidade

`attendedCapped = min(quantidade_no_documento_alocada, quantidade_pedida)`.

Percentual de atendimento = atendido capado / pedido, **≤ 100%**.

## 9. Regra de excesso

`excess = max(0, qtd_documento − qtd_pedida)` (por item / documento).

Entra em alerta `QUANTIDADE_EXCEDENTE_DOCUMENTO` e métricas de excedente — **não** no valor oficial do pedido.

## 10. Regra de produto fora

Itens de documento cujo produto **não** pertence ao pedido → `PRODUTO_FORA_DO_PEDIDO` / `itemsOutsideOrder` — valor fora **não** aumenta carteira.

## 11. Regra de cabeçalho

`nfeHeaderValue` é evidência/risco. Valor atribuído ao pedido vem da cobertura itemizada. Se cabeçalho > pedido → alerta; carteira permanece no valor do pedido.

## 12. Regra de forecast por maturidade

Fonte (substituição): `RECEIVED` > `RECEIVABLE` > `DOCUMENT_OR_NFE` > `ORDER_FUTURE` > `ORDER_ATTENTION` > `ORDER_BLOCKED`.

Âncoras de confiança típicas: 100 / 90 / 75 / 65 / 50 / ≤20.  
`isReliableCash` só para evidência financeira forte (baixa/CR conforme motor). Bloqueado **não** é caixa confiável.

## 13. Como debugar PD 02339

1. Rodar `npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts`.  
2. Com DB: filtrar run `1dc2ead7-533d-4ad4-bc4c-621061fa5623`, pedido **PD 02339**.  
3. Na UI: Inteligência → abrir drawer → aba Mapa.  
4. Conferir: valor pedido 158.000; attributed ≤ 158.000; header ~355.290 em alerta; FIN_CR_ABERTO; OP com excedente; conclusão em português.  
5. Se mapa vazio: sync Nomus + rebuild da conciliação (read-only na tela não grava).

## 14. Como rodar validações

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm test
npm run build
npm run check:browser-bundle
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
npx tsx tmp-audits/validate-portfolio-cash-forecast-audit.ts
```

## 15. Como garantir não regressão

- Escopo só em `portfolio-reconciliation` / `portfolio*maturity*` / `portfolio*fulfillment*` / `portfolioCashForecast*`.  
- **Não** importar `src/lib/commissions`.  
- **Não** alterar FinanceCashFlow / AR oficial / Presidencial / pricing / BOM.  
- Testes UI bloqueiam Prisma no frontend e JSON cru no drawer de inteligência.  
- Scripts Britânia/PD fixam totais e não-duplicação de status.

---

# Seção PD 02339

| Tema | Conteúdo |
|------|----------|
| **Problema original** | NF/documentos com cabeçalho maior que o pedido; excesso e produtos fora; risco de ler “R$ 355 mil” como carteira do PD de R$ 158 mil. |
| **O que a nova tela mostra** | Pedido = R$ 158.000; atendimento total em quantidade com excedente; status financeiro CR aberto; alertas técnicos separados; conclusão executiva em português. |
| **O que ainda depende de sync/rebuild** | Baixas recentes, novos vínculos Nomus e frescor dos títulos só aparecem após sincronizar Contas a Receber e reconstruir a run de conciliação. |
| **Como interpretar CR/baixa** | CR aberto = direito formalizado (não caixa). Baixa = caixa realizado. No PD 02339 fixture: CR coverage presente; baixa depende da materialização atual. |

Script: **PASS=15 FAIL=0** (FIXTURE nesta máquina).

---

# Seção Britânia

Totais esperados (`BRITANIA_INTELLIGENCE_EXPECTED`):

| Métrica | Valor |
|---------|-------|
| Pedidos | **31** |
| Valor total | **R$ 3.324.636,50** |
| Pedidos sem NF/doc/CR | **13** |
| Valor sem NF/doc/CR | **R$ 1.380.296,00** |
| Futuro + presente plausível | **R$ 495.460,00** (3 pedidos: PD 02607, 02740, 02739) |
| Vencido / bloqueado | **R$ 884.836,00** (10 pedidos, âncora PD 02159 = R$ 320.070) |

### PASS/FAIL dos scripts (revalidação 2026-07-11 — após QA `43f062c`)

| Script | Resultado |
|--------|-----------|
| `validate-pd02339-fulfillment-map.ts` | **PASS=15 FAIL=0** |
| `validate-portfolio-intelligence-britania.ts` | **PASS=65 FAIL=0** |
| `validate-portfolio-cash-forecast-audit.ts` | **PASS=11 FAIL=0** |
| Gates npm (imports / test / build / browser-bundle) | **PASS** (fail 0; browser-bundle OK) |

**Ressalva:** Britânia e PD 02339 rodaram em **FIXTURE** (DB local indisponível). Reexecutar com a run materializada em ambiente com Postgres.

---

# Limitações conhecidas

1. Forecast da Central **não** substitui o Fluxo de Caixa oficial.  
2. Sem sync recente, frescor pode mostrar “nenhuma baixa” mesmo com pagamento no ERP.  
3. KPIs por cliente (além de vendedor) ainda não têm grade dedicada.  
4. Validação visual browser com prints não faz parte deste relatório (há QA por contrato de código em `portfolio-cash-forecast-audit-qa-report.md`).

---

# Status final

**PRONTO**

A Central de Auditoria da Carteira está documentada, validada nos gates e scripts obrigatórios, e pronta para uso de diretoria/comercial/financeiro como camada de auditoria — sem alterar módulos oficiais.
