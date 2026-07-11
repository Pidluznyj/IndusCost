# Inventário — Funil de Venda atual (Dashboard Gerencial)

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Dashboard → aba **Funil de Venda** (não há módulo “Windows Coach” no código) |
| **Data** | 2026-07-11 |
| **Tipo** | Inventário técnico e funcional (somente documentação) |
| **Estado** | Baseline antes do Funil Pedido → Caixa |

> Relacionados:  
> [`sales-order-to-cash-funnel-requirements.md`](./sales-order-to-cash-funnel-requirements.md) ·  
> [`../integrations/nomus-production-orders-api-discovery.md`](../integrations/nomus-production-orders-api-discovery.md) ·  
> [`../finance/portfolio-cash-forecast-audit-requirements.md`](../finance/portfolio-cash-forecast-audit-requirements.md)

---

## Sumário executivo

| Pergunta | Resposta |
|----------|----------|
| Onde fica a tela? | `/dashboard` → `DashboardModule` → aba `funil` |
| “Windows Coach”? | **Não existe** no repositório; o alvo é o **Dashboard Gerencial** |
| Fonte oficial atual do funil? | **`SalesOrder`** (já não é Proposal) |
| Usa Comissões? | **Não** |
| Usa Portfolio Reconciliation / CR / Baixa? | **Não** (para em pedido + NF + atraso logístico) |
| Usa Proposal no funil do dashboard? | **Não** (Proposal tem funil separado em `/proposals/indicators`) |
| Risco Pedido+NF+CR? | **Baixo hoje** (não soma CR); risco futuro se misturar valores sem eixos |

---

## 1. Arquivos encontrados

### UI

| Arquivo | Papel |
|---------|-------|
| `src/App.tsx` | Rota `/dashboard` → `DashboardModule` |
| `src/components/DashboardModule.tsx` | Shell com abas `executivo` \| `operacao` \| `funil`; fetch do summary |
| `src/components/dashboard/SalesFunnelPanel.tsx` | **Componente principal** da aba Funil |
| `src/components/dashboard/ExecutiveDashboardSummaryKpiGrid.tsx` | Grid de cards KPI |
| `src/components/dashboard/ExecutiveDashboardPanel.tsx` | Abas Pedidos / Faturamento (irmão, não é o funil) |
| `src/tours/dashboardTourSteps.ts` | Tour guiado do dashboard |

### Backend / API

| Arquivo | Papel |
|---------|-------|
| `src/lib/executiveDashboardRoutes.ts` | `GET /api/dashboard/executive-summary` |
| `src/lib/executiveDashboardService.ts` | Orquestra tabs (`salesOrders`, `billing`, `salesFunnel`) |
| `src/lib/salesFunnelDashboardMetrics.ts` | **Service** que monta o payload do funil |
| `src/lib/salesFunnelDashboardRules.ts` | Regras puras do funil comercial legado |
| `src/lib/salesOrderMetricsEngine.ts` | Motor enriquecido + funil operacional |
| `src/lib/salesOrderDashboardRules.ts` | Regras de pedido (cancelado, atraso, faturado) |
| `src/lib/salesOrderRulesAdapter.ts` | Adapter regras oficiais de Sales Order |
| `src/lib/salesOrderLinkedNfe.ts` | Contexto de NF vinculada ao pedido |
| `src/lib/executiveDashboardTypes.ts` | Tipos `SalesFunnelDashboardTab`, stages, etc. |
| `src/lib/executiveDashboardFormatters.ts` | Formatação moeda/inteiro/% |
| `src/lib/executiveDashboardYear.ts` | Contexto de ano |

### Relacionados, mas **fora** do funil do Dashboard

| Arquivo | Papel |
|---------|-------|
| `src/lib/salesFunnel.ts` | Funil de **ProposalStatus** (propostas) — **não** alimenta a aba Dashboard |
| `src/components/contextual/ProposalIndicatorsDashboard.tsx` | Funil/indicadores em `/proposals/indicators` |
| `src/components/proposal/ProposalIndicatorsTab.tsx` | Indicadores no módulo de propostas |

---

## 2. Rotas envolvidas

| Rota UI | API | Permissão |
|---------|-----|-----------|
| `/dashboard` (aba Funil) | `GET /api/dashboard/executive-summary?year=YYYY` | `dashboard.view` na rota; conteúdo funil exige `sales_orders.view` ou `reports.view` |
| Link “Ver pedidos” | navega para `/sales-orders` | Gestão de pedidos (fora do funil) |
| `/api/dashboard` | KPIs de custo/produto (aba Operação) — **não** é o funil | — |

Não há hook React Query dedicado: `DashboardModule` usa `useState` + `useCallback` + `fetchJsonOk`.

---

## 3. Componentes envolvidos

```text
DashboardModule
  ├─ tabs: executivo | operacao | funil
  └─ funil → SalesFunnelPanel
        ├─ ExecutiveDashboardSummaryKpiGrid (summaryCards)
        ├─ ExecutiveDashboardSummaryKpiGrid (operationalSummaryCards)
        ├─ SalesOperationalFunnel (barras vendido→NF→atraso/parcial…)
        ├─ LegacyCommercialFunnel (emitido→válido→carteira→faturado→atraso→cancelado)
        ├─ ComposedChart (evolução mensal emitido vs faturado + conversão)
        ├─ BarChart (breakdown por status)
        ├─ tabela top clientes (carteira aberta)
        └─ tabela pedidos críticos
```

**Hooks:** apenas React built-in (`useState`, `useCallback`, `useEffect`, `useMemo`) — sem hook de domínio `useSalesFunnel`.

---

## 4. Services envolvidos

| Service | Função no funil |
|---------|-----------------|
| `buildExecutiveDashboardSummary` | Paralelo: pedidos + faturamento + funil |
| `buildSalesFunnelDashboardTab` | Monta KPIs, estágios, charts, top clientes, críticos |
| `loadSalesOrderEnrichedMetricsForIssueYear` | Métricas por pedido (NF, logística, valores) |
| `buildOperationalFunnelStages` | Estágios operacionais |
| `loadSalesOrderLinkedNfeContextMap` | Presence/contexto de NF |
| `buildOfficialSalesOrderRulesResult` | Breakdown oficial de status |

Prisma: `prisma.salesOrder.findMany` (ano de emissão) + joins/contexto de NF via linked map. **Customer** entra via campos do pedido (nome/agrupamento de carteira aberta), não como funil de oportunidade.

---

## 5. Dados usados / exibidos

### Fonte de dados

| Entidade | Usado no funil Dashboard? | Como |
|----------|---------------------------|------|
| **SalesOrder** | **Sim** — fonte oficial | Emissão no ano, valor líquido, status, datas |
| **Customer** | Parcial | Top clientes com carteira aberta (agregação) |
| **NFe / SalesOrderNfeLink** | **Sim** (presença / faturado) | `hasNfe`, linked context — **não** valor de cabeçalho como carteira |
| **Proposal** | **Não** | Outro módulo |
| **Accounts Receivable / Baixa** | **Não** | Ausente no funil atual |
| **Portfolio Reconciliation** | **Não** | Ausente |
| **Commissions** | **Não** | Ausente |
| **Documento de saída / OP** | **Não** | Ausente no funil (OP só em raw/lifecycle de pedidos) |

### Filtros existentes

- **Ano** (select no header da aba)  
- Refresh manual  
- Sem filtros de cliente/vendedor/estágio/temperatura na UI atual  

### Cards existentes

- `summaryCards` — totais comerciais do ano (emitidos, válidos, carteira, faturado, etc.)  
- `operationalSummaryCards` — indicadores do motor operacional  

### Gráficos existentes

- Funil operacional (barras horizontais por estágio)  
- Funil comercial legado (barras emitido→…→cancelado; **pode sobrepor** etapas)  
- Evolução mensal (barras emitido/faturado + linha conversão)  
- Breakdown por status (barras)  

### Regras de cálculo existentes

- Classificação comercial: emitido / válido / carteira aberta / faturado / atrasado / cancelado (`salesFunnelDashboardRules`)  
- Funil operacional: vendido → com NF → no prazo / atrasado / pendente / parcial / corte / revisão (`salesOrderMetricsEngine`)  
- “Faturado” ≈ presença de NF vinculada / processamento — **não** CR nem baixa  
- UI **não** recalcula: só formata payload  

---

## 6. Riscos técnicos

| Risco | Avaliação |
|-------|-----------|
| Proposta como fonte oficial do Dashboard funil | **Não ocorre no código atual** |
| Uso de Comissões | **Não ocorre** |
| Somar Pedido + NF + CR | **Não ocorre hoje** (CR nem entra); risco se evolução misturar eixos sem disciplina |
| Funil comercial legado com sobreposição | **Sim** — UI admite que atrasados ⊆ carteira (não é funil exclusivo por estágio) |
| Docs legados desatualizados | Alguns docs ainda dizem “funil = oportunidades” — **desconfiar**; confiar no código |
| Nome “Windows Coach” | Confusão de vocabulário; produto real = Dashboard Gerencial |
| `salesFunnel.ts` (Proposal) | Pode confundir mantenedores se importado por engano — manter isolado |

---

## 7. O que pode ser reaproveitado

| Ativo | Reuso no Funil Pedido → Caixa |
|-------|-------------------------------|
| Slot da aba `funil` em `DashboardModule` | Manter shell; trocar conteúdo interno |
| Endpoint `executive-summary` | Estender `salesFunnel` tab **ou** acrescentar campo/payload versionado |
| `SalesFunnelPanel` como container | Refatorar para consumir novo payload / subcomponentes |
| `salesOrderMetricsEngine` / linked NF | Base comercial + evidência fiscal |
| Permissões `sales_orders.view` / `reports.view` | Manter |
| Formatação executiva | Manter |
| **Portfolio maturity / fulfillment map** | Reusar para Doc, parcial, excedente, CR, recebido (ainda não ligados) |

---

## 8. O que deve ser substituído

| Atual | Para |
|-------|------|
| Paradigma “emitido → NF / atraso” como funil completo | Paradigma **Pedido → Doc → NF → CR → Baixa** |
| Funil comercial legado com sobreposição | Estágios **exclusivos** (um principal por pedido) |
| Ausência de Doc/CR/Baixa | Incluir via maturity/fulfillment (read-only) |
| Temperatura inexistente | Quente / Morno / Frio / Congelado |
| Filtro só por ano | Filtros ricos (cliente, vendedor, estágio, etc.) conforme requisitos |
| Copy “Funil de Vendas” sem aviso pedido≠caixa | Conceito **Funil Pedido → Caixa** |

---

## 9. O que não deve ser mexido

- Fluxo de Caixa oficial  
- Contas a Receber oficial  
- Comissões  
- Relatório Presidencial / Precificação / BOM / Suprimentos  
- Funil de **propostas** (`/proposals/indicators`, `salesFunnel.ts`) — permanece histórico opcional  
- Sync Nomus oficial / migrations  
- Abas `executivo` e `operacao` do Dashboard (exceto se precisarem de espaço mínimo no shell)  

---

## 10. Plano de migração incremental

| Fase | Entrega | Risco |
|------|---------|-------|
| 0 | Requisitos + inventário + descoberta OP (docs) | Baixo — **feito / em curso** |
| 1 | Motor puro Pedido→Caixa (estágios + temperatura) + testes | Médio — sem UI |
| 2 | Payload na API (`salesFunnel` v2 ou campo paralelo) | Médio — feature flag / available |
| 3 | Componentes UI **novos isolados** (`OrderToCashFunnel*`) dentro da aba | Médio — shell Dashboard intacto |
| 4 | Desligar funil legado (LegacyCommercialFunnel) após paridade | Baixo se feature-flag |
| 5 | OP opcional se descoberta Nomus confirmar | Baixo |

---

## Decisão de preservação

### Opções avaliadas

| Opção | Prós | Contras |
|-------|------|---------|
| A. Nova aba ao lado (“Pedido → Caixa”) | Zero risco visual no funil antigo | Duas abas confusas; dívida |
| B. Substituir aba de uma vez | Limpo | Big bang na UI |
| C. **Refatorar a aba existente com componentes novos isolados** | Mantém lugar no Dashboard; migração controlada | Precisa disciplina de feature-flag / payload dual |
| D. Só renomear sem mudar lógica | Cosmético | Não resolve o paradigma |

### Recomendação (preferida)

**Opção C — trocar internamente a lógica da aba `funil`, mantendo o slot no Dashboard**, com:

1. Componentes novos isolados (ex.: `OrderToCashFunnelPanel`) montados no lugar de `SalesFunnelPanel` (ou como substituição gradual dentro dele).  
2. Nome visual pode permanecer “Funil de Vendas” temporariamente e migrar para **Funil Pedido → Caixa** quando o payload novo estiver estável.  
3. Compatibilidade: manter `tabs.salesFunnel` no `executive-summary`, evoluindo o shape com campos novos + `source`/`version` explícitos.  
4. Não criar segunda aba permanente; não tocar abas executivo/operação além do necessário.

**Preservar:** permissões, ano, refresh, link para `/sales-orders`, formatação, motor de métricas de pedido/NF como base comercial.  
**Não preservar como verdade final:** funil legado com sobreposição e ausência de Doc/CR/Baixa.

---

## Checklist de verificação (este inventário)

| Item | Resultado |
|------|-----------|
| Usa SalesOrder? | **Sim** |
| Usa Proposal no Dashboard funil? | **Não** |
| Usa Customer? | Parcial (top carteira) |
| Usa NFe? | **Sim** (vínculo/presença) |
| Usa Accounts Receivable? | **Não** |
| Usa Portfolio Reconciliation? | **Não** |
| Usa Commissions? | **Não** |
| Proposta como fonte oficial indevida? | **Não** (no código da aba) |
| Comissão indevida? | **Não** |
| Risco Pedido+NF+CR? | **Não materializado hoje**; prevenir na migração |

---

## Status

Inventário concluído. **Nenhuma alteração de UI/regra/código** neste prompt — apenas este documento.
