# Auditoria de identidade de pessoas (somente leitura)

`npm run audit:people-identity` (ou `npx tsx scripts/auditPeopleIdentity.ts`), com o `DATABASE_URL` do ambiente. Só `findMany`: pode rodar em produção. `--json` e `--csv` exportam. CPF só mascarado.

Responde, em números, a duas perguntas: **há uma única Pessoa canônica por pessoa?** e **todo papel (usuário, colaborador, comissionado, motorista, cliente PF) está ligado a uma Pessoa?**

## Categorias

| Categoria | O que é | Como se resolve hoje |
| --- | --- | --- |
| `PESSOA_CPF_REPETIDO` | Duas ou mais Pessoas canônicas com o mesmo CPF | Não há unificação automática: escolher a que fica, religar os papéis a ela (Vincular pessoa existente) e limpar/inativar a repetida em Pessoas |
| `PESSOA_EMAIL_REPETIDO` | Idem, por e-mail corporativo | Idem |
| `USUARIO_PESSOA_DIVERGE_DO_COLABORADOR` | Usuário e seu colaborador apontam para Pessoas diferentes | Religar um dos dois à mesma Pessoa (`PERSON_MISMATCH` no vínculo) |
| `VINCULO_USUARIO_COLABORADOR_PENDENTE` | Usuário sem colaborador, mas há colaborador ativo com o mesmo e-mail | Ficha do colaborador › Acesso ao sistema › Vincular usuário existente |
| `USUARIO_SEM_PESSOA` | Usuário ativo sem Pessoa canônica | Vincular o usuário a um colaborador com Pessoa (o vínculo copia a Pessoa) ou criar a Pessoa |
| `USUARIO_SEM_COLABORADOR` | Usuário ativo sem colaborador e sem candidato pelo e-mail | Decisão do RH: é um colaborador sem cadastro, um acesso técnico ou um externo? |
| `COLABORADOR_SEM_PESSOA` | Colaborador ativo sem Pessoa canônica | Editar colaborador › Vincular pessoa existente / Criar nova pessoa (ou backfill `scripts/canonical-person-backfill.ts`, dry-run primeiro) |
| `COMISSIONADO_SEM_PESSOA` · `MOTORISTA_SEM_PESSOA` · `CLIENTE_PF_SEM_PESSOA` | Papel ativo sem Pessoa | Backfill (dry-run) ou vínculo manual no cadastro |
| `PESSOA_SEM_PAPEL` | Pessoa canônica ativa sem nenhum papel ligado | Candidata a inativação ou a ser a Pessoa "que fica" numa unificação |

## O que o sistema garante hoje (e o que não garante)

- Unicidade de CPF e e-mail entre Pessoas canônicas é verificada **só na aplicação** (criar/atualizar Pessoa). Os índices únicos do banco foram removidos de propósito na migration `20260715200000_canonical_person_core_harden`, para o backfill não travar em dados legados. Logo, repetições podem existir e esta auditoria é o jeito de vê-las.
- Criar usuário (Configurações › Usuários) **não** cria nem exige Pessoa canônica; criar colaborador só cria Pessoa quando o RH pede. Papéis sem Pessoa são válidos por desenho ("legado sem vínculo continua válido").
- Não existe unificação (merge) de Pessoas. A prontidão do ciclo de Desempenho lê apenas o vínculo Colaborador ↔ Usuário (`AppUser.employeeId`).
- Fornecedores (`FinancialSupplier`) são empresas: não há pessoa de fornecedor nem contato de fornecedor como entidade, então não entram aqui.

## Próximos passos possíveis (não feitos)

1. Regras de criação: usuário novo sempre nasce ligado a um colaborador (ou Pessoa) e colaborador novo sempre resolve uma Pessoa.
2. Unificação assistida de Pessoas (escolher a que fica, mover papéis, inativar a outra, auditoria).
3. Só depois de zerar `PESSOA_CPF_REPETIDO`/`PESSOA_EMAIL_REPETIDO`: índices únicos parciais no banco.
