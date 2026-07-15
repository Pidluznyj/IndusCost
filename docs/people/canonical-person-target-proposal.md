# Pessoa canônica — proposta-alvo (sem implementação neste prompt)

| | |
|---|---|
| Data | 2026-07-15 |
| Premissa | Proposta baseada no código real e no inventário |
| Este prompt | **Não** altera schema nem comportamento |

## Decisão principal: reutilizar, não criar de novo

Após auditoria:

1. **Já existe** o modelo `Person` + FKs opcionais nos papéis principais (`Employee`, `AppUser`, `CommissionPerson`, `FleetDriver`, `Customer`).
2. **Não** há outro cadastro canônico transversal reutilizável (`Party`/`Individual`/etc. ausentes).
3. Portanto a proposta é: **reutilizar e completar o hub `Person` existente**, em vez de criar um segundo motor.

Criar uma nova tabela paralela seria duplicidade e viola YAGNI.

---

## O que é identidade vs o que permanece no domínio

### Pertence à identidade (`Person`)

- Nome canônico / nome social
- E-mail corporativo e pessoal (normalizados)
- CPF normalizado
- Telefone normalizado
- Status de identidade (ACTIVE/INACTIVE)

### Permanecem no domínio (nunca mover para Person)

| Domínio | Exemplos |
|---------|----------|
| RH / Employee | cargo, salário, admissão, desligamento, contrato, centro de custo, gestor, EPI, dados bancários/admin, endereço completo |
| AppUser | senha, hash, permissões, role, sessão, status de acesso |
| CommissionPerson | type/source Nomus, regras, records, aliases |
| FleetDriver | CNH, unit, reservas |
| Customer | razão social, taxId empresa, segmento, CRM |
| CrmCustomerCommercialOwner | assignmentSource, sellerIdentityKey (papel de carteira) |

---

## Quais modelos devem (continuar a) ter `personId`

| Modelo | Ação | Motivo |
|--------|------|--------|
| Employee | **manter** | identidade RH |
| AppUser | **manter** | login alinhado à mesma PF |
| CommissionPerson | **manter** | mesmo humano comissionado |
| FleetDriver | **manter** | mesmo humano motorista |
| Customer | **manter só PF** | PJ não é Person |
| CrmCustomerCommercialOwner | **não** (por enquanto) | relacionamento; opcionalmente `commissionPersonId` depois |
| CommissionPersonAlias | **não** | sinônimo Nomus |
| SalesOrder / Proposal | **não** | soft seller; Person via CommissionPerson |
| Project owners, Purchase/Maintenance requesters | **não** agora | strings/snapshot; FK AppUser só se UX exigir |
| SupplierServiceTermination | **não** obrigatório | snapshot legal |
| Nomus AR/AP | **nunca** UUID Person no Int Nomus | mapear por documento |
| BrandingSettings | **não** | contato da empresa |
| Emergency contact no Employee | **não** | familiar, não o colaborador |

---

## Vínculos que devem permanecer específicos do domínio

| Vínculo | Representação oficial |
|---------|----------------------|
| Gestor do colaborador | `Employee.managerId` |
| Dono de carteira | `CrmCustomerCommercialOwner` |
| Vendedor do pedido | `externalSellerId` + `CommissionPersonAlias` |
| Contato cadastral do cliente | campos denormalizados (até existir Contact) |
| Solicitante / aprovador operacional | strings ou AppUser tipado no módulo |
| Alias Nomus seller | `CommissionPersonAlias` |

---

## Compatibilidade

- `personId` permanece **opcional**; legado sem vínculo continua válido.
- Não apagar IDs técnicos nem campos denormalizados (`managerName`, `contactName`, etc.).
- Não exigir backfill completo para operar o sistema.
- Não alterar e-mail de login ao mudar e-mail corporativo sem fluxo admin explícito (já documentado no RH).

---

## Migration (estado e próximos passos)

| Item | Situação |
|------|----------|
| Migration `20260715190000_canonical_person` | **já versionada** |
| Execução em produção | **fora deste prompt**; comando no servidor quando homologar |
| Nova migration neste prompt | **não** |
| Futuras migrations | só se formalizar FKs opcionais (ex.: `FleetReservation.requesterUserId` → AppUser) |

---

## Backfill (estratégia proposta)

1. **Dry-run primeiro** (`scripts/canonical-person-backfill-dry-run.ts` / `GET /api/people/diagnostics/unequivocal-matches`).
2. Auto-vínculo **somente** com evidência inequívoca:
   - e-mail exato (CI);
   - CPF/documento 11 dígitos exato.
3. **Proibido** auto-merge por:
   - nome semelhante;
   - e-mail parcial;
   - telefone isolado;
   - só `sellerResponsibleName`.
4. Ambíguos → relatório de pendências + decisão humana (`people.link.manage`).
5. Cliente PJ → nunca Person por identidade da empresa.

---

## Critérios de correspondência inequívoca

| Evidência | Auto-link seguro? |
|-----------|-------------------|
| CPF exatamente igual (11 dígitos) | sim |
| E-mail corporativo/pessoal exatamente igual (CI) | sim |
| `nomusPersonId` ↔ `AppUser.externalSellerId` + confirmação | condicional (média–alta) |
| Nome canônico só | **não** |
| Telefone normalizado só | **não** (sugestão UI no máximo) |

---

## Riscos de merge incorreto

| Risco | Mitigação |
|-------|-----------|
| Homônimos | nunca merge só por nome |
| Homônimo + telefone compartilhado | exigir CPF/e-mail |
| AppUser já ligado a outro Employee | bloquear; mostrar conflito |
| CommissionPerson compartilhado indevido | N:1 a Person ok, mas 1 Person → 1 Employee/AppUser |
| Nomus Int `personId` tratado como UUID | documentação + types separados |
| Sobrescrever dados divergentes | preview de conflitos campo a campo (já previsto na API) |

---

## Clientes PF × PJ (proposta operacional)

| Caso | Regra |
|------|-------|
| Cliente PF (`taxId` 11) | pode `Customer.personId` |
| Cliente PJ (`taxId` 14) | **não** Person; contatos futuros/relatórios separam relacionamento |
| Contato (`contactName`) | relacionamento/snapshot; não identidade do CNPJ |
| Responsável comercial | relacionamento; não identidade do cliente |

---

## Permissões (já no catálogo — referência)

| Key | Uso |
|-----|-----|
| `people.search` | buscar identidades |
| `people.link.manage` | criar/remover vínculos |
| `people.pii.view` | e-mail/CPF sem máscara |
| Aliases | `employees.view/edit`, `users.manage` |

Não criar permissões cosméticas adicionais neste prompt.

---

## Roadmap sugerido (fora deste prompt)

1. Homologar migration no servidor (se ainda não aplicada).
2. Rodar dry-run de backfill e revisar relatório.
3. Completar vínculos inequívocos com auditoria.
4. Avaluar FK tipada `FleetReservation.requesterUserId` → AppUser.
5. Avaliar se `CrmCustomerCommercialOwner` ganha `commissionPersonId` (domínio), não Person direto.
6. Só então considerar modelo `CustomerContact` — se o negócio exigir catálogo de contatos (hoje YAGNI: denormalizado).

---

## Resumo da proposta

**Reutilizar `Person` existente como identidade canônica.**  
Completar vínculos e backfill seguro; não criar motor paralelo; preservar relacionamentos e snapshots de domínio; nunca confundir party Nomus com Person UUID.
