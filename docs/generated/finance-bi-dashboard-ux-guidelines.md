# Financeiro — Padrão UX/UI BI Executivo

**Projeto:** IndusCost  
**Escopo:** Contas a Receber · Contas a Pagar · Faturamento  
**Fase:** Fundação visual (sem alteração de regras de cálculo)

---

## 1. Paleta e princípios

| Token | Valor | Uso |
|-------|-------|-----|
| Fundo página | `#F9FAFB` | Shell das telas financeiras |
| Card | `#FFFFFF` | KPIs, painéis, filtros |
| Borda | `#E5E7EB` | Separadores flat |
| Texto principal | `#111827` | Títulos e valores |
| Texto secundário | `#6B7280` | Subtítulos, metadados |
| Ação primária | `#2563EB` | Aplicar filtros, links |
| Risco/atraso | `#DC2626` | Tendências negativas |
| Sucesso | `#059669` | Tendências positivas |
| Alerta | `#D97706` | Pendências de filtro |

**Princípios:** flat, sem sombra pesada, sem gradiente excessivo, sem poluição visual.

Constantes em `src/lib/financeBiDashboardTheme.ts`.

---

## 2. Estrutura obrigatória da tela

### 2.1 Header executivo — `FinanceBiExecutiveHeader`

- Eyebrow (módulo + área)
- Título
- Subtítulo com **fonte de dados** (NomusAccountsReceivable / NomusAccountsPayable / SalesOrder)
- Badge de estado de filtros (`Sem filtros ativos` / `Filtros aplicados` / `Alterações pendentes`)
- Metadados: última sync, calculado em, período
- Ações: Atualizar, Exportar CSV (quando existir)

### 2.2 Resumo KPI — `FinanceBiKpiCard`

- Número grande, label uppercase
- Subtexto com escopo/fórmula
- `FinanceBiCalcTooltip` no hint (regra de cálculo)
- `scopeNote` opcional para exceções (YTD, global, etc.)
- Badge de tendência semântica (risco/sucesso)

### 2.3 Filtros BI — `FinanceBiFilterPanel`

- Cabeçalho colapsável com `FinanceBiFilterStatusBadge`
- Corpo com filtros principais + avançados (grid existente das páginas)
- Botões **Aplicar filtros** e **Limpar**
- `FinanceBiFilterChips` abaixo com filtros **aplicados** e remoção individual

**Estado draft vs aplicado:** inalterado na lógica; UI exibe claramente via badge e chips.

Helpers de chips: `src/lib/financeBiFilterChips.ts`  
Estado: `src/lib/financeBiFilterState.ts`

### 2.4 Escopo e exceções — `FinanceFilterScopeBanner` / `FinanceFilterScopeNote`

Métricas que não respeitam 100% os filtros devem usar constantes de `src/lib/financeFilterScope.ts`.

### 2.5 Empty state — `FinanceBiEmptyState`

Para gráficos/tabelas sem dados (uso incremental nas próximas fases).

---

## 3. Componentes compartilhados

| Componente | Arquivo |
|------------|---------|
| Shell da página | `bi/FinanceBiDashboardShell.tsx` |
| Header | `bi/FinanceBiExecutiveHeader.tsx` |
| Painel de filtros | `bi/FinanceBiFilterPanel.tsx` |
| Chips ativos | `bi/FinanceBiFilterChips.tsx` |
| Badge de status | `bi/FinanceBiFilterStatusBadge.tsx` |
| KPI card | `bi/FinanceBiKpiCard.tsx` |
| Tooltip de cálculo | `bi/FinanceBiCalcTooltip.tsx` |
| Empty state | `bi/FinanceBiEmptyState.tsx` |

---

## 4. Aplicação por tela (fase atual)

| Tela | Aplicado agora | Preparado para próxima fase |
|------|----------------|----------------------------|
| Contas a Receber | Shell, header, filtros BI, chips, KPI BI | Charts aging/ranking com empty state BI |
| Contas a Pagar | Shell, header, filtros BI, chips, KPI BI | Idem |
| Faturamento | Shell, header, filtros BI, chips; cards via `FinanceBillingExecutiveCard` → `FinanceBiKpiCard` | Tabs analíticas com empty states |

---

## 5. O que não mudou nesta fase

- Endpoints e builders de dashboard
- Regras de cálculo, aging, projeção, comparativo
- Sync Nomus / NF-e / AR / AP
- Schema e migrations
- Dados mockados

---

## 6. Próximos passos sugeridos

1. Migrar gráficos AR/AP para wrappers BI com título + empty state + tooltip de escopo.
2. Action Center com priorização visual BI (sem alterar regras).
3. Rankings com barras horizontais padronizadas.
4. Rotular sync global em AR/AP com `FINANCE_SYNC_GLOBAL_SCOPE`.
