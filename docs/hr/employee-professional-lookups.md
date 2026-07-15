# Aba Profissional — fontes oficiais (lookups)

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Substituir campos livres por fontes oficiais (sem cadastros paralelos) |

## Decisão por campo

| Campo | Fonte oficial | Persistência | UI | Legado |
|-------|---------------|--------------|----|--------|
| Cargo | `Role` | `roleId` (UUID) | select remoto `/lookups/roles?q=` | ID inexistente → 400 |
| Departamento / setor | *sem tabela* | `department` (texto) | texto + sugestões `/lookups/departments?q=` | permanece livre |
| Centro de custo | `FinancialCostCenter` (Financeiro) | `costCenterId` + rótulo `costCenter` | select remoto `/lookups/cost-centers?q=` | rótulo sem ID só se inalterado na edição |
| Gestor responsável | `Employee` (RH) | `managerId` + `managerName` canônico | select remoto `/lookups/managers?q=` | gestor inativo histórico preservado |
| Tipo de contrato | enum `EMPLOYEE_CONTRACT_TYPES` | `contractType` | select | valor fora do enum só se inalterado |
| Classificação | enum DIRETO/INDIRETO/APOIO | `classification` | select | inválido → 400 |

## Regras do gestor

- Lista padrão: colaboradores **ativos** (exclui o próprio).
- Nome exibido: socialName || name.
- Backend: bloqueia self, ciclo direto e indireto; permite manter `managerId` inativo já vinculado.

## Centro de custo

- Fonte única: cadastro financeiro (`FinancialCostCenter`).
- Não altera regras financeiras do módulo Financeiro.
- Create exige `costCenterId` ativo; update pode manter CC inativo já salvo.

## Endpoints

- `GET /api/employees/lookups/roles`
- `GET /api/employees/lookups/cost-centers`
- `GET /api/employees/lookups/managers`
- `GET /api/employees/lookups/departments` (sugestões, não cadastro)

Permissão: `employees.view` ou `employees.edit`.

## Migration

Nenhuma nova nesta entrega — FKs `costCenterId` / `managerId` já existentes.
