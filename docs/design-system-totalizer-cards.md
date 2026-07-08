# Design System — Cards Totalizadores Executivos

**Versão:** 2026-07-08 (revisão final)  
**Referência visual:** Fluxo de Caixa → resumo executivo

---

## Padrão oficial

Todo **card totalizador / KPI de resumo** em telas novas ou refatoradas deve usar o componente oficial:

| Camada | Artefato | Uso |
|--------|----------|-----|
| **Componente base** | `SystemTotalizerCard` | Tipografia, tom, badge, loading |
| **Ponte legado** | `FinanceExecutiveTotalizerCard` | Telas que já usavam `FinanceKpiCard` / `FinanceBiKpiCard` |
| **Alias semântico** | `SummaryKpiCard` | Grids de materiais / suprimentos (delega ao CSS executivo) |
| **Contextual** | `ContextualDashboardKpiCard` + `ContextualDashboardKpiGrid` | Dashboards por módulo |
| **Grid** | `SummaryKpiGrid` + `SYSTEM_TOTALIZER_GRID_CLASS` | Layout responsivo |
| **Seção** | `ExecutiveSummarySection` / `AdminKpiSection` | Título, eyebrow, agrupamento |
| **CSS** | `system-totalizer-card.css` | Tipografia executiva única |

### Regra obrigatória

> **Novos totalizadores:** usar `SystemTotalizerCard` ou `FinanceExecutiveTotalizerCard` dentro de `SummaryKpiGrid` com `className={SYSTEM_TOTALIZER_GRID_CLASS}`.

Não criar `KpiCard` / `SummaryCard` locais com Tailwind (`font-black`, `text-3xl+`) para KPIs.

---

## Tipografia e layout

Definidos em `src/components/ui/system-totalizer-card.css`:

- Label: 11px, `font-weight: 600`, uppercase
- Valor: `clamp(1.25rem … 1.75rem)`, `font-weight: 600` (nunca 800)
- Valores monetários: `white-space: nowrap` + `text-overflow: ellipsis`
- Valores longos / status: `valueSize="text"` ou classe `--wrap`
- Ícone: 0.875rem em box 1.75rem
- Altura mínima: 108px (96px em grid secundário)
- Badge de status: `SystemTotalizerBadge` (comissões, status)

---

## Como criar um novo card totalizador

```tsx
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";

<ExecutiveSummarySection title="Resumo" eyebrow="Período atual">
  <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
    <FinanceExecutiveTotalizerCard
      label="Receita líquida"
      amount={total}
      amountFormat="currency"
      tone="money"
    />
    <FinanceExecutiveTotalizerCard
      label="Pedidos em aberto"
      value={String(count)}
      tone="warning"
      subtitle="Aguardando faturamento"
    />
  </SummaryKpiGrid>
</ExecutiveSummarySection>
```

### Props principais (`FinanceExecutiveTotalizerCard`)

| Prop | Descrição |
|------|-----------|
| `label` | Título do indicador |
| `value` | Texto formatado (preferir quando já formatado) |
| `amount` + `amountFormat` | Valor estruturado (`currency`, `number`, `percent`) |
| `subtitle` / `hint` | Linha auxiliar |
| `tone` | `neutral`, `success`, `warning`, `danger`, `info`, `money`, `margin` |
| `icon` | `LucideIcon` (não JSX) |
| `loading` | Skeleton |
| `valueSize` | `"default"` ou `"text"` para strings longas |

---

## Wrappers por domínio

| Wrapper | Quando usar |
|---------|-------------|
| `FinanceCashFlowExecutiveMetricCard` | Fluxo de Caixa (delega a `SystemTotalizerCard`) |
| `FinanceBillingExecutiveCard` | Faturamento executivo (já migrado) |
| `ExecutiveDashboardSummaryKpiGrid` | Painel gerencial (cards dinâmicos do backend) |
| `CustomerIntelligenceTabKpiGrid` | Abas da inteligência de cliente |
| `AdminKpiSection` | KPIs em configurações / auditorias |

---

## Exceções aprovadas (não migrar)

| Área | Motivo |
|------|--------|
| **Centro de Custo → Mapa de Gastos** (`FinanceCostCenterExpenseMapExecutiveSummary`, `ExpenseMapCard`) | Identidade visual aprovada + CSS dedicado |
| **CC Visão geral / Detalhe** (`FinanceKpiCard`) | Preservado até validação explícita separada |
| **Relatório Presidencial → top cards CC (PDF)** | Layout de impressão |
| **Heróis de simulação** (`SimulationModule` comparação, `TransformationCostSimulatorModule`, `PricingModule` preço publicado) | Resultado principal da ferramenta, não grid KPI |
| **Produtos → custo com `CalculatedValue`** | Explainability integrada |
| **Fluxo de Caixa → herói posição líquida** (`FinanceCashFlowNetPositionHero`) | Destaque único fora do grid |
| **Capas / landing / títulos de página** | Tipografia editorial, não totalizador |

---

## Testes

- `src/lib/systemTotalizerCard.test.ts` — contrato do componente e telas migradas
- `src/lib/kpiSummaryCardsVisualAudit.test.ts` — auditoria visual estática

---

## Commits de referência

| Fase | Hash | Escopo |
|------|------|--------|
| Auditoria inicial | `6d8361e` | Inventário |
| Fase 1 — críticos | `a64fd9d` | `SystemTotalizerCard`, pedidos, comissões fechamento, Nomus |
| Fase 2 — financeiro | `7ff980d` | AR, AP, faturamento, relatório presidencial |
| Fase 3 — demais módulos | `e531071` | Comercial, engenharia, suprimentos, operações |
| Revisão final | *(este commit)* | Dashboard executivo, inteligência cliente, custos indiretos |
