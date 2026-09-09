# Totais da Carteira e escopo do dashboard básico — estado oficial

**Projeto:** IndusCost / CRM Comercial
**Data:** 2026-09-09
**Escopo:** `/api/crm/customers` (totais da Carteira de Clientes) e `/api/crm/dashboard/basic` (escopo de acesso).

Este documento descreve o **estado vigente** depois da correção. Substitui, nos
dois pontos que cobre, as pendências registradas em
`crm-commercial-cockpit-redesign.md` §7 (documento histórico de uma branch que
nunca foi integrada).

---

## 1. Regra: card de total conta o universo, nunca a página

Um indicador apresentado como total do filtro **tem que** ser contado no banco
com o mesmo `where` da listagem. É proibido derivá-lo do array já paginado
(`items.length`, `.filter().length`, `.every()` sobre a página).

Quando um número for legitimamente da página, o **rótulo precisa dizer isso**
("Na lista: …"). Ambiguidade entre página e universo é defeito, não estilo.

Essa proibição não estava escrita em `docs/commercial/` — existia só para
Top-N e truncamento (`crm-cockpit-sales-order-mirror.md`). Fica registrada aqui.

### O que estava errado

`src/lib/crmCustomersList.ts` calculava os quatro sub-totais de qualidade com
`customers.filter(...).length` sobre `pageRows`. Com o limite padrão de 50, um
card rotulado "Clientes sem responsável comercial" nunca passava de 50 e mudava
de valor conforme o usuário paginava. Não havia nenhuma asserção de `totals` no
teste da lista.

### Como ficou

| Indicador | Fonte | Escopo |
|---|---|---|
| `totalCustomersInScope` | `prisma.customer.count({ where })` | Universo do filtro (exato) |
| `customersWithoutCommercialOwner` | consulta agregada | Universo do filtro |
| `customersWithoutPurchase` | consulta agregada | Universo do filtro |
| `customersWithOrderWithoutNomusSeller` | consulta agregada | Universo do filtro |
| `customersWithOwnerSellerDivergence` | consulta agregada | Universo do filtro |
| `qualityTotalsTruncated` | `total > ids agregados` | Sinaliza universo acima do teto |
| `PortfolioEmptySummary` (4 cards) | `computePortfolioEmptySummary` | **Página** — rotulado "Na lista:" |

Página, universo e IDs do universo saem do **mesmo `where`**, resolvidos juntos
num `Promise.all` (`crmCustomersList.ts`). A agregação vive em
`src/lib/crmCustomersListQualityTotals.ts`.

### Data lineage dos quatro sub-totais

Os predicados SQL replicam, por construção, o que o enriquecimento por linha já
aplicava em JS — é essa paridade que permite reconciliar o card com a tabela:

| Sub-total | Predicado | Espelha (JS) |
|---|---|---|
| sem responsável | `LEFT JOIN CrmCustomerCommercialOwner … isActive = true` ausente | `Boolean(manual)` em `mapCustomerRowsToListItems` |
| sem compra | `NOT EXISTS SalesOrder` válido | `hasPurchaseHistory` em `enrichCustomersFromSalesOrders` |
| pedido sem vendedor Nomus | `EXISTS SalesOrder válido AND externalSellerId IS NULL` | `isNomusSellerInformed` (= `externalSellerId != null`) |
| responsável ≠ vendedor | owner ativo **e** compra **e** (id divergente **ou** nome normalizado divergente), só contra pedidos com vendedor informado | `ownerDiffersFromOrderSellers` |

População de pedido: `CANCELLED` e `ERROR` fora — o mesmo recorte que as demais
consultas desta tela usam (`crmCustomersList.ts`). Os quatro sub-totais são de
**qualidade cadastral**, não de movimento: não são filtrados por período.

### Teto e truncamento

A agregação cobre até `CRM_CUSTOMERS_QUALITY_TOTALS_MAX` (20.000) clientes,
mesmo teto já adotado pelo motor de métricas do CRM. Acima disso,
`qualityTotalsTruncated = true` e a UI exibe faixa âmbar avisando que os
indicadores estão subestimados — o padrão do projeto é **avisar**, nunca
apresentar número parcial como total.

`totalCustomersInScope` é sempre exato: vem de `count`, não do teto.

---

## 2. Escopo de `/api/crm/dashboard/basic`

**Eixo oficial: Responsável Comercial do cliente** (`CrmCustomerCommercialOwner`),
o mesmo de `/api/crm/customers` e do seller dashboard.

O endpoint escopava `own` pelo **vendedor Nomus do pedido**, via
`buildCrmSellerCustomerExistsSql` — função marcada `@deprecated` justamente por
isso. Era o único ponto do CRM fora do eixo de carteira.

Havia um segundo defeito, mais grave: a chamada omitia `sellerIdentityKey`.
Como `crmCommercialSellerMatchFilters` zera `externalSellerId`/`responsible`
sempre que existe identity key, o filtro caía em todas as branches e retornava
`Prisma.sql\`TRUE\``. Um usuário de escopo próprio recebia contagens de
praticamente toda a base. Não havia teste cobrindo o endpoint.

Agora a carteira é resolvida uma vez por `fetchCrmManualOwnerCustomerIds` e
reaproveitada por todas as contagens. O predicado virou função pura exportada
(`buildCrmDashboardBasicCustomerScopeSql`), testável sem banco, e é
**fail-closed**: `own` sem carteira retorna `FALSE`, nunca `TRUE`.

Responsável Comercial e Vendedor do Pedido continuam eixos separados, conforme
`crm-commercial-owner-and-order-seller-rules.md`: carteira é do responsável;
vendedor Nomus é auditoria/comissão e **nunca** define acesso.

---

## 3. Performance

- Requisição da Carteira: 3 consultas em paralelo (página, `count`, IDs do
  universo) + 1 agregada. Sem N+1 — a agregada usa `EXISTS` por cliente e não
  carrega linhas de pedido.
- `/dashboard/basic`: a carteira é resolvida uma única vez, não por contagem.

---

## 4. Cobertura de teste

| Arquivo | Prova |
|---|---|
| `src/lib/crmCustomersListQualityTotals.test.ts` | total do universo (50) não é limitado pela página (10); consulta única; universo vazio não vai ao banco; população e eixo de divergência |
| `src/lib/crmDashboardBasicScope.test.ts` | `own` sem carteira é `FALSE`; eixo depreciado não volta; regressão Owner A × Seller B |
| `src/components/crm/crmPortfolioScopeLabels.test.ts` | rótulos page-scoped se identificam; faixa de auditoria expõe o total do universo; aviso de truncamento |

Todos registrados em `npm run test:customers`.

---

## 5. Limitações conhecidas

1. **Sem validação visual**: Postgres local inacessível (`localhost:5432`) — a
   mesma limitação registrada nas auditorias anteriores deste módulo. As regras
   são cobertas por testes determinísticos, build e import guards; a conferência
   dos números com dados reais precisa acontecer em homologação.
2. **Universos acima de 20.000 clientes** têm os quatro sub-totais de qualidade
   truncados (sinalizado na UI). `totalCustomersInScope` permanece exato.
3. ~~A Carteira continua sem filtro de período na UI~~ — **resolvido** na missão
   de fechamento do redesenho operacional (branch
   `feat/crm-commercial-operational-redesign-final`): barra Ano/Mês
   compartilhada (`CrmPeriodFilterBar`), default "Ano inteiro". Ver
   `docs/commercial/crm-commercial-operational-redesign-final.md`.
4. ~~A Carteira não tem paginação na UI~~ — **resolvido** na mesma missão:
   `CrmCustomerPortfolioTable` ganhou Anterior/Próxima reais sobre
   `offset`/`hasMore`, que o backend já calculava corretamente.
5. **`ERROR` vs `CANCELLED`**: esta tela exclui os dois, enquanto a população
   canônica de Pedidos de Venda mantém `ERROR`
   (`crm-cockpit-sales-order-mirror.md`). Divergência **pré-existente** e
   preservada aqui para não alterar silenciosamente os números da Carteira;
   merece missão própria.
