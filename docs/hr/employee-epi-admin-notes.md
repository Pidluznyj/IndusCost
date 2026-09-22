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

## Escala de tamanhos (2026-09-22)

Fonte única em `src/lib/employeeHrUi.ts` (`EPI_LETTER_SIZE_SCALE`), usada pelos selects do cadastro, pela validação do servidor (`normalizeEpiSize`) e pelas sugestões de tamanho na entrega de EPI.

| Campo | Opções |
|-------|--------|
| Camiseta / camisa, Jaqueta / blusa | PP, P, M, G, GG, XG, 2XG, 3XG, 4XG, 5XG · Sob medida · Não se aplica |
| Calça | Letra PP a 5XG **e** numeração 34 a 60 (select agrupado) · Sob medida · Não se aplica |
| Luva | 6 / PP, 7 / P, 8 / M, 9 / G, 10 / GG, 11 / XG, 12 / 2XG · Único · Não se aplica |
| Calçado / bota | Numeração 33 a 48 · Sob medida · Não se aplica (letra não se aplica) |
| Entrega de EPI (tamanho) | Texto livre com sugestões PP a 5XG, Único, Sob medida |

Rótulos da escala anterior são convertidos pela posição (os dois tamanhos acima de GG eram XGG e EXGG): `XGG` → `XG`, `EXGG` → `2XG`, luva `11 / XGG` → `11 / XG` (`EPI_SIZE_LEGACY_ALIASES` / `canonicalEpiSize`). O cadastro e a ficha já mostram o rótulo novo, e o próximo "Salvar alterações" grava com ele — sem migration. A conversão só vale no campo cuja lista tem o rótulo novo: luva ou calçado com "XGG"/"EXGG" (da época em que eram texto livre) seguem como valor legado, aparecem no select e não bloqueiam o salvar.
- Admin: salário ≥ 0; jornada 1–744; produtividade 0–200; IDs de verba devem existir.
- Notas: sanitize + limites (EPI 2000; profissional/admin 4000); sem versionamento.
- GET listagem sem `employees.edit`: omite salário, `costs`, valores de verbas e `adminNotes`.
- Auditoria `employee.admin_epi_notes.*`: flags e comprimentos — **nunca** valor salarial nem texto completo de notas.

## Limitações conscientes

- Sem CEP / entrega EPI / almoxarifado neste prompt.
- `monthlyHours` permanece visível na listagem (não financeiro); salário/custos não.
- Inventário PPE continua independente do RH.
