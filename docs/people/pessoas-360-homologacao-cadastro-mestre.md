# Pessoas 360° como cadastro mestre — procedimento de homologação e regularização dos 7 casos

Data: 2026-10-21. Branch: `feat/people-360-master-identity`. Implementação: [pessoas-360-implementation.md](pessoas-360-implementation.md) §11. Validação local: [pessoas-360-validation.md](pessoas-360-validation.md) §6.

**Escopo e limites.** Este procedimento foi escrito, não executado: a máquina de desenvolvimento não tem acesso SSH ao servidor de homologação (`servidor-01`, `/opt/induscost-homolog/app`, PostgreSQL `127.0.0.1:5433/teste_bi_homolog`). Os sete casos foram reproduzidos com dados fictícios na base local descartável (`seedPeopleLegacy.mts` + E2E `part16`). Nada aqui toca produção (`/opt/induscost`, porta 3000, `induscost.service`). Nenhuma migration nova foi adicionada nesta missão: o schema é o mesmo da entrega anterior (`20261027120000_person_link_event`).

## 0. Pré-condições (somente leitura)

```bash
cd /opt/induscost-homolog/app
git status --short | head; git rev-parse --short HEAD; git branch --show-current
systemctl is-active induscost-homolog; ss -ltnp | grep -E ':3000 |:3001 '     # anotar os dois PIDs: 3000 é produção
grep -E '^DATABASE_URL=' .env | sed -E 's#^.*@([^/]+)/([^?"]+).*#\1/\2#'     # deve imprimir 127.0.0.1:5433/teste_bi_homolog
curl -sS http://127.0.0.1:3001/api/app-version                                 # SHA em execução (esperado: cf4921ff)
npm run audit:people-identity -- --json > /var/tmp/people-audit-before.json    # baseline ANTES (CPF mascarado, só leitura)
npm run audit:people-identity -- --only=USUARIO_SEM_PESSOA,USUARIO_COLABORADOR_PESSOA_INATIVA,USUARIO_EMAIL_DIVERGE_DO_COLABORADOR
```

Esperado no baseline (diagnóstico de 2026-10-21): `usuariosAtivos` ≈ 7 sem Pessoa, 1 `USUARIO_COLABORADOR_PESSOA_INATIVA` (Eduardo), 1 `USUARIO_EMAIL_DIVERGE_DO_COLABORADOR` (Leticia). As duas últimas categorias só existem no código novo; antes do deploy o script antigo não as mostra.

Nunca exportar `PEOPLE_PG_TEST_URL`/`PERFORMANCE_PG_TEST_URL` no servidor: os testes de integração e os seeds recusam `teste_bi*`, mas o guard é de nome — não dependa dele.

## 1. Backup

```bash
INDUSCOST_ROOT=/opt/induscost-homolog/app BACKUP_DIR=/var/backups/induscost-homolog \
  bash scripts/backupDatabaseBeforeDeploy.sh --reason=pre_people_master
ls -la /var/backups/induscost-homolog | tail -2          # anotar o .dump; o script valida com pg_restore --list
```

## 2. Código e build (branch, sem merge em main)

```bash
git fetch origin feat/people-360-master-identity
git checkout feat/people-360-master-identity && git pull --ff-only origin feat/people-360-master-identity
git rev-parse --short HEAD                                # anotar o SHA liberado
npm ci --no-audit --no-fund                               # só se package-lock.json mudou (não mudou nesta missão)
npx prisma validate && npx prisma migrate status           # pendentes esperadas: nenhuma nova (person_link_event já aplicada em cf4921ff)
npx prisma generate
NODE_ENV=production npm run build && cat dist/build-info.json   # commit == SHA liberado, env=production
```

Não usar `scripts/deploy-server-main-update.sh` (faz `git pull origin main`, mata a porta 3000 e sobe com nohup) nem `restart-induscost-production.sh` neste host.

## 3. Reinício só da homologação

```bash
sudo systemctl restart induscost-homolog && sleep 6
systemctl --no-pager status induscost-homolog | head -8
ss -ltnp | grep -E ':3000 |:3001 '                        # PID da 3000 inalterado
journalctl -u induscost-homolog -n 40 --no-pager | grep -iE 'error|prisma|listen' | tail
V=$(curl -sS http://127.0.0.1:3001/api/app-version); echo "$V"
[ "$(echo "$V" | sed -E 's/.*"commit":"([0-9a-f]+)".*/\1/' | cut -c1-7)" = "$(git rev-parse --short HEAD)" ] && echo SHA_OK || echo SHA_DIVERGE
```

Rollback de código: `git checkout cf4921ff && NODE_ENV=production npm run build && sudo systemctl restart induscost-homolog`. Dados só mudam pelas operações da interface descritas abaixo, todas auditadas e reversíveis (vínculo) ou explícitas (situação da Pessoa); o dump de §1 é a rede de segurança.

## 4. Fumaça (sem gravar)

1. Login com o SUPER_ADMIN de homologação → `/people` lista → abrir a ficha de uma Pessoa.
2. `POST /api/people/:id/merge` sem step-up → 403 `ADMIN_ELEVATION_REQUIRED`.
3. Na ficha de uma Pessoa sem conta: botões "Habilitar acesso ao IndusCost" e "Regularizar vínculo existente" visíveis; abrir "Regularizar" lista contas sem Pessoa; fechar sem confirmar.
4. `npm run audit:people-identity -- --json > /var/tmp/people-audit-after-deploy.json` e comparar o `summary` com o baseline: o deploy em si não altera dados (apenas as duas categorias novas aparecem).

## 5. Regularização dos sete casos — pela interface, com backup feito, um a um

Regra geral: sempre pela ficha da Pessoa (`/people/<id>`), com prévia e justificativa; nunca por SQL. Cada confirmação grava `PersonLinkEvent` (ficha › Histórico de identidade) e `SecurityAuditLog.USER_IDENTITY_LINKED` (conta). Quem executa: um SUPER_ADMIN de homologação (Paulo exige SUPER_ADMIN **com step-up**; os demais aceitam quem tem `admin.employees.links:manage` + `admin.employees.user_link:manage`).

| Caso | Diagnóstico confirmado | Ação na ficha | Resultado esperado |
|---|---|---|---|
| Gi, Joseane, Maria, Pedrinho | conta com `employeeId`, Pessoa do colaborador ativa, e-mails iguais, `AppUser.personId` nulo | Abrir a Pessoa do colaborador → cartão **Usuário IndusCost** mostra "Pendente · <nome>" → **Vincular a esta pessoa** → prévia → justificativa → confirmar | `AppUser.personId` = Pessoa; `RELINKED/LINKED`; senha, papel, permissões, sessões e vendedor Nomus intactos (auditoria `USUARIO_SEM_PESSOA` cai 4) |
| Leticia | igual ao acima, mas e-mail de login ≠ corporativo | Na ficha da Pessoa → **Regularizar vínculo existente** → buscar o login → Escolher → a prévia mostra "e-mail de login difere" → marcar a confirmação explícita (identidade comprovada pelo colaborador vinculado) → justificativa → confirmar | vínculo com evidência `MANUAL` e `emailMismatchConfirmed`; **login não muda** |
| Paulo (SUPER_ADMIN) | `AppUser.id d85e1654…` sem `employeeId`/`personId`; Employee `b7eba656…` ativo; Person `abb9ebeb…` ativa | Abrir `/people/abb9ebeb-f328-4015-a8e6-13cfaec40722` → **Regularizar vínculo existente** → buscar "paulo" → Escolher a conta SUPER_ADMIN → prévia mostra colaborador `b7eba656…` e "exige step-up" → justificativa → confirmar → confirmar a senha no step-up | `personId = abb9ebeb…` e `employeeId = b7eba656…` na mesma transação; papel SUPER_ADMIN e credenciais intactos |
| Eduardo | Employee ativo aponta para Person `INACTIVE` | Abrir a Pessoa: faixa "Pessoa inativa com vínculos ativos". **Decisão humana obrigatória**: (a) se Eduardo está na empresa, **Reativar identidade** com justificativa (evento `PERSON_REACTIVATED`) e então **Vincular a esta pessoa** no cartão Usuário; (b) se o colaborador deveria estar desligado, tratar o desligamento no RH primeiro — a conta não é vinculada a uma Pessoa inativa (`TARGET_INACTIVE`) | caso (a): conta vinculada; caso (b): conta fica como pendência explícita, nada é inventado |

Antes de confirmar cada caso, valide o estado na prévia (Pessoa atual da conta = "sem Pessoa"; colaborador correto). Se a prévia acusar `TARGET_HAS_USER`, `PERSON_MISMATCH` ou `EMPLOYEE_ALREADY_HAS_USER`, pare e investigue — não há correção automática.

## 6. Verificação DEPOIS

```bash
npm run audit:people-identity -- --json > /var/tmp/people-audit-after.json
npm run audit:people-identity -- --only=USUARIO_SEM_PESSOA,USUARIO_PESSOA_DIVERGE_DO_COLABORADOR,USUARIO_COLABORADOR_PESSOA_INATIVA
```

Critério: `USUARIO_SEM_PESSOA` = 0 (ou só Eduardo, se a decisão (b) tiver sido tomada) e `USUARIO_PESSOA_DIVERGE_DO_COLABORADOR` = 0. Comissionáveis e clientes PF sem Pessoa ficam fora do escopo obrigatório. Conferir ainda: login de cada uma das sete contas continua funcionando (senha inalterada); em Configurações › Usuários o vínculo Nomus dos vendedores está igual; `SecurityAuditLog` tem um `USER_IDENTITY_LINKED` por conta regularizada.

## 7. Demonstrações pedidas na missão (todas pela interface)

- Nova Pessoa: `/people` → **Nova pessoa** → nome, CPF válido, e-mail → ficha abre com origem MANUAL.
- Habilitar acesso: ficha → **Habilitar acesso ao IndusCost** → e-mail e senha temporária → conta VIEWER sem perfil; definir perfil depois em Usuários; vínculo Nomus pelo processo existente (botão próprio em Usuários).
- Habilitar motorista: ficha → **Habilitar motorista** → prévia (CREATE/LINK/REACTIVATE) → CNH → justificativa → motorista PENDING ligado à Pessoa.
- Editar dados: ficha → **Editar dados** → alterar nome social/telefone → evento `IDENTITY_UPDATED` no histórico; nome do colaborador, da conta e do comissionável não mudam (propriedade de campo).
