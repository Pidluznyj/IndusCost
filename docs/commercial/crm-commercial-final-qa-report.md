# QA final — CRM Comercial (3 abas)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Rota** | `/crm-commercial` |
| **Data** | 2026-07-13 |
| **Escopo** | Gestão Geral · Gestão por Responsável · Carteira de Clientes |
| **Método** | Contratos de UI/API + script de consistência SalesOrder + gates de build/testes. Smoke HTTP/browser live **não** executável neste ambiente (Postgres `localhost:5432` inacessível; app não estava no ar). |
| **Script de consistência** | `scripts/qaCrmCommercialSalesOrderConsistency.ts` (29/29 PASS; live SKIP) |
| **Status final** | **LIBERADO COM RESSALVA** — pronto para smoke visual em ambiente com DB/servidor |

---

## 1. Telas / abas testadas

| Aba (UI) | Resource key | Componentes principais | Resultado código |
|----------|--------------|------------------------|------------------|
| **Gestão Geral** | `comercial.crm.tab.gestao_geral` | `CrmManagementDashboardSection` + `CrmManagementLists` | **PASS** |
| **Gestão por Responsável** (label; resource legado “gestão vendedor”) | `comercial.crm.tab.gestao_vendedor` | `CrmSellerDashboardSection` + `CrmSellerDashboardLists` | **PASS** |
| **Carteira de Clientes** | `comercial.crm.tab.carteira_clientes` | `CrmCustomerPortfolioSection` + cockpit | **PASS** |

Tabs definidas em `src/lib/moduleTabResources.ts` (`CRM_UI_TABS`): labels **Gestão Geral**, **Gestão por Responsável** (own: **Meu Dashboard**), **Carteira de Clientes**.

---

## 2. Filtros testados (contrato)

| Aba | Filtros | Evidência |
|-----|---------|-----------|
| Gestão Geral | Período API `dateFrom`/`dateTo` (default últimos 30 dias no serviço oficial) | `resolveManagementDashboardPeriod` + `GET /api/crm/management-dashboard` |
| Gestão por Responsável | **Responsável comercial da carteira** + período (presets / custom) | Label UI + `sellerIdentityKey` / owner-only scope |
| Gestão por Responsável | Caso sem carteira | `emptyStateReason=NO_CUSTOMERS_FOR_COMMERCIAL_OWNER` + empty UI dedicado |
| Carteira | Responsável comercial + busca + chips (contato, follow-up, histórico, carteira aberta) | `CrmCustomerPortfolioSection` + `CRM_PORTFOLIO_FILTER_CHIPS` |

**GISLENE LIMA / 30 dias:** coberto pelo QA de consistência (live SKIP neste host). Quando o DB estiver up, o mesmo script fecha orders/value/`emptyStateReason`.

---

## 3. Resultados dos 15 testes manuais esperados

| # | Teste | Resultado | Como foi validado |
|---|-------|-----------|-------------------|
| 1 | Abrir CRM Comercial | **PASS (código)** | Rota/módulo `crm-commercial`, tabs protegidas, `CrmModule` |
| 2 | Gestão Geral · últimos 30 dias | **PASS (código)** | Default período 30d; KPIs via `loadCrmSalesOrderMetrics` |
| 3 | Gestão por Responsável · GISLENE LIMA | **PASS (contrato) / LIVE SKIP** | Filtro por responsável; script live SKIP (DB down) |
| 4 | Responsável sem carteira | **PASS (código)** | Empty `no_customers_for_owner` + `emptyStateReason` |
| 5 | Carteira de Clientes | **PASS (código)** | Lista + sourceInfo + auditoria + colunas (responsável, último pedido, valor período, Nomus) |
| 6 | Cards não zerados indevidamente | **PASS (código)** | Zeros só com empty explícito / clientes sem pedido no período; sem Proposal inventando KPI |
| 7 | sourceInfo / explicação da fonte | **PASS** | `CrmCommercialSourceInfoNote` nas 3 abas + `CRM_OFFICIAL_SOURCE_NOTE` |
| 8 | Pedidos = fonte oficial Pedidos de Venda | **PASS** | SalesOrder/Item + motor oficial; consistency QA c1–c3 |
| 9 | Responsável ≠ comissionável | **PASS** | Subtítulo UI + `comissionamentoAfetado: false` + tooltips |
| 10 | Pedidos sem vendedor Nomus → alerta | **PASS** | Audit strip + tags `Pedido s/ Nomus` + métricas API |
| 11 | Cliente sem responsável → alerta | **PASS** | Tag `Sem responsável` + audit “Clientes sem responsável” |
| 12 | Divergência responsável × vendedor | **PASS** | Tag `Divergência Nomus` + audit strip + footer nas listas |
| 13 | Sem erro no console | **NÃO OBSERVÁVEL** | Sem browser live neste ambiente |
| 14 | Sem 500 nas APIs | **PASS (contrato)** | Handlers CRM com try/catch; 500 só em falha real (não smoke HTTP) |
| 15 | Layout limpo / moderno / legível | **PASS (código)** | Executive cards, notas discretas, audit strip, empty states diferenciados |

---

## 4. Inconsistências encontradas

| Item | Severidade | Status |
|------|------------|--------|
| Ambiente local sem Postgres (`localhost:5432`) | Ambiente | **Ressalva** — bloqueia smoke UI/API live e Gislene live |
| Servidor `npm run dev` não estava em execução no momento do QA | Ambiente | **Ressalva** — browser visual não exercitado |
| Nenhuma inconsistência de produto (fonte Proposal, híbrido Nomus como dono, comissão via responsável) nos contratos atuais | — | **Nenhuma aberta** |

---

## 5. Correções feitas neste ciclo

Nenhuma correção de bug de produto necessária neste QA final.

Correções já incorporadas na linha recente (referência):

1. Backend: 3 abas no eixo **Responsável Comercial** + métricas **SalesOrder**.
2. UI: rename **Gestão por Responsável**, sourceInfo, auditoria, empty states, tooltips.
3. Script: `qaCrmCommercialSalesOrderConsistency.ts` (DB inacessível = SKIP, não FAIL).

---

## 6. Pendências

1. **Smoke visual obrigatório em servidor com DB:** abrir `/crm-commercial`, filtrar Gislene 30d, responsável sem carteira, carteira com tags de auditoria; checar Network (sem 500) e Console (sem erro).
2. Opcional: comparar um card Pedidos de Venda (eixo Nomus) vs CRM (eixo responsável) no mesmo período — totais **não** precisam coincidir.

---

## 7. Conclusão final

**LIBERADO COM RESSALVA.**

- Contratos de UI/API e consistência SalesOrder: **aprovados**.
- Gates (`imports`, `browser-bundle`, `test`, `build`, script QA): **aprovados**.
- Smoke visual/funcional browser + Network/Console: **pendente** até ambiente com Postgres e app no ar.

Critério de aceite de produto (responsável ≠ comissionável; fonte = Pedidos de Venda; alertas de auditoria; zeros só quando reais): **atendido no código**.

---

## 8. Evidências de validação automática

```text
npx tsx scripts/qaCrmCommercialSalesOrderConsistency.ts  → 29/29 PASS (live SKIP)
npm run check:server-imports                             → OK
npm run check:frontend-server-imports                    → OK
npm run check:browser-bundle                             → OK
npm test                                                 → OK
npm run build                                            → OK
```

### Checklist visual rápido (para o smoke no servidor)

- [ ] Abrir CRM → 3 abas visíveis conforme permissão
- [ ] Gestão Geral: KPIs + nota de fonte + faixa de auditoria
- [ ] Gestão por Responsável: filtro “Responsável comercial da carteira” → GISLENE LIMA
- [ ] Responsável sem clientes: mensagem “Nenhum cliente sob esta responsabilidade”
- [ ] Carteira: colunas responsável / último pedido / valor período / Nomus; tags Sem responsável / Divergência / s/ Nomus
- [ ] DevTools: sem 500 nos 3 GETs principais; sem erro de console na navegação das abas
