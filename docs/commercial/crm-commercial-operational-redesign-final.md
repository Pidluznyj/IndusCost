# CRM Comercial — fechamento do redesenho operacional

**Projeto:** IndusCost / My Industry
**Data:** 2026-09-09
**Escopo:** Gestão por Responsável e Carteira de Clientes (`/crm-commercial`).
**Base:** `origin/main` `fa94a02` (já contém o fechamento da V2 — totais da
Carteira por universo, escopo do dashboard básico, ver
`docs/commercial/crm-portfolio-scoped-totals.md`).

Esta é a terceira e última missão da sequência de redesenho do CRM:

1. **V1** (`feat/crm-commercial-operational-redesign`, nunca integrada) —
   primeira tentativa de redesenho visual, ficou 90 commits atrás da main.
2. **V2** (integrada, `fa94a02`) — corrigiu bugs concretos de dado/escopo
   (totais page-scoped, eixo do dashboard básico) direto sobre a main atual,
   sem o redesenho visual.
3. **Esta missão** — entrega o redesenho visual/operacional que faltava,
   construído do zero sobre a V2 (não um merge da V1 antiga), preservando
   todas as invariantes da V2.

---

## 1. Contrato único de período (Ano/Mês)

Módulo: `src/components/crm/crmPeriodFilter.ts` (lógica pura, testada) +
`CrmPeriodFilterBar.tsx` (mesma barra "Ano ▼ / Mês ▼" já usada na Gestão
Geral desde antes desta missão).

| Tela | Default Ano | Default Mês | Motivo |
|---|---|---|---|
| **Gestão por Responsável** | Ano vigente (fuso America/Sao_Paulo, runtime) | Mês vigente | Tela de movimento/performance. |
| **Carteira de Clientes** | Ano vigente | "Ano inteiro" | Tela de carteira/relacionamento. Antes: nenhum seletor — backend caía em 30 dias ocultos. |
| Gestão Geral | Ano vigente | "Ano inteiro" | Já existia antes desta missão; não alterada. |

Deep-link: `?tab=general|seller|portfolio` + `{aba}Year`/`{aba}Month` na URL de
`/crm-commercial`, sincronizado via `history.replaceState`.

**Atenção operacional (Carteira):** o período filtra só as colunas de
movimento da tabela (`periodOrdersCount`/`periodPurchaseValue` por cliente).
Os totais de cadastro da faixa de auditoria (`totalCustomersInScope`, sem
responsável, sem compra, divergência — todos da V2) são sempre do histórico
completo do filtro, **não** do período selecionado — a UI diz isso
explicitamente na nota abaixo da barra de período, para não sugerir que todo
número da tela respeita o período escolhido.

---

## 2. Gestão por Responsável — o que mudou

- Preset de datas antigo (`Todos/Hoje/Semana/30d/90d/Personalizado`, default
  "Todos" = sem filtro) → barra Ano/Mês, default mês vigente.
- **Comparação entre responsáveis** (`CrmCommercialOwnerComparisonTable`),
  visível só quando "Todos os responsáveis" está selecionado: Responsável ·
  Pedidos · Valor · **% do total** · Ticket médio. Fonte:
  `commercialOwnerBreakdown`/`commercialOwnerRankingTotals`, novos campos na
  resposta de `GET /api/crm/seller-dashboard` — mas **dado já calculado**:
  `crmSalesOrderMetricsService.ts` já produzia `topCommercialOwners`/
  `commercialOwnerRankingTotals` (o mesmo motor da Gestão Geral); só não
  estava exposto na resposta. Nenhuma query nova.
- **Duas listas novas**: "Top clientes da carteira" (`topCustomers`) e
  "Pedidos sem follow-up" (`followUpCandidates`) — campos que a resposta já
  carregava, nunca renderizados.
- **Novo KPI "Clientes sem compra"**: `customerCount` (tamanho da carteira do
  responsável selecionado) menos `uniqueCustomersCount` (clientes com pedido
  no período) — cálculo derivado no frontend, sem query nova. **Só aparece**
  quando: (a) um responsável específico está selecionado (em "Todos" o
  backend não soma carteiras) e (b) nenhum filtro auxiliar de "Vendedor do
  pedido" (Nomus) está ativo — achado da revisão adversarial: com esse filtro
  ativo, `customerCount` (carteira inteira) e `uniqueCustomersCount`
  (filtrado também pelo vendedor Nomus) deixam de falar do mesmo universo, e
  o card superestimaria "sem compra".
- Os 11 KPI cards originais permanecem exatamente como estavam.

### Contrato de API (adição não-disruptiva)

`GET /api/crm/seller-dashboard` ganha:

```ts
commercialOwnerBreakdown: { key, label, orders, value }[]
commercialOwnerRankingTotals: { groups, value, orders, truncatedForDisplay }
```

Nenhum campo existente mudou de forma ou semântica.

---

## 3. Carteira de Clientes — o que mudou

- Barra Ano/Mês (antes: nenhum seletor de período na UI).
- **A lista de cards estreita virou uma tabela operacional** de largura
  cheia (`CrmCustomerPortfolioTable`): Cliente · Responsável · Status ·
  Última compra · Dias sem compra · Pedidos no período · Venda no período ·
  Ticket médio · Atenção · Ações (**Abrir** / **Ver 360**, botões com
  texto). Todas as colunas usam campos que `CrmCustomerListItem` já
  expunha — nenhuma agregação nova no backend.
  - **Status** usa o enum já existente `CrmPortfolioStatus`.
  - **"Atenção"** usa só as flags booleanas já computadas e testadas pela V2
    (`hasOverdueFollowUp`, `hasCommercialOwner`, `hasOwnerSellerDivergence`,
    `hasOrderWithoutNomusSeller`) — nenhuma classificação de risco nova.
  - **"Dias sem compra"** ganha destaque visual (âmbar) acima de 365 dias —
    o mesmo valor de `CUSTOMER_INTELLIGENCE_INACTIVE_DAYS`
    (`src/lib/customerIntelligenceScoring.ts`, motor de Inteligência do
    Cliente), duplicado como constante local porque aquele módulo é
    server-only e não pode ser importado no frontend.
- **Paginação real**: `CrmCustomerPortfolioTable` ganha Anterior/Próxima
  sobre `offset`/`pagination.hasMore` — campos que o backend já calculava
  corretamente, mas nenhuma tela usava (todo call site pedia `offset=0`
  fixo). Qualquer mudança de filtro (busca, chip, responsável, período,
  limpar filtros) zera a paginação de volta à primeira página.
- A faixa de auditoria da V2 (5 métricas: total no filtro, sem responsável,
  sem compra, pedido sem vendedor Nomus, divergência) e o aviso de
  truncamento continuam **exatamente como a V2 entregou** — funcionam como o
  "KPI row" desta tela; esta missão não duplicou uma segunda faixa de KPIs.
- O cockpit do cliente (`CrmCustomerAccountCockpit`, inalterado — os rótulos
  "Na lista:" da V2 continuam intactos) passa a abrir abaixo da tabela
  quando um cliente é selecionado, com scroll automático até ele.
- **Não implementado**: coluna "Propostas abertas" — exigiria nova
  agregação sobre `Proposal` por cliente, sem fonte pronta hoje.

### Contrato de API

Nenhuma mudança — `GET /api/crm/customers` já aceitava `dateFrom`/`dateTo`
(agora enviados pelo frontend a partir da barra Ano/Mês) e já retornava
`pagination.offset`/`limit`/`hasMore` (agora consumidos pela UI).

---

## 4. Responsável Comercial × Vendedor do Pedido — como ficou

Sem mudança de regra. A nova comparação entre responsáveis agrupa por
`bucketLabel` do responsável comercial (mesma função
`resolveActiveCommercialOwner` usada em toda a Gestão Geral); clientes sem
responsável aparecem no bucket "Sem responsável comercial", nunca omitidos
silenciosamente. Vendedor do pedido (Nomus) continua só auditoria/divergência
(badge "Divergência Nomus" agora também na tabela da Carteira).

---

## 5. Navegação

Confirmado nesta missão (auditoria da main atual antes de implementar):
Gestão Geral / Gestão por Responsável ("Meu Dashboard" para vendedor) /
Carteira de Clientes / Cliente 360 já eram telas claramente separadas, sem
sobreposição de propósito — nenhuma mudança de navegação foi necessária.

**Achado, não corrigido (fora do escopo desta missão):** o Cadastro de
Clientes (`/customers`) ainda tem um modal legado "Visão comercial do
cliente" (`CustomerCommercial360.tsx`) que duplica boa parte do Cliente 360
canônico (`CustomerIntelligencePage`, `/crm/customers/:id/intelligence`).
Já identificado na auditoria da V1 (07/2026) e novamente aqui — candidato a
missão própria de consolidação. Esta missão não criou nenhum novo Cliente
360; a tabela da Carteira só linka para o canônico.

---

## 6. Matriz de indicadores

| Indicador | Tela | Fonte | Eixo de data | Status |
|---|---|---|---|---|
| Comparação entre responsáveis (Pedidos/Valor/%/Ticket) | Gestão por Responsável | `commercialOwnerBreakdown` (motor oficial, já computado) | issueDate | **NOVO (exposto)** |
| Top clientes da carteira | Gestão por Responsável | `topCustomers` (já computado) | issueDate | **NOVO (exposto)** |
| Pedidos sem follow-up | Gestão por Responsável | `followUpCandidates` (já computado) | updatedAt | **NOVO (exposto)** |
| Clientes sem compra | Gestão por Responsável | Derivado: customerCount − uniqueCustomersCount | issueDate | **NOVO (frontend, sem query)** |
| 11 KPIs originais | Gestão por Responsável | Motor oficial | issueDate | KEEP |
| Tabela operacional (10 colunas) | Carteira | `CrmCustomerListItem` (já existia) | — | **REDESENHADO (mesma fonte)** |
| Paginação | Carteira | `pagination` (já existia, não usado) | — | **NOVO (exposto)** |
| Total no filtro / sem responsável / sem compra / divergência | Carteira | V2 (`totals`) | — | KEEP (V2, intocado) |

---

## 7. Performance

Nenhuma query nova no backend. As duas únicas mudanças de payload
(`commercialOwnerBreakdown`/`commercialOwnerRankingTotals`) reaproveitam um
cálculo que já rodava a cada request — só passaram a ser serializadas na
resposta. A paginação da Carteira usa exatamente os mesmos parâmetros
(`limit`/`offset`) que o endpoint já validava e testava.

---

## 8. Testes

| Arquivo | Cobertura |
|---|---|
| `src/components/crm/crmPeriodFilter.test.ts` | Contrato de período — ano vigente, virada de ano, ano completo, deep-link, limpar filtros |
| `src/components/crmSellerDashboardUi.test.ts` | Gating do card "Clientes sem compra" (achado da revisão adversarial) |
| `src/lib/crmCommercialOperationalRedesignFinal.test.ts` | Contrato desta missão nas duas telas + trava as invariantes da V2 (totais por universo, `$transaction`, `ownerDiffersFromOrderSellers`, escopo fail-closed do dashboard básico, rótulos "Na lista:") |

Todos registrados em `npm run test:customers`.

---

## 9. Limitações conhecidas

1. **Sem validação visual com dados reais**: Postgres local inacessível
   (`localhost:5432`), mesma limitação de todas as auditorias anteriores
   deste módulo. Validado via build de produção, testes determinísticos e
   guards de import; um boot real do servidor confirmou o shell/login
   renderizando sem erro de console.
2. **"Propostas abertas" por cliente** não implementada — sem fonte pronta.
3. **Duplicação Cliente 360 × `CustomerCommercial360`** (Cadastro de
   Clientes) — achado, não corrigido, candidato a missão própria.
4. Gestão Geral e `/api/crm/dashboard/basic` não foram tocados — já
   conformes (Gestão Geral) ou sem consumidor no frontend (dashboard/basic).
