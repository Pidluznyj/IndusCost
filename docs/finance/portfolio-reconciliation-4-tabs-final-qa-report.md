# QA final — Conciliação de Carteira (4 abas)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → **Conciliação de Carteira** |
| **Data** | 2026-07-13 |
| **Escopo** | Validação final (sem feature nova) |
| **Status geral** | **LIBERADO COM RESSALVA** |
| **Ressalva** | Smoke live DB não executado neste ambiente (`DATABASE_URL` ausente) |

Abas validadas:

1. Conciliação  
2. Inteligência da Carteira  
3. Status Pedidos  
4. Auditoria Pedido → Caixa  

Scripts:

- `npx tsx scripts/qaPortfolioReconciliation3Tabs.ts` → **20 pass / 0 fail** (1 skip live)
- `npm run qa:portfolio-order-status` → **9 pass / 0 fail** (1 skip live)
- Unitários PD/CR: `portfolioOrderStatusService` + adapter → **pass**

Run de referência (quando presente no banco): `41c2470a-b685-4765-a954-77110fd8cf5c`  
Britânia específica (ref.): `a0bdc0b6-b3d5-42ca-a548-283edbc31cfa` · customerExternalId `200` · ano `2026`  
Esmaltec (ref.): customerExternalId `500`

---

## 1. Status por aba

| Aba | Endpoint | Wiring UI | Grão | Filtros | Bundle | Live DB |
|-----|----------|-----------|------|---------|--------|---------|
| **Conciliação** | `GET /api/finance/portfolio-reconciliation` | PASS | Pedido (via adapter O2C) | cliente/ano/mês | sem Prisma | SKIP |
| **Inteligência** | `GET …/intelligence` | PASS | Cards + pedidos | período/vendedor/status | sem Prisma | SKIP |
| **Status Pedidos** | `GET …/order-status` | PASS | **1 linha por pedido** | ano/cliente/status/cards | sem Prisma | SKIP |
| **Auditoria Pedido → Caixa** | `GET …/order-to-cash-audit` | PASS | **item / evidência** (`row.id`) | cliente/ano/estágio/temperatura/vendedor/sort | sem Prisma | SKIP |

Ordem das abas em `PORTFOLIO_RECONCILIATION_UI_TABS`: Conciliação → Inteligência → Status Pedidos → Auditoria.

---

## 2. Endpoints testados

| Endpoint | Resultado estático |
|----------|-------------------|
| `/api/finance/portfolio-reconciliation` | PASS — rota registrada |
| `/api/finance/portfolio-reconciliation/intelligence` | PASS — rota registrada |
| `/api/finance/portfolio-reconciliation/order-status` | PASS — rota registrada |
| `/api/finance/portfolio-reconciliation/order-to-cash-audit` | PASS — rota registrada |

Contratos adicionais:

- Conciliação usa adapter O2C (`adaptOrderToCashAuditFactsToPortfolioFacts`)
- Inteligência prefere fonte `ORDER_TO_CASH_AUDIT`
- Auditoria lê `OrderToCashAudit`
- Adapter: CR só no primeiro fato do pedido (`isFirstCrCarrier`)
- Frontend das 4 abas/clients sem Prisma

---

## 3. Filtros testados

| Escopo | Evidência |
|--------|-----------|
| Conciliação | cliente / ano / mês presentes na página |
| Inteligência | barra própria (período / vendedor / status) |
| Status Pedidos | ano obrigatório + cliente opcional + status/temperatura/alertas + cards/drilldowns (script dedicado) |
| Auditoria | cliente / ano / estágio / temperatura / vendedor / sort |
| Empty customer | tratado nos scripts live (SKIP aqui); unitários cobrem empty state API Status Pedidos |

---

## 4. Resultado PD 02534

| Critério | Resultado | Evidência |
|----------|-----------|-----------|
| Carrega / classifica | PASS (unitário) | `PARCIAL_CR_ABERTO` |
| Uma linha por pedido (Status Pedidos) | PASS | service agrega por `orderKey` |
| CR não duplica | PASS | `receivableTotalValue === 183612` (não × N facts) |
| `309.86AA` não como faturado | PASS | linha PENDING excluída do cobrado |
| NF/CR título ≠ valor de item | PASS | `lineBilledValue <` título CR |

_Live DB:_ não exercitado neste ambiente — reexecutar loaders com `DATABASE_URL` + filtro Esmaltec/`PD 02534`.

---

## 5. Resultado PD 02339

| Critério | Resultado | Evidência |
|----------|-----------|-----------|
| Continua carregando / sem regressão | PASS (unitário) | valor pedido único `158000` |
| Alocado capped no pedido | PASS | `allocatedOrderValue <= 158000` |
| NF cabeçalho não infla pedido | PASS | `nfeHeaderMaxValue >` pedido; total do pedido permanece 158k |
| Status consolidado | PASS | `COMPLETO_CR_ABERTO` (fixture) |

_Live DB:_ SKIP — confirmar na run geral.

---

## 6. Resultado Britânia

| Critério | Resultado |
|----------|-----------|
| Filtro customerExternalId `200` / ano `2026` (contrato) | PASS (estático + unitário API Status Pedidos) |
| Loader live Conciliação / Inteligência / Auditoria | **SKIP** (sem `DATABASE_URL`) |
| Expectativa operacional (run geral) | ~35 pedidos / ~108 facts Britânia (script live) |

---

## 7. Resultado Esmaltec

| Critério | Resultado |
|----------|-----------|
| Filtro Esmaltec (externalId `500`) na API Status Pedidos | PASS (unitário) |
| PD 02534 no universo Esmaltec | PASS (fixtures unitárias) |
| Live DB | **SKIP** |

---

## 8. Checklist UI / qualidade

| # | Item | Resultado |
|---|------|-----------|
| 1 | Conciliação carrega (wiring) | PASS |
| 2 | Inteligência carrega (wiring) | PASS |
| 3 | Status Pedidos carrega (wiring) | PASS |
| 4 | Auditoria carrega (wiring) | PASS |
| 5 | Filtros cliente/ano | PASS (contrato) |
| 6 | Britânia 2026 | PASS unitário / SKIP live |
| 7 | Esmaltec / PD 02534 | PASS unitário / SKIP live |
| 8 | PD 02339 sem regressão | PASS unitário |
| 9 | Status Pedidos 1 linha/pedido | PASS |
| 10 | Auditoria item a item | PASS |
| 11 | CR não duplica nos cards | PASS (adapter + Status Pedidos) |
| 12 | NF/CR título ≠ valor item | PASS (unitário) |
| 13 | Sem 500 (empty/paths estáticos) | PASS nos contratos; live SKIP |
| 14 | Sem erro crítico no console | N/A neste CI local headless — smoke visual no servidor |
| 15 | Browser bundle sem Prisma | PASS (`check:browser-bundle` + QA) |

---

## 9. Bugs encontrados

Nenhum bug bloqueante encontrado nesta rodada.

Observação (não bloqueante): o DOM renderiza `ProtectedTab` de Status Pedidos/Auditoria antes de Conciliação/Inteligência; a **ordem visual** das abas segue `PORTFOLIO_RECONCILIATION_UI_TABS` corretamente. Reordenar o markup seria cosmético.

---

## 10. Correções feitas

- `scripts/qaPortfolioReconciliation3Tabs.ts`: passou a validar explicitamente as **4 abas** (endpoint `order-status`, wiring UI, grão Status Pedidos vs Auditoria, clients sem Prisma).

Nenhuma alteração de regra de cálculo.

---

## 11. Validações executadas

| Comando | Resultado |
|---------|-----------|
| `npm run check:server-imports` | OK |
| `npm run check:frontend-server-imports` | OK |
| `npm run check:browser-bundle` | OK |
| `npm test` | OK (0 fail) |
| `npm run build` | OK |
| `npx tsx scripts/qaPortfolioReconciliation3Tabs.ts` | 20 pass / 0 fail / 1 skip live |
| `npm run qa:portfolio-order-status` | 9 pass / 0 fail / 1 skip live |

---

## 12. Pendências

1. Rodar no servidor com `DATABASE_URL` + run geral SUCCESS:
   - `npx tsx scripts/qaPortfolioReconciliation3Tabs.ts`
   - `npm run qa:portfolio-order-status`
2. Smoke visual no browser: as 4 abas, Britânia 2026, Esmaltec/PD 02534, PD 02339, console limpo.
3. Confirmar contagens Britânia na run geral (~35 pedidos / ~108 facts) se a materialização mudou.

---

## 13. Conclusão

**LIBERADO COM RESSALVA.**

Contratos estáticos, wiring das 4 abas, grãos (pedido vs item), anti-duplicação de CR e casos PD 02534 / PD 02339 estão cobertos por QA estático + unitários.  
A liberação **plena** (sem ressalva) depende do smoke **live DB** e visual no ambiente com banco.
