# Validação manual em homologação (servidor-01) — procedimento exato

Roteiro para quem opera o servidor-01. Nada aqui é executado automaticamente. Pré-requisitos:

- a coleta H1–H12 de [COLETA.md](COLETA.md) foi feita e `environments/homologacao.env` está **sem `A_COLETAR`**
  (em 29/10/2026 restam só as três chaves de H12, lidas do executor antigo com um único `grep`);
- as três suítes locais passaram no commit (elas validam o código; o arquivo de ambiente é validado pelo instalador
  em `--dry-run` e pelo `--check` deste roteiro);
- o commit com estes arquivos está no checkout `/opt/induscost-homolog/app` (deploy anterior) ou num clone à parte;
- fora da janela 22h25–22h40 (backup diário do PostgreSQL 12: não é tocado, mas evita confundir a observação).

Cada passo diz o que observar. "Esperado" cita trechos que a saída **contém** (a biblioteca prefixa suas linhas
com `[deploy-safety] ` e o instalador com `[install] `). Se algo não bater, **pare** e traga a saída; não ajuste o
servidor para "passar". Até H2 confirmar que o wrapper `induscost-deploy-homologacao` repassa `"$@"`, todos os
comandos usam o caminho instalado `deploy-induscost-homologacao` (substituído pelo wrapper do instalador).
Nos comandos, `PSQL17` é o cliente 17 do cluster da homologação, conforme coletado em H5:

```bash
PSQL17='sudo runuser -u <IDS_PG_OS_USER> -- env -i <IDS_PG_BIN>/psql -h /run/induscost-pg17 -p 5433 -U pg17homolog -X -At'
```

## 0. Fotografia dos recursos que NÃO pertencem à homologação (antes)

```bash
sudo mkdir -p /root/validacao-executor && cd /root/validacao-executor
{
  systemctl list-timers --all --no-pager
  systemctl list-units --all --plain --no-legend '*induscost*'
  ls -l /etc/cron.d/
  sudo crontab -l
  sudo systemctl show induscost-homolog -p DropInPaths -p IPAddressDeny -p IPAddressAllow
  sudo sha256sum /usr/local/bin/update-induscost-homolog-egress /usr/local/bin/induscost-deploy-homologacao
  sudo -u postgres psql -p 5432 -Atc "select datname from pg_database order by 1"
  $PSQL17 -d postgres -c "select datname, datallowconn from pg_database order by 1"
  $PSQL17 -d postgres -c "select d.datname, s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase"
} > antes.txt 2>&1
sudo sha256sum /usr/local/bin/deploy-induscost-homologacao
```

Esperado em `antes.txt`: `induscost-db-backup.timer` listado; os bancos do cluster 17 incluem `teste_bi_homolog`,
`teste_bi_homolog_prev`, `teste_bi_cloud_standby`; nenhuma configuração por banco. O último comando (fora da
fotografia, porque o arquivo vai mudar de propósito) dá `114c438fb993b1fcef99b04f9f255900a7c008cde3c142a458e26a8fb5697411`.

## 1. Ensaio da biblioteca no próprio servidor (bancos descartáveis, cluster 17)

Exercita, em bancos `ids_ensaio_*` **do cluster 17** (socket `/run/induscost-pg17`, porta 5433), o que o Windows
de desenvolvimento não reproduz: `runuser` do usuário do cluster, os binários 17 do servidor e as permissões do
diretório de backup (causa do incidente). O arquivo de ambiente do repositório é o mesmo que será instalado.

```bash
cd /opt/induscost-homolog/app
sudo bash scripts/ops/rehearseDeploySafety.sh --env-file infra/deploy/environments/homologacao.env
```

Esperado: uma linha contendo `cluster conferido: PostgreSQL 17, porta 5433, socket '` seguido de um valor que
inclui `/run/induscost-pg17`, `papel pg17homolog (superusuário), clientes 17`; ao fim, `resultado: 16 OK, 0
falha(s) (esperado: 16 OK)`. Conferir que os bancos de ensaio só existem no cluster 17 e que o 12 não ganhou nenhum:

```bash
$PSQL17 -d postgres -c "select datname from pg_database where datname like 'ids\_ensaio\_%'"
sudo -u postgres psql -p 5432 -Atc "select datname from pg_database where datname like 'ids\_ensaio\_%'"   # esperado: vazio
```

Depois, remova (só bancos `ids_ensaio_<época>_<cenário>…` sem sessões e o diretório do ensaio):

```bash
sudo bash scripts/ops/rehearseDeploySafety.sh --env-file infra/deploy/environments/homologacao.env --cleanup
```

## 2. Instalação (reversível)

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao
```

Só simula. Esperado: `OK    /usr/local/bin/deploy-induscost-homologacao é o executor auditado (sha256 confere)`,
`OK    /usr/local/bin/induscost-deploy-homologacao chama deploy-induscost-homologacao com "$@"` (com as linhas do
wrapper impressas), versão, release e o wrapper que será gravado. Se aparecer `RECUSADO`, pare. Depois instale:

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --apply
```

Esperado: `OK    executor antigo guardado em /usr/local/lib/induscost/backups/… (sha256 confere)` e `RESULTADO:
instalação íntegra.`. O wrapper do operador (`induscost-deploy-homologacao`) continua existindo e chega ao executor
versionado através de `deploy-induscost-homologacao`.

```bash
sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-homologacao
```

Esperado: `RESULTADO: executor protegido.` (um `AVISO` sobre a biblioteca do checkout é aceitável; `FALTA` não).

Se depois de um passo você corrigir `homologacao.env`, reaplique com `--apply --replace-env`: isso cria uma
segunda instalação, e o `--uninstall` do passo 9 desfaz a cadeia inteira de uma vez.

### 2.1 Hooks do servidor-01 (somente leitura)

Antes do `--apply`, o `--dry-run` precisa listar `OK    HOOKS_PRE_DEPLOY: @release/hooks/servidor01-checks.sh faz
parte da release` (idem pós-subida e pós-rollback). Depois da instalação, rode o hook à mão, com o ambiente instalado:

```bash
R="$(cat /usr/local/lib/induscost/homologacao.current)"
sudo "$R/hooks/servidor01-checks.sh" --validate --env-file /etc/induscost/deploy-executor-homologacao.env
sudo "$R/hooks/servidor01-checks.sh" --check --env-file /etc/induscost/deploy-executor-homologacao.env
```

Esperado: `RESULTADO: configuração válida` (com `pior caso das sondas: 245s`, ou 255 s com `check`) e `RESULTADO: --check OK …; nada foi
gravado`, com `OK` para papel `CLOUD_PRIMARY`, produção Node local desligada, `nginx.service ativo`, gateway, produção
AWS e o commit em execução na AWS (conferir o SHA). `ATENÇÃO CNPJ` é aviso (terceiros); se for de egress, o
atualizador fica a cargo do operador, numa janela própria — nenhum passo deste roteiro o executa. Detalhes e
significado de cada linha: [docs/deploy/hooks-servidor01.md](../../docs/deploy/hooks-servidor01.md) §7.

## 3. Plano sem alterar nada

```bash
sudo deploy-induscost-homologacao --check
```

Esperado, nesta ordem: a linha `cluster conferido: PostgreSQL 17, porta 5433, socket '…/run/induscost-pg17…', papel
pg17homolog (superusuário), clientes 17`; `espaço: banco teste_bi_homolog … MiB; livres …`; para cada cron/timer dos
globs, `janela pausaria …` ou `janela não tocaria …`; `escopo da janela conferido: cron /etc/cron.d/<CRON_GLOB> e
unidades <UNIT_GLOB> só desta instalação (/opt/induscost-homolog)`; `DATABASE_URL da aplicação conferida:
teste_bi_homolog na porta 5433 (PostgreSQL 17)`; commit atual, alvo, testes alterados, migrations novas, hooks de cada
fase; `Modo --check: nada foi alterado (só as referências remotas do git foram atualizadas; hooks não executados).`
e `RESULTADO: CHECK OK ambiente=homologacao rc=0 …`. Nada é parado nem alterado (o `git fetch` atualiza
`refs/remotes/origin/*`). Saídas 50/51/52/58 aqui significam cluster, disco, escopo ou `DATABASE_URL` errados:
corrigir o arquivo de ambiente (`--apply --replace-env`), não o servidor.

## 4. Preparar os alvos

Os passos 5, 6 e 7 fazem rollback, então o checkout volta ao commit anterior e o **mesmo alvo** serve para os três
e para o deploy real do passo 8. O alvo precisa ser avanço rápido do commit em execução e, para os passos 6 e 7
(interrupção durante `5/11 TESTES DO PACOTE`), precisa alterar pelo menos um `*.test.ts` — o próprio commit desta
infraestrutura altera três. Anote:

```bash
git -C /opt/induscost-homolog/app rev-parse HEAD          # commit anterior
git -C /opt/induscost-homolog/app rev-parse origin/main   # alvo
```

## 5. Falha depois da subida, sem migrations (rollback só do código)

Um hook pós-subida que falha, com o health real, faz o executor reverter o código e religar o serviço (um health
quebrado no arquivo de ambiente derrubaria também o health do rollback). Com um alvo **sem migrations novas**:

```bash
sudo install -o root -g root -m 0755 /dev/stdin /root/validacao-executor/hook-falha.sh <<'EOF'
#!/usr/bin/env bash
echo "hook de validação: falha proposital (fase $IDS_DEPLOY_PHASE)"
exit 7
EOF
sudo cp /etc/induscost/deploy-executor-homologacao.env /root/validacao-executor/ensaio-hook.env
sudo sed -i 's#^HOOKS_POST_START=.*#HOOKS_POST_START=/root/validacao-executor/hook-falha.sh#' /root/validacao-executor/ensaio-hook.env
sudo "$(cat /usr/local/lib/induscost/homologacao.current)/induscost-deploy-executor.sh" --env-file /root/validacao-executor/ensaio-hook.env <alvo>
```

Esperado: `Health: OK`, `hook HOOKS_POST_START: /root/validacao-executor/hook-falha.sh falhou (RC=7)`, `DEPLOY
(homologacao) FALHOU: etapa de deploy retornou RC=44`, `nenhuma migration foi aplicada` (ou `banco não foi alterado
por este deploy`), o código de volta ao commit anterior, o serviço no ar, `ROLLBACK AUTOMÁTICO CONCLUÍDO`,
`RESULTADO: FALHOU, ROLLBACK CONCLUÍDO (etapa rc=44) … rc=44`. Remova `ensaio-hook.env` e `hook-falha.sh` ao final.

## 6. Interrupção controlada (substitui o antigo `pkill -9 -f`)

Nunca use `pkill -f`: casa qualquer processo cuja linha de comando contenha o texto (um `grep`, um editor, outro
executor) e `-9` impede qualquer limpeza. O executor grava o próprio pid em `/run/induscost/deploy-homologacao.pid`
e o `--stop` envia SIGTERM **só a ele**; ele encerra a própria árvore de processos (filhos primeiro, pelos pids) e
faz o rollback normal. Se o sinal chegar antes da etapa de deploy (espera por rotinas, backup), a etapa em curso
termina e o executor aborta com o sistema de volta, sem rollback de código.

Durante um deploy do alvo, na etapa `5/11 TESTES DO PACOTE`, num segundo terminal:

```bash
sudo deploy-induscost-homologacao --stop
```

Esperado no terminal do deploy: `SIGTERM recebido: interrompendo a etapa atual`, `DEPLOY (homologacao) FALHOU:
interrompido por SIGTERM`, `banco não foi alterado por este deploy`, `ROLLBACK AUTOMÁTICO CONCLUÍDO`, `RESULTADO:
FALHOU, ROLLBACK CONCLUÍDO (etapa rc=143) … rc=143`. O código está no commit anterior, o serviço está no ar, a
janela foi encerrada e o pidfile sumiu.

## 7. Queda abrupta simulada (recuperação)

Só para validar a recuperação. Durante outro deploy do alvo, na etapa `5/11`:

```bash
sudo deploy-induscost-homologacao --abort-hard
```

Isso envia SIGKILL a toda a árvore do executor (pelos pids, não por padrão de texto) e deixa a janela aberta, como
numa queda de energia. Depois:

```bash
sudo deploy-induscost-homologacao
```

Esperado: `janela de manutenção de um deploy interrompido está aberta`, `RESULTADO: RECUSADO (janela pendente) …
rc=46`.

```bash
sudo deploy-induscost-homologacao --recover
```

Esperado: estado sem alterar nada (`deploy <backup>`, `readonly teste_bi_homolog`, cron/timers pausados). Então:

```bash
sudo deploy-induscost-homologacao --recover --rollback
```

Esperado: `Retomando a interrupção: backup …, commit anterior …`, `banco não foi alterado por este deploy`, código
anterior, serviço no ar, `ROLLBACK AUTOMÁTICO CONCLUÍDO`, `RESULTADO: ROLLBACK CONCLUÍDO (retomada) … rc=0`.
(`--recover --resume` continua existindo para só encerrar a janela quando o operador já tratou banco e código por
conta própria; se a interrupção tiver sido depois de a aplicação nova subir, o executor diz isso e recusa o
`--rollback` sem `--force-rollback`.)

## 8. Deploy real do alvo

```bash
sudo deploy-induscost-homologacao
```

Num segundo terminal, durante a etapa `3/11` em diante, observe a janela:

```bash
sudo cat /var/lib/induscost/deploy-safety/homologacao/maintenance.state
ls -l /etc/cron.d/
systemctl list-timers --all --no-pager | grep -E 'induscost'
$PSQL17 -d postgres -c "select d.datname, s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase"
sudo crontab -l | grep -c /opt/induscost
```

Esperado durante a janela:

- `maintenance.state` tem `begin`, `flag`, `deploy /var/backups/induscost-homolog/deploys/<ts>`, `readonly teste_bi_homolog`
  e só os `cron`/`timer` casados pelos globs da homologação;
- só os arquivos de `/etc/cron.d/<CRON_GLOB>` saem; os demais ficam;
- `induscost-db-backup.timer` continua listado e ativo; só timers de `<UNIT_GLOB>` que estavam ativos param;
- apenas `teste_bi_homolog` mostra `default_transaction_read_only=on`; `_prev` e `_cloud_standby` sem configuração;
- a crontab do root continua com as mesmas linhas de `/opt/induscost`.

Ao fim: `DEPLOY (homologacao) CONCLUÍDO` e `RESULTADO: DEPLOY CONCLUÍDO ambiente=homologacao rc=0 …`, tudo volta,
`maintenance.state` vira `maintenance.<data>.done`, a trava some e `http://127.0.0.1:3001/api/health` responde.

Hooks no deploy: `Execução: <RUN_ID> (contexto dos hooks: …/hook-context/<RUN_ID>)`, `--- hook HOOKS_PRE_DEPLOY: …
OK` antes de `3/11`, `--- hook HOOKS_POST_START: … OK` depois de `Health: OK` e `commit da produção AWS inalterado
durante o deploy`. Conferir o registro (nenhum outro arquivo é gravado pelos hooks):

```bash
sudo ls -l /var/lib/induscost/deploy-safety/homologacao/hook-context/"$(sudo cat /var/backups/induscost-homolog/deploys/<ts>/deploy-run-id)"
```

`rc=59` = deploy concluído com ALERTA (ex.: `ALTERAÇÃO INESPERADA no commit da produção AWS`): nada foi desfeito
nem executado na AWS; investigar quem publicou na produção. `rc=9` com `FALHA crítica` = recusado antes de parar o
serviço (gateway/AWS/papel/Nginx/produção local): nada foi alterado.

## 9. Desinstalação e reinstalação (reversibilidade)

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --uninstall
sudo sha256sum /usr/local/bin/deploy-induscost-homologacao
```

Esperado: `executor anterior restaurado (N instalação(ões) desfeita(s); sha256 114c438f…)` e o `sha256sum`
`114c438fb993b1fcef99b04f9f255900a7c008cde3c142a458e26a8fb5697411` (byte a byte o executor antigo), mesmo que
tenha havido `--apply --replace-env` no meio. Reinstale com `--apply` e confira com `--verify`.

## 10. Fotografia depois e comparação

Repita o bloco do passo 0 gravando `depois.txt` e compare:

```bash
cd /root/validacao-executor && diff antes.txt depois.txt
```

Esperado: nenhuma diferença fora do timestamp dos timers (o bloco não inclui `deploy-induscost-homologacao`, que
muda de propósito e é conferido pelo `--verify`). Em particular: mesmos timers (inclusive `induscost-db-backup.timer`),
mesmos arquivos em `/etc/cron.d`, mesma crontab do root, mesmos drop-ins e `IPAddressDeny/Allow`, mesmo sha256 de
`update-induscost-homolog-egress` e do wrapper `induscost-deploy-homologacao`, mesmos bancos nos dois clusters
(nenhum `__failed_`/`__rollback_`: os cenários acima não têm migration).

## Critérios de aceite para seguir para a AWS

- [ ] Ensaio com `16 OK`, bancos de ensaio só no cluster 17, `--cleanup` feito.
- [ ] Instalação íntegra (sha256 do executor antigo conferido, wrapper do operador conferido) e verificador aprovado.
- [ ] Hooks: `hooks/servidor01-checks.sh` na release e no MANIFEST; `--validate` e `--check` manuais OK (papel,
      produção local, Nginx, gateway, AWS, commit AWS conferido com a AWS); nenhum `PROIBIDO`/escrita fora do contexto.
- [ ] `--check` com cluster, disco, escopo e `DATABASE_URL` conferidos.
- [ ] Falha pós-subida: rollback só do código, sistema de volta (rc 44).
- [ ] `--stop`: rollback controlado, rc 143.
- [ ] `--abort-hard`: recusa 46, `--recover --rollback` devolvendo o estado anterior.
- [ ] Deploy real concluído, com a janela observada: só os agendamentos da homologação pausados, PG12 e seu timer
      intocados, só `teste_bi_homolog` travado.
- [ ] Desinstalação devolvendo o executor original byte a byte.
- [ ] `diff antes.txt depois.txt` sem diferenças fora das esperadas.
- [ ] Saídas completas arquivadas em `/root/validacao-executor/`.

Os cenários com migration incompatível (restauração e bloqueio) são exercitados no passo 1 (banco descartável) e nas
suítes locais com PostgreSQL 17 real. Não são forçados no banco da homologação.

Produção: mesmos passos, com `--env producao`, só com autorização explícita. O passo 1 cria bancos `ids_ensaio_*`
no cluster de produção e pede essa autorização à parte.
