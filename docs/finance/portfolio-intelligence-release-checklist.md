# QA final / liberação — Central de Inteligência da Carteira

**Projeto:** IndusCost / My Industry  
**Data:** 2026-07-10  
**Commit de liberação:** `6a114e11f9eeb38f389367fd1f990226e2a89fe0` (checklist em `bedb440`)  
**Veredito:** **PRONTO PARA DEPLOY** (com ressalva de revalidar Britânia na run materializada em ambiente com DB)

---

## Evidência técnica (executada nesta QA)

| Comando | Resultado |
|---------|-----------|
| `npm run check:server-imports` | PASS |
| `npm run check:frontend-server-imports` | PASS |
| `npm test` | PASS (fail 0) |
| `npm run build` | PASS |
| `npm run check:browser-bundle` | PASS |
| `npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts` | **PASS=65 FAIL=0** (modo FIXTURE — DB local indisponível) |

Bugs encontrados nesta QA: **nenhum** (sem correção de código além desta documentação).

---

## Checklist funcional

| # | Critério | Resultado | Evidência |
|---|----------|-----------|-----------|
| 1 | Tela abre em Financeiro → Conciliação de Carteira | PASS | `FinancePortfolioReconciliationPage` + rota do módulo |
| 2 | Aba/seção Inteligência da Carteira | PASS | `portfolio-tab-intelligence` + `PortfolioIntelligenceSection` |
| 3 | Cards carregam | PASS | `PortfolioIntelligenceCards` + testes UI/analytics |
| 4 | Cards têm “?” | PASS | `MetricHelpTooltip` em cada card |
| 5 | Popups explicam de forma simples | PASS | 5 seções leigas + aviso operacional |
| 6 | Filtros funcionam | PASS | `PortfolioIntelligenceFiltersBar` + parser 400 |
| 7 | Eixo de data aparece claramente | PASS | `portfolio-intelligence-active-axis` |
| 8 | Sanfonas abrem/fecham | PASS | `PortfolioIntelligenceAccordions` |
| 9 | Grids mostram pedidos | PASS | `PortfolioIntelligenceOrdersGrid` |
| 10 | Clique na linha abre drawer | PASS | `onOpenOrder` → `PortfolioIntelligenceOrderDrawer` |
| 11 | Drawer mostra abas | PASS | 7 abas (Resumo…Histórico) |
| 12 | Dados ausentes = indisponíveis | PASS | empty states / UNAVAILABLE |
| 13 | Não há JSON cru na UI de inteligência | PASS | sem `JSON.stringify` de payload no drawer de inteligência |
| 14 | Não há erro Prisma exposto | PASS | 5xx genérico; bundle sem Prisma |
| 15 | Estado vazio funciona | PASS | `FinanceModuleEmptyState` (sem run / sem cards) |
| 16 | Loading funciona | PASS | `FinanceModuleLoadingBlock` + skeletons |
| 17 | Erro amigável funciona | PASS | banner + mensagem fixa em ≥500 |

---

## Checklist financeiro

| # | Critério | Resultado | Evidência |
|---|----------|-----------|-----------|
| 1 | Carteira total não duplica pedido | PASS | teste “não duplica valor entre cards de status principal” |
| 2 | Status principal único por pedido | PASS | classificador + script Britânia `statusPrincipal.semDuplicidade` |
| 3 | Tags não duplicam cards principais | PASS | `isAlertCard` (divergência + risco) |
| 4 | Conversão em CR correta | PASS | `portfolioMaturityAnalytics.test.ts` |
| 5 | Conversão em documento de saída correta | PASS | idem |
| 6 | Taxa de recebimento correta | PASS | card + analytics |
| 7 | Confiança média ponderada por valor | PASS | teste dedicado |
| 8 | Risco = vencidos/bloqueados | PASS | `RISCO_SUPERESTIMACAO` = bloqueada; `isAlertCard` |
| 9 | Pedido futuro ≠ CR confirmado | PASS | PD 02607/02740 → futura; fixture Britânia |
| 10 | Vencido sem NF/CR ≠ caixa confiável | PASS | PD 02159 bloqueado + MUITO_BAIXA + sem evidência |

---

## Checklist Britânia

| Critério | Esperado | Resultado |
|----------|----------|-----------|
| totalPedidos | 31 | PASS |
| valorTotalPedidos | R$ 3.324.636,50 | PASS |
| pedidosSemNfDocCr | 13 | PASS |
| valorSemNfDocCr | R$ 1.380.296,00 | PASS |
| futura/presente plausível | R$ 495.460,00 | PASS |
| vencido/bloqueado | R$ 884.836,00 | PASS |
| PD 02159 | vencido/bloqueado | PASS |
| PD 02607 | futura provável | PASS |
| PD 02739 | presente/atenção | PASS |

**Nota:** validação local em **FIXTURE** (service puro). Em deploy, reexecutar o script com DB e `runId=1dc2ead7-533d-4ad4-bc4c-621061fa5623` para fechar a run materializada.

---

## Checklist regressão

| # | Critério | Resultado | Evidência |
|---|----------|-----------|-----------|
| 1 | Build passa | PASS | `vite build` OK |
| 2 | Testes passam | PASS | fail 0 |
| 3 | Rotas antigas de financeiro | PASS | inteligência só adiciona GETs read-only |
| 4 | Menu não quebrou | PASS | sem diff em layout/menu nos commits da feature |
| 5 | Gestão de Pedidos | PASS | sem alteração em `sales*` nesta faixa |
| 6 | Relatório Presidencial | PASS | sem alteração |
| 7 | Comissões | PASS | sem alteração em `src/lib/commissions` / UI comissões |
| 8 | Contas a Receber oficial | PASS | sem alteração nos módulos oficiais de AR |
| 9 | Fluxo de Caixa | PASS | sem alteração |

---

## Liberação

- **Status:** pronto para deploy  
- **Pré-deploy recomendado:** rodar `validate-portfolio-intelligence-britania.ts` no ambiente com a run materializada  
- **Pós-deploy smoke:** abrir Conciliação → aba Inteligência → filtro Britânia → cards + sanfona + drawer PD 02159  

Referências: [`portfolio-intelligence-handoff.md`](./portfolio-intelligence-handoff.md), [`portfolio-intelligence-api.md`](./portfolio-intelligence-api.md).
