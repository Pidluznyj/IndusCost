# Diagnóstico UX e performance — Cards Pedidos de Venda

## 1. Cards transparentes / “soltos”

### Causa raiz

`metric-card.css` usava tokens shadcn legados (`hsl(var(--card))`, `hsl(var(--border))`) que **não existem** no tema Tailwind v4 do projeto (`index.css` define apenas `--color-card`, `--color-border`).

Efeito:

- `background` e `border` inválidos → cards sem superfície visível
- `box-shadow: none` → zero separação do fundo `bg-background`
- Seções KPI sem painel (`SalesOrderKpiSection` sem borda/fundo) → hierarquia fraca

### Correção

- CSS alinhado a `var(--color-card)` / `var(--color-border)` + sombra leve
- `SalesOrderKpiSection` com painel sólido (`bg-card`, `border`, `shadow-sm`) por padrão
- Hover sutil em cards clicáveis

## 2. Lentidão percebida

### Diagnóstico (antes)

| Item | Gestão | Listagem |
|------|--------|----------|
| Fetches no mount | 1 (`GET /api/sales-orders/management`) | 1 (`GET /api/sales-orders`) |
| Cards com fetch próprio | Não | Não |
| Cálculo pesado no React | Baixo (helpers de formatação) | Baixo |
| Re-renders | Dashboard monolítico re-renderizava todos os blocos | OK |
| Blocos secundários | Logística + margem + NF sempre montados na 1ª dobra | N/A |
| Recharts | Bundle carregado no chunk principal da gestão | N/A |
| Margem sem permissão | Backend omite `consolidated`; UI ainda montava bloco | N/A |

### Melhorias aplicadas (sem alterar motores)

1. **`React.memo`** em `SalesOrderManagementKpiDashboard`, `SalesOrderListSummaryCards` e blocos secundários
2. **Abas lazy** em `SalesOrderManagementKpiSecondaryPanel` — só monta conteúdo da aba ativa
3. **Recharts lazy** via `React.lazy` + `Suspense` na gestão
4. **Skeleton** reservando altura (cards + gráficos)
5. **`useMemo`** mantido para lista de alertas

### O que não mudou

- Endpoint único da gestão (payload completo) — trade-off consciente: 1 round-trip vs. latência do agregado
- Motores `buildFulfillmentKpis`, `buildSalesOrderManagementMarginEconomics`, etc.

## 3. Hierarquia visual (depois)

### Gestão (`/sales-orders/management`)

1. **Visão Geral** — 5 cards executivos (painel)
2. **Alertas** — mini-cards compactos acionáveis (painel)
3. **Detalhes operacionais** — abas Logística | Margem | NF-e (lazy)
4. Gráficos fulfillment (lazy, após carga)
5. Tabela operacional

### Listagem (`/sales-orders`)

1. **Visão Geral** — 4 cards em grid único (2 principais + 2 compactos)
2. Filtros + tabela (prioridade)

## 4. Equivalência de dados

Nenhum motor de cálculo, endpoint ou filtro foi alterado. Apenas layout, CSS, memoização e code-splitting de UI.
