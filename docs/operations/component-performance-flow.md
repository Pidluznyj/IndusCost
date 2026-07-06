# Operações > Performance de Componentes

> **Frente validada** — fluxo operacional auditável de ciclo/cavidades.  
> **Atualizado:** 2026-07-02  
> **Escopo:** UI, API, histórico, impacto em novo DRAFT de custo (sem alterar publicados).

---

## 1. Fluxo ponta a ponta

```
Operações > Performance
        ↓ busca SKU/nome + filtros/cards de cobertura
Listagem de COMPONENT (campos vivos)
        ↓ editar ciclo/cavidades + responsável obrigatório
PATCH /api/operations/performance/components/:id
        ↓ transação
Product.cycleTimeSeconds / cavities atualizados
ComponentPerformanceChangeLog (old/new, usuário, data/hora)
        ↓ (não recalcula publicado)
ProductionCostTableItem PUBLISHED permanece congelado
        ↓ nova geração de DRAFT de produção
getProductCostAnalysis lê campos vivos → novo calculationSnapshot
```

### Passos do usuário

1. Acessar **Operações > Performance** (`/operations-performance`).
2. Pesquisar por SKU ou nome; usar filtros (pendentes, vendidos sem performance, etc.).
3. Visualizar ciclo, cavidades, peças/h estimadas e última alteração.
4. Editar ciclo/cavidades no drawer; informar **responsável pela alteração** (obrigatório).
5. Salvar — toast confirma que custos publicados permanecem congelados.
6. Consultar **Histórico** — old/new, usuário logado, responsável, observação.

---

## 2. Componentes do sistema

| Camada | Arquivos |
|--------|----------|
| UI | `OperationsPerformanceModule.tsx`, `ComponentPerformanceEditDrawer.tsx`, `ComponentPerformanceHistoryDrawer.tsx` |
| Client | `componentPerformanceClient.ts`, `componentPerformanceUi.ts` |
| API | `componentPerformanceRoutes.ts` |
| Service | `componentPerformanceChange.server.ts`, `componentPerformanceCoverage.server.ts` |
| Regras puras | `componentPerformanceChange.ts`, `componentPerformanceCoverage.ts` |
| Histórico DB | `ComponentPerformanceChangeLog` (Prisma) |
| Motor custo | `productCostAnalysisEngine.server.ts` → `buildStandardOperationItems` |
| Snapshot | `productionCostPublication.ts` → `processPerformance` no `calculationSnapshot` |

**Não existe** `ProductPerformanceChangeLog` — entidade oficial: `ComponentPerformanceChangeLog`.

---

## 3. APIs

| Método | Endpoint | Função |
|--------|----------|--------|
| GET | `/api/operations/performance/components` | Listagem + filtros |
| GET | `/api/operations/performance/components/:id` | Detalhe |
| PATCH | `/api/operations/performance/components/:id` | Alterar performance |
| GET | `/api/operations/performance/components/:id/history` | Histórico (desc) |
| GET | `/api/operations/performance/coverage` | Cards de cobertura |

**Permissões:** `operations.component-performance.view` / `.edit` (fallback `products.view` / `products.edit`).

---

## 4. Regras invioláveis

| Regra | Implementação |
|-------|-----------------|
| Responsável obrigatório | `validateResponsiblePersonName` |
| Valores inválidos bloqueados | `validatePositiveFieldsWhenPresent` |
| Sem mudança real → sem log | `diffProcessSnapshots` vazio |
| Usuário logado gravado | `changedByUserId/Name/Email` no log |
| Custo publicado congelado | PATCH não toca `ProductionCostTableItem` |
| BOM/Nomus intactos | Service não altera BOM nem sync |
| Novo DRAFT usa performance nova | Motor lê `Product` vivo na geração |
| Margem histórica | `VERSIONED_PRODUCTION_COST` na `issueDate` |

---

## 5. Auditoria operacional

```bash
# Cobertura (pendências, vendidos sem performance)
npm run audit:component-performance-coverage -- --year=2026 --month=7 --json

# Impacto em custo (simulação ciclo/cavidades)
npm run audit:component-performance-cost-impact -- --before-cycle=64 --after-cycle=90
```

---

## 6. Testes de validação

```bash
npm run test:operations-performance-flow
npm run test:component-performance
npm run test:operations-performance
npm run test:component-performance-cost-draft
npm run test:component-performance-coverage
npm run test:versioned-cost-baseline
npm run test:sales-orders-margins
npm run build
npm run check:frontend-server-imports
```

Teste integrado principal: `src/lib/operationsPerformanceFlow.server.test.ts`

---

## 7. Limitações conhecidas (aceitas)

- Alteração de performance **não recalcula** custos já publicados — exige nova geração/publicação de DRAFT.
- COMPONENT com **roteiro explícito** pode usar `ROUTING` em vez de processo padrão no motor (prioridade do motor).
- Cards de cobertura usam vendas do **mês corrente** por padrão.

---

## 8. Referência cruzada

- Arquitetura custo versionado: `docs/architecture/versioned-cost-price-margin.md` (seção Performance operacional)
- Impacto em DRAFT: commit `feat: connect component performance to production cost drafts`
