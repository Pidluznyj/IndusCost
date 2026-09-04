# Redesenho operacional — Gestão por Responsável e Carteira de Clientes

**Projeto:** IndusCost / My Industry
**Data:** 2026-09-04
**Escopo:** CRM Comercial (`/crm-commercial`) — abas "Gestão por Responsável" e "Carteira de Clientes"; contrato de período compartilhado com as 3 abas.
**Base:** auditoria completa do CRM (docs/commercial/crm-commercial-official-rules.md e demais docs desta pasta) — nenhuma regra de negócio, eixo de responsável/vendedor ou motor de cálculo foi alterado. Este documento cobre só a camada de apresentação e o contrato de período.

---

## 1. Por que este redesenho

A auditoria de 09/2026 encontrou dois problemas estruturais nas telas prioritárias, sem violar nenhuma regra oficial já documentada:

1. **Nenhuma das duas telas seguia um contrato de período previsível.** "Gestão por Responsável" abria com preset `"Todos"` (histórico inteiro, sem filtro de data); "Carteira de Clientes" não tinha seletor de período algum e o backend caía silenciosamente em "últimos 30 dias" quando nada era enviado.
2. **"Carteira de Clientes" não era uma tabela operacional.** Era uma lista estreita de cards (largura fixa ~320-420px) funcionando como seletor para o cockpit — sem colunas, sem ordenação visual, sem ação explícita por linha.

Nenhum dos dois problemas era de cálculo: os KPIs, o eixo Responsável Comercial × Vendedor do Pedido e as fontes oficiais (`SalesOrder`/`SalesOrderItem` via motor oficial) já estavam corretos. O trabalho foi 100% de contrato de período + apresentação, reaproveitando dados que o backend já calculava.

---

## 2. Contrato único de período (Ano/Mês)

Novo módulo: [`src/components/crm/crmPeriodFilter.ts`](../../src/components/crm/crmPeriodFilter.ts) (lógica pura, testada em `crmPeriodFilter.test.ts`) + [`CrmPeriodFilterBar.tsx`](../../src/components/crm/CrmPeriodFilterBar.tsx) (UI — mesma barra "Ano ▼ / Mês ▼" já usada na Gestão Geral).

| Tela | Default Ano | Default Mês | Motivo |
|---|---|---|---|
| **Gestão por Responsável** | Ano vigente (`resolveCrmCurrentYearMonth`, fuso America/Sao_Paulo) | Mês vigente | Tela de movimento/performance — pergunta "como estou indo agora". |
| **Carteira de Clientes** | Ano vigente | "Ano inteiro" (`month: ""`) | Tela de carteira/relacionamento — pergunta "como está minha base este ano". |
| **Gestão Geral** | Ano vigente | "Ano inteiro" (já existia antes desta missão) | Não alterada nesta missão — já seguia o padrão. |

- **Ano nunca é hardcoded** — sempre `new Intl.DateTimeFormat(..., {timeZone: "America/Sao_Paulo"})` no momento do render.
- **"Limpar filtros"** restaura o default oficial da tela (ano vigente + mês conforme a tabela acima) — nunca "sem período".
- **Deep-link:** a URL de `/crm-commercial` reflete `?tab=general|seller|portfolio` + `{aba}Year`/`{aba}Month` (ex.: `?tab=seller&sellerYear=2026&sellerMonth=9`). Um reload ou link compartilhado abre exatamente no mesmo recorte. Sincronização via `history.replaceState` (não empilha histórico a cada troca de filtro).
- **Limitação conhecida:** a Gestão Geral aceita "Todos os anos" (`year: ""`) na própria UI; esse valor não sobrevive a um reload via deep-link (o parser da URL exige ano de 4 dígitos e cai no default se vazio). Comportamento pré-existente não piorado — antes não havia deep-link nenhum.

O ano/mês é resolvido no **frontend** para `dateFrom`/`dateTo` (`buildCrmPeriodDateRange`) e enviado explicitamente a `/api/crm/seller-dashboard` e `/api/crm/customers` — **nenhum contrato de API mudou**, os dois endpoints já aceitavam `dateFrom`/`dateTo` livremente.

---

## 3. Gestão por Responsável — o que mudou

Arquivo: `src/components/CrmSellerDashboardSection.tsx` + `CrmSellerDashboardLists.tsx`.

- Substituído o seletor de preset (`Todos/Hoje/Semana/Mês/30d/90d/Personalizado`) pela barra Ano/Mês.
- **Nova seção "Comparação entre responsáveis"** (`CrmCommercialOwnerComparisonTable.tsx`), visível só quando "Todos os responsáveis" está selecionado. Mostra Responsável · Pedidos · Valor · **% do total** · Ticket médio — participação relativa, não ranking absoluto. Fonte: `commercialOwnerBreakdown`/`commercialOwnerRankingTotals`, campos **já calculados** por `loadCrmSalesOrderMetrics` (o mesmo motor da Gestão Geral) e que só não eram expostos na resposta da API — nenhuma query nova.
- **Duas listas novas** em `CrmSellerDashboardLists.tsx`: "Top clientes da carteira" (`topCustomers`) e "Pedidos sem follow-up" (`followUpCandidates`) — ambos campos já computados pelo backend e nunca renderizados antes.
- KPIs (11 cards) mantidos exatamente como estavam — já tinham definição clara e fonte oficial.

### Contrato de API (adição não-disruptiva)

`GET /api/crm/seller-dashboard` agora retorna dois campos a mais na resposta:

```ts
commercialOwnerBreakdown: { key, label, orders, value }[]
commercialOwnerRankingTotals: { groups, value, orders, truncatedForDisplay }
```

Nenhum campo existente mudou de forma ou semântica.

---

## 4. Carteira de Clientes — o que mudou

Arquivo: `src/components/crm/CrmCustomerPortfolioSection.tsx` + novo `CrmCustomerPortfolioTable.tsx`.

- Barra Ano/Mês adicionada (antes: nenhum seletor de período).
- **Nova seção de KPIs** antes da tabela (Fase 12 da missão): Total de clientes no filtro, Exibindo nesta lista, Com histórico de compra, Carteira aberta, Sem responsável comercial, Venda no período. Os rótulos distinguem explicitamente "universo do filtro" (`totalCustomersInScope`, corrigido no backend — ver §5) de "nesta lista" (métricas da página atual) para não repetir o erro de tratar contagem de página como total.
- **A lista de cards estreita virou uma tabela real** (`CrmCustomerPortfolioTable.tsx`), largura cheia, colunas: Cliente · Responsável · Status · Última compra · Dias sem compra · Pedidos no período · Venda no período · Ticket médio · Atenção · Ações (**Abrir** / **Ver 360**, botões com texto, não só ícone).
  - **Status** usa o enum canônico já existente `CrmPortfolioStatus` (`SEM_COMPRA` / `CARTEIRA_ABERTA` / `SOMENTE_FATURADO` / `COM_HISTORICO`) — nenhuma classificação nova.
  - **"Atenção"** usa exclusivamente flags booleanas já computadas e testadas (`hasOverdueFollowUp`, `hasCommercialOwner`, `hasOwnerSellerDivergence`, `hasOrderWithoutNomusSeller`) — nenhum "score" novo.
  - **"Dias sem compra"** ganha destaque visual (âmbar) acima de 365 dias — o mesmo número de `CUSTOMER_INTELLIGENCE_INACTIVE_DAYS` (motor de Inteligência do Cliente, `src/lib/customerIntelligenceScoring.ts`). Duplicado como constante local no componente porque aquele módulo é server-only (não pode ser importado no frontend); é o mesmo valor, não uma régua nova — ver `check:frontend-server-imports`.
- O cockpit do cliente (`CrmCustomerAccountCockpit`) continua existindo, agora abaixo da tabela quando um cliente é selecionado (rola automaticamente até ele).
- **"Propostas abertas"** (coluna cogitada na missão) **não foi adicionada** — exigiria uma nova agregação sobre `Proposal` por cliente (contagem em janela aberta), que não existe hoje em `CrmCustomerListItem`. Ficou de fora deliberadamente para não expandir escopo de backend além do necessário; ver §7 (pendências).

### Contrato de API (correção de bug + adição não-disruptiva)

`GET /api/crm/customers` — `totals` ganhou `totalCustomersInScope: number`, contando o **mesmo `where`** da consulta paginada (não mais o array da página). Os demais 4 sub-totais de `totals` (`customersWithoutCommercialOwner` etc.) **continuam escopados à página** — não foram "consertados" nesta missão porque exigiriam replicar filtros Prisma complexos em contagens agregadas separadas, com risco real de repetir o bug histórico documentado em `docs/commercial/project_invested_capital_recovery` (`isNot` vs `NOT`+`is` zerando resultado). Ver pendência em §7.

---

## 5. Matriz de indicadores (Fase 38 da auditoria)

| Indicador | Tela | Definição | Fonte | Eixo de data | Filtro Ano | Filtro Mês | Responsável/Vendedor | Drilldown | Status |
|---|---|---|---|---|---|---|---|---|---|
| Pedidos emitidos / Valor | Gestão por Responsável | `SalesOrder` válidos da carteira | Motor oficial (`resolveOfficialScopedOrderMetrics`) | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Carteira aberta / Valor | Gestão por Responsável | Válido sem NF processada | Motor oficial | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Faturados / Valor | Gestão por Responsável | Com NFe processada | Motor oficial | `issueDate` + NFe | Sim | Sim | Responsável Comercial | — | KEEP |
| Cancelados | Gestão por Responsável | `status = CANCELLED` | `SalesOrder` | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Ticket médio | Gestão por Responsável | Valor válido ÷ qtd | Motor oficial | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Clientes com pedido | Gestão por Responsável | Distintos com pedido válido | Motor oficial | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Produto líder | Gestão por Responsável | Maior receita | `SalesOrderItem` | `issueDate` | Sim | Sim | Responsável Comercial | — | KEEP |
| Pedidos sem proposta vinculada | Gestão por Responsável | Rastreabilidade, não KPI de venda | `SalesOrder.proposalId IS NULL` | `issueDate` | Sim | Sim | Responsável Comercial | Lista já existente | KEEP |
| **Comparação entre responsáveis** | Gestão por Responsável | Pedidos/Valor/% do total por responsável | `loadCrmSalesOrderMetrics` (campo já existia, não exposto) | `issueDate` | Sim | Sim | Todos (agregado) | **NOVO** — botão "Ver carteira" por linha | **NEW** |
| **Top clientes da carteira** | Gestão por Responsável | Maior valor no período | Motor oficial (`topCustomers`, já computado) | `issueDate` | Sim | Sim | Responsável Comercial | Abre cliente | **NEW (exposto)** |
| **Pedidos sem follow-up** | Gestão por Responsável | Carteira aberta sem contato | `followUpCandidates` (já computado) | `updatedAt` | Sim | Sim | Responsável Comercial | Abre cliente | **NEW (exposto)** |
| **Total de clientes no filtro** | Carteira de Clientes | Universo real do `where` aplicado | `customer.count({where})` — **fix** | — | Sim | Sim | Escopo do filtro | — | **NEW (fix)** |
| Exibindo nesta lista / Com histórico / Carteira aberta / Sem responsável / Venda no período | Carteira de Clientes | Somas sobre a página exibida (rotuladas como tal) | `CrmCustomerListItem[]` | `issueDate` no valor do período | Sim | Sim | Escopo do filtro | Clique na linha | KEEP_AND_REPOSITION |
| Status (badge) | Carteira de Clientes | `CrmPortfolioStatus` | Enum já existente | — | — | — | — | — | KEEP_AND_REPOSITION |
| Dias sem compra | Carteira de Clientes | `daysSinceLastOrder` | Já existia no item da lista | `issueDate` do último pedido | — | — | — | — | KEEP_AND_REPOSITION |
| Atenção (badges) | Carteira de Clientes | Flags booleanas já existentes | `CrmCustomerListItem` | — | — | — | — | — | KEEP_AND_REPOSITION |
| Propostas abertas | Carteira de Clientes | — | — | — | — | — | — | — | **REMOVE_FROM_PRIMARY_VIEW** (não implementado — exigiria nova agregação) |

---

## 6. Responsável Comercial × Vendedor do Pedido — como ficou

Sem mudança de regra. Continua exatamente como em `docs/commercial/crm-commercial-official-rules.md`:

- **Eixo de carteira** (as duas telas redesenhadas): `CrmCustomerCommercialOwner` (manual) — nunca o vendedor Nomus do pedido.
- **Vendedor do pedido**: só auditoria/divergência (`hasOwnerSellerDivergence`, badge "Divergência Nomus" na tabela da Carteira).
- **Comissão**: fora de escopo, eixo Nomus, não tocado.
- A nova "Comparação entre responsáveis" agrupa por `bucketLabel` do responsável comercial (mesma função `resolveActiveCommercialOwner` usada em toda a Gestão Geral) — clientes sem responsável aparecem no bucket "Sem responsável comercial", sinalizado com badge âmbar, nunca omitidos silenciosamente.

---

## 7. Pendências conhecidas (não bloqueiam a entrega)

1. **Sub-totais de qualidade da Carteira** (`customersWithoutCommercialOwner`, `customersWithOrderWithoutNomusSeller`, `customersWithOwnerSellerDivergence`) continuam escopados à página, não ao universo do filtro. Corrigir exigiria queries agregadas dedicadas por flag — proposto como missão própria para não arriscar repetir bugs de filtro Prisma já documentados no projeto.
2. **"Propostas abertas" por cliente** não foi adicionada à tabela da Carteira — não há fonte pronta (exigiria `groupBy` sobre `Proposal` por `customerId` filtrando status de negociação aberta).
3. **`/api/crm/dashboard/basic`** (widget não usado pelas 2 telas redesenhadas) continua escopando "own" pelo vendedor Nomus, não pelo responsável comercial — gap identificado na auditoria de backend, fora do escopo desta missão (tela não tocada).
4. **Deep-link de "Todos os anos"** na Gestão Geral não sobrevive a um reload (cai no ano vigente) — ver §2.
5. **Visual smoke test ao vivo não foi possível**: Postgres local inacessível (`localhost:5432`), mesma limitação documentada nas 3 auditorias anteriores deste módulo (jul-ago/2026). O app foi validado de ponta a ponta com build de produção + testes automatizados + um boot real do servidor (porta alternativa, sem colidir com outra sessão em paralelo) confirmando shell/login renderizando sem erro de console — mas as telas de CRM em si não puderam ser abertas com sessão autenticada.
