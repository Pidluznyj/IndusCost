# Pedidos de Venda — Auditoria de Performance + Consolidação Canônica

Missão autônoma executada apenas com acesso ao repositório Git e ambiente
local. Nenhum servidor, banco real, homologação ou produção foi acessado —
tudo que depende deles está marcado `SERVER_VALIDATION_PENDING`.

```
INITIAL SHA (origin/main): 4b710ad
BRANCH:                    perf/sales-order-screen-and-tabs
```

---

## 1. Arquitetura mapeada

```
SalesOrdersModule (src/components/SalesOrdersModule.tsx, 1.242 linhas)
├── SalesOrderList
│   ├── filtros draft × applied (consulta só no Pesquisar)
│   ├── GET /api/sales-orders            → grade + agregados no banco
│   ├── GET …/page-margins               → margens da página (após a grade)
│   ├── GET …/margin-summary             → margem geral (após a grade)
│   ├── GET …/seller-filter-options      → opções do filtro de vendedor
│   ├── SalesOrderListSummaryCards       → consome summary do servidor
│   ├── SalesOrderListMonthlyCharts      → cache de sessão (ttl), só Ano
│   ├── SalesOrderListTable
│   ├── SalesOrderQuickSummaryDrawer     → GET intelligence sob demanda
│   └── SalesOrderDetailDialog (LAZY após esta missão)
└── SalesOrderDetailRoute (/sales-orders/:id) → mesmo dialog (LAZY)

SalesOrderDetailDialog (350 linhas)
└── 1 request único: GET /api/sales-orders/:id/detail (cache sessão 30s,
    AbortController) → SalesOrderDetailPayload alimenta as 4 abas
    ├── Aba Geral      → SalesOrderDetailView   (summary/itens do payload)
    ├── Aba Tributos   → SalesOrderTributosTab  (payload.fiscalTaxes)
    ├── Aba Custos     → …CustosTab             (payload.industrialResult)
    └── Aba Resultado  → …ResultadoTab          (payload.industrialResult)
    Só a aba ativa monta; trocar de aba NÃO refaz fetch.
```

### Inventário das abas do detalhe

| TAB | COMPONENT | DATA SOURCE | ENGINE CANÔNICO | MOUNT | FETCH |
|---|---|---|---|---|---|
| geral | SalesOrderDetailView | payload único | orderFullAudit + FIN-05 + marginService | só quando ativa | nenhum próprio |
| tributos | SalesOrderTributosTab | payload.fiscalTaxes | salesOrderFiscalTaxes.server (gate de permissão no server) | só quando ativa | nenhum próprio |
| custos | SalesOrderDetailCustosTab | payload.industrialResult | salesOrderDetailIndustrialResult (bloco único) | só quando ativa | nenhum próprio |
| resultado | SalesOrderDetailResultadoTab | payload.industrialResult | o MESMO bloco da aba custos | só quando ativa | nenhum próprio |

---

## 2. Matriz de valores canônicos

| VALUE | CANONICAL SOURCE | CONSUMERS | DUPLICATES | CONSISTENT? | ACTION |
|---|---|---|---|---|---|
| Billing status | `resolveSalesOrderBillingStatus` (salesOrderListBillingStatus.ts) | lista (server.ts), detalhe, relatório XLSX/PDF, resultado industrial | 0 — todos importam a mesma função | SIM | caracterizado por teste |
| Margem item/pedido | `calculateSalesOrderItemMargin` + `…MarginSummary` (salesOrderMarginMath.ts) | 10 serviços (lista, detalhe, exports, dashboards, audit 360º) | 0 | SIM | caracterizado + differential vs média simples |
| Financeiro efetivo (CR real substitui previsão) | FIN-05 `salesOrderEffectiveFinancialSchedule` | detalhe, audit 360º, CR efetivo, ICR | 0 | SIM | já coberto por suíte própria + fixtures |
| Resultado industrial | `buildSalesOrderDetailIndustrialResultBlock` | abas Custos e Resultado (mesmo objeto) | 0 | SIM (por construção) | cross-tab caracterizado |
| Totais do rodapé do detalhe | `payload.summary` (detail service) | SalesOrderDetailView | 0 — rodapé NÃO re-soma itens | SIM | gate estrutural (sem reduce local) |
| Summary da lista | agregação Prisma no banco + `buildSalesOrderListSummaryFromAggregate` | SummaryCards | 0 | SIM | — |
| Cronograma de pagamento | `resolveSalesOrderListPaymentSummary` | lista, exports | 0 | SIM | teste apodrecido corrigido (ver §4) |

**DIVERGENT_BUG encontrados: NONE.** O domínio já passou por 11 rodadas de
perf documentadas (docs/perf-01…11) e a consolidação canônica está feita: os
componentes de exibição consomem DTOs prontos; nenhuma aba recalcula margem,
custo, recebido ou cobertura localmente. Os gates estruturais criados nesta
missão impedem regressão desse estado.

---

## 3. Baseline → After

| METRIC | BEFORE | AFTER | DELTA | EVIDENCE |
|---|---|---|---|---|
| Main JS | 8.123,91 kB | 8.083,13 kB | −40,78 kB | saída do vite build |
| Main JS gzip | 1.917,24 kB | 1.908,92 kB | −8,32 kB | idem |
| Chunk SalesOrderDetailDialog | inexistente (inlined no main) | 41,34 kB (gzip 9,60) sob demanda | novo split | idem |
| Warning import misto (Vite) | 1 | 0 | resolvido | idem |
| Consumidores lazy do DetailDialog | 4 de 5 | 5 de 5 | +1 | grep de imports |
| Refetch de seller-options ao trocar só o vendedor | 1 request desnecessário | 0 | deduplicado | deps do effect |
| Eager tabs no detalhe | 0 (só a ativa monta) | 0 | mantido | leitura do código |
| Requests estruturais ao abrir detalhe | 1 | 1 | mantido | leitura do código |
| Typecheck | 1.370 erros (dívida pré-existente) | 1.370 | 0 novos | tsc via binário do pacote |
| Latência HTTP real / EXPLAIN / payload produção | NOT AVAILABLE — NO SERVER ACCESS | — | — | — |

### Mudança 1 — lazy-load do DetailDialog no SalesOrdersModule

`SalesOrdersModule` era o **único** dos 5 consumidores com import estático do
`SalesOrderDetailDialog` — o warning do Vite ("dynamic import will not move
module into another chunk") apontava exatamente isso, e um import estático
basta para derrotar o split de todos. Convertido para `React.lazy` +
`Suspense fallback={null}`, com gate `detailOpen && detailOrderId != null`
para o chunk só baixar quando o usuário abre um pedido (o mesmo padrão dos
outros 4 consumidores). A rota `/sales-orders/:id` ganhou o mesmo Suspense.

### Mudança 2 — dedupe do fetch de seller-filter-options

O effect dependia de `[sellerOptionsFiltersKey, appliedFilters]`. O key
existe justamente para **excluir** `sellerKey` (trocar o vendedor não muda as
opções disponíveis), mas `appliedFilters` nas deps refazia o fetch em toda
aplicação de filtro, inclusive quando só o vendedor mudou. O effect agora lê
os campos do próprio key (`JSON.parse`) e depende só dele.

### Mudança 3 — teste apodrecido de payment schedule

`salesOrderListPaymentSchedule.test.ts` falhava na base limpa: fixture com
vencimento absoluto `08/08/2026` que ficou no passado — o motor, correto,
passou a reportar "Atrasado · A vencer" e o teste esperava "A vencer". O
motor sempre aceitou `referenceDate` injetável; o teste agora a fixa em
`10/07/2026`, anterior aos vencimentos do fixture. Nenhuma regra alterada.

---

## 4. Testes criados

`src/lib/sales-orders/salesOrderCanonicalValues.test.ts` — 22 casos:

- **Billing**: precedência completa; eliminatórios "cancelado nunca vira
  faturado" e "CR sem NF não fatura".
- **Margem**: caracterização numérica exata; differential provando ponderado
  (39,7%) ≠ média simples (25%); custo ausente → `SEM_CUSTO` com margem
  `null` (nunca zero); cancelado fora da consolidação; precedência de status
  (`ITEM_CANCELADO` > `SEM_PRODUTO_VINCULADO` > `RECEITA_INVALIDA` >
  `SEM_CUSTO` > `CUSTO_ZERO`); consolidação vazia → percentual `null`.
- **Industrial**: `materialsTotalCost` = roundMoney(Σ linhas); verdict com
  tolerância 0,9 centavo; determinismo cross-tab.
- **Gates estruturais** (source-inspection, padrão do repo): proíbem import
  estático do DetailDialog em qualquer consumidor, proíbem `appliedFilters`
  nas deps do effect de seller-options, proíbem aritmética de margem nos
  componentes de exibição, exigem AbortController no fluxo do detalhe.

Registrado em `scripts/unit-test-files.txt` e no script
`test:sales-orders-canonical`.

---

## 5. Achados sem ação (com justificativa)

| Achado | Classificação | Motivo |
|---|---|---|
| `salesOrderCommercialDiscountReport` calcula percent próprio | INTENTIONALLY_DIFFERENT | grandeza distinta: margem sobre valor **coberto** do relatório de desconto, não sobre receita líquida do pedido |
| Índices de banco | INDEX_CANDIDATE — nenhum criado | sem PostgreSQL real para validar plano; perf-06/08 já cobriram os índices da lista |
| Split adicional das abas do detalhe | DEFERRED | as 4 abas somam ~41 kB juntas no chunk novo; dividir mais criaria waterfall sem ganho mensurável |
| Cache global de payload de detalhe | NOT NEEDED | cache de sessão 30s já existe; dados financeiros não podem ficar stale além disso |

BUSINESS_DECISION_REQUIRED: **nenhum** — não foi encontrada divergência que
exigisse arbitragem de regra.

## 6. SERVER_VALIDATION_PENDING

- EXPLAIN ANALYZE das queries da lista/margens
- tempos reais de endpoint e waterfall de rede
- payload de produção
- validação dos INDEX_CANDIDATE em banco real
