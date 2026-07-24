# PERFORMANCE 03 — Fetching e abas (Pedidos + Financeiro)

Otimizações **somente no frontend** de carregamento. Sem migration, sem mudança de regra de negócio, layout, textos, filtros, permissões, totais ou ordenação.

## Estratégia

| Mecanismo | Uso |
|-----------|-----|
| Lazy por aba | Endpoints exclusivos só quando a aba está ativa |
| Preservar estado | Billing: não refetch se `nfeList` / `comparison` / `audit` já existem |
| Cache de sessão | `fetchUiSessionCachedJson` — chave = URL+query, TTL 60s (detalhe pedido 30s; branding 5min) |
| AbortController | Troca rápida de filtro/página/aba cancela request anterior |
| IntersectionObserver | Blocos abaixo da dobra: gráfico anual CF, radar diário CF, gráficos mensais SO |
| Debounce | Só busca textual (já existente 300–400ms) |
| Branding | Carregado só ao imprimir/PDF |

## Invalidação

- Sync AR → `invalidateUiSessionGetCache("/api/finance/accounts-receivable/")` + reload dashboard
- Sync AP → `invalidateUiSessionGetCache("/api/finance/accounts-payable/")` + reload dashboard
- Botão Atualizar → `skipCache: true` onde aplicável
- Mudança de query → chave diferente ou state `null` força reload na aba ativa

## Medição (antes/depois)

Reexecutar o baseline do passo 02:

```bash
$env:INDUSCOST_PERF_BASELINE='1'
npm run perf:baseline:sales-finance
```

Comparar no JSON / Network:

| Métrica | Antes (PERF 02) | Depois (PERF 03) | Esperado |
|---------|-----------------|------------------|----------|
| Billing mount (fora Documentos) | dashboard + nfes (+… ) | dashboard; nfes só em Documentos | −1 GET nfes se aba ≠ documents* |
| Billing voltar a Documentos | refetch nfes | sem rede se state/cache válido (≤60s) | −1 GET |
| CF mount | dashboard + annual + daily-radar | dashboard; annual/daily só na viewport | −0–2 GETs até scroll |
| AR overdue remount (mesmo query) | GET overdue | cache hit ≤60s | −1 GET |
| SO list mount | list + seller-options + branding + results charts | list + seller-options; branding no PDF; charts na viewport | −1 branding; charts adiados |
| SO detalhe reabrir (≤30s) | GET detail | cache hit | −1 GET |
| Chamadas duplicadas por deps instáveis | seller-options deps redundantes | só `sellerOptionsFiltersKey` | menos churn |

\* Default do Billing continua `documents` — no primeiro paint a lista NF-e ainda carrega (comportamento visual preservado).

Se o DB local estiver indisponível, registrar PENDING como no PERF 02 e medir via DevTools com `localStorage.induscost_perf_baseline=1`.

## Testes

```bash
npx tsx --test src/lib/uiSessionGetCache.test.ts src/lib/uiSessionCachedGet.test.ts src/lib/financeSalesUiFetchLazy.test.ts
```

## Confirmações

- Endpoints/parâmetros/resultados funcionais preservados
- Sem commit / push / deploy neste passo
