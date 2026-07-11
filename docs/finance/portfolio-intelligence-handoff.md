# Handoff — Central de Inteligência da Carteira

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Conciliação de Carteira → aba **Inteligência da Carteira**  
**Atualizado:** 2026-07-10  
**Camada:** auditoria / maturidade **paralela** (não oficial)

> Complementar: [`portfolio-intelligence-api.md`](./portfolio-intelligence-api.md), [`portfolio-intelligence-requirements.md`](./portfolio-intelligence-requirements.md), [`portfolio-reconciliation-handoff.md`](./portfolio-reconciliation-handoff.md).

---

## 1. Objetivo da tela

Explicar, em linguagem de negócio, a **maturidade** dos pedidos de uma run de conciliação:

- o que já virou Contas a Receber / foi recebido;
- o que ainda é previsão futura ou presente;
- o que está vencido/bloqueado (risco de superestimar a carteira);
- confiança evidencial e tags de alerta (sem substituir o status principal).

A tela **só formata** o payload da API. Não recalcula regras oficiais de Fluxo de Caixa, Contas a Receber, Comissões ou Relatório Presidencial.

---

## 2. Endpoints (read-only)

| Método | Path | Uso |
|--------|------|-----|
| `GET` | `/api/finance/portfolio-reconciliation/intelligence` | Cards, grupos, seller KPIs, rows paginadas |
| `GET` | `/api/finance/portfolio-reconciliation/intelligence/orders/:salesOrderId` | Drawer (7 abas) |

- **Sem** `POST` / `PUT` / `PATCH` / `DELETE`.
- Permissões: `FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS` (`finance.view`, `finance.accountsReceivable.view`, `finance.accountsPayable.view`, `reports.view`, `settings.nomus.view`).
- Erros 400: filtros inválidos (mensagem amigável).  
- Erros 500: mensagem genérica no JSON; stack só no log do servidor.  
- Frontend: em HTTP ≥ 500 não anexa `error.message` técnico ao banner.

`pageSize` máximo: **200**. Cards / grupos / seller KPIs usam o conjunto **filtrado completo**; a grade de pedidos respeita paginação.

Detalhes de query: [`portfolio-intelligence-api.md`](./portfolio-intelligence-api.md).

---

## 3. Services

| Arquivo | Papel |
|---------|--------|
| `src/lib/finance/portfolioMaturityClassification.ts` | Status principal, tags, confiança, `getMetricExplanation` |
| `src/lib/finance/portfolioMaturityAnalytics.ts` | Agrega fatos → rows, cards, groups, seller KPIs, totais |
| `src/lib/finance/portfolioMaturityIntelligenceApi.ts` | Parse de filtros + montagem de payload (sem Prisma) |
| `src/lib/financePortfolioReconciliationApi.server.ts` | Loaders Prisma read-only (`loadPortfolioIntelligenceList` / `OrderDetail`) |
| `src/lib/financePortfolioReconciliationRoutes.ts` | Registro Express |
| `src/lib/financePortfolioReconciliationPermissions.ts` | Constantes de permissão |
| `src/lib/finance/portfolioIntelligenceSellerKpiExplanations.ts` | Textos de ajuda dos KPIs por vendedor (UI) |
| `src/lib/finance/portfolioIntelligenceFilters.ts` | Filtros UI → query |
| `src/lib/finance/portfolioIntelligenceDrilldown.ts` | Card → sanfona / filtro de rows |

Fatos sempre carregados com `where: { runId }` (e `customerExternalId` / `customerId` quando informados). Índice: `PortfolioReconciliationFact.runId`.

---

## 4. Componentes frontend

| Componente | Responsabilidade |
|------------|------------------|
| `PortfolioIntelligenceSection` | Orquestra load, filtros, cards, sellers, sanfonas, drawer |
| `PortfolioIntelligenceFiltersBar` | Eixo de data, presets, status/tags/evidências |
| `PortfolioIntelligenceCards` | KPIs + `MetricHelpTooltip` |
| `PortfolioIntelligenceSellerKpis` | Qualidade por vendedor (fonte SalesOrder/Nomus) |
| `PortfolioIntelligenceAccordions` | Drilldown por status (+ alerta divergência) |
| `PortfolioIntelligenceOrdersGrid` | Grade de pedidos (status + tags) |
| `PortfolioIntelligenceOrderDrawer` | Detalhe read-only (7 abas) |
| `PortfolioIntelligenceHelpPopover` (`MetricHelpTooltip`) | Ajuda leiga padronizada |

Cliente HTTP: `src/lib/financePortfolioReconciliationClient.ts`.

---

## 5. Status e tags

### Status principal (um por pedido)

`RECEBIDO` · `CR_ABERTO` · `FATURADO_SEM_CR` · `CARTEIRA_FUTURA_PROVAVEL` · `CARTEIRA_PRESENTE_ATENCAO` · `CARTEIRA_VENCIDA_BLOQUEADA` · `SEM_EVIDENCIA`

A soma dos valores desses buckets (excluindo cards de alerta/derivados) deve bater com a carteira total analisada (± R$ 0,05).

### Tags / alertas (podem coexistir)

`DIVERGENCIA_TECNICA` · `NF_SEM_DOCUMENTO` · `DOCUMENTO_SEM_CR` · `NF_CABECALHO_MAIOR_PEDIDO` · `DIVERGENCIA_PRECO` · `SEM_CONDICAO_PAGAMENTO` · `VINCULO_INCOMPLETO` · `PEDIDO_ANTIGO_SEM_EVOLUCAO`

Tags **nunca** substituem o status. Cards com `isAlertCard: true` (ex.: divergência técnica, risco de superestimação) **não** entram na soma dos buckets principais.

---

## 6. KPIs (cards)

Incluem carteira total, cada status principal, divergência técnica (alerta), risco de superestimação (alerta = valor da carteira vencida/bloqueada), conversões pedido→CR / pedido→documento, confiança média ponderada.

Todo card carrega `explanation` com: o que significa, como calculamos, o que entra, o que não entra, como interpretar.

Seller KPIs: valor, conversão CR/doc, recebido, stuck sem NF/CR, vencido/bloqueado, % baixa confiança — **sem** módulo de comissões.

---

## 7. Filtros

Cliente, vendedor (ou “sem vendedor”), empresa, status, confiança, tags, pedido, produto, min/max valor, eixo de data (`ORDER_ISSUE_DATE` | `FORECAST_DATE` | …) + `from`/`to`, atalhos `onlyWithoutNfe` / doc / CR / seller.

Parser rejeita enums inválidos com HTTP 400. Pedidos por emissão **≠** CR por vencimento (aviso na UI).

---

## 8. Regras de confiança

| Label | Score |
|-------|-------|
| ALTA | ≥ 80 |
| MEDIA | 60–79 |
| BAIXA | 30–59 |
| MUITO_BAIXA | &lt; 30 |

Faixas base por status + ajustes por evidência (NF, documento, alocação, idade do pedido). Pedidos antigos sem evolução tendem a **MUITO_BAIXA**. Futura com previsão plausível tende a **MEDIA**. Presente/atenção frequentemente **BAIXA** (não forçar MEDIA).

---

## 9. Validação Britânia (piloto)

Constantes: `BRITANIA_INTELLIGENCE_EXPECTED` em `portfolioMaturityAnalytics.ts`.

| Métrica | Esperado |
|---------|----------|
| runId | `1dc2ead7-533d-4ad4-bc4c-621061fa5623` |
| totalPedidos | 31 |
| valorTotalPedidos | 3.324.636,50 |
| pedidosSemNfDocCr | 13 / R$ 1.380.296 |
| futura+presente | R$ 495.460 (PD 02607, 02740, 02739) |
| vencida/bloqueada | R$ 884.836 (10 PDs, liderados por PD 02159) |

Script: `npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts`  
(force-add se necessário — pasta `tmp-audits/` é gitignored).

Tolerância monetária: **R$ 0,05**. Não maquiar números.

Com DB indisponível o script valida em modo **FIXTURE** (service puro). Com DB, valida a run materializada.

---

## 10. Limitações conhecidas

1. Camada **operacional/auditoria** — não substitui números oficiais.
2. Sem `runId`, resolve a última run `SUCCESS` **global** (filtro de cliente aplica nos fatos, não na escolha da run).
3. Classificação/agregação em memória após carregar fatos da run (com filtro de cliente no Prisma quando informado).
4. Grade de pedidos limitada a `pageSize` (UI avisa se truncar); cards usam o filtro completo.
5. Condição de pagamento só aparece se importada — senão “Informação não disponível na importação atual.”
6. Tabelas largas em mobile: scroll horizontal (hint na UI).
7. Seller KPI explanations vivem no frontend (`SELLER_KPI_EXPLANATIONS`), não no payload da API.

---

## 11. Como investigar divergências

1. Rodar `validate-portfolio-intelligence-britania.ts` (ou fixture unitária) e anotar FAIL por regra.
2. Confirmar `runId` + `customerExternalId` + `asOfDate`.
3. Abrir drawer do pedido: evidências NF / documento / CR / timeline.
4. Comparar status principal vs tags (tags não mudam o bucket).
5. Se soma de status ≠ total → warning de não-duplicidade no payload; investigar agregação por `salesOrderId`.
6. **Não** ajustar constantes esperadas para “bater” — corrigir causa (fato, classificação ou filtro).

---

## 12. Como evoluir para todos os clientes

1. Manter piloto Britânia verde (script + testes).
2. Materializar runs SUCCESS por cliente/período com o rebuild da conciliação.
3. Preferir sempre `runId` explícito na UI/API.
4. Monitorar tamanho da run (fatos) — se crescer demais, paginar no Prisma ou pré-agregar.
5. Só então liberar filtro “todos os clientes” sem run fixa, documentando a regra de resolução de run.
6. Não acoplar a Comissões / Fluxo / Presidencial.

---

## 13. Checklist de isolamento (revisão técnica)

| # | Critério | Status |
|---|----------|--------|
| 1 | Endpoints read-only | OK |
| 2 | Sem mutation/write na inteligência | OK |
| 3–6 | Sem alteração em Fluxo / CR oficial / Comissões / Presidencial | OK |
| 7 | Sem uso do módulo de comissões | OK |
| 8 | Permissões Financeiro / conciliação | OK |
| 9 | Erros técnicos não vazam (500 genérico) | OK |
| 10 | Paginação / limite 200 + aviso UI | OK |
| 11 | Filtros validados | OK |
| 12 | Queries por `runId` (+ cliente) | OK |
| 13 | Status principal sem duplicar valor | OK |
| 14 | Tags coexistentes documentadas na UI | OK |
| 15 | Métricas com explanation | OK |
| 16 | Drawer com empty states | OK |
| 17 | Condição de pagamento não inventada | OK |
| 18 | Layout responsivo (grids + scroll) | OK |
| 19 | Cores suaves nos cards/sanfonas | OK |
| 20 | Build limpo | Validar no CI / local |

---

## 14. Comandos de validação

```bash
npm run check:server-imports
npm run check:frontend-server-imports
npm test
npm run build
npm run check:browser-bundle
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
```
