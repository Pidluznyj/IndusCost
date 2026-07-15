# Cadastro de Colaborador — modelo-alvo

## Matriz completa (campo → fonte)

| Aba | Visual | Técnico | Tipo atual | Origem atual | Origem oficial | Persistência | Obrigatório | Migração | Recomendação |
|-----|--------|---------|------------|--------------|----------------|--------------|-------------|----------|--------------|
| Profissional | Nome completo | `name` | string | livre | livre | texto | sim | não | manter campo livre |
| Profissional | Nome social | `socialName` | string? | livre | livre | texto | não | não | manter campo livre |
| Profissional | E-mail corporativo | `corporateEmail` | string? | **novo** | RH / login | lowercase unique CI | não* | sim | criar novo campo |
| Profissional | Cargo | `roleId` | UUID | Role | Role | ID + nome | sim | não | reutilizar cadastro |
| Profissional | Departamento | `department` | string | livre | *(sem cadastro)* | texto | sim | não | manter campo livre |
| Profissional | Centro de custo | `costCenterId` + `costCenter` | UUID? + texto | texto livre | `FinancialCostCenter` | ID + rótulo cache | sim** | sim | relacionamento |
| Profissional | Classificação | `classification` | enum | DIRETO/INDIRETO/APOIO | mão de obra | enum | sim | não | reutilizar enum |
| Profissional | Tipo contrato | `contractType` | string? | opções UI | mesmas opções | texto normalizado | não | não | reutilizar enum UI |
| Profissional | Admissão | `admissionDate` | date? | livre | livre + validação | date | não | não | validar range |
| Profissional | Desligamento | `terminationDate` | date? | livre | livre + validação | date | não | não | consistente c/ status |
| Profissional | Gestor | `managerId` + `managerName` | UUID? + texto | texto | Employee ACTIVE | ID + nome | não | sim | relacionamento |
| Profissional | Status | `status` | ACTIVE/INACTIVE | enum | enum | string | sim | não | manter |
| Pessoal | CPF/RG/nasc/tel/e-mail/end. | vários | string/date | livre | livre (+ CEP futuro) | texto | não | não | manter + máscara UI |
| Emergência | nome/tel/relação | emergency* | string | livre | livre | texto | não | não | manter no colaborador |
| EPI | tamanhos/notas | shirtSize… | string | enums UI | preferência | texto | não | não | **não** estoque |
| Admin | salário/jornada/verbas | salary… | number | PayrollComponent | PayrollComponent | números + IDs | RH edit | não | reutilizar |
| Observações | notas | professionalNotes / adminNotes | text | livre | livre | trim | não | não | manter livre |

\* Nullable para legado sem e-mail.  
\*\* Novo cadastro exige CC oficial ou rótulo legado na edição.

## Vínculo com login

1. `corporateEmail` é a referência preferida (fallback: `personalEmail` na criação de usuário).
2. Criação de AppUser continua em Configurações → Usuários.
3. `POST /api/employees/:id/link-user` vincula AppUser existente pelo e-mail (sem criar senha).
4. Não altera e-mail de login automaticamente; não desativa login no desligamento.

## Decisões

- Não criar tabela paralela de CC / cargos / gestores / departamentos.
- Departamento permanece texto até existir cadastro oficial.
- EPI permanece preferência de tamanho (não almoxarifado).
- Classificação = mão de obra Direto/Indireto/Apoio.

## Estado de entrega (hardening)

- Lookups oficiais: CC (`FinancialCostCenter`), gestor (`Employee`), cargo (`Role`), e-mail corporativo.
- Pessoa canônica opcional no create/edit; vínculo AppUser explícito.
- Redação GET por facetas (`personal_data` / `sensitive_data` / `administrative_data`) com OR legado `employees.edit`.
- Homologação: [`../people/canonical-person-homologation-checklist.md`](../people/canonical-person-homologation-checklist.md).
- Gestores = colaboradores ativos (sem filtro de “liderança” — fonte inexistente).
- Auditoria de vínculo: log estruturado `employee.link_user` + timestamps Prisma.

## Pendências de negócio

- Cadastro oficial de departamentos/setores.
- ~~Redação de campos sensíveis no GET listagem~~ → feito (Pessoal/Emergência; ver `employee-personal-emergency.md`).
- Inventário/entrega de EPI oficial.
- Estrutura de endereço com CEP (sem API externa neste momento).
