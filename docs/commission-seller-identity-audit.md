# Auditoria de identidade de vendedor (comissões)

## Objetivo

Garantir que o mesmo vendedor Nomus — mesmo com IDs externos diferentes ou sem ID — seja consolidado em **uma única pessoa comissionada canônica**, sem perder comissão nem pagar em duplicidade.

## Como o vendedor é identificado hoje

| Fonte | Campos brutos |
|-------|----------------|
| `SalesOrder` | `externalSellerId`, `responsible` |
| `CommissionRecord` | `nomusSellerId`, `commissionPersonId` → `CommissionPerson.name` |
| `CommissionPaymentSchedule` | via registro de comissão + CR |
| `CommissionPerson` | `nomusPersonId`, `name` |

Não há vendedor em `NomusNfe` nem em `NomusAccountsReceivable` — a cadeia é pedido → NF → comissão → CR.

## Resolução canônica

Helper central: `resolveCommissionSellerIdentity()` em `src/lib/commissions/commissionSellerIdentity.ts`.

Ordem de resolução:

1. Alias ativo por `rawSellerId + source`
2. `CommissionPerson` por `nomusPersonId`
3. Alias ativo por `normalizedSellerName`
4. `CommissionPerson` por nome normalizado (`normalizeCommissionPersonName`)
5. Se múltiplos cadastros com mesmo nome → `MULTIPLE_CANONICALS` (não consolida automaticamente)
6. Conflito de aliases → `CONFLICT`

`resolveCanonicalCommissionPersonId()` mapeia `commissionPersonId` duplicado para o canônico em relatórios/agrupamentos.

## Aliases persistidos

Tabela `CommissionPersonAlias` (migration `20260706140000_commission_person_alias`):

- Vincula `rawSellerId` e/ou nome normalizado a `CommissionPerson`
- Status: `ACTIVE`, `INACTIVE`, `PENDING`
- Consolidação oficial exige alias `ACTIVE` ou cadastro único por nome
- Matching automático por nome gera sugestão; operador aprova alias manualmente

### Exemplo: Gislene Lima

1. Cadastro canônico: `CommissionPerson` com `nomusPersonId=464` e nome `GISLENE LIMA`
2. Alias `ACTIVE` para `rawSellerId=464` → `NOMUS_ORDER`
3. Alias `ACTIVE` para nome normalizado sem ID (pedidos antigos sem `externalSellerId`)
4. Rodar auditoria:

```bash
npx tsx scripts/audit-commission-seller-identity.ts \
  --year=2026 --month=6 --seller="GISLENE" --json --details
```

Status esperado: `OK_CANONICAL` com `pending.outsideCanonical=0`.

## Como evitar duplicidade

- **Não** fundir automaticamente cadastros com nomes parecidos mas pessoas diferentes
- Usar `dedupe-commission-persons.ts --preview` antes de `--apply`
- Criar aliases explícitos em vez de hardcode no motor
- Reprocessar histórico só com preview (`preview-commission-customer-exclusion-impact.ts` como referência)

## Scripts de auditoria

### AR x Comissão

```bash
npx tsx scripts/reconcile-ar-vs-commission.ts --year=2026 --month=6 --json --details
```

Explica por que o AR financeiro (~R$ 1,31 Mi recebido) difere da comissão PAYABLE (~R$ 847k):

- AR por `settlementDate` inclui **todos** os títulos baixados
- Comissão PAYABLE inclui só CRs com `CommissionPaymentSchedule` + registro ativo
- Categorias: sem comissão, cliente excluído, sem vínculo NF/pedido, vendedor ambíguo, etc.

### Identidade de vendedores

```bash
npx tsx scripts/audit-commission-seller-identity.ts --year=2026 --month=6 --json
```

## Operação manual

1. Rodar auditoria de vendedores
2. Se `MULTIPLE_CANONICALS` ou `CONFLICT`: revisar em **Pessoas Comissionadas**
3. Criar `CommissionPersonAlias` para cada `rawSellerId` ou nome órfão
4. Opcional: `dedupe-commission-persons.ts --preview` e `--apply` para mesclar cadastros
5. Revalidar comissão PAYABLE e fechamento mensal

## UI de aliases

A UI de aliases em Pessoas Comissionadas pode ser adicionada em fase seguinte. Até lá, aliases são gerenciados via API/banco ou script de backfill dedicado.

## Regras de comissão

- **Gerada / prevista / a pagar**: usam motor existente; relatórios consolidam por `commissionPersonId` canônico quando aplicável
- **Comissão mensal oficial**: `settlementDate` do CR
- **Previsão**: `dueDate`
- **Geração**: NF/pedido

Não altera Nomus, CR original, pedido ou NF.
