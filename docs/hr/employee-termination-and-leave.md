# Situação do colaborador — desligamento e afastamento

| | |
|---|---|
| Data | 2026-10-16 |
| Escopo | Cadastro do colaborador (Situação), ficha › Profissional e Férias & afastamentos, lista de colaboradores |
| Regras puras | `src/lib/employeeLifecycle.ts` (+ `employeeLifecycle.test.ts`) |
| Leitura no banco | `src/lib/employeeLifecycle.server.ts` |
| Migration | `20261019120000_employee_termination_leave_details` (aditiva) |

## Modelo

| Conceito | Onde fica | Observação |
|----------|-----------|------------|
| Vínculo | `Employee.status` = `ACTIVE` / `INACTIVE` | Inalterado. `INACTIVE` = desligado. |
| Desligamento | `Employee.terminationDate`, `terminationReason`, `terminationNoticeType`, `terminationNoticeDate`, `terminationDetails` | CHECKs: motivo e tipo de aviso enumerados; motivo só com `status = 'INACTIVE'`. |
| Afastamento | `HrAbsence` (tipo de afastamento, início, retorno previsto/real, justificativa em `reason`) + `extendedLicense`, `inssBenefitNumber`, `catNumber` | **Não** é status do Employee: o vínculo continua `ACTIVE`. |
| Situação exibida | calculada (`computeEmployeeSituation`) | Desligado > Afastado > Férias > Ativo. |

Afastado não virou valor de `Employee.status` de propósito: ~15 leitores filtram `status = 'ACTIVE'` (organograma, gestores, competências, vínculo com usuário, compras, dashboard…) e um afastado continua empregado (folha, estabilidade, organograma).

Afastamento em andamento = já iniciado, não cancelado/concluído, sem retorno registrado e sem fim (`endDate`) já passado. **Retorno previsto vencido não encerra** (o INSS pode prorrogar): o colaborador segue afastado, com o alerta "Retorno previsto … e ainda não registrado".

## Afastamentos — regras legais (`LEAVE_RULES`)

| Tipo | Base legal | Pagamento | FGTS | Prazo | Estabilidade |
|------|-----------|-----------|------|-------|--------------|
| `SICK_LEAVE` Doença | Lei 8.213/1991, arts. 59–60 (B31) | Empresa 15 dias; INSS a partir do 16º | Não | — | — |
| `ACCIDENT` Acidente de trabalho | Lei 8.213/1991, arts. 19–22, 60, 118 (B91); Lei 8.036, art. 15 §5º | Empresa 15 dias; INSS a partir do 16º | Sim | — | 12 meses após o retorno (se > 15 dias) |
| `MATERNITY` / `ADOPTION` | CF art. 7º XVIII; CLT arts. 392/392-A; Lei 11.770 | Salário-maternidade | Sim | 120 dias (180 Empresa Cidadã) | Gestante: 5 meses a partir do início (ADCT art. 10) |
| `MISCARRIAGE` Aborto não criminoso | CLT art. 395 | Salário-maternidade | Sim | 14 dias | — |
| `PATERNITY` | CF art. 7º XIX; ADCT art. 10 §1º; Lei 13.257/2016 | Empresa | Sim | 5 dias (20 Empresa Cidadã) | — |
| `MILITARY` | CLT art. 472; Lei 8.036 art. 15 §5º | Sem salário | Sim | — | — |
| `SUSPENSION` Suspensão disciplinar | CLT art. 474 | Sem salário | Não | Máx. 30 dias | — |
| `LEAVE` Licença remunerada | CLT art. 473 | Empresa | Sim | — | — |
| `UNPAID` / `OTHER` | Acordo entre as partes | Conforme o caso | Não | — | — |

Validação (`validateLeave`, cliente e servidor → `400 INVALID_LEAVE`): justificativa obrigatória (mín. 10 caracteres), início dentro do vínculo (após a admissão, antes da demissão, não para desligado), retorno ≥ início, prazo máximo, Empresa Cidadã só onde a lei prevê, e **sem sobreposição** com outro afastamento (limite exclusivo: retorno real › retorno previsto › dia seguinte ao fim). Férias seguem as regras de antes (sem justificativa obrigatória).

Padrões no registro: situação `IN_PROGRESS` se já começou, senão `SCHEDULED`; retorno previsto pelo prazo legal quando houver (maternidade, paternidade, aborto). Registrar o retorno real conclui o afastamento (`COMPLETED`) e grava `RETURN_TO_WORK` / `VACATION_END` no histórico, com `metadata.recordType = "absenceReturn"`; excluir o afastamento remove início e retorno.

## Desligamento — regras legais (`TERMINATION_RULES`)

Motivos: dispensa sem justa causa, por justa causa (art. 482), pedido de demissão, acordo (art. 484-A), término de contrato a prazo, rescisão antecipada pelo empregador (art. 479) / pelo empregado (art. 480), rescisão indireta (art. 483), falecimento, outro. Cada motivo limita os tipos de aviso (`WORKED`, `INDEMNIFIED`, `WAIVED`, `NOT_APPLICABLE`) e lista as verbas devidas.

- Aviso prévio proporcional (Lei 12.506/2011): 30 dias + 3 por ano completo, até 90; acordo = metade; pedido de demissão = 30. Aviso indenizado mostra a projeção (art. 487 §1º).
- Descrição obrigatória (mín. 20) para justa causa, rescisão indireta e outro.
- Exigido ao passar a desligado ou ao mudar a data; desligado legado sem motivo continua editável sem preencher.
- **Bloqueio** (`409 TERMINATION_BLOCKED`): dispensa por iniciativa do empregador (sem justa causa, acordo, rescisão antecipada pelo empregador) durante afastamento em andamento.
- **Aviso com ciência** (`409 TERMINATION_WARNINGS`, `details.warnings`): estabilidade acidentária ou da gestante na data; o cadastro mostra os avisos e reenvia com `acknowledgeTerminationWarnings: true`.

`PATCH /api/employees/:id/status` só aceita `ACTIVE` (reativação: limpa data e dados do desligamento, registra no histórico). Desligar pelo atalho da lista abre o cadastro na seção Situação → `400 TERMINATION_DETAILS_REQUIRED` se chamado com `INACTIVE`.

## Telas

- **Cadastro › Situação do colaborador** (`EmployeeSituationSection`): Ativo / Afastado / Desligado. Afastado mostra o afastamento em andamento (nuances legais, justificativa, nº INSS/CAT, alertas) com **Registrar retorno**, ou o formulário de afastamento com prévia legal e **Registrar afastamento** (gravado na hora). Desligado mostra data de demissão, motivo, aviso, comunicação, descrição, prévia (aviso proporcional, projeção, verbas), bloqueio e avisos.
- **Ficha › Profissional**: Data de demissão, Situação ("Afastado desde …"), cartões do afastamento em andamento e do desligamento.
- **Ficha › Férias & afastamentos**: justificativa, INSS, CAT, base legal, estabilidade; cartão legal para o afastamento em andamento.
- **Lista**: filtro Ativos (vínculo) / Afastados / Desligados e selo de situação com "desde".

## Dados sensíveis

- `terminationDetails` (fatos da justa causa): só com `canViewRestrictedNotes` na ficha; lista `/api/employees` só com dados administrativos.
- Justificativa / nº INSS / CAT (podem conter dado médico): mesma regra da guia Férias & afastamentos (`canViewAbsences`), aplicada em `redactLifecycle`.

## Implantação

Migration **antes** do código (colunas novas são lidas pelo select do cadastro). Aditiva, sem backfill: desligados antigos ficam sem motivo até a próxima edição da data.
