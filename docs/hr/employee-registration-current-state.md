# Cadastro de Colaborador — estado atual (auditoria)

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Pessoas / RH — Novo/Editar Colaborador |

## Arquitetura encontrada

- UI: `EmployeeModule.tsx` + `EmployeeFichaTabNav` + `employeeHrUi.ts`
- API: CRUD em `server.ts` (`/api/employees`)
- Modelo: `Employee` (Prisma) + `Role` (FK) + `AppUser.employeeId` (1:1 opcional)
- Sem serviço Zod dedicado anteriormente — validação imperativa fraca

## Gaps principais (pré-evolução)

| Gap | Detalhe |
|-----|---------|
| Sem e-mail corporativo | Só `personalEmail`; login via Admin → Usuários |
| Centro de custo texto | Não usava `FinancialCostCenter` |
| Gestor texto | `managerName` livre |
| Departamento texto | Sem cadastro oficial |
| Contrato/EPI | Enums no frontend apenas |
| Roles API | Exigia `settings.*` (RH às vezes sem cargos) |
| Dados sensíveis | Máscara UI + **GET listagem redige** CPF/RG/nasc/tel/e-mail/endereço/emergência sem `employees.edit` |

## Fontes oficiais reutilizáveis

| Domínio | Fonte |
|---------|--------|
| Cargo | `Role` + `/api/employees/lookups/roles` (ID obrigatório) |
| Centro de custo | `FinancialCostCenter` + lookup RH (ID obrigatório em create) |
| Gestor | `Employee` ACTIVE + lookup RH (`managerId`; inativo histórico ok) |
| Login | `AppUser.employeeId` + e-mail |
| Contrato | enum `EMPLOYEE_CONTRACT_TYPES` (legado inalterado ok) |
| Classificação | DIRETO / INDIRETO / APOIO (mão de obra) |
| EPI | tamanhos em `employeeHrUi` (sem estoque) |
| Departamento | **sem cadastro** — texto livre + sugestões `/lookups/departments` |

Ver detalhe: [employee-professional-lookups.md](./employee-professional-lookups.md).
