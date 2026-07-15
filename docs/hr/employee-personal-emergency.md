# Abas Pessoal e Emergência — validação e proteção

| | |
|---|---|
| Data | 2026-07-15 |
| Escopo | Normalizar/validar/proteger PII sem CEP externo |

## Classificação dos campos

| Campo | Classe | Persistência | Permissão de leitura API |
|-------|--------|--------------|--------------------------|
| CPF | documento + identidade canônica (Person) | dígitos; check digit | `employees.edit` |
| RG | documento | texto (máx. 32) | `employees.edit` |
| Nascimento | dado pessoal RH | date | `employees.edit` |
| Telefone | contato + Person | 10–11 dígitos | `employees.edit` |
| E-mail pessoal | contato + Person | lowercase | `employees.edit` |
| Endereço | endereço (texto livre) | máx. 500 | `employees.edit` |
| Contato emergência * | emergência (só Employee) | nome+tel+relação | `employees.edit` |

Nome / nome social / e-mail corporativo permanecem na aba Profissional.

## Regras

- Create/update: validação FE + BE (`prepareEmployeePersonalHrFields`).
- Legado: CPF/telefone/e-mail inválidos só se **inalterados** na edição.
- Emergência: se qualquer campo preenchido → nome e telefone obrigatórios.
- GET `/api/employees`: sem `employees.edit`, campos pessoais/emergência vêm `null` + flags `personalPiiRedacted` / `hasPersonalPii`.
- Auditoria: `employee.personal_hr.*` apenas com flags e máscaras (sem endereço/CPF completo).
- Sem integração ViaCEP / BrasilAPI.

## UI

- Máscaras visuais de CPF e telefone.
- Visualização mascara nascimento sem permissão.
- Edição exige `employees.edit` (já existente).
