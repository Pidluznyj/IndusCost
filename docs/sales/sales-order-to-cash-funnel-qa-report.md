# QA final — Funil Pedido → Caixa

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Data** | 2026-07-11 |
| **Escopo** | QA técnico, visual e de negócio (sem feature nova) |
| **HEAD avaliado** | `438f1d0` |
| **Status geral** | **PARCIAL** |

---

## Status geral

**PARCIAL** — produto e gates de build/teste unitário estão **PRONTOS**; a validação read-only contra banco de produção/servidor **não pôde ser confirmada neste ambiente** (`localhost:5432` indisponível). Scripts PD 02339 e Britânia passaram em modo **FIXTURE**.

Nenhum bug de código foi encontrado nesta rodada; **nenhuma correção de feature** foi necessária.

---

## O que foi implementado (histórico da feature)

1. **Requisitos e inventário** — docs oficiais do funil e inventário do Dashboard.  
2. **Motor de classificação** — um estágio principal por pedido (`SalesOrder`), alertas sem somar carteira.  
3. **Analytics** — cards, funil, risco, conversões, aging, `sellerSummary` / `customerSummary`.  
4. **API read-only** — `GET /api/sales/order-to-cash-funnel` (+ detalhe por pedido).  
5. **UI** — aba Funil de Vendas → painel “Funil Pedido → Caixa” (cards, funil visual, grid, filtros, KPIs, drawer).  
6. **Filtros avançados + chips** — período/eixo de data, estágio, temperatura, alerta, responsável, etc.  
7. **KPIs por vendedor e cliente** — sem comissão; filtro na tela.  
8. **Descoberta OP Nomus** — documentação + script read-only (OP **não** integrada).

---

## Arquivos alterados (conjunto da feature)

### Core / API
- `src/lib/sales/salesOrderToCashFunnelClassification.ts` (+ `.test.ts`)
- `src/lib/sales/salesOrderToCashFunnelAnalytics.ts` (+ `.test.ts`)
- `src/lib/sales/salesOrderToCashFunnelApi.ts` (+ `.server.ts`, `.test.ts`)
- `src/lib/salesOrderToCashFunnelRoutes.ts`
- `src/lib/sales/salesOrderToCashFunnelClient.ts`
- `src/lib/sales/salesOrderToCashFunnelFilters.ts` (+ `.test.ts`)
- `src/lib/sales/salesOrderToCashFunnelUiCopy.ts`
- `package.json` (registro dos testes)

### UI
- `src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelPanel.tsx`
- `src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelFiltersBar.tsx`
- `src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelDrawer.tsx`
- `src/components/dashboard/order-to-cash-funnel/OrderToCashFunnelEntityKpis.tsx`
- `src/components/DashboardModule.tsx` (integração da aba)
- `src/components/finance/bi/FinanceBiFilterPanel.tsx` (rótulo “Limpar filtros”)

### Docs / audits
- `docs/sales/sales-order-to-cash-funnel-requirements.md`
- `docs/sales/current-sales-funnel-inventory.md`
- `docs/sales/sales-order-to-cash-funnel-validation.md`
- `docs/integrations/nomus-production-orders-api-discovery.md`
- `tmp-audits/validate-sales-order-to-cash-funnel.ts`
- `tmp-audits/discover-nomus-production-orders-api.ts`
- **Este relatório:** `docs/sales/sales-order-to-cash-funnel-qa-report.md`

---

## Regras de negócio finais

| # | Regra | Evidência QA |
|---|--------|--------------|
| 1 | Fonte oficial = **Pedido de Venda** (`SalesOrder`) | Classificação/API/UI; aviso na tela |
| 2 | Proposta **não** manda no funil | Sem imports de Proposal; testes negativos |
| 3 | Proposta só histórico/cotação, se aparecer | `ORDER_TO_CASH_FUNNEL_PROPOSAL_NOTICE` |
| 4 | OP é **opcional** | Docs + drawer sem OP |
| 5 | Funil funciona **sem** OP | UI/API sem dependência de OP |
| 6 | Pedido antigo sem NF/doc/CR → `BLOQUEADO_REVISAO` | Classification test #10 |
| 7 | Com CR aberto → `CR_ABERTO` | Classification test #2 |
| 8 | Recebido → `RECEBIDO` | Classification test #1 |
| 9 | Documento/NF sem CR → `DOCUMENTO_SEM_NF` / `NF_SEM_CR` | Classification test #3 |
| 10 | Valor **não** duplica Pedido+NF+CR | Analytics: um `valueForStage` por pedido |
| 11 | Alertas **não** somam carteira | `doesNotSumPortfolio` / risk note |
| 12 | Vendedor/cliente **sem** comissões | Seller/customer KPIs usam vendedor comercial do pedido |

Cadeia oficial:

```text
Cliente → Pedido → [OP opcional] → Documento → NF → CR → Baixa
```

---

## Checklist visual (código + testes de UI)

| Item | Resultado |
|------|-----------|
| Título Funil Pedido → Caixa | OK (`otc-title`) |
| Aviso Pedido de Venda como origem | OK (`otc-proposal-notice`) |
| Cards em blocos Comercial / Execução / Financeiro | OK |
| Funil horizontal + raia de risco | OK |
| Cores suaves (TONE_CLASSES) | OK |
| Cards com “?” (`MetricHelpTooltip`) | OK |
| Grid legível | OK |
| Filtros (barra + avançados + chips) | OK |
| Drawer abre (largura / abas / scroll) | OK |
| Estados vazios amigáveis | OK |
| Sem JSON cru no drawer | OK |

---

## Testes rodados

### Gates npm (2026-07-11, workspace local)

| Comando | Resultado |
|---------|-----------|
| `npm run check:server-imports` | **OK** |
| `npm run check:frontend-server-imports` | **OK** (632 arquivos) |
| `npm test` | **PASS** — 250 testes (suite completa + market-intelligence) |
| `npm run build` | **OK** (vite build) |
| `npm run check:browser-bundle` | **OK** (dist/ livre de Prisma) |

### Suite específica Funil Pedido → Caixa

```text
npx tsx --test src/lib/sales/salesOrderToCashFunnel*.test.ts
ℹ tests 66
ℹ pass 66
ℹ fail 0
```

Cobertura: classificação, analytics (sem duplicar / sem comissão), API, filtros/chips, UI (painel, drawer, KPIs).

---

## Scripts rodados (`tmp-audits`)

| Script | Resultado | Notas |
|--------|-----------|--------|
| `npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts` | **FAIL** | `cargaBanco: FAIL` — Prisma sem `localhost:5432` |
| `npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts` | **PASS** (15/15) | Fallback **FIXTURE** (DB indisponível) |
| `npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts` | **PASS** (65/0) | Fallback **FIXTURE** Britânia-shaped |

Trecho funil (DB):

```text
Falha ao carregar funil do banco (read-only): Banco indisponível ...
Can't reach database server at `localhost:5432`
PASS/FAIL: FAIL
```

**Reexecução recomendada no servidor:**

```bash
cd /opt/induscost
npx tsx tmp-audits/validate-sales-order-to-cash-funnel.ts
npx tsx tmp-audits/validate-pd02339-fulfillment-map.ts
npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
```

---

## Limitações conhecidas

1. **Validação DB do funil** não rodou neste ambiente (Postgres local down).  
2. **OP não integrada** — drawer exibe “Ordem de produção não disponível na integração atual.”  
3. Aba do menu ainda se chama “Funil de Vendas”; título interno = “Funil Pedido → Caixa”.  
4. Scripts PD/Britânia com fixture **não** substituem auditoria da run SUCCESS materializada.  
5. Descoberta Nomus de OP deve ser executada no servidor (`docs/integrations/nomus-production-orders-api-discovery.md`).

---

## Decisão sobre OP

- OP permanece **enriquecimento opcional**, nunca dependência do funil.  
- Integração de OP **não** foi feita nesta fase.  
- Próximo passo: rodar descoberta Nomus no servidor e só então planejar fase opcional se **CONFIRMADO**.

---

## Confirmação de não regressão

- Gates de imports frontend/server OK.  
- Bundle browser sem Prisma.  
- Suite `npm test` (250) verde.  
- Testes do funil (66) verdes; regras de não-comissão / não-proposta preservadas.  
- Nenhuma alteração de sync, migration ou write nesta rodada de QA.

---

## Próximos passos

1. No servidor com `DATABASE_URL` e run SUCCESS da Conciliação: reexecutar os três scripts `tmp-audits` acima.  
2. Rodar descoberta de OP Nomus (`discover-nomus-production-orders-api.ts --salesOrderCode "PD 02339" --verbose`).  
3. Smoke visual manual na aba (filtros, chips, drawer, KPIs vendedor/cliente).  
4. Se OP **CONFIRMADO**, abrir fase futura de enriquecimento opcional (sem tornar OP DoD).  
5. Após DB PASS do funil, atualizar este relatório para **PRONTO**.

---

## Resultado desta execução QA

| Dimensão | Status |
|----------|--------|
| Técnico (gates + unit) | PRONTO |
| Negócio (regras em código/testes) | PRONTO |
| Visual (contrato UI/testes de fonte) | PRONTO |
| Auditoria DB live | PENDENTE (ambiente) |
| **Status consolidado** | **PARCIAL** |

**Bugs corrigidos nesta rodada:** nenhum.
