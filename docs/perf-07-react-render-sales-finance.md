# PERFORMANCE 07 — Renderização React (Pedidos + Financeiro)

Otimizações **somente de render** no frontend. Sem mudança de layout, estilos, textos, regras de negócio, filtros, totais, permissões, ordenação ou virtualização.

## Estratégia

| Mecanismo | Onde | Evidência de benefício |
|-----------|------|------------------------|
| `React.memo` em tabela/linha | `SalesOrderListTable` + `SalesOrderListTableRow` | Digitação em `searchDraft` / abertura de drawer não recalcula N linhas |
| Callbacks/`filters` estáveis | `SalesOrdersModule` | Props de lista/gráficos não mudam de identidade a cada tecla |
| `memo` + `useMemo` charts | SO monthly, AR/AP charts | Digitação de draft filters não reconstrói Recharts |
| Arrays vazios estáveis | AR/AP pages (`EMPTY_*`) | `?? []` deixava de invalidar memo a cada render |
| `cardTone` / drilldown cards | AR/AP + horizonte | Função/`map` inline quebrava memo do drilldown |
| Tooltip de margem `memo`+`useMemo` | `SalesOrderMarginInfoTooltip` | Texto longo não reconstrói se props iguais |
| Modal/drawer early `null` | Detalhe SO, resumo rápido, audit drawer | Portal pesado só quando `open` |
| Abas condicionais + memo | AR tab panels | Só aba ativa monta; painéis leves se props estáveis |

**Não feito:** virtualização — página já pagina (20/página SO; titles AR/AP paginados). Risco a sticky header/menus/seleção sem ganho claro neste volume.

## Estados

- Draft vs applied filters (AR/AP/Billing) **mantidos** — draft continua local; filhos pesados ignoram draft via memo + deps em `appliedFilters`/`data`.
- Detalhe SO / drawer resumo: estado local no módulo; fechados → `return null` (sem portal).
- Abas: estado de uma aba não monta o conteúdo das demais (já era condicional; painéis agora memo).

## Medição (antes/depois)

Com `localStorage.induscost_perf_baseline=1` (ou `INDUSCOST_PERF_BASELINE=1`) e DevTools Performance:

| Cenário | Antes (estrutural) | Depois (esperado) |
|---------|--------------------|-------------------|
| Digitar busca SO (`searchDraft`) | Re-render tabela + N linhas + formatação + tooltips | Tabela/linhas skip se props iguais; tooltip texto não reconstrói |
| Digitar filtro draft AR/AP | Charts Recharts + drilldown re-render | Charts/drilldown skip (`memo` + props estáveis) |
| Trocar aba analítica AR | Remount condicional (já) | Idem + painel memo se voltar com mesmos dados |
| Abrir modal detalhe SO | Portal só se `open` (já) | Preservado |
| Digitar filtro com tooltips na lista | `buildOfficial…` × N a cada tecla | skip via `memo` (props iguais) |

Contadores: `noteDevPerfRender("SalesOrderListTable"|"SalesOrderListTableRow"|"SalesOrderListMonthlyCharts"|"SalesOrdersModule"|"FinanceModule")`.

Se DB local indisponível, registrar **PENDING** quantitativo de rede e medir só renders no cliente.

## Testes

```bash
npx tsx --test src/lib/financeSalesReactRenderPerf.test.ts
```

## Confirmações

- Layout / classes CSS / textos / filtros / totais / permissões: inalterados
- Sem virtualização
- Sem commit / push / deploy neste passo
