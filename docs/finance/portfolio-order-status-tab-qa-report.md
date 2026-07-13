# QA — Aba Status Pedidos (Conciliação de Carteira)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Tela** | Financeiro → Conciliação de Carteira → **Status Pedidos** |
| **Data** | 2026-07-13 |
| **Script** | `scripts/qaPortfolioOrderStatusTab.ts` (`npm run qa:portfolio-order-status`) |
| **Endpoint** | `GET /api/finance/portfolio-reconciliation/order-status` |
| **Status geral** | **LIBERADO COM RESSALVA** |
| **Resumo** | total=18 pass=18 fail=0 skip=1 |

---

## 1. Testes estáticos

| ID | Resultado | Detalhe |
|----|-----------|---------|
| `endpoint:order-status` | PASS | rota registrada |
| `service:portfolioOrderStatusService` | PASS | arquivo existe |
| `client:portfolioOrderStatusClient` | PASS | client frontend existe |
| `ui:tab-registered` | PASS | aba Status Pedidos na página + PORTFOLIO_RECONCILIATION_UI_TABS |
| `bundle:no-prisma-frontend` | PASS | Status Pedidos UI/client sem Prisma/server |
| `table:one-row-per-order` | PASS | tabela keyed por orderKey (pedido) |
| `service:canceled-items` | PASS | service trata itens cancelados (status + valores + card) |
| `docs:canceled-section` | PASS | doc com seção de itens cancelados |
| `service:item-status-normalizer` | PASS | normalizador de status de item |
| `docs:item-status-rules` | PASS | regras oficiais de status de item |
| `docs:item-status-impact-audit` | PASS | inventário de impacto |
| `docs:item-nomus-status-sync` | PASS | doc sync status item Nomus |
| `schema:sales-order-item-nomus-status` | PASS | SalesOrderItem com campos Nomus |
| `cards:distinct-orders` | PASS | cards contam pedidos (não facts) |
| `server:loader` | PASS | loader Prisma order-status existe |
| `drilldown:shared-items-grid` | PASS | OrderToCashAuditItemsGrid usado em Status Pedidos + Auditoria |
| `drilldown:reuses-audit-api` | PASS | painel carrega itens via API Auditoria Pedido → Caixa |

---

## 2. Testes live (DATABASE_URL)

_Live DB não executado neste ambiente (sem `DATABASE_URL`). Smoke obrigatório no servidor com a run geral materializada._

| ID | Resultado | Detalhe |
|----|-----------|---------|
| `live:db` | SKIP | SKIPPED — DATABASE_URL ausente neste ambiente |

---

## 3. Evidências PD 02534

_Sem evidência live — reexecutar com DATABASE_URL._

---

## 4. Evidências PD 02339

_Sem evidência live — reexecutar com DATABASE_URL._

---

## 5. Pendências

- Executar `npm run qa:portfolio-order-status` no servidor com `DATABASE_URL` e run geral SUCCESS.
- Confirmar visualmente filtros/chips/drawer na UI.


Notas:
- Live DB não executado — sem DATABASE_URL.

---

## 6. Conclusão

Contratos estáticos OK. Liberação completa depende do smoke live no ambiente com banco (PD 02534 / PD 02339 / filtros / paginação).

Run de referência operacional: `41c2470a-b685-4765-a954-77110fd8cf5c` (quando presente).
