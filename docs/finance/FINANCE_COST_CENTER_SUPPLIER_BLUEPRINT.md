# Blueprint — Fornecedores, Centros de Custo e Classificação de Contas a Pagar

**Projeto:** IndusCost / My Industry  
**Módulo:** Financeiro → Classificação gerencial AP  
**Data do blueprint:** 2026-06-17  
**Fase:** Documentação oficial pré-implementação (sem alteração de código funcional)

> Documento de referência para implementação completa da funcionalidade.  
> Baseado na auditoria técnica de jun/2026 sobre `NomusAccountsPayable`, dashboard AP existente e model `CostCenter` de Compras.  
> Complementar: `docs/induscost-system-current-state.md`, `docs/induscost-system-map.md`.

---

## 1. Objetivo de negócio

### 1.1 Por que precisamos de fornecedores consolidados

Os títulos de Contas a Pagar chegam do Nomus com fragmentação de identidade:

| Problema observado | Evidência no sistema atual |
|--------------------|----------------------------|
| Mesmo fornecedor com CNPJ em formatos diferentes | `resolveFinanceApSupplierKey()` usa `personCnpj` bruto (`cnpj:12.345.678/0001-90` ≠ `cnpj:12345678000190`) |
| Nomes com variações de grafia, acentos ou sufixos societários | Agrupamento atual usa apenas `toLowerCase()` em `personName` |
| Payload Nomus alterna campos (`nomePessoa` / `nomeFornecedor`, `idPessoa` / `idFornecedor`) | `nomusAccountsPayableMapper.ts` |
| Títulos sem nome nem documento | Fallback `id:{externalId}` — cada título vira “fornecedor” distinto |
| `personId` (ID Nomus) existe no banco mas não entra na chave de agrupamento | Campo materializado, não usado no dashboard AP |

A aba **Fornecedores** do dashboard AP (`FinanceApSuppliersTab`) exibe um **ranking efêmero** (top 100 por saldo em aberto) calculado em memória — não há cadastro mestre, merge manual, aliases nem vínculo persistente com centro de custo.

**Fornecedor consolidado** resolve isso criando uma **dimensão gerencial estável** que agrupa fragmentos Nomus sem alterar os títulos originais.

### 1.2 Por que Contas a Pagar continua sendo a fonte oficial

| Princípio | Detalhe |
|-----------|---------|
| Fonte de verdade dos títulos | Model `NomusAccountsPayable` — stage read-only do sync Nomus |
| Imutabilidade operacional | Nenhum campo de negócio do AP será editado pela nova funcionalidade |
| Sync Nomus intocado | Mapper, rotas `nomusAccountsPayable*` e `rawPayload` permanecem como estão |
| Dashboards atuais preservados | `GET /api/finance/accounts-payable/dashboard`, `/titles`, `/export` continuam calculando sobre AP puro |
| Enriquecimento opt-in | Classificação e fornecedor consolidado vivem em tabelas **adicionais**, referenciadas por `externalId` |

Campos de fornecedor já materializados no AP (auditoria):

| Campo Prisma | Origem Nomus (`rawPayload`) |
|--------------|----------------------------|
| `personId` | `idPessoa` ou `idFornecedor` |
| `personName` | `nomePessoa` ou `nomeFornecedor` |
| `personCnpj` | `cnpjPessoa`, `cpfCnpj` ou `cnpjFornecedor` |
| `personPhone` | `telefonePessoa` ou `telefoneFornecedor` |
| `companyId`, `companyName` | `idEmpresa`, `nomeEmpresa` |

> **Nota:** AP não possui campo `nomusRawResponse`. O payload integral fica em `rawPayload` (JSONB) + `payloadHash`.

### 1.3 Por que Centro de Custo é uma camada gerencial

Centro de Custo financeiro **não substitui** a classificação Nomus (`classification`, `type`) nem o centro de custo de Compras (`CostCenter` usado em `PurchaseRequest`).

| Camada | Função |
|--------|--------|
| Nomus AP | Título financeiro oficial (valor, vencimento, baixa, fornecedor bruto) |
| `FinancialSupplier` | Identidade consolidada do fornecedor para gestão |
| `FinancialCostCenter` | Dimensão gerencial para análise de despesas (produção, admin, logística, etc.) |
| `AccountsPayableCostCenterAllocation` | Vínculo título ↔ CC com origem (automática ou manual) |

O model `CostCenter` existente (Compras) tem permissões `purchases.view` / `purchases.edit`, seed `A-CLASS` (“A classificar”) e relação com requisições de compra. **Não deve ser reutilizado diretamente** para classificação financeira de AP.

### 1.4 Como isso ajuda no dashboard financeiro

| Benefício | Descrição |
|-----------|-----------|
| Análise por centro de custo | Despesas AP agrupadas por CC gerencial, não só por fornecedor bruto |
| Classificação automática | Novos títulos de fornecedor já mapeado recebem CC via regra |
| Redução de trabalho manual | Fila de “títulos sem classificação” com aplicação em lote |
| Consistência histórica | Alocações persistidas permitem relatórios retroativos sem reprocessar Nomus |
| Integração futura | Fluxo de Caixa, Relatório Presidencial e exportações podem incluir dimensão CC (opt-in) |
| Auditoria | Rastreio de quem classificou, quando e por qual regra |

---

## 2. Arquitetura funcional

### 2.1 Diagrama de camadas

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Nomus ERP (fonte externa)                                              │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ sync read-only (existente)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  NomusAccountsPayable                                                   │
│  • externalId (chave estável)                                           │
│  • personId, personName, personCnpj, companyId, companyName             │
│  • valores, datas, classification, type, rawPayload                     │
│  • NÃO ALTERADO pela nova funcionalidade                                │
└───────────────┬─────────────────────────────────────────────────────────┘
                │
                │ bootstrap / matching (read-only sobre AP)
                ▼
┌──────────────────────────┐     ┌──────────────────────────┐
│  FinancialSupplier       │◄────│  FinancialSupplierAlias  │
│  • identidade mestre     │     │  • NOMUS_PERSON_ID       │
│  • displayName           │     │  • DOCUMENT              │
│  • documentDigits        │     │  • NAME_NORMALIZED       │
│  • defaultCostCenterId   │     │  • escopo companyId?     │
│  • status / needsReview  │     └──────────────────────────┘
└──────────────┬───────────┘
               │
               │ default + regras
               ▼
┌──────────────────────────┐     ┌──────────────────────────────────────┐
│  FinancialCostCenter     │◄────│  SupplierCostCenterRule              │
│  • code, name, isActive  │     │  • supplierId + costCenterId         │
│  • hierarquia opcional   │     │  • companyId?, priority, vigência    │
│  • link Compras opcional │     └──────────────────────────────────────┘
└──────────────┬───────────┘
               │
               │ alocação por título
               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  AccountsPayableCostCenterAllocation                                    │
│  • nomusPayableExternalId → NomusAccountsPayable.externalId             │
│  • financialCostCenterId, supplierId (denorm.)                          │
│  • allocationPercent (soma 100% por título)                             │
│  • source: AUTO_RULE | MANUAL | BATCH                                   │
│  • isLocked (bloqueia sobrescrita automática)                           │
└───────────────┬─────────────────────────────────────────────────────────┘
                │ toda mutação
                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  FinancialCostCenterAuditLog                                            │
│  • entityType, action, before/after JSON, userId, timestamp             │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Fluxos principais

| Fluxo | Descrição |
|-------|-----------|
| **Bootstrap** | Job lê `NomusAccountsPayable`, cria/atualiza `FinancialSupplier` + aliases por matching |
| **Sync Nomus** | Títulos novos/atualizados no AP; pós-sync opcional tenta classificar títulos sem alocação |
| **Regra automática** | `SupplierCostCenterRule` + fornecedor mapeado → grava alocação com `source=AUTO_RULE` |
| **Classificação manual** | Usuário define CC em título; `isLocked=true` impede sobrescrita automática |
| **Lote** | Preview → apply em massa para títulos elegíveis |

### 2.3 O que permanece intocado

- Model `NomusAccountsPayable` e migration existente
- `nomusAccountsPayableMapper.ts`, sync Nomus AP
- Cálculos em `financeAccountsPayableDashboard.ts`, `financeAccountsPayableOperational.ts`
- Exclusões gerenciais (intercompany, `type=2` pedido de compra, stale Nomus)
- Endpoints AP atuais (dashboard, titles, export)
- Model `CostCenter` de Compras

---

## 3. Regras de negócio

### 3.1 Regras estruturais

| # | Regra |
|---|-------|
| R1 | **AP original não será alterado** — nenhum UPDATE em `NomusAccountsPayable` pela funcionalidade de classificação |
| R2 | **Fornecedor é dimensão consolidada** — cadastro mestre em `FinancialSupplier`; AP continua com `personName`/`personCnpj` brutos |
| R3 | **Centro de custo é classificação gerencial** — independente de `classification`/`type` Nomus e de `CostCenter` de Compras |
| R4 | **Regra automática não sobrescreve classificação manual bloqueada** — alocação com `isLocked=true` ou `source=MANUAL` protegida de AUTO_RULE/BATCH automático |
| R5 | **Rateio deve somar 100%** — por `nomusPayableExternalId`, Σ `allocationPercent` = 100 (tolerância ±0.01 para arredondamento) |
| R6 | **Período fechado não deve ser alterado automaticamente** — títulos com `competenceDate` ou `dueDate` em período fechado configurado só alteráveis manualmente por quem tem `finance.ap_allocations.manage` |
| R7 | **Fornecedor sem documento tem menor confiança** — matching por nome exige `needsReview=true` até confirmação humana; não dispara regra automática de CC sem confirmação |
| R8 | **Nome normalizado só consolida por igualdade exata** — usar `normalizeSearchString` (acentos, espaços); **proibido** fuzzy match, Levenshtein ou “nome parecido” |
| R9 | **Auditoria obrigatória** — toda criação/edição/merge de fornecedor, regra, alocação e aplicação em lote gera registro em `FinancialCostCenterAuditLog` |

### 3.2 Ordem de matching para bootstrap (fornecedor)

| Prioridade | Critério | Confiança | Auto-vincular? |
|------------|----------|-----------|----------------|
| 1 | `personId` Nomus (`NOMUS_PERSON_ID`) | Alta | Sim, se único |
| 2 | Documento normalizado (só dígitos, 11 ou 14) | Alta | Sim, se único global |
| 3 | `companyId` + documento | Alta | Sim em contexto multi-empresa |
| 4 | Nome normalizado exato (`NAME_NORMALIZED`) | Média | Somente se documento ausente → `needsReview` |
| 5 | `companyId` + nome normalizado exato | Média | `needsReview` se conflito |
| — | Conflito / ambiguidade | — | Fila de revisão; **nunca** merge automático |

Função de normalização de documento: reutilizar `normalizeCnpjDigits` de `src/lib/groupCompanyCustomer.ts`.

### 3.3 Regras de classificação automática

1. Título deve ter `FinancialSupplier` resolvido (não `needsReview` pendente).
2. Deve existir `SupplierCostCenterRule` ativa compatível (`companyId` null = todas empresas).
3. Título não pode ter alocação com `isLocked=true`.
4. Título não pode estar em período fechado (para automação).
5. Se múltiplas regras aplicáveis: maior `priority`; desempate por `effectiveFrom` mais recente.
6. Alocação automática padrão: 100% em um único CC (rateio multi-CC é manual na v1).

### 3.4 Período fechado

Configuração futura em tabela de settings ou campo em `FinancialCostCenter` module config:

- `closedThroughDate` (competência) — definido por admin financeiro.
- Automação (sync, apply-batch automático) **ignora** títulos com `competenceDate <= closedThroughDate`.
- Override manual exige `finance.ap_allocations.manage` + entrada de auditoria com justificativa.

---

## 4. Modelagem proposta (Prisma)

> Models **futuros** — não existem no schema atual. Nomes e tipos alinhados ao padrão do repositório (`String @id @default(uuid())`, `DateTime @db.Timestamptz(6)` onde aplicável).

### 4.1 Enums propostos

```prisma
enum FinancialSupplierStatus {
  ACTIVE
  MERGED
  NEEDS_REVIEW
  INACTIVE
}

enum FinancialSupplierAliasType {
  NOMUS_PERSON_ID
  DOCUMENT
  NAME_NORMALIZED
  RAW_NAME
}

enum FinancialSupplierAliasSource {
  AUTO_SYNC
  MANUAL
  IMPORT
}

enum ApCostCenterAllocationSource {
  AUTO_RULE
  MANUAL
  BATCH
}

enum FinancialCostCenterAuditAction {
  CREATE
  UPDATE
  DELETE
  MERGE
  LOCK
  UNLOCK
  BATCH_APPLY
  BATCH_PREVIEW
}

enum FinancialCostCenterAuditEntityType {
  SUPPLIER
  SUPPLIER_ALIAS
  COST_CENTER
  SUPPLIER_RULE
  ALLOCATION
  PERIOD_CONFIG
}
```

### 4.2 `FinancialSupplier`

```prisma
model FinancialSupplier {
  id                    String                  @id @default(uuid())
  displayName           String
  documentDigits        String?                 // só dígitos; null se ausente
  documentType          String?                 // CPF | CNPJ | UNKNOWN
  primaryNomusPersonId  Int?                    // ID Nomus preferencial (não unique global)
  defaultCostCenterId   String?                 @db.Uuid
  status                FinancialSupplierStatus @default(ACTIVE)
  mergedIntoSupplierId  String?                 @db.Uuid
  needsReviewReason     String?
  notes                 String?
  createdByUserId       String?
  updatedByUserId       String?
  createdAt             DateTime                @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime                @default(now()) @updatedAt @db.Timestamptz(6)

  defaultCostCenter     FinancialCostCenter?    @relation("SupplierDefaultCc", fields: [defaultCostCenterId], references: [id], onDelete: SetNull)
  mergedInto            FinancialSupplier?      @relation("SupplierMerge", fields: [mergedIntoSupplierId], references: [id], onDelete: SetNull)
  mergedFrom            FinancialSupplier[]     @relation("SupplierMerge")
  aliases               FinancialSupplierAlias[]
  rules                 SupplierCostCenterRule[]
  allocations           AccountsPayableCostCenterAllocation[]

  @@index([documentDigits])
  @@index([status])
  @@index([primaryNomusPersonId])
  @@index([displayName])
}
```

### 4.3 `FinancialSupplierAlias`

```prisma
model FinancialSupplierAlias {
  id          String                       @id @default(uuid())
  supplierId  String                       @db.Uuid
  aliasType   FinancialSupplierAliasType
  aliasValue  String                       // id numérico, dígitos doc, ou nome normalizado
  companyId   Int?                         // escopo Nomus empresa; null = global
  source      FinancialSupplierAliasSource @default(AUTO_SYNC)
  isActive    Boolean                      @default(true)
  createdAt   DateTime                     @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime                     @default(now()) @updatedAt @db.Timestamptz(6)

  supplier    FinancialSupplier            @relation(fields: [supplierId], references: [id], onDelete: Cascade)

  @@unique([aliasType, aliasValue, companyId])
  @@index([supplierId])
  @@index([aliasValue])
}
```

### 4.4 `FinancialCostCenter`

```prisma
model FinancialCostCenter {
  id                           String    @id @default(uuid()) @db.Uuid
  code                         String    @unique
  name                         String
  description                  String?
  parentId                     String?   @db.Uuid
  isActive                     Boolean   @default(true)
  sortOrder                    Int       @default(0)
  linkedPurchaseCostCenterId   String?   @db.Uuid  // FK opcional → CostCenter (Compras)
  notes                        String?
  createdAt                    DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt                    DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  parent                       FinancialCostCenter?  @relation("FinancialCcTree", fields: [parentId], references: [id], onDelete: SetNull)
  children                     FinancialCostCenter[] @relation("FinancialCcTree")
  linkedPurchaseCostCenter     CostCenter?           @relation(fields: [linkedPurchaseCostCenterId], references: [id], onDelete: SetNull)
  defaultForSuppliers          FinancialSupplier[]   @relation("SupplierDefaultCc")
  rules                        SupplierCostCenterRule[]
  allocations                  AccountsPayableCostCenterAllocation[]

  @@index([isActive])
  @@index([parentId])
}
```

> **Decisão:** `FinancialCostCenter` separado de `CostCenter`. Campo `linkedPurchaseCostCenterId` permite ponte futura sem acoplamento obrigatório.

### 4.5 `SupplierCostCenterRule`

```prisma
model SupplierCostCenterRule {
  id                    String              @id @default(uuid())
  supplierId            String              @db.Uuid
  financialCostCenterId String              @db.Uuid
  companyId             Int?                // null = todas empresas Nomus
  priority              Int                 @default(100)
  isActive              Boolean             @default(true)
  effectiveFrom         DateTime?           @db.Date
  effectiveTo           DateTime?           @db.Date
  notes                 String?
  createdByUserId       String?
  createdAt             DateTime            @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime            @default(now()) @updatedAt @db.Timestamptz(6)

  supplier              FinancialSupplier   @relation(fields: [supplierId], references: [id], onDelete: Cascade)
  financialCostCenter   FinancialCostCenter @relation(fields: [financialCostCenterId], references: [id], onDelete: Restrict)
  allocations           AccountsPayableCostCenterAllocation[]

  @@index([supplierId, isActive])
  @@index([companyId])
  @@index([priority])
}
```

### 4.6 `AccountsPayableCostCenterAllocation`

```prisma
model AccountsPayableCostCenterAllocation {
  id                      String                       @id @default(uuid())
  nomusPayableExternalId  Int                          // → NomusAccountsPayable.externalId
  financialCostCenterId   String                       @db.Uuid
  financialSupplierId     String?                      @db.Uuid  // denormalizado
  allocationPercent       Decimal                      @default(100) @db.Decimal(5, 2)
  source                  ApCostCenterAllocationSource
  ruleId                  String?                      @db.Uuid
  isLocked                Boolean                      @default(false)
  classifiedAt            DateTime                     @default(now()) @db.Timestamptz(6)
  classifiedByUserId      String?
  notes                   String?
  createdAt               DateTime                     @default(now()) @db.Timestamptz(6)
  updatedAt               DateTime                     @default(now()) @updatedAt @db.Timestamptz(6)

  financialCostCenter     FinancialCostCenter          @relation(fields: [financialCostCenterId], references: [id], onDelete: Restrict)
  financialSupplier       FinancialSupplier?           @relation(fields: [financialSupplierId], references: [id], onDelete: SetNull)
  rule                    SupplierCostCenterRule?      @relation(fields: [ruleId], references: [id], onDelete: SetNull)

  @@unique([nomusPayableExternalId, financialCostCenterId])
  @@index([nomusPayableExternalId])
  @@index([financialCostCenterId])
  @@index([financialSupplierId])
  @@index([source])
  @@index([isLocked])
}
```

> **FK lógica para AP:** `nomusPayableExternalId` referencia `NomusAccountsPayable.externalId` (unique). FK Prisma opcional na migration se política do projeto permitir referência a tabela read-only.

### 4.7 `FinancialCostCenterAuditLog`

```prisma
model FinancialCostCenterAuditLog {
  id                      String                            @id @default(uuid())
  entityType              FinancialCostCenterAuditEntityType
  entityId                String
  action                  FinancialCostCenterAuditAction
  nomusPayableExternalId  Int?
  beforeJson              Json?
  afterJson               Json?
  metadataJson            Json?                             // batchId, preview, reason
  userId                  String?
  userEmail               String?
  createdAt               DateTime                          @default(now()) @db.Timestamptz(6)

  @@index([entityType, entityId])
  @@index([nomusPayableExternalId])
  @@index([userId])
  @@index([createdAt])
  @@index([action])
}
```

### 4.8 Configuração de período fechado (opcional Fase 4+)

```prisma
model FinancialClassificationPeriodConfig {
  id                  String   @id @default(uuid())
  closedThroughDate   DateTime @db.Date
  updatedByUserId     String?
  updatedAt           DateTime @default(now()) @updatedAt @db.Timestamptz(6)
}
```

---

## 5. Endpoints propostos

Padrão: `registerFinance*Routes()` em `src/lib/`, registrado em `server.ts`. Autenticação via `requireAppAuth` + `requireAnyPermission`.

### 5.1 Fornecedores — `/api/finance/suppliers`

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/finance/suppliers` | `finance.suppliers.view` | Lista paginada; filtros: `q`, `status`, `hasDocument`, `costCenterId`, `needsReview` |
| GET | `/api/finance/suppliers/:id` | `finance.suppliers.view` | Detalhe + aliases + regras + stats AP (read-only) |
| POST | `/api/finance/suppliers` | `finance.suppliers.manage` | Criar manual |
| PATCH | `/api/finance/suppliers/:id` | `finance.suppliers.manage` | Editar, merge, resolver `needsReview` |
| POST | `/api/finance/suppliers/:id/aliases` | `finance.suppliers.manage` | Adicionar alias |
| DELETE | `/api/finance/suppliers/aliases/:aliasId` | `finance.suppliers.manage` | Remover alias |
| POST | `/api/finance/suppliers/bootstrap-from-ap` | `finance.suppliers.manage` | Job bootstrap (dry-run via `?preview=true`) |

### 5.2 Centros de custo — `/api/finance/cost-centers`

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/finance/cost-centers` | `finance.cost_centers.view` | Lista árvore ou flat; filtro `isActive` |
| GET | `/api/finance/cost-centers/:id` | `finance.cost_centers.view` | Detalhe |
| POST | `/api/finance/cost-centers` | `finance.cost_centers.manage` | Criar |
| PATCH | `/api/finance/cost-centers/:id` | `finance.cost_centers.manage` | Editar/desativar |

### 5.3 Regras — `/api/finance/supplier-cost-center-rules`

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/finance/supplier-cost-center-rules` | `finance.cost_center_rules.view` | Lista; filtros `supplierId`, `companyId`, `isActive` |
| POST | `/api/finance/supplier-cost-center-rules` | `finance.cost_center_rules.manage` | Criar regra |
| PATCH | `/api/finance/supplier-cost-center-rules/:id` | `finance.cost_center_rules.manage` | Editar |
| DELETE | `/api/finance/supplier-cost-center-rules/:id` | `finance.cost_center_rules.manage` | Excluir (soft: `isActive=false` preferível) |

### 5.4 Classificação AP

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/finance/accounts-payable/classification-summary` | `finance.ap_allocations.view` | KPIs: total, classificados, sem classificação, locked, por CC |
| GET | `/api/finance/accounts-payable/unclassified` | `finance.ap_allocations.view` | Títulos sem alocação; mesmos filtros base do AP (`companyName`, `personName`, datas) |
| POST | `/api/finance/accounts-payable/classify-batch-preview` | `finance.ap_allocations.apply_batch` | Simula lote; retorna `{ eligible, skipped, conflicts, preview[] }` |
| POST | `/api/finance/accounts-payable/classify-batch-apply` | `finance.ap_allocations.apply_batch` | Aplica lote; body: `externalIds[]` ou filtros + `ruleId?` / `costCenterId?` |
| GET | `/api/finance/accounts-payable/allocations` | `finance.ap_allocations.view` | Alocações por título ou CC |
| POST | `/api/finance/accounts-payable/allocations` | `finance.ap_allocations.manage` | Classificação manual unitária; suporta rateio |
| PATCH | `/api/finance/accounts-payable/allocations/:id` | `finance.ap_allocations.manage` | Alterar CC, lock/unlock |

### 5.5 Auditoria — `/api/finance/cost-center-audit`

| Método | Rota | Permissão | Descrição |
|--------|------|-----------|-----------|
| GET | `/api/finance/cost-center-audit` | `finance.cost_center_audit.view` | Log paginado; filtros `entityType`, `action`, `userId`, `externalId`, datas |

### 5.6 Extensão não-breaking dos endpoints AP existentes (Fase 8)

| Endpoint existente | Extensão |
|--------------------|----------|
| `GET /api/finance/accounts-payable/titles` | Query opt-in `includeClassification=true` adiciona `allocations[]`, `consolidatedSupplier` |
| `GET /api/finance/accounts-payable/dashboard` | Query opt-in `groupByCostCenter=true` (Fase 6) |

Default permanece **sem** campos novos — zero impacto em clientes atuais.

---

## 6. Telas propostas

Nova área no módulo Financeiro, rota sugerida: `/finance/classification` (ou sub-seções dentro de `/finance/accounts-payable`).

Registro em `financeNavigation.ts` com permissão `finance.ap_allocations.view`.

### 6.1 Abas

| Aba | Conteúdo | Permissão mínima |
|-----|----------|------------------|
| **Visão Geral** | KPIs (`classification-summary`), gráfico pizza por CC, títulos pendentes, atalhos bootstrap/lote | `finance.ap_allocations.view` |
| **Centros de Custo** | CRUD árvore, código, nome, ativo, link opcional Compras | `finance.cost_centers.view` / `.manage` |
| **Fornecedores** | Lista consolidada, merge, aliases, fila `needsReview`, vínculo CC default | `finance.suppliers.view` / `.manage` |
| **Regras de Classificação** | Matriz fornecedor → CC, prioridade, vigência, empresa | `finance.cost_center_rules.view` / `.manage` |
| **Títulos sem Classificação** | Tabela com filtros AP; seleção múltipla; preview/apply batch | `finance.ap_allocations.view` / `.apply_batch` |
| **Auditoria** | Timeline de alterações, diff JSON, filtro por usuário/título | `finance.cost_center_audit.view` |

### 6.2 Integração com AP existente (`FinanceAccountsPayablePage`)

| Local atual | Evolução (Fase 8) |
|-------------|-------------------|
| Aba **Fornecedores** (`FinanceApSuppliersTab`) | Link para ficha consolidada; badge CC default |
| Aba **Títulos** (`FinanceApTitlesTab`) | Colunas opcionais: CC, fornecedor consolidado, origem |
| **Auditoria** (`FinanceDataAuditDrawer`) | Alertas: sem mapeamento, sem CC, conflito de regra |
| Drawer de título (futuro) | Classificar manual + lock |

### 6.3 Padrão visual

Reutilizar shell BI existente: `FinanceBiDashboardShell`, `FinanceBiExecutiveHeader`, `FinanceBiFilterPanel`, `FinanceBiKpiCard` — alinhado ao blueprint de Fluxo de Caixa.

---

## 7. Permissões

Novas entradas em `src/lib/permissionCatalog.ts` (módulo `finance`):

| Key | Label sugerido | parentKey | requires |
|-----|----------------|-----------|----------|
| `finance.cost_centers.view` | Financeiro — Ver centros de custo | `finance.view` | `finance.view` |
| `finance.cost_centers.manage` | Financeiro — Gerenciar centros de custo | `finance.cost_centers.view` | view |
| `finance.suppliers.view` | Financeiro — Ver fornecedores consolidados | `finance.view` | `finance.view` |
| `finance.suppliers.manage` | Financeiro — Gerenciar fornecedores | `finance.suppliers.view` | view |
| `finance.cost_center_rules.view` | Financeiro — Ver regras de classificação | `finance.view` | `finance.view` |
| `finance.cost_center_rules.manage` | Financeiro — Gerenciar regras | `finance.cost_center_rules.view` | view |
| `finance.ap_allocations.view` | Financeiro — Ver classificação AP | `finance.accountsPayable.view` | `finance.accountsPayable.view` |
| `finance.ap_allocations.manage` | Financeiro — Classificar títulos AP | `finance.ap_allocations.view` | view |
| `finance.ap_allocations.apply_batch` | Financeiro — Classificação em lote | `finance.ap_allocations.manage` | manage |
| `finance.cost_center_audit.view` | Financeiro — Auditoria de classificação | `finance.ap_allocations.view` | view |

Arquivos espelho (padrão do projeto): `financeCostCentersPermissions.ts`, `financeSuppliersPermissions.ts`, etc.

**Bootstrap de fornecedores:** exige `finance.suppliers.manage`.  
**Período fechado:** alteração exige `finance.cost_centers.manage` ou permissão admin dedicada.

---

## 8. Fases de implantação

| Fase | Escopo | Entregáveis | Critério de done |
|------|--------|-------------|------------------|
| **1 — Schema base** | Migration com enums + models vazios + índices | Prisma schema, migration SQL, seed vazio | `prisma migrate` OK; zero impacto em AP |
| **2 — Fornecedores e aliases** | Lib matching, bootstrap job, API suppliers | `financialSupplier*.ts`, testes matching | Bootstrap dry-run em staging; aliases únicos |
| **3 — Centros de custo** | CRUD `FinancialCostCenter` | API + permissões | Listagem árvore funcional |
| **4 — Regras** | `SupplierCostCenterRule` + API | CRUD regras, validação vigência | Regra resolvível por supplier+company |
| **5 — Alocação/classificação AP** | `AccountsPayableCostCenterAllocation` | APIs allocations, unclassified, manual lock | Rateio 100%; lock respeitado |
| **6 — Dashboards** | `classification-summary`, agrupamento por CC | KPIs, gráficos Visão Geral | Opt-in; AP dashboard inalterado por default |
| **7 — UI completa** | 6 abas, navegação, permissões UI | `FinanceClassificationPage` | Smoke E2E manual |
| **8 — Integração com AP** | Colunas opt-in em titles; links fornecedores | Extensão `includeClassification` | Regressão AP dashboard/titles/export |
| **9 — Auditoria/regressão** | Audit log completo, testes integração, docs | `FinancialCostCenterAuditLog` UI + testes | Suite verde; smoke produção |

**Ordem rígida:** Fases 1→5 são pré-requisito de UI. Fase 8 só após Fase 5 estável.

---

## 9. Testes esperados

### 9.1 Lib pura (`src/lib/*.test.ts`)

| Módulo | Casos |
|--------|-------|
| `financialSupplierMatching.ts` | Prioridade personId > documento > nome exato; conflitos → `needsReview` |
| `financialSupplierNormalization.ts` | `normalizeCnpjDigits`, `normalizeSupplierName` (igualdade exata pós-normalização) |
| `financialSupplierBootstrap.ts` | Dry-run não persiste; idempotência segundo bootstrap |
| `supplierCostCenterRuleResolver.ts` | Prioridade, vigência, `companyId` scope |
| `apCostCenterAllocation.ts` | Soma 100%, lock impede auto, período fechado |
| `apClassifyBatchPreview.ts` | Preview vs apply; skipped locked/closed/unmapped |
| `financialCostCenterAudit.ts` | Toda mutação gera log |

### 9.2 API (testes de rota ou integração)

| Rota | Casos |
|------|-------|
| `GET /suppliers` | 401 sem auth; 403 sem permissão; paginação |
| `POST /suppliers/bootstrap-from-ap` | preview=true não grava |
| `POST /classify-batch-apply` | respeita lock; auditoria criada |
| `PATCH /allocations/:id` | lock/unlock; rateio inválido → 400 |

### 9.3 Regressão AP existente

| Arquivo | Garantia |
|---------|----------|
| `financeAccountsPayableDashboard.test.ts` | Métricas idênticas sem `includeClassification` |
| `financeAccountsPayableTitles.test.ts` | Payload default inalterado |
| `financeAccountsPayableExport.test.ts` | CSV default inalterado |
| `financeCashFlowDashboard.test.ts` | Fluxo de caixa não afetado |
| `nomusAccountsPayableMapper.test.ts` | Sync intocado |

### 9.4 UI (smoke manual / futuro E2E)

- Navegação abas com permissões parciais
- Batch preview antes de apply
- Merge fornecedor atualiza aliases e não altera AP

---

## 10. Riscos

| Risco | Nível | Mitigação |
|-------|-------|-----------|
| **Duplicidade de fornecedor** — CNPJ com/sem máscara, nomes variantes | **P0** | `documentDigits` normalizado; aliases múltiplos; merge manual; nunca fuzzy name |
| **Documento ausente** — matching fraco | **P1** | `needsReview`; sem auto-rule até confirmação |
| **Regra errada** — CC incorreto em massa | **P0** | Batch preview obrigatório; amostra + contagem; auditoria |
| **Sobrescrita indevida** — automação em classificação manual | **P0** | `isLocked`; R4; testes dedicados |
| **Período fechado** — alteração retroativa | **P1** | `closedThroughDate`; automação bloqueada; override com permissão + audit |
| **Impacto em AP atual** — dashboard/export quebrados | **P0** | Campos opt-in; nenhum JOIN obrigatório; testes regressão |
| **Performance** — bootstrap em tabela grande | **P2** | Batch cursor por `externalId`; índices em aliases; job assíncrono |
| **personId instável Nomus** | **P1** | Alias tipo `NOMUS_PERSON_ID`; não unique global; documento como âncora |
| **Confusão CostCenter Compras vs Financial** | **P1** | Nomes distintos na UI; permissões separadas; doc operacional |
| **Multi-empresa** — mesmo fornecedor, empresas diferentes | **P2** | `companyId` em alias e regra; matching escopado |

---

## Apêndice A — Referência rápida AP atual

### Model `NomusAccountsPayable` (campos obrigatórios)

`id`, `externalId`, `rawPayload`, `payloadHash`, `syncedAt`, `createdAt`, `updatedAt`

### Endpoints AP existentes (não alterar comportamento default)

- `GET /api/finance/accounts-payable/dashboard`
- `GET /api/finance/accounts-payable/titles`
- `GET /api/finance/accounts-payable/export`
- `GET /api/nomus/accounts-payable/summary`

### Chave efêmera atual de fornecedor (dashboard)

`resolveFinanceApSupplierKey()` em `financeAccountsPayableDashboard.ts`: `cnpj:{bruto}` → `name:{lower}` → `id:{externalId}`

### SQL de diagnóstico (staging/produção, SELECT only)

Ver queries na auditoria técnica para: totais AP, fornecedores únicos, duplicidades documento/nome, top 50.

---

## Apêndice B — Decisões técnicas registradas

| # | Decisão | Alternativa rejeitada | Motivo |
|---|---------|----------------------|--------|
| D1 | `FinancialCostCenter` separado | Reutilizar `CostCenter` | Permissões Compras, semântica diferente, seed A-CLASS |
| D2 | FK por `externalId` | FK por `NomusAccountsPayable.id` (uuid) | `externalId` estável, unique, usado na API de títulos |
| D3 | Alocação em tabela própria | Coluna `costCenterId` em AP | AP é read-only Nomus |
| D4 | Matching sem fuzzy | Similaridade de strings | Risco falso positivo; regra R8 |
| D5 | `rawPayload` para reprocessamento | Duplicar campos fornecedor | Já existe; bootstrap lê colunas materializadas |
| D6 | Permissões granulares novas | Reutilizar só `finance.accountsPayable.view` | Separação ver/gerenciar/lote/auditoria |

---

*Documento gerado para guiar implementação completa sem dependência de memória de conversa. Próximo passo: Fase 1 (migration schema base) após aprovação deste blueprint.*
