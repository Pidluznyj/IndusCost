# Abas Pessoal e Emergência — validação e proteção

| | |
|---|---|
| Data | 2026-07-15 (atualizado em 2026-09-21) |
| Escopo | Normalizar/validar/proteger PII sem CEP externo |

## Classificação dos campos

| Campo | Classe | Persistência | Permissão de leitura API |
|-------|--------|--------------|--------------------------|
| CPF | documento + identidade canônica (Person) | dígitos; check digit | `employees.edit` |
| RG | documento | texto (máx. 32) | `employees.edit` |
| Nascimento | dado pessoal RH | date | `employees.edit` |
| Estado civil | dado pessoal RH | texto (máx. 40); a UI oferece `MARITAL_STATUS_OPTIONS` e o valor gravado é o próprio rótulo | `employees.edit` |
| Telefone | contato + Person | 10–11 dígitos | `employees.edit` |
| E-mail pessoal | contato + Person | lowercase | `employees.edit` |
| Endereço | endereço (texto livre) | máx. 500 | `employees.edit` |
| Cidade | endereço | texto (máx. 80) | `employees.edit` |
| UF | endereço | 2 letras maiúsculas, uma das 27 de `BRAZIL_UF_CODES` | `employees.edit` |
| CEP | endereço | 8 dígitos, gravado com máscara `00000-000` | `employees.edit` |
| Contato emergência * | emergência (só Employee) | nome+tel+relação | `employees.edit` |
| Contatos de emergência adicionais | emergência (`HrEmergencyContact`) | nome+tel obrigatórios; relação, tel. alternativo, prioridade 1–9, observação | `canViewEmergency` / `canManageEmergency` da ficha |

Nome / nome social / e-mail corporativo permanecem na aba Profissional. A jornada descritiva (`workSchedule`, máx. 80) também é dado **profissional**: não é PII e não é redigida.

"`employees.edit`" aqui inclui o **Editor de RH** (legado `employees.edit` **ou** canônico `admin.employees:update`) — ver [`employee-functional-record.md`](./employee-functional-record.md#editor-de-rh).

## Regras

- Create/update: validação FE + BE (`prepareEmployeePersonalHrFields`).
- Legado: CPF/telefone/e-mail inválidos só se **inalterados** na edição. O mesmo vale para UF fora da lista e CEP fora do padrão (`normalizeEmployeeState` / `normalizeEmployeeZipCode` com `allowLegacy` + valor anterior); alterados → 400 `INVALID_STATE` / `INVALID_ZIP_CODE`.
- Estado civil e cidade: `trim` + corte no tamanho máximo (mesmo tratamento do endereço); vazio → `null`. O servidor aceita qualquer estado civil até 40 caracteres — o select deve mostrar o valor atual mesmo fora da lista.
- Estado civil, cidade, UF, CEP (e `workSchedule`) só são gravados no POST/PUT quando a chave vem no corpo: um cliente antigo não apaga o valor. Chave ausente no POST grava `null`.
- Emergência: se qualquer campo preenchido → nome e telefone obrigatórios.
- GET `/api/employees`: sem `employees.edit`, campos pessoais/emergência vêm `null` + flags `personalPiiRedacted` / `hasPersonalPii`. Estado civil, cidade, UF e CEP são redigidos **junto com o endereço** (`EMPLOYEE_PERSONAL_ONLY_REDACT_KEYS`) e contam para `hasPersonalPii`.
- Auditoria: `employee.personal_hr.*` apenas com flags e máscaras (sem endereço/CPF completo). Os campos novos entram só como booleanos: `hasMaritalStatus`, `hasCityState`, `hasZipCode`.
- Sem integração ViaCEP / BrasilAPI.

## Contatos de emergência adicionais

O contato **principal** continua nas colunas do Employee (`emergencyContact*`) e é salvo pelo cadastro (`PUT /api/employees/:id`, guia Emergência). Os **adicionais** são linhas `HrEmergencyContact`, gravadas na hora pela ficha ou pelo Editar (`EmployeeEditRecordsPanel`, que esconde o principal com `hidePrimary`):

| Método | Caminho | Notas |
|--------|---------|--------|
| POST | `/api/employees/:id/emergency-contacts` | Nome e telefone obrigatórios; prioridade inteira 1–9 (padrão 2). |
| PATCH | `/api/employees/:id/emergency-contacts/:recordId` | Parcial: `{ name?, phone?, relationship?, alternatePhone?, priority?, notes? }`. 200 `{ id }`. |
| DELETE | `/api/employees/:id/emergency-contacts/:recordId` | 200 `{ ok: true }`. |

- Exigem `canManageEmergency` (`employees.emergency.manage` ou `employees.edit` / Editor de RH).
- `recordId = "primary"` (`PEOPLE_PRIMARY_EMERGENCY_CONTACT_ID`) → 400 `PRIMARY_CONTACT`: "O contato principal é editado no cadastro do colaborador (guia Emergência)."
- `recordId` de outro colaborador → 404 (`findFirst({ id, employeeId })`).
- Auditoria: `employee.emergency.change` com `details.action: "update" | "delete"`, id do contato e **nomes** dos campos alterados — nunca nome/telefone.

## UI

- Máscaras visuais de CPF, telefone e CEP (`formatZipCodeMask`).
- Estado civil e UF em select (`MARITAL_STATUS_OPTIONS`, `BRAZIL_UF_OPTIONS` em `src/lib/employeeHrUi.ts`).
- Visualização mascara nascimento sem permissão.
- Edição exige `employees.edit` (já existente) — ou `admin.employees:update` canônico (Editor de RH).
