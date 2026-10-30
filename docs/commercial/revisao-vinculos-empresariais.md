# Revisão de vínculos empresariais — motor de crédito (29/10/2026)

Caso real: **VICLA LTDA** (66.913.253/0001-64) × **GODOI & CARDOSO** (54.987.242/0001-40).
As duas têm o mesmo endereço fiscal. O crédito consolidado da VICLA ficou em `EM_ANALISE / RELATED_PARTY_UNVERIFIED`
e ninguém conseguia concluir a revisão.

## 1. Causas-raiz

| # | Causa | Onde (antes) | Efeito |
|---|---|---|---|
| A | Confirmação manual não tirava a pendência | `creditRelationFacts.server.ts` filtrava pendentes só pelos vínculos do QSA/Radar, ignorando `CustomerCorporateLink` CONFIRMED; `portfolioCredit.server.ts` igual | Confirmar não mudava nada: continuava EM_ANALISE na ficha, carteira e CRM |
| B | Rejeição sem efeito | rota gravava a impressão só do **primeiro** candidato (`.find`) e gravava `null` sem avisar; Radar usava só o **primeiro** padrão do par; impressão de endereço/e-mail era texto fixo | Rejeitar não tirava a pendência quando havia mais de uma evidência; mudança real de endereço não reabria |
| C | SUPER_ADMIN passava pela expansão implícita | rota POST e varredura do Radar usavam `user.effectivePermissions` (SUPER_ADMIN = catálogo inteiro) | Política "SUPER_ADMIN não concede" furada no servidor |
| D | Tela lia outra lista de permissões | painel usava `authUser.effectivePermissions` da sessão compacta (vazia para SUPER_ADMIN) | Quem tinha a chave explícita não via os botões; tela e servidor discordavam |

Também: gravação das duas direções sem transação; auditoria sem estado anterior nem justificativa; "Encerrar" exibido em vínculo formal (QSA) onde não tinha efeito; Radar do cliente ignorava rejeições e confirmações.

## 2. Política de autorização (decisão)

- **Quem revisa:** as chaves oficiais já existentes `commercial.credit.exception.grant` (Financeiro) e `commercial.credit.exception.grant.board` (Diretoria), críticas, no catálogo (`permissionCatalog.ts`) e no contrato (`finance.commercial_credit_exception`, que agora lista `/api/customers/:id/corporate-links`).
- **Por que não uma chave nova "revisar vínculo":** confirmar ou rejeitar vínculo muda a decisão consolidada de crédito — mesma criticidade e mesmo público da exceção formal. Uma chave nova nasceria sem ninguém com ela (o caso VICLA continuaria travado) e exigiria seed de concessão, que a missão proíbe fazer automaticamente. A separação continua possível depois, pelo contrato oficial, sem mudar a tela: a regra está num único ponto (`corporateLinkReviewCapability`).
- **Fonte da verdade:** as permissões **atribuídas** ao usuário (`AppUser.permissions`, as mesmas que a tela de Usuários concede e revoga), nunca a lista efetiva expandida nem a sessão compacta. SUPER_ADMIN sem a chave explícita **não** revisa (`EXCEPTION_IMPLICIT_SUPER_ADMIN`).
- **Servidor decide, tela obedece:** `GET /api/customers/:id/commercial-credit` devolve `canReviewCorporateLinks` calculado pela mesma função usada no `POST`. Sem permissão a tela mostra "Esta validação requer autorização de Financeiro ou Diretoria." e o `POST` responde 403.
- Nenhum mecanismo paralelo, nenhum hardcode de usuário, nenhum seed, nenhuma alteração de usuário no banco.

**Revisão de 30/10/2026 (decisão do negócio, substitui a regra anterior para SUPER_ADMIN):** o `SUPER_ADMIN` ativo revisa vínculo pelo papel, sem chave atribuída. Tela, `POST` e varredura do Radar usam `resolveCorporateLinkReviewAuthorization`. A auditoria registra `authorizationBasis` (`ROLE_SUPER_ADMIN` ou `ASSIGNED_PERMISSION`); pelo papel, `permission` fica nula. **Não muda:** conceder exceção de crédito e registrar ocorrência continuam exigindo a chave explícita (`resolveCommercialCreditExceptionPermission`).

## 3. Comportamento do vínculo

| Ação | Exige | Grava | Efeito no crédito |
|---|---|---|---|
| Confirmar | permissão + justificativa (20–2000) + indício **atual** do par (recalculado no servidor) | as duas direções `CONFIRMED`, `evidenceKind=MANUAL`, ator, justificativa, impressões | a empresa entra no grupo de risco; a dívida dela **não** é copiada; sai da lista de pendentes |
| Rejeitar | idem | as duas direções `REJECTED` com a impressão de **todas** as evidências atuais do par | a pendência some; evidência **nova** (outro endereço, telefone, e-mail, sócio) reabre |
| Encerrar | permissão + justificativa + vínculo **manual** confirmado | as duas direções `CLOSED`, `closedAt`, impressões atuais | sai do grupo; a mesma evidência não volta pendente; evidência nova reabre |

- Transação única (`$transaction`), ordem fixa de gravação (menor id primeiro: duas revisões simultâneas não travam), idempotente (repetir não grava nem audita de novo).
- Auditoria (`CommercialAuditLog`, uma linha por direção): ator, papel, permissão usada, data, as duas empresas, ação, justificativa, impressões/evidências, estado anterior (`oldValue`) e novo (`newValue`).
- Vínculo **formal** (QSA com CNPJ, CPF conferido, mesma raiz de CNPJ) aparece como "Comprovado por documento" e não se encerra nem se rejeita aqui: muda quando a fonte pública mudar.
- Indício (endereço, telefone, e-mail, nome de sócio) **nunca vira prova sozinho**: só a decisão humana registrada o resolve. O rigor da política não foi reduzido: sem revisão, o crédito continua em análise.
- Vínculo de pessoa/contato (`CustomerPeopleLinksPanel`, `Customer.personId`/`contactPersonId`) não é vínculo societário e não foi tocado nem convertido.

## 4. Antes × depois (VICLA, sem outras restrições)

| | Individual | Consolidada | Motivo |
|---|---|---|---|
| Antes de revisar | LIBERADO | EM_ANALISE | RELATED_PARTY_UNVERIFIED |
| Rejeitado com justificativa | LIBERADO | LIBERADO | — |
| Confirmado, GODOI regular | LIBERADO | LIBERADO | — |
| Confirmado, GODOI inadimplente | LIBERADO | BLOQUEADO | RELATED_PARTY_DELINQUENT |

Restrição própria (atraso, protesto, QUOD/IEPTB) continua bloqueando em qualquer caso; rejeitar vínculo não é autorização para ignorá-la. Boa Vista/LIKE SERASA não entra no motor.

## 5. Dados e migrations

- **Sem migration e sem seed.** Usa as colunas existentes de `CustomerCorporateLink`. `evidenceFingerprint` passa a guardar várias impressões separadas por vírgula; linha antiga com uma impressão continua válida.
- Rejeição antiga de **endereço/e-mail** (impressão de texto fixo) pode reaparecer **uma vez** como pendente, porque a impressão agora inclui o valor coincidente (hash curto). Direção segura: pede nova revisão, não libera nada.
- Rejeição antiga gravada com impressão `null` nunca teve efeito; continua sem efeito (o par segue pendente até nova decisão).

## 6. Homologação (procedimento oficial, nada na AWS)

```bash
induscost-deploy-homologacao
```

Relatório **somente leitura** (recusa qualquer escrita; não chama bureau nem protesto pago):

```bash
npx tsx scripts/auditCorporateLinkReview.ts --cnpj=66913253000164
```

### Checklist VICLA (homologação)

1. Rodar o relatório: esperado `individual LIBERADO · consolidada EM_ANALISE · RELATED_PARTY_UNVERIFIED` e 1 pendente GODOI & CARDOSO, "Mesmo endereço fiscal", "Baixa · indício, não prova". Se aparecer "leitura de vínculos incompleta", a causa é Radar/QSA indisponível, não o vínculo.
2. Com usuário **sem** a chave: Ficha CNPJ da VICLA mostra o pendente sem botões e a frase "Esta validação requer autorização de Financeiro ou Diretoria.".
3. Com SUPER_ADMIN (mesmo sem a chave): botões Confirmar/Rejeitar aparecem; a decisão grava `authorizationBasis=ROLE_SUPER_ADMIN` e `permission=null` na auditoria.
4. Conceder `commercial.credit.exception.grant` a um usuário de Financeiro pela tela de Usuários (não pelo banco). Sair e entrar.
5. Ficha CNPJ da VICLA: botões Confirmar/Rejeitar aparecem. Conferir o contrato social das duas empresas fora do sistema.
6. Registrar a decisão com justificativa objetiva (o botão só habilita com 20+ caracteres). A ficha recarrega o crédito sozinha.
7. Rodar o relatório de novo: pendentes 0; linhas `CustomerCorporateLink` nas duas direções com o mesmo status; 2 entradas `CORPORATE_LINK_*` com o usuário.
8. Conferir paridade: Carteira (badge sai de "avaliação pendente"), CRM (filtro de crédito), Radar do cliente (`/api/customers/<id>/corporate-radar` sem item em `review`).
9. Ficha CNPJ da GODOI: o mesmo vínculo aparece do outro lado (confirmado ou no histórico).
10. Se confirmado: testar "Encerrar vínculo" com justificativa e ver o histórico "Encerrado".
11. Revogar a chave do usuário e confirmar que os botões somem e o `POST` responde 403.

Não alterar dados de clientes, títulos, protestos, QUOD, Boa Vista, IEPTB, limites ou exceções para "fazer o alerta sumir".
