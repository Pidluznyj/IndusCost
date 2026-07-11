# Relatório de execução — Mapa de Atendimento (Central de Inteligência)

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → Inteligência da Carteira → **Mapa de Atendimento**  
**Data do relatório:** 2026-07-11  
**Status:** **PRONTO** (evidências em modo FIXTURE — Postgres local indisponível nesta máquina)  
**HEAD no momento do relatório (antes deste commit de doc):** `7c9a311`

> Complementa:  
> [`portfolio-order-fulfillment-map-requirements.md`](./portfolio-order-fulfillment-map-requirements.md) ·  
> [`portfolio-order-fulfillment-map-validation.md`](./portfolio-order-fulfillment-map-validation.md) ·  
> [`portfolio-intelligence-execution-report.md`](./portfolio-intelligence-execution-report.md) ·  
> [`pd02339-fulfillment-validation.md`](./pd02339-fulfillment-validation.md)

---

## Resumo executivo (1 página)

A Central de Inteligência já respondia **quanto** da carteira é financeiro, operacional ou bloqueado. O **Mapa de Atendimento** responde **como** um pedido foi (ou não) atendido **item a item**, com documentos de saída, CR e alertas técnicos — sem misturar isso com caixa.

Regra de ouro para diretoria e comercial:

> **Pedido de venda não é caixa.** Só vira dinheiro confirmado quando existe Contas a Receber (e, depois, baixa).  
> **Cabeçalho de NF, excedente e produto fora do pedido não aumentam a carteira do pedido.**

O mapa é **paralelo e somente leitura**. Não altera Fluxo de Caixa, Contas a Receber oficial, Comissões nem Relatório Presidencial.

Caso âncora: **PD 02339** (R$ 158.000) — itens atendidos com múltiplas NFs, excesso e produtos fora em alertas, cabeçalho NF maior que o pedido **sem** inflar valor. Piloto Britânia: **PASS=65 FAIL=0**.

---

# Parte A — Para diretoria (linguagem de negócio)

## 1. Por que a tela existe

A carteira comercial misturava três perguntas diferentes:

1. **Já virou dinheiro?** (CR / recebido)  
2. **Já saiu da fábrica / foi faturado?** (documento / NF / itens)  
3. **Há risco técnico?** (NF maior que o pedido, produto errado, quantidade a mais)

Sem separar isso, a reunião de carteira confunde “pedido aberto” com “recebível” e “alerta de NF” com “mais receita”. A tela existe para **decidir com clareza**: cobrar comercial, limpar pedido antigo, ou esperar o financeiro — sem inflar o caixa mental.

## 2. Por que pedido de venda não é caixa

Um PD é **compromisso comercial**. Caixa exige:

- título em Contas a Receber (CR), e/ou  
- baixa (recebido).

Até lá, o valor do pedido pode estar:

- **futuro / presente** (ainda só pedido), ou  
- **bloqueado** (antigo, sem NF/doc/CR — risco de superestimação).

A Central deixa isso explícito nos cards **Financeiro confirmado** vs **Carteira operacional**. Alertas (excesso, produto fora, cabeçalho) **não somam** carteira.

## 3. Como a tela mostra se o pedido foi entregue item a item

No drawer do pedido, aba **Mapa de Atendimento** (primeira aba):

- lista **cada item** do pedido (produto, qtde pedida, qtde atendida, restante, %);  
- qtde atendida **nunca passa** da pedida (cap);  
- status operacional resume: totalmente / parcialmente / não atendido / com excedente.

Assim a diretoria vê “entregamos o que foi vendido?” sem olhar só o valor do cabeçalho da NF.

## 4. Como a tela mostra entregas em múltiplos documentos de saída

O mesmo item pode aparecer em **várias NFs / documentos de estoque**. O mapa:

- agrupa cobertura **por documento**;  
- em cada item, lista os documentos usados e a quantidade alocada;  
- soma o valor **atribuído ao pedido** pelo preço do pedido — não pelo total do cabeçalho da NF.

Exemplo típico: uma NF cobre parte do item A; outra NF cobre o restante — o pedido fecha item a item, não “por NF inteira”.

## 5. Como a tela mostra excedentes

Quando o documento manda **mais quantidade** do que o item pediu:

- o que cabe no pedido entra em “atendido” (até o teto);  
- o resto fica em **excesso** (`surplusItems` / alerta “quantidade excedente”);  
- cards de alerta mostram quantidade/valor excedente com selo **alerta — não soma carteira**.

Excesso é risco operacional/fiscal de conferência, **não** aumento de receita da carteira do PD.

## 6. Como a tela mostra produtos fora do pedido

Produto no documento que **não está** no pedido:

- aparece em **produto fora do pedido** (`itemsOutsideOrder`);  
- gera alerta técnico;  
- **não** aumenta valor do pedido nem “fecha” item inexistente.

É pista para comercial/logística conferir vínculo ou remessa errada.

## 7. Como a tela impede que cabeçalho de NF infle carteira

NFs frequentemente têm valor de cabeçalho **maior** que o pedido (outras remessas, outras linhas, rateio incompleto). A tela:

- mostra o total de cabeçalho como **referência de risco**;  
- mostra o valor **atribuído** ao pedido (≤ valor oficial do PD);  
- mostra o trecho **não atribuído** separado;  
- cards de “cabeçalho não atribuído” ficam no bloco de **alertas**, não no financeiro.

**PD 02339:** cabeçalho ~R$ 355.290 × pedido R$ 158.000 → atribuído R$ 158.000.

## 8. Como a tela separa financeiro, operacional e alertas

| Bloco | Pergunta | Exemplos |
|-------|----------|----------|
| **Financeiro confirmado** | Já é CR / recebido? | Recebido, CR aberto |
| **Carteira operacional** | Ainda é só pedido? Quanto está faturado sem CR? | Futura, presente, faturado sem CR, % atendido item a item |
| **Alertas técnicos** | Há risco que **não** é dinheiro novo? | Excesso, produto fora, cabeçalho NF, divergência |

Cada pedido tem eixos separados no drawer: chip financeiro (`FIN_*`) + chip operacional (`OP_*`) + lista de alertas. Um pedido pode estar **operacionalmente atendido** e **financeiramente sem CR** ao mesmo tempo.

## 9. Como usar a tela para cobrar comercial

1. Filtrar / abrir sanfonas de **carteira futura/presente** e **faturado sem CR**.  
2. Abrir o pedido → Mapa: itens restantes, documentos, alerta de produto fora/excesso.  
3. Cobrar: emissão de NF/doc, vínculo correto, ou abertura de CR — com evidência item a item.  
4. Usar KPIs por vendedor (qualidade / confiança / excesso) para priorizar quem tem mais risco.

## 10. Como usar a tela para limpar pedidos antigos

1. Abrir bloco / sanfona **vencida / bloqueada** (ex.: Britânia PD 02159).  
2. Confirmar: sem NF, sem documento, sem CR + confiança baixa.  
3. Decidir: cancelar, reabrir comercialmente, ou investigar sync — **sem** contar esse valor como caixa.  
4. Após sync de CR + rebuild da conciliação, o **frescor dos dados** na tela indica se a visão está atualizada.

---

# Parte B — Para TI

## 1. Services criados / alterados

| Arquivo | Papel |
|---------|--------|
| `src/lib/finance/portfolioOrderFulfillmentMap.ts` | Motor puro: cobertura item/doc/CR, status FIN/OP, alertas, conclusão executiva |
| `src/lib/finance/portfolioMaturityAnalytics.ts` | Enriquece rows com mapa; KPIs operacionais e de alerta (excesso, fora, cabeçalho) |
| `src/lib/finance/portfolioMaturityClassification.ts` | Explicações / tags alinhadas a alertas técnicos |
| `src/lib/finance/portfolioMaturityIntelligenceApi.ts` | Lista + detalhe; monta `fulfillmentMap` no GET de pedido |
| `src/lib/finance/portfolioIntelligenceDataFreshness.ts` | Frescor run/CR (sync/rebuild notice) |
| `src/lib/finance/portfolioIntelligenceDrilldown.ts` | Ordem de sanfonas: financeiro → operacional → alertas |
| `src/lib/finance/portfolioIntelligenceUiCopy.ts` | Copy leiga (pedido ≠ caixa; alertas não somam) |
| `src/lib/financePortfolioReconciliationClient.ts` | Tipos/cliente HTTP do detalhe com `fulfillmentMap` |
| `src/lib/finance/financePortfolioReconciliationApi.server.ts` | Loaders read-only (fatos/meta); sem write do mapa |

Reutiliza o motor de alocação existente (`portfolioReconciliationAllocationEngine`) — **não** recalcula fatos de forma contraditória quando há materialização.

## 2. API alterada

Rotas em `src/lib/financePortfolioReconciliationRoutes.ts` (somente **GET**):

- `GET /api/finance/portfolio-reconciliation/intelligence` — cards, grupos, frescor, pedidos enriquecidos  
- `GET /api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId` — detalhe + **`fulfillmentMap`**

Sem POST/PATCH/DELETE nesta feature. Erros via `financeApiErrorJson`; falha no mapa não derruba o detalhe (mapa `null` + warning).

## 3. Payload `fulfillmentMap`

Tipo: `PortfolioOrderFulfillmentMap`

```ts
{
  financialStatus: PortfolioFinancialStatus;      // FIN_RECEBIDO | FIN_CR_ABERTO | FIN_FATURADO_SEM_CR | FIN_SEM_CR
  operationalStatus: PortfolioOperationalStatus;  // OP_TOTALMENTE_ATENDIDO | …_COM_EXCEDENTE | PARCIAL | NAO_ATENDIDO | …
  technicalAlerts: PortfolioTechnicalAlert[];
  fulfillmentSummary: FulfillmentSummary;         // orderValue, attributed*, excess*, nfeHeader*, flags
  orderItemsCoverage: OrderItemCoverageRow[];     // cap, remaining, documentsUsed
  stockDocumentsCoverage: StockDocumentCoverageRow[]; // matched / surplus / itemsOutsideOrder
  receivablesCoverage: ReceivableCoverageRow[];
  executiveConclusion: string;
  evidenceWarnings: string[];
}
```

Aliases legados (`attendedQuantity`, `unmatchedItems`, etc.) mantidos para UI estável.

## 4. Componentes frontend alterados

Sob `src/components/finance/portfolio-reconciliation/`:

| Componente | Mudança |
|------------|---------|
| `PortfolioIntelligenceSection.tsx` | Banner frescor + intro leiga |
| `PortfolioIntelligenceCards.tsx` | Três blocos; cards de alerta tracejados |
| `PortfolioIntelligenceAccordions.tsx` | Grupos financeiro / operacional / alertas |
| `PortfolioIntelligenceOrdersGrid.tsx` | Colunas opcionais de atendimento |
| `PortfolioIntelligenceOrderDrawer.tsx` | Aba **Mapa** primeiro; grids tipados; sem JSON cru |
| `PortfolioIntelligenceSellerKpis.tsx` | KPIs operacionais / excesso |
| `PortfolioIntelligenceHelpPopover.tsx` / filtros | “?” e filtros existentes |

## 5. Testes criados

- `portfolioOrderFulfillmentMap.test.ts` — cap, excesso, fora, cabeçalho, eixos  
- `portfolioMaturityAnalytics.test.ts` — excesso/fora/cabeçalho não aumentam carteira; Britânia  
- `portfolioMaturityIntelligenceApi.test.ts` — payload detalhe  
- `portfolioIntelligenceUi.test.ts` — três blocos, mapa no drawer, estados vazios  
- `portfolioIntelligenceDrilldown.test.ts` — ordem e sem duplicidade  
- Demais suite de inteligência (filtros, seller KPIs, metric help, freshness)

## 6. Scripts de validação

```bash
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
```

Com DB offline → **FIXTURE**. Com Postgres + run `1dc2ead7-533d-4ad4-bc4c-621061fa5623` → validação materializada.

## 7. Regra de cap de quantidade

Por item: `attendedQuantityCapped = min(soma alocada, orderedQuantity)`.  
Reforço no `buildOrderItemsCoverage` além do motor de alocação.  
`remainingQuantity = ordered − capped`.  
`fulfillmentPercentCapped ≤ 100`.

## 8. Regra de excesso

Fatos/status de surplus → `surplusItems` no documento + `excessQuantity` por produto.  
Entram em `totalExcessQuantity` / alertas `QUANTIDADE_EXCEDENTE_DOCUMENTO`.  
**Não** entram em `orderValue` nem em cards de status principal de carteira.

## 9. Regra de produto fora do pedido

Linhas de documento cujo `externalProductId` não existe no pedido → `itemsOutsideOrder` + alerta `PRODUTO_FORA_DO_PEDIDO`.  
Valor do pedido oficial permanece o do PD.

## 10. Regra de cabeçalho não atribuído

Por documento:  
`valueAttributedToOrder` (preço do pedido × qtde capped)  
`valueNotAttributedToOrder = max(0, nfeHeaderValue − attributed)` (visão de risco).  

No summary: `nfeHeaderTotalValue` vs `nfeHeaderAttributedToOrderValue` vs `nfeHeaderNotAttributedToOrderValue`.  
Flag `hasHeaderInflationRisk` + alerta `NF_CABECALHO_MAIOR_PEDIDO` quando cabeçalho > pedido.

## 11. Como debugar divergência

1. Confirmar **runId** e frescor (`dataFreshness` / isLatestRun).  
2. Abrir detalhe API do `salesOrderId` e inspecionar `fulfillmentMap` (não a UI).  
3. Comparar fatos materializados (`status`, `allocatedQuantity`, `nfeHeaderValue`) com itens do pedido.  
4. Rodar `validate-pd02339-fulfillment-map.ts` / Britânia com a mesma run.  
5. Se CR “sumiu”: verificar sync de Contas a Receber + **rebuild** da conciliação (mapa não inventa CR).  
6. Se valor “subiu”: checar se o número veio de **alerta/cabeçalho** e não de card financeiro.

## 12. Como manter a feature

- Manter motor **puro** e read-only; não escrever Prisma no mapa.  
- Qualquer novo alerta → tipo em `PortfolioTechnicalAlert` + label + card/accordion no bloco 3 + teste de “não soma carteira”.  
- Não misturar `FIN_*` e `OP_*` em um único status de UI.  
- Após mudanças de alocação/fatos, reexecutar os dois scripts `tmp-audits` + `portfolioOrderFulfillmentMap.test.ts`.  
- Não acoplar a Fluxo de Caixa / CR oficial / Comissões / Presidencial.

---

# Parte C — Caso PD 02339

## O que aconteceu

O pedido **PD 02339** (id `3915fa28-1947-4388-bb27-2699c3cbb516`, **R$ 158.000,00**) tinha NFs/documentos cujo **cabeçalho somado** (~R$ 355.290) era maior que o pedido, com **excesso de quantidade** e **produtos fora** do PD. Sem o mapa, a leitura intuitiva era “carteira/faturamento maior que o pedido”.

## O que o mapa mostra (fixture validada)

| Campo | Valor |
|-------|--------|
| Itens | 4 (produtos 452, 455, 456, 537) |
| NFs / docs | 3 / 3 |
| Financeiro | `FIN_FATURADO_SEM_CR` (sem CR inventado) |
| Operacional | `OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` |
| Excesso | qtde 23.000 (separado) |
| Fora do pedido | produtos 538 e 453 |
| Cabeçalho vs atribuído | 355.290 vs 158.000 |
| Conclusão executiva | presente (PT, eixos + alertas) |

## O que a tela deve mostrar

1. Cards: pedido na carteira operacional / faturado sem CR — **não** como recebido.  
2. Drawer → aba Mapa primeiro: itens, docs, excesso, fora, conclusão.  
3. Aba CR: estado vazio se não houver título (“Nenhum Contas a Receber…”).  
4. Alertas com “?” e texto de que **não somam carteira**.

## Como ler financeiro × operacional × alerta

- **Financeiro:** saiu NF/doc mas **ainda não há CR** → não é caixa.  
- **Operacional:** itens do pedido foram cobertos (com cap) e há excedente documentado.  
- **Alerta:** cabeçalho inflado, excesso e produto fora — conferência, **não** receita extra do PD.

---

# Parte D — Evidências (reexecução 2026-07-11)

| Check | Resultado |
|-------|-----------|
| `npm run check:server-imports` | **OK** |
| `npm run check:frontend-server-imports` | **OK** |
| `npm test` | **PASS** — 339 + 250 suítes agregadas; **fail 0** |
| `npm run build` | **OK** |
| `npm run check:browser-bundle` | **OK** — dist livre de Prisma |
| `validate-pd02339-fulfillment-map.ts` | **PASS=19 FAIL=0** (FIXTURE) |
| `validate-portfolio-intelligence-britania.ts` | **PASS=65 FAIL=0** (FIXTURE) |

**Britânia (fixture):** 31 pedidos · R$ 3.324.636,50 · 13 / R$ 1.380.296 sem NF/doc/CR · R$ 495.460 futuro+presente · R$ 884.836 bloqueado.

**Não regressão:** endpoints inteligência GET-only; sem migration/write nesta feature; módulos oficiais (Fluxo de Caixa, CR, Comissões, Presidencial) fora do escopo de alteração.

**Limitação:** DB `localhost:5432` indisponível — reexecutar scripts com Postgres + run Britânia materializada para fechar ciclo live.

---

## Próximos passos sugeridos

1. Revalidar scripts com DB e run `1dc2ead7-533d-4ad4-bc4c-621061fa5623`.  
2. Smoke browser: Britânia → PD 02339 (Mapa) e PD 02159 (vencido/bloqueado).  
3. Após sync CR + rebuild, conferir se PD 02339 passa a exibir CR real (sem inventar na fixture).
