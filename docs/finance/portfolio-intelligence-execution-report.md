# Relatório de execução — Central de Inteligência da Carteira

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → **Inteligência da Carteira**  
**Data do relatório:** 2026-07-10  
**Status geral:** **PRONTO**  
**HEAD no momento do relatório:** `9504aa64b9a438a1ade4c23036af253a07970b60`  

> Complementa: [`portfolio-intelligence-requirements.md`](./portfolio-intelligence-requirements.md), [`portfolio-intelligence-api.md`](./portfolio-intelligence-api.md), [`portfolio-intelligence-handoff.md`](./portfolio-intelligence-handoff.md), [`portfolio-intelligence-release-checklist.md`](./portfolio-intelligence-release-checklist.md).

---

## 1. Resumo executivo

Foi criada uma **camada paralela e somente leitura** que classifica cada pedido da conciliação materializada por **maturidade**: o que já virou dinheiro financeiro (CR/recebido), o que ainda é só pedido comercial, e o que precisa validação (carteira antiga sem NF/documento/CR).

A regra de ouro: **pedido de venda não é dinheiro confirmado até virar Contas a Receber.**

A tela evita inflar a visão de caixa misturando previsão comercial com título financeiro. Foi validada com o piloto **Britânia** (31 pedidos / R$ 3.324.636,50) e passou nos checks de build/testes/imports.

**Não** altera Fluxo de Caixa, Contas a Receber oficial, Comissões nem Relatório Presidencial.

---

## 2. Problema de negócio resolvido

Antes, a carteira comercial misturava:

- pedidos já convertidos em CR;
- pedidos futuros plausíveis;
- pedidos antigos sem evolução (sem NF, sem documento, sem CR).

Isso gerava risco de **fluxo de caixa mentalmente inflado**: tratar PD como se fosse recebível.

A Central responde, em linguagem de reunião:

1. Quanto é a carteira total analisada.  
2. Quanto já é financeiro confirmado (CR / recebido).  
3. Quanto ainda é só pedido (futuro / atenção).  
4. Quanto está bloqueado para revisão.  
5. Onde está o risco de superestimação.  
6. Qual a confiança da evidência.  
7. Como está a qualidade por vendedor.

---

## 3. Visão geral da solução

```
Run materializada (PortfolioReconciliationFact)
        │
        ▼
Classificador (status único + tags + confiança)
        │
        ▼
Analytics (cards, grupos, seller KPIs, paginação)
        │
        ▼
API GET read-only
        │
        ▼
UI (cards, filtros, sanfonas, grid, drawer, “?”)
```

---

## 4. Histórico Git — commits dos 14 prompts

| # | Hash | Mensagem | Prompt |
|---|------|----------|--------|
| 1 | `967fed3` | classifica maturidade… (+ requirements) | Inventário/requisitos + classificador |
| 2 | `a938e9e` | agrega maturidade e KPIs… | Analytics / cards |
| 3 | `3b0972a` | script de auditoria Britânia | Script Britânia (junto ao analytics) |
| 4 | `bb2c2dc` | API read-only | Endpoints HTTP |
| 5 | `3b4bfe1` | UI na conciliação | Cards + seção + aba |
| 6 | `5d7e3ea` | drilldown sanfona | Sanfonas + grid |
| 7 | `e0d314a` | drawer de detalhe | Drawer 7 abas |
| 8 | `36c2675` | filtros avançados | Filtros + eixo de data |
| 9 | `09a5f91` (+ `8603c74`) | KPIs por vendedor | Qualidade por vendedor |
| 10 | `09a3bc2` | ajuda leiga de métricas | Tooltips “?” padronizados |
| 11 | `dfde412` | valida piloto Britânia | Validação financeira completa |
| 12 | `713de2b` | isolamento + handoff | Revisão técnica / isolamento |
| 13 | `4b853a3` | polimento visual executivo | UX / textos leigos |
| 14 | `bedb440`…`c0ff6d5` | checklist de liberação QA | QA final / liberação |

**Notas de agrupamento:**

- O **prompt de inventário/plano** gerou `portfolio-intelligence-requirements.md` no mesmo commit do classificador (`967fed3`), não em commit separado.  
- O **script Britânia inicial** (`3b0972a`) saiu logo após o analytics; a validação completa veio em `dfde412`.  
- O **ajuste de teste de comissões** (`8603c74`) é correção de assert do prompt 9, não feature nova.  
- Os commits `6a114e1` / `c0ff6d5` só anotam hash no checklist.

---

## 5. Explicação dos 14 prompts

### Prompt 1 — Inventário técnico + requisitos + classificador

- **Objetivo negocial:** Definir o que a tela deve responder e como classificar maturidade sem misturar com financeiro oficial.  
- **Técnico:** Documento de requisitos; motor `classifyPortfolioOrder` / `resolveMaturityStatus` / confiança / tags.  
- **Arquivos:** `docs/finance/portfolio-intelligence-requirements.md`, `src/lib/finance/portfolioMaturityClassification.ts`, `*.test.ts`.  
- **Regras:** 7 status principais exclusivos; tags múltiplas; score 0–100; pedido sem NF/doc/CR classificado por janela de previsão (futuro >30d, presente ≤30d ou atraso ≤60d, bloqueado >60d / antigo).  
- **Na tela:** Base invisível — alimenta todos os cards depois.  
- **Testes:** `portfolioMaturityClassification.test.ts` (incl. cenários Britânia futura vs vencida).  
- **Evidência:** Commit `967fed3`.  
- **Atenção:** Classificação é evidencial/operacional, não título contábil.

### Prompt 2 — Analytics (agregação e cards)

- **Objetivo:** Transformar pedidos classificados em KPIs de carteira.  
- **Técnico:** `buildPortfolioMaturityAnalytics` — rows, summaryCards, statusGroups, totais, conversões, risco, confiança ponderada.  
- **Arquivos:** `portfolioMaturityAnalytics.ts`, `portfolioMaturityAnalytics.test.ts`.  
- **Regras:** Um pedido → um status; soma dos status = carteira total; `RISCO_SUPERESTIMACAO` = valor da carteira vencida/bloqueada (alerta).  
- **Na tela:** Números dos cards.  
- **Testes:** não-duplicidade, conversão CR/doc, risco, confiança ponderada, fixture Britânia.  
- **Evidência:** `a938e9e`.

### Prompt 3 — Script de auditoria Britânia (inicial)

- **Objetivo:** Provar números do piloto sem maquiar.  
- **Técnico:** `tmp-audits/validate-portfolio-intelligence-britania.ts` (force-add; pasta gitignored).  
- **Arquivos:** script + evolução em `dfde412`.  
- **Na tela:** N/A (CLI).  
- **Evidência:** `3b0972a` → depois `dfde412` (PASS=65).

### Prompt 4 — API HTTP read-only

- **Objetivo:** Expor inteligência sem write.  
- **Técnico:**  
  - `GET /api/finance/portfolio-reconciliation/intelligence`  
  - `GET .../intelligence/orders/:salesOrderId`  
  - Parse de filtros; loaders Prisma read-only; permissões da conciliação.  
- **Arquivos:** `portfolioMaturityIntelligenceApi.ts`, `financePortfolioReconciliationApi.server.ts`, `financePortfolioReconciliationRoutes.ts`, `portfolio-intelligence-api.md`.  
- **Regras:** GET only; `pageSize` ≤ 200; 400 amigável; 500 sem stack.  
- **Evidência:** `bb2c2dc` + testes de API.

### Prompt 5 — UI: aba, seção e cards

- **Objetivo:** Gestor ver maturidade em 10 segundos.  
- **Técnico:** Aba na página de conciliação; `PortfolioIntelligenceSection` + `Cards` + help popover inicial.  
- **Arquivos:** `FinancePortfolioReconciliationPage.tsx`, `PortfolioIntelligenceSection.tsx`, `PortfolioIntelligenceCards.tsx`, `PortfolioIntelligenceHelpPopover.tsx`, client DTOs.  
- **Na tela:** Cards com valor, contagem, “?”.  
- **Evidência:** `3b4bfe1`.

### Prompt 6 — Sanfonas + grid

- **Objetivo:** Drilldown por status.  
- **Técnico:** Accordions + OrdersGrid; clique no card abre sanfona.  
- **Arquivos:** `PortfolioIntelligenceAccordions.tsx`, `OrdersGrid.tsx`, `portfolioIntelligenceDrilldown.ts`.  
- **Na tela:** Lista de pedidos por maturidade.  
- **Evidência:** `5d7e3ea`.

### Prompt 7 — Drawer de detalhe

- **Objetivo:** Explicar um PD (ex.: 02159) sem inventar dado.  
- **Técnico:** Drawer 7 abas; empty states honestos; condição de pagamento só se importada.  
- **Arquivos:** `PortfolioIntelligenceOrderDrawer.tsx`.  
- **Na tela:** Resumo, pedido, itens, NF/saída, CR, pagamento, histórico.  
- **Evidência:** `e0d314a`.

### Prompt 8 — Filtros avançados

- **Objetivo:** Recortar por cliente, vendedor, status, confiança, tags, evidências, eixo de data.  
- **Técnico:** `portfolioIntelligenceFilters.ts` + `FiltersBar`; aviso emissão ≠ vencimento CR.  
- **Arquivos:** filters + bar + section wiring.  
- **Evidência:** `36c2675`.

### Prompt 9 — KPIs por vendedor

- **Objetivo:** Cobrar qualidade comercial (conversão, stuck, risco) **sem comissões**.  
- **Técnico:** `buildSellerKpis`; tabela clicável filtra a visão.  
- **Arquivos:** `PortfolioIntelligenceSellerKpis.tsx`, `portfolioIntelligenceSellerKpiExplanations.ts`, analytics.  
- **Evidência:** `09a5f91` (+ `8603c74` assert).

### Prompt 10 — Ajuda leiga padronizada (“?”)

- **Objetivo:** Explicar métricas em reunião sem jargão.  
- **Técnico:** `MetricHelpTooltip` com 5 seções + aviso operacional; textos em `getMetricExplanation`.  
- **Arquivos:** HelpPopover, classification explanations, metric help tests.  
- **Evidência:** `09a3bc2`.

### Prompt 11 — Validação financeira Britânia completa

- **Objetivo:** Garantir que a conta bate antes de generalizar.  
- **Técnico:** Constantes `BRITANIA_INTELLIGENCE_EXPECTED`; script PASS/FAIL por regra; fixture offline.  
- **Arquivos:** analytics expected + script + testes.  
- **Evidência:** `dfde412` — **PASS=65 FAIL=0**.

### Prompt 12 — Revisão técnica / isolamento

- **Objetivo:** Garantir read-only, permissões, paginação, erros, sem full-scan desnecessário.  
- **Técnico:** filtro cliente no Prisma; `RISCO` como `isAlertCard`; erros 5xx genéricos; handoff.  
- **Arquivos:** server loader, UI notices, `portfolio-intelligence-handoff.md`.  
- **Evidência:** `713de2b`.

### Prompt 13 — Polimento visual executivo

- **Objetivo:** Tela moderna e legível para leigo.  
- **Técnico:** Copy leiga (`portfolioIntelligenceUiCopy.ts`); hero cards; badges de confiança; empty states.  
- **Sem** mudança de cálculo.  
- **Evidência:** `4b853a3`.

### Prompt 14 — QA final / checklist de liberação

- **Objetivo:** Liberar deploy com checklist PASS/FAIL.  
- **Técnico:** Documento de liberação; reexecução da suíte.  
- **Arquivos:** `portfolio-intelligence-release-checklist.md`.  
- **Evidência:** `bedb440`…`c0ff6d5`.  
- **Pendência documentada:** revalidar Britânia com DB na run materializada no ambiente de deploy.

---

## 6. Arquitetura técnica

### Services backend

| Arquivo | Papel |
|---------|--------|
| `portfolioMaturityClassification.ts` | Status, tags, confiança, explanations |
| `portfolioMaturityAnalytics.ts` | Agregação, cards, groups, seller KPIs |
| `portfolioMaturityIntelligenceApi.ts` | Parse filtros + payload (sem Prisma) |
| `financePortfolioReconciliationApi.server.ts` | Loaders Prisma read-only |
| `financePortfolioReconciliationRoutes.ts` | Registro Express GET |
| `financePortfolioReconciliationPermissions.ts` | Permissões Financeiro/conciliação |

### Endpoints

| Método | Path |
|--------|------|
| GET | `/api/finance/portfolio-reconciliation/intelligence` |
| GET | `/api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId` |

### Componentes frontend

`PortfolioIntelligenceSection`, `Cards`, `FiltersBar`, `Accordions`, `OrdersGrid`, `OrderDrawer`, `SellerKpis`, `HelpPopover` / `MetricHelpTooltip`, copy em `portfolioIntelligenceUiCopy.ts`.

### Agregação por pedido

Fatos da run → agrupados por `salesOrderId` → evidências (NF/doc/CR/recebido) → classificador → uma row por pedido → cards/grupos somam **uma vez** cada pedido.

### Cards

Construídos em `buildSummaryCards`: total, status principais, alertas (`DIVERGENCIA_TECNICA`, `RISCO_SUPERESTIMACAO`), conversões %, confiança média ponderada por valor.

### Status sem duplicidade

Prioridade fixa no classificador; teste unitário + warning se soma de grupos ≠ total; script Britânia valida `statusPrincipal.semDuplicidade`.

### Tags

Múltiplas; nunca substituem status; UI explica coexistência; card de divergência é alerta.

### Confiança

Faixas por status + ajustes (evidência, idade, divergência). Labels: ALTA ≥80, MEDIA 60–79, BAIXA 30–59, MUITO_BAIXA &lt;30.

### Filtros

Whitelist no parser; eixo de data + from/to; evidências `onlyWithout*`; pageSize max 200.

### Drawer

GET detalhe por `salesOrderId` + run; empty states; sem inventar condição de pagamento.

### “?”

`explanation` no payload do card → `MetricHelpTooltip`; fallback se incompleto; aviso de métrica operacional.

---

## 7. Regras de status principal

| Ordem | Status | Ideia de negócio |
|-------|--------|------------------|
| 1 | RECEBIDO | Já baixado |
| 2 | CR_ABERTO | Já virou financeiro |
| 3 | FATURADO_SEM_CR | Saiu NF/doc, falta CR |
| 4 | CARTEIRA_FUTURA_PROVAVEL | Ainda só pedido, previsão longe |
| 5 | CARTEIRA_PRESENTE_ATENCAO | Ainda só pedido, janela próxima |
| 6 | CARTEIRA_VENCIDA_BLOQUEADA | Precisa validação — antigo sem evolução |
| 7 | SEM_EVIDENCIA | Falta informação |

---

## 8. Tags de alerta

`DIVERGENCIA_TECNICA`, `NF_SEM_DOCUMENTO`, `DOCUMENTO_SEM_CR`, `NF_CABECALHO_MAIOR_PEDIDO`, `DIVERGENCIA_PRECO`, `SEM_CONDICAO_PAGAMENTO`, `VINCULO_INCOMPLETO`, `PEDIDO_ANTIGO_SEM_EVOLUCAO`.

---

## 9. Cards e KPIs

**Cards:** carteira total; recebido; já financeiro (CR); faturado sem CR; futuro; presente; precisa validação; divergência; sem evidência; risco (alerta); conversões; confiança média.

**Seller KPIs:** valor, conversão CR/doc, recebido, stuck sem NF/CR, vencido/bloqueado, % baixa confiança — fonte SalesOrder/Nomus, **nunca** comissões.

---

## 10. Validação da Britânia

**Comando:** `npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts`

| Métrica | Esperado | Resultado (2026-07-10) |
|---------|----------|-------------------------|
| totalPedidos | 31 | PASS |
| valorTotalPedidos | 3.324.636,50 | PASS |
| pedidosSemNfDocCr | 13 | PASS |
| valorSemNfDocCr | 1.380.296 | PASS |
| futura/presente | 495.460 | PASS |
| vencido/bloqueado | 884.836 | PASS |
| PD 02607 | futura | PASS |
| PD 02740 | futura | PASS |
| PD 02739 | presente | PASS |
| PD 02159 (+9) | bloqueados | PASS |
| Resumo script | — | **PASS=65 FAIL=0** |

**Fonte:** FIXTURE (DB local indisponível). Service puro bate 100%. Reexecutar com DB na run `1dc2ead7-533d-4ad4-bc4c-621061fa5623` no deploy.

Pedidos futuros **não** entram como CR. Bloqueados **não** entram como caixa confiável (status + confiança MUITO_BAIXA + sem NF/doc/CR).

---

## 11. Evidências de teste (esta execução)

| Comando | Resultado | Warning | Bloqueante? |
|---------|-----------|---------|-------------|
| `npm run check:server-imports` | PASS | probe histórico ausente (informativo) | Não |
| `npm run check:frontend-server-imports` | PASS | — | — |
| `npm test` | PASS (fail 0) | — | — |
| `npm run build` | PASS | chunk &gt;500kB (Vite) | Não |
| `npm run check:browser-bundle` | PASS | — | — |
| Script Britânia | PASS=65 FAIL=0 | DB indisponível → FIXTURE | Não (documentado) |

---

## 12. Evidências de não regressão

Na faixa de commits da Inteligência:

- **Sem** alteração de regra em Fluxo de Caixa.  
- **Sem** alteração em Contas a Receber oficial.  
- **Sem** alteração em Comissões (apenas assert de UI garantindo *não* importar comissões).  
- **Sem** alteração em Relatório Presidencial.  
- Endpoints **GET only** — sem mutation/write da inteligência.  
- **Sem** migration nova nesta feature (usa fato já materializada da conciliação).  
- Permissões: `FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS`.  
- Erros 5xx: mensagem fixa no frontend; stack só no log do servidor.

---

## 13. Limitações conhecidas

1. Camada operacional — não substitui números oficiais.  
2. Sem `runId`, resolve última run SUCCESS global; cliente filtra fatos.  
3. Agregação em memória após load da run (com filtro de cliente no Prisma).  
4. Grade limitada a pageSize 200 (cards usam filtro completo).  
5. Britânia local validada em FIXTURE se DB offline.  
6. Condição de pagamento só se importada.  
7. Tabelas largas em mobile: scroll horizontal.

---

## 14. Pendências / próximos passos

| Item | Tipo | Impacto |
|------|------|---------|
| Revalidar Britânia com DB na run materializada | Obrigatório no deploy | Fecha piloto live |
| Paginação UI (próxima página) | Melhoria opcional | Grade &gt;200 pedidos |
| Explanations de seller KPI no payload API | Melhoria opcional | Paridade API/UI |
| Índice composto (runId, customerExternalId) | Melhoria opcional | Performance em runs grandes |
| Liberar “todos os clientes” com regra de run explícita | Evolução | Rollout geral |

Nenhuma lacuna obrigatória dos 14 prompts ficou sem implementação. Melhorias acima são pós-liberação.

---

## 15. Tabela de validação

| Requisito | Onde foi implementado | Como foi testado | Resultado | Evidência |
|-----------|----------------------|------------------|-----------|-----------|
| Status único por pedido | `portfolioMaturityClassification.ts` | unit + Britânia | PASS | `967fed3`, script |
| Tags não duplicam cards | `isAlertCard` + UI | unit + review | PASS | `713de2b` |
| Cards / totais Britânia | analytics + script | fixture + script | PASS | PASS=65 |
| Conversão CR / doc / recebimento | analytics | unit tests | PASS | `portfolioMaturityAnalytics.test.ts` |
| Confiança ponderada | analytics | unit | PASS | idem |
| Risco = bloqueados | analytics | unit + Britânia | PASS | PD 02159 |
| Futuro ≠ CR | classificador | Britânia PDs | PASS | 02607/02740 |
| API read-only | routes | code review + tests | PASS | só GET |
| UI cards + “?” | Cards + Help | UI contract tests | PASS | `portfolioIntelligenceUi.test.ts` |
| Sanfonas / grid / drawer | Accordion/Grid/Drawer | UI tests | PASS | commits 6–7 |
| Filtros + eixo data | FiltersBar | unit + UI | PASS | `36c2675` |
| Seller KPIs sem comissão | SellerKpis | UI assert | PASS | `09a5f91`/`8603c74` |
| Isolamento módulos oficiais | review git | diff path | PASS | release checklist |
| Build / imports / bundle | CI local | npm scripts | PASS | esta execução |
| Polimento leigo | UiCopy + Section | UI tests | PASS | `4b853a3` |

---

## 16. Resumo para diretoria

Esta tela mostra a **maturidade da carteira comercial**: o que já virou financeiro, o que ainda é só pedido e o que precisa revisão.

**Como ler os cards:** comece pelo total; depois “já virou financeiro / já recebido”; depois “ainda só pedido”; depois “precisa validação” e “não tratar como caixa confiável”.

**Carteira confiável:** pedidos com Contas a Receber ou recebimento evidenciado.  
**Carteira bloqueada:** pedidos antigos sem NF, documento ou CR — **não** tratar como caixa.

Use os KPIs por vendedor e as sanfonas para cobrar evolução comercial e limpar carteira antiga.  
**Pedido de venda não é automaticamente dinheiro** — só vira caixa confiável quando entra no Contas a Receber / baixa.

---

## 17. Resumo para TI

- **Services:** classification → analytics → intelligenceApi → Prisma loaders.  
- **Endpoints:** 2 GETs sob `/api/finance/portfolio-reconciliation/intelligence*`.  
- **UI:** Section orquestra; Cards/Accordions/Grid/Drawer/Filters/SellerKpis/Help.  
- **Testes:** classification, analytics, intelligenceApi, filters, drilldown, seller KPIs, metric help, UI contracts.  
- **Script:** `tmp-audits/validate-portfolio-intelligence-britania.ts` (force-add).  
- **Manutenção:** não alterar classificador sem atualizar Britânia expected + testes; UI copy em `portfolioIntelligenceUiCopy.ts` sem mexer em cálculo.  
- **Riscos:** runs grandes em memória; resolução de run sem `runId`; não acoplar a comissões.

---

## 18. Como validar manualmente na tela

1. Entrar em **Financeiro → Conciliação de Carteira**.  
2. Abrir a aba **Inteligência da Carteira**.  
3. Filtrar **Britânia** e/ou `runId=1dc2ead7-533d-4ad4-bc4c-621061fa5623`.  
4. Conferir cards: total 3.324.636,50; sem NF 1.380.296; futuro/presente 495.460; bloqueado 884.836.  
5. Abrir sanfona **Precisa validação** — 10 pedidos.  
6. Abrir **PD 02159** no drawer — ausência de NF/documento/CR.  
7. Abrir sanfona futuro/presente — 3 pedidos (02607, 02740, 02739).  
8. Clicar “?” em um card — ler as 5 seções.  
9. Filtrar/clicar um vendedor nos KPIs — visão principal filtra.  
10. Confirmar loading/empty/erro amigável se aplicável.

---

## 19. Arquivos principais (mapa)

**Backend:** `portfolioMaturityClassification.ts`, `portfolioMaturityAnalytics.ts`, `portfolioMaturityIntelligenceApi.ts`, `financePortfolioReconciliationApi.server.ts`, `financePortfolioReconciliationRoutes.ts`.

**Frontend:** `PortfolioIntelligence*.tsx`, `portfolioIntelligenceUiCopy.ts`, `portfolioIntelligenceFilters.ts`, `portfolioIntelligenceDrilldown.ts`, `financePortfolioReconciliationClient.ts`, `FinancePortfolioReconciliationPage.tsx`.

**Docs:** requirements, api, handoff, release-checklist, **este relatório**.

**Script:** `tmp-audits/validate-portfolio-intelligence-britania.ts`.
