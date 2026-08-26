# Ficha Funcional Corporativa

Registro oficial da trajetória do colaborador em Pessoas / RH.

## Princípios

- **Person** = identidade física. A abertura da ficha **não** cria Person nem faz merge.
- **Employee** = snapshot funcional atual (cargo, departamento, gestor, salário de referência).
- **Histórico** = eventos imutáveis em `HrEmployeeHistory` / `HrCompensationAdjustment`.
- **PayrollComponent** permanece no motor de custo HH. Benefícios de RH são `HrBenefit` / `HrEmployeeBenefit` (domínio separado).
- Alterar gestor, cargo administrativo, telefone, EPI, férias ou observações **não** recalcula custo industrial, BOM, CIU, comissões ou Nomus.

## API

| Método | Caminho | Notas |
|--------|---------|--------|
| GET | `/api/employees/:id/profile` | Summary leve + capabilities. Sem salário. `Cache-Control: no-store`. |
| GET | `/api/employees/:id/{professional,career,compensation,benefits,personal,emergency,epi,documents,absences,history,notes}` | Guias sob demanda |
| POST | `/api/employees/:id/compensation-adjustments` | Reajuste atômico (histórico + snapshot + auditoria) |
| POST | `/api/employees/:id/career-events` | Promoção / movimentação transacional |
| GET | `/api/employees/:id/documents/:documentId/download` | Auth + scope + permissão documental |

## Permissões

Namespace oficial: `employees.*` (não foi criado um segundo motor).

- `employees.view` abre a ficha e eventos de reajuste (data / % / tipo). **Nunca** libera valores em R$.
- `employees.compensation.values.view` **ou** `employees.sensitive_data.view` **ou** legado `employees.edit` liberam valores.
- `employees.team.view` / `employees.team.descendants.view` = escopo DIRECT_REPORTS / DESCENDANTS.
- Deny explícito no motor oficial continua `deny > allow > herança`. Chave desconhecida = deny.
- Se `requireResource` anexou `canonicalAccess.viewResources`, valores monetários exigem `admin.employees.compensation_values` na lista (deny remove o recurso). `isDenied` no bag também vence `employees.edit`.

## Proteção financeira

Sem permissão de valores, os DTOs **omitam** as chaves `salary`, `previousAmount`, `newAmount`, `differenceAmount`, `amount` financeiro. Não basta enviar `null`. Testes inspecionam `JSON.stringify`.

## Hierarquia

`Employee.managerId` é a fonte. Ciclos (A→A, A→B→A, A→B→C→A) são bloqueados no cadastro existente e nas movimentações da ficha (CTE PostgreSQL para descendentes, sem N+1).

## Histórico

Ordenação: `effectiveDate DESC`, `createdAt DESC`, `id DESC`. Página padrão: 50.

Backfill de baseline (não inventa promoção):

```bash
npx tsx scripts/backfill-hr-employee-history.ts --dry-run
npx tsx scripts/backfill-hr-employee-history.ts --apply --confirm-apply=HR_EMPLOYEE_HISTORY_INITIAL_STATE
```

O índice único parcial `(employeeId) WHERE eventType = 'INITIAL_STATE'` torna o script idempotente.

Índice de timeline `(employeeId, effectiveDate DESC, createdAt DESC, id DESC)`: justifica-se pela query paginada real da guia Histórico.

## Auditoria

`logEmployeeHrAudit` não grava salário/CPF. `VIEW_COMPENSATION_VALUES` ocorre só no GET de remuneração com valores. Abrir o summary da ficha não gera log financeiro.

## Performance

- Summary: um Employee + 8 eventos + 1 reajuste recente.
- Autores de histórico: `findMany` em lote de `AppUser`, não N+1.
- Guias pesadas: lazy no React + fetch sob demanda com cache da abertura atual.
- Race: `AbortController` + `employeeIdRef` ao trocar João → Maria. Cache de guia por `employeeId:tab` na mesma abertura.
- Histórico: keyset `(effectiveDate, createdAt, id)` — não usa cursor Prisma por id global (evita IDOR/skip duplo).

## Status

`Employee.status` continua `String`. Semântica de apresentação: `ACTIVE`, `INACTIVE`, `ON_LEAVE`, `VACATION`, `TERMINATED` (INACTIVE + data de desligamento aparece como Desligado, sem breaking change no valor persistido).
