# EPI / Admin / Observações — limites e proteção

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Preferências EPI, referência admin, notas — sem estoque |

## Separação de conceitos

| Conceito | Neste cadastro? | Fonte |
|----------|-----------------|-------|
| Preferência / tamanho | **Sim** | enums UI (`EPI_*_SIZE_OPTIONS`) |
| Necessidade / entrega / estoque / devolução / validade | **Não** | Inventário tem `PPE`, mas **sem** vínculo Employee |
| Dados bancários / matrícula / folha oficial | **Não** no modelo Employee |
| Códigos externos | — | sem campos |
| Observações gerais | **Sim** | `professionalNotes` / `adminNotes` / `epiNotes` |
| Referência salarial / jornada / produtividade | **Sim** | campos Employee + motor HH global (usa salários) |
| Verbas | **Sim** | `PayrollComponent` oficial (`/api/payroll-components`) |

## Regras

- EPI: tamanhos da lista oficial; legado inalterado ok; **não** cria movimentação de estoque.
- Admin: salário ≥ 0; jornada 1–744; produtividade 0–200; IDs de verba devem existir.
- Notas: sanitize + limites (EPI 2000; profissional/admin 4000); sem versionamento.
- GET listagem sem `employees.edit`: omite salário, `costs`, valores de verbas e `adminNotes`.
- Auditoria `employee.admin_epi_notes.*`: flags e comprimentos — **nunca** valor salarial nem texto completo de notas.

## Limitações conscientes

- Sem CEP / entrega EPI / almoxarifado neste prompt.
- `monthlyHours` permanece visível na listagem (não financeiro); salário/custos não.
- Inventário PPE continua independente do RH.
