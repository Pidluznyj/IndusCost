# Diagnóstico — Dashboard Executivo IndusCost

**Data:** 2026-06-05  
**Escopo:** tela inicial (`/dashboard`) antes da implementação executiva

---

## 1. Componente e rota atuais

| Item | Detalhe |
|------|---------|
| **Rota frontend** | `/dashboard` (`App.tsx` → `DashboardModule`) |
| **Permissão menu** | `dashboard.view` (`modulePermissions.ts`) |
| **Componente** | `src/components/DashboardModule.tsx` |
| **Abas (antes)** | Operação/Financeiro · Funil de Vendas |

---

## 2. Dados exibidos (estado anterior)

### Aba Operação/Financeiro — `GET /api/dashboard`

| KPI / bloco | Fonte | Observação |
|-------------|-------|------------|
| Custo médio folha/colaborador | `Employee` + `Role` + payroll | Industrial |
| Tarifa HM global | `IndirectCost` GLOBAL_PARAM | Exige ENERGY_COST + WORKING_HOURS |
| CIF / OPEX mensal | `IndirectCost` | Industrial |
| Composição MP/HH/HM/CIF/OPEX | `getProductCostAnalysis` × produtos ativos | Pesado (N× produtos) |
| Top/bottom margem | `ProductPricing` + custo | Industrial/comercial misturado |

**Problemas:** foco industrial; falha 400 se parâmetros globais ausentes; não consolida comercial, frota, CRM, Nomus.

### Aba Funil — `GET /api/proposals` (client)

Pipeline de propostas via `SalesFunnelPanel` + `salesFunnel.ts`. Sem endpoint server dedicado.

---

## 3. Limitações identificadas

1. **Escopo estreito** — KPIs de custo industrial, não visão executiva multi-módulo.
2. **Performance** — `/api/dashboard` chama `getProductCostAnalysis` para todos os produtos ativos.
3. **Fragilidade** — erro CONFIG_MISSING bloqueia aba operação inteira.
4. **Ausências** — pedidos, clientes, frota, Nomus, RH não aparecem na home.
5. **Permissões** — usuário vê dashboard mas seções de outros módulos não refletem o que pode acessar.
6. **UX** — duas abas sem hierarquia executiva; sem alertas consolidados.

---

## 4. Fontes reais disponíveis para consolidação

| Módulo | Fonte existente | Reutilização |
|--------|-----------------|--------------|
| Pedidos | `SalesOrder` aggregate / `GET /api/reports/data` | Count/sum por mês e status |
| Propostas | `Proposal` aggregate / `GET /api/proposals` | Pipeline aberto |
| Clientes | `Customer`, `CustomerCnpjLookup`, CRM SQL | Counts cadastrais |
| Produtos | `Product`, `ProductBOM`, `ProductPricing` | Counts (sem CIU full scan) |
| Nomus | `buildNomusAutoApplyBomDashboard` | Totais read-only |
| Frota | `buildFleetDashboardCards` | Mesmo motor `/api/fleet/dashboard` |
| RH | `Employee` count ACTIVE | Headcount |
| Alertas | Derivados das seções | Sem mock |

---

## 5. Oportunidades de melhoria

- Endpoint único read-only `GET /api/dashboard/executive-summary`
- Aba **Visão Executiva** como padrão na home
- Manter abas industrial e funil (compatibilidade)
- Cards por área + alertas + links rápidos
- Seções ocultas/indisponíveis conforme permissão
- Evitar `getProductCostAnalysis` em massa na home

---

## 6. Proposta visual/conceitual

1. Header — título, timestamp, botão Atualizar  
2. Faixa KPI — pedidos mês, propostas abertas, clientes, frota, alertas  
3. **Atenção agora** — cards severidade (Nomus bloqueado, manutenção atrasada, follow-ups)  
4. Grid 2 colunas — Comercial · Nomus · Produtos · Clientes · Frota · RH  
5. Links rápidos — Propostas, Clientes, Produtos, Frota, Configurações  

Paleta: cards `rounded-3xl`, bordas suaves, ícones Lucide, sem tabelas grandes.

---

## 7. Riscos

| Risco | Mitigação |
|-------|-----------|
| Nomus dashboard lento | `revalidateBlocked: false` |
| Duplicar lógica reports | Aggregates Prisma leves, não full reports handler |
| Permissão inconsistente | Helpers `canSee*` por módulo |
| NaN na UI | `safeMetricNumber` + "Não disponível" |
| CIU por produto caro | Não calcular CIU na home |

---

*Diagnóstico gerado antes da implementação do dashboard executivo.*
