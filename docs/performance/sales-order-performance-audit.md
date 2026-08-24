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

---

## REAL HOMOLOGATION VALIDATION — 2026-08-24

Rodada de validação contra o ambiente REAL de homologação
(`192.168.100.5:3001`, alcançável pela LAN). Rótulos: **MEASURED** (medido de
fato), **CODE-VERIFIED** (provado por código/teste/build), **BLOCKED** (rota
de acesso inexistente — motivo objetivo registrado).

### A. CODE AUDIT
Sem mudanças conceituais desde a rodada anterior. `HOMOLOG_COMMIT = 84069d2`
= `origin/main` no momento da medição (build de 24/08 13:25 UTC) — comparação
binária válida: o `main-*.js` servido pela homolog tem exatamente os
6.982.092 bytes do build local.

### B. SERVER MEASUREMENTS — MEASURED (parcial)
Rede LAN → homolog: TTFB 10–65 ms nos probes. Endpoints autenticados de
Pedidos de Venda respondem **401** sem sessão (guard correto).

**AUTH_BLOCKED** para os tempos de lista/detalhe/seller-options: a extensão
Claude in Chrome (sessão real do operador) estava desconectada, não existe
credencial utilizável nesta máquina e a missão proíbe inventar login. Os
p50/p95 desses endpoints ficam para uma rodada com sessão disponível.

### C. DATABASE PLANS — BLOCKED
PostgreSQL da homolog inacessível desta máquina: porta 5432 fechada na LAN e
no Tailscale (parado localmente), sem chave SSH (`~/.ssh` só tem
known_hosts). EXPLAIN/inventário de índices/pg_stat exigem execução no
próprio servidor — **READ_ONLY_DB_VALIDATION = BLOCKED**, com o roteiro
seguro (BEGIN READ ONLY + timeouts + ROLLBACK) já documentado na memória
operacional do projeto para quem tiver acesso.

### D. NETWORK WATERFALL — MEASURED (bootstrap) / CODE-VERIFIED (demais)
Bootstrap real na homolog (browser in-app, página de login = mesmo bundle):
exatamente 4 requests — `main-*.js`, `client-*.js`, `main-*.css`,
`/api/auth/me`. **Nenhum chunk `SalesOrderDetailDialog` no boot** (prova A do
plano). O chunk existe no dist da homolog (`SalesOrderDetailDialog-COTyt7BG.js`,
41.348 bytes) e só é referenciado via import dinâmico (0 ocorrências no HTML)
— provas B–E (abrir detalhe, abas, dedupe de seller) dependem de sessão:
cobertas por gates estruturais e testes (CODE-VERIFIED), não medidas ao vivo.

### E. BOTTLENECK ENCONTRADO — MEASURED
**Transporte sem compressão.** A homolog servia `main-*.js` com
`content-encoding` vazio mesmo com `Accept-Encoding: gzip, br` — 6.982.092
bytes transferidos por carga fria (~0,8–1,0 s na LAN; muito pior fora dela).
Causa: `express.static` não comprime e a homolog é acessada direto na porta
3001, sem proxy comprimindo na frente. O mesmo vale para os JSONs das APIs.

### F. CHANGES IMPLEMENTED
Middleware `compression` (pacote oficial do Express, threshold 1 KB),
registrado antes do body parser — cobre assets estáticos E respostas JSON.
Sem SSE no projeto (verificado). Prova local em modo produção:

| Asset | Antes (homolog, MEASURED) | Depois (local, MEASURED) | Δ |
|---|---|---|---|
| main-*.js | 6.982.092 bytes | **1.564.475 bytes (br)** | **−77,6%** |
| main-*.css | 378.817 | 51.038 (br) | −86,5% |
| SalesOrderDetailDialog-*.js | 41.348 | 9.940 (br) | −76,0% |
| fallback sem Accept-Encoding | — | bytes originais, sem encoding | correto |

O middleware negociou **brotli** (melhor que o gzip previsto: 1,56 MB vs
1,65 MB). Assets têm `Cache-Control: immutable`, então o custo de CPU é pago
uma vez por cliente.

### G. REMAINING RISKS / PENDÊNCIAS
- p50/p95 dos endpoints autenticados: **AUTH_BLOCKED** (medir com sessão).
- EXPLAIN/índices reais: **BLOCKED** (sem rota ao PG). Nenhum índice proposto
  sem plano real — regra do §11 mantida: `INDEX_CANDIDATE` continua vazio.
- `HOMOLOG_DEPLOY_REQUIRED=YES` para a compressão chegar à homolog (deploy
  pelo fluxo oficial, fora desta missão).
