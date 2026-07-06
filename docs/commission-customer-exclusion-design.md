# Design — Exclusão de comissionamento por cliente

**Projeto:** IndusCost / My Industry  
**Data:** 2026-07-03  
**Escopo:** Regras cadastráveis (ex.: ESMALTEC não comissiona) **sem hardcode**, com motivo auditável e comissão R$ 0,00 — **design only** (sem alteração de cálculo nesta etapa).

---

## 1. Resposta ao checklist YAGNI

| # | Pergunta | Resposta |
|---|----------|----------|
| 1 | Precisa existir? | **Sim** — decisão comercial recorrente, não pode ficar no código. |
| 2 | CommissionRule suporta exceção? | **Não** — regras definem *quanto* comissionar (%), não *zerar* por cliente. |
| 3 | Já existe config por cliente? | **Sim** — `CommissionCustomerException`. |
| 4 | customerId / Nomus no banco? | **Sim** — `SalesOrder.externalCustomerId`, `CommissionRecord.customerExternalId`, `Customer.id`. |
| 5 | Dá para reutilizar estrutura? | **Sim** — tabela + API + UI já existem. |
| 6 | Precisa migration? | **Não na fase 1** — entidade Prisma já migrada. Migration opcional fase 2 (ver §8). |
| 7 | Segundo motor? | **Não** — hook no motor existente + overlay na auditoria visual. |
| 8 | Auditar motivo? | `reason` + alerta `CLIENTE_SEM_COMISSAO` + `metadataJson` no record (fase implementação). |
| 9 | Histórico indevido? | Vigência por data da venda/NF; sem retroatividade automática. |
| 10 | Build/testes | Rodados nesta entrega — 167 testes comissões OK. |

---

## 2. Auditoria de entidades

### 2.1 Entidades revisadas

| Entidade | Papel na exclusão |
|----------|-------------------|
| `CommissionRule` | Percentual/base/liberação — **não** é exclusão |
| `CommissionRuleCondition` | Filtro positivo (`customerExternalId` inclui cliente na regra) |
| `CommissionRecord` | Persiste comissão calculada; tem `customerExternalId`, `customerName`, `metadataJson` |
| `CommissionPaymentSchedule` | `commissionExpectedAmount`, `commissionReleasedAmount` por parcela |
| `CommissionCustomerException` | **Entidade de exclusão existente** |
| `SalesOrder` | `customerId` (UUID), `externalCustomerId` (Nomus), `issueDate` |
| `SalesOrderItem` | Itens comissionáveis |
| `Customer` | Cadastro IndusCost (`companyName`, `taxId`) — sem flag “sem comissão” |
| `NomusAccountsReceivable` | CR — **não** define se venda comissiona |
| `NomusNfe` / links NF | Data NF para vigência |

### 2.2 O que já existe no código

| Artefato | Estado |
|----------|--------|
| `CommissionCustomerException` (Prisma) | ✅ Migrado |
| `commissionExceptions.server.ts` | ✅ CRUD |
| `GET/POST/PUT/PATCH /api/commissions/exceptions` | ✅ Rotas |
| `CommissionsExceptionsPage.tsx` | ✅ UI cadastro (rota legada — oculta no modo simplificado) |
| `loadCustomerExceptionIds()` em visual audit | ⚠️ Parcial — só `customerExternalId`, **ignora vigência** |
| Alerta `CLIENTE_SEM_COMISSAO` | ✅ Label “Cliente marcado como sem comissão” |
| `commission-calculation-service.server.ts` | ❌ **Não aplica** exceção — ainda calcula % normal |
| Zerar `commissionExpected` / `commissionReleased` na UI | ❌ Flag alerta only — valores do record permanecem |

### 2.3 Campos `CommissionCustomerException` (atual)

```prisma
model CommissionCustomerException {
  id                 String    @id
  customerExternalId Int?      // ID Nomus — chave preferencial
  customerName       String?   // Snapshot / busca
  commissionPersonId String?   // Escopo opcional por vendedor
  productCode        String?   // Escopo opcional por produto
  productExternalId  Int?
  reason             String    // Motivo auditável (obrigatório)
  startDate          DateTime  // effectiveFrom
  endDate            DateTime? // effectiveTo
  active             Boolean
  createdByUserId    String?
  metadataJson       Json?
  ...
}
```

**Equivalente ao spec proposto** (`CommissionExclusionRule`):

| Spec sugerido | Campo existente |
|---------------|-----------------|
| scope CUSTOMER | implícito (campos cliente; produto/vendedor opcionais) |
| customerExternalId | ✅ |
| customerNameSnapshot | ✅ `customerName` |
| normalizedCustomerName | ⚠️ calcular em runtime (fase 2: coluna indexada) |
| reason | ✅ |
| effectiveFrom / effectiveTo | ✅ `startDate` / `endDate` |
| ACTIVE/INACTIVE | ✅ `active` |
| notes | ✅ `metadataJson` ou ampliar `reason` |

---

## 3. Decisão arquitetural

### 3.1 Reutilizar `CommissionCustomerException` (sem nova tabela)

**Motivo:** YAGNI — entidade, API e UI já existem. Evita migration e duplicidade conceitual.

**Nome de produto:** na UI, rotular como **“Clientes excluídos de comissionamento”** (alias de Exceções).

**Não usar `CommissionRule`** para exclusão: regra de % e exclusão são concerns distintos; misturar gera ambiguidade (“regra 0%” vs “cliente bloqueado”).

### 3.2 Onde aplicar (fase implementação — fora deste prompt)

```
                    ┌─────────────────────────────┐
                    │ CommissionCustomerException │
                    │ (cadastro, vigência)        │
                    └──────────────┬──────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         ▼                         ▼                         ▼
 calculateCommissions      commission-release-service   commissionVisualAudit
 (zerar no nascimento)     (não liberar se excluído)    (overlay R$ 0 + motivo)
         │                         │                         │
         └─────────────────────────┴─────────────────────────┘
                    CommissionRecord + Schedules
                    (permanecem visíveis, amount = 0)
```

**Um único resolvedor puro (novo módulo proposto):**

`src/lib/commissions/commissionCustomerExclusion.ts`

```typescript
resolveCustomerExclusion(input: {
  customerExternalId: number | null;
  customerName: string | null;
  productCode?: string | null;
  commissionPersonId?: string | null;
  referenceDate: Date;  // NF ou pedido — NÃO settlementDate
  rules: CommissionCustomerException[];
}): { excluded: boolean; ruleId?: string; reason?: string }
```

---

## 4. Identificação do cliente

Prioridade de match (mais confiável primeiro):

1. **`customerExternalId`** — ID Nomus em `SalesOrder.externalCustomerId` → `CommissionRecord.customerExternalId`
2. **`customerName` normalizado** — fallback quando ID ausente (ex.: “ESMALTEC S/A” ≈ “ESMALTEC”)
   - Normalização: uppercase, trim, remover pontuação, colapsar espaços
3. **`Customer.id` (UUID)** — fase 2 via FK ou `metadataJson.customerId` no cadastro da exceção

**Cadastro ESMALTEC (exemplo operacional):**

```json
POST /api/commissions/exceptions
{
  "customerName": "ESMALTEC",
  "customerExternalId": 12345,
  "reason": "Cliente excluído de comissionamento — política comercial",
  "startDate": "2026-07-01",
  "endDate": null,
  "active": true
}
```

Sem hardcode: busca por nome no formulário + ID Nomus quando disponível.

---

## 5. Regra de vigência

### 5.1 Data de referência (decisão comissionável)

| Prioridade | Campo | Quando |
|------------|-------|--------|
| 1 | `CommissionRecord.confirmedAt` | NF confirmada / documento de saída |
| 2 | `SalesOrder.issueDate` | Pedido sem NF ainda |
| 3 | Nunca | `NomusAccountsReceivable.settlementDate` |

**Princípio:** *Se a venda/NF é comissionável na data X, a baixa em outro mês não “reativa” comissão.*

### 5.2 Algoritmo de vigência

```
excluded = rule.active
  AND rule.startDate <= referenceDate
  AND (rule.endDate IS NULL OR rule.endDate >= referenceDate)
  AND matchCustomer(rule, sale)
  AND matchOptionalScopes(rule, product, seller)
```

### 5.3 Não retroatividade

- Exclusão com `startDate = 2026-07-01` **não altera** records de jun/2026 já calculados.
- Recalcular período anterior exige **recálculo manual autorizado** (`calculateCommissions` com escopo explícito).
- Records históricos **não são apagados** — podem ser superseded pelo hash de recálculo.

---

## 6. Comportamento esperado

### 6.1 Telas e export

| Elemento | Comportamento |
|----------|---------------|
| Pedido / NF / CR | **Permanecem visíveis** |
| Valor vendido / recebido | **Inalterado** |
| Base comissionável | Pode exibir `baseAmount` original + coluna **“base excluída”** ou base efetiva 0 |
| Comissão esperada | **R$ 0,00** |
| Comissão liberada | **R$ 0,00** (release service respeita exclusão) |
| Status visual | `SEM_COMISSAO` |
| Motivo | **“Cliente excluído de comissionamento”** (+ `reason` da regra) |
| CSV export | Coluna `motivo_exclusao` / alertas |

### 6.2 Persistência (fase implementação)

Opção recomendada — **zerar no cálculo**, não delete:

```typescript
CommissionRecord {
  baseAmount: originalBase,           // mantém rastreio
  ratePercent: 0,
  commissionAmount: 0,
  metadataJson: {
    exclusionRuleId: "...",
    exclusionReason: "Cliente excluído...",
    originalRatePercent: 2.5,
    originalCommissionAmount: 150.00
  }
}
```

Schedules: `commissionExpectedAmount = 0`; liberação permanece 0.

### 6.3 Impacto por visão

| Visão | Impacto |
|-------|---------|
| **Fechamento mensal** (PAYABLE) | Comissão a pagar **não inclui** cliente excluído (R$ 0 liberado) |
| **Previsão** (FORECAST) | Pendente **R$ 0** — título pode aparecer, comissão prevista 0 |
| **Auditoria visual** | Linha completa + alerta + motivo |
| **Pagamento / lote** | Nada a pagar para linhas excluídas |

---

## 7. Auditoria

| Canal | Conteúdo |
|-------|----------|
| `CommissionCustomerException.reason` | Motivo cadastrado pelo usuário |
| `CommissionRecord.metadataJson` | ID da regra, motivo, valores originais (opcional) |
| `CommissionAuditIssue` | Tipo futuro `CUSTOMER_EXCLUDED` (opcional — alerta visual já cobre) |
| Alerta visual | `CLIENTE_SEM_COMISSAO` → texto **“Cliente excluído de comissionamento”** (ajuste de copy) |
| CSV | `# motivo_exclusao=` ou coluna dedicada |

---

## 8. Migration — necessária?

### Fase 1 (recomendada): **Não**

Tabela `CommissionCustomerException` já atende:
- cliente Nomus + nome
- vigência
- motivo
- ativo/inativo
- escopo produto/vendedor

### Fase 2 (opcional): migration incremental

Só se necessário matching por UUID ou índice de nome:

| Campo novo | Motivo |
|------------|--------|
| `customerId` UUID FK → `Customer` | Vínculo cadastro IndusCost |
| `normalizedCustomerName` String index | Busca rápida por nome sem ID Nomus |

Documento de migration separado: `docs/commission-customer-exclusion-rule-design.md` (criar **somente** se fase 2 aprovada).

---

## 9. Plano de implementação (próximos passos)

1. **`commissionCustomerExclusion.ts`** — resolvedor puro + testes vigência/nome/ID
2. **`calculateCommissions`** — antes de persistir, aplicar exclusão → amount 0 + metadata
3. **`commission-release-service`** — guard: se record excluído, released = 0
4. **`commissionVisualAudit.server.ts`** — substituir `loadCustomerExceptionIds` por resolvedor com vigência; overlay zerar expected/released na exibição até recálculo backfill
5. **Copy** — alerta: “Cliente excluído de comissionamento”
6. **UI** — reexpor cadastro em Configurações ou subaba Comissões (modo simplificado)
7. **CSV** — coluna motivo em exports fechamento/previsão/auditoria
8. **Script** — `audit-commission-customer-exclusions.ts` listar vendas afetadas

---

## 10. Exemplo ESMALTEC (aceite)

| Cenário | Resultado esperado |
|---------|-------------------|
| NF jun/2026, exclusão desde jul/2026 | Comissão **normal** em jun/2026 |
| NF jul/2026, exclusão desde jul/2026 | Comissão **R$ 0**, motivo auditável |
| CR recebido ago/2026 de NF jul/2026 excluída | Comissão liberada **R$ 0** |
| Tela fechamento ago/2026 | Venda aparece; comissão a pagar **R$ 0** |
| Export CSV | Motivo preenchido |

---

## 11. Arquivos auditados (referência)

| Arquivo | Relevância |
|---------|------------|
| `prisma/schema.prisma` | Models Commission*, Customer, SalesOrder |
| `src/lib/commissions/commissionExceptions.server.ts` | CRUD exceções |
| `src/lib/commissions/commission-calculation-service.server.ts` | Motor cálculo |
| `src/lib/commissions/commissionVisualAudit.server.ts` | Flag parcial `customerNoCommission` |
| `src/lib/commissions/commissionVisualAudit.ts` | Alerta `CLIENTE_SEM_COMISSAO` |
| `src/lib/commissions/commission-release-service.ts` | Liberação por CR |
| `src/lib/commissionsRoutes.ts` | API `/exceptions` |
| `src/components/commissions/pages/CommissionsExceptionsPage.tsx` | UI cadastro |

---

## 12. Conclusão

**Não criar `CommissionExclusionRule` nem migration nesta fase.**  
Expandir o uso de **`CommissionCustomerException`** com resolvedor único, vigência por data NF/pedido, e zeramento auditável no motor existente — **sem segundo motor e sem ocultar vendas**.
