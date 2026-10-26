# Validação manual em homologação (antes de qualquer atualização na AWS)

Roteiro para quem opera o servidor-01. Pré-requisitos:

- a coleta de [COLETA.md](COLETA.md) foi feita;
- `environments/homologacao.env` está sem `A_COLETAR`;
- o commit com estes arquivos está no checkout da homologação.

Cada passo diz o que observar. Se algo não bater, **pare** e traga a saída; não ajuste o servidor para "passar".

## 0. Ensaio da biblioteca no próprio servidor (sem tocar no banco da homologação)

Exercita, num banco descartável `ids_ensaio_*` do mesmo cluster, o que o Windows de desenvolvimento não reproduz:
`runuser postgres`, os binários do servidor e as permissões do diretório de backup (causa do incidente).

```bash
cd /opt/induscost-homolog/app
sudo bash scripts/ops/rehearseDeploySafety.sh
```

Esperado: `resultado: 15 OK, 0 falha(s)`. Inspecione se quiser e depois remova (só bancos `ids_ensaio_*` e o
diretório do ensaio):

```bash
sudo bash scripts/ops/rehearseDeploySafety.sh --cleanup
```

## 1. Instalação (reversível)

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao
```

Esse comando só simula. Confira o caminho do executor, a versão e o wrapper. Depois instale:

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --apply
```

Esperado: `RESULTADO: instalação íntegra.` e o executor anterior guardado em `/usr/local/lib/induscost/backups/`.

```bash
sudo bash scripts/ops/checkDeployExecutorSafety.sh "$(command -v induscost-deploy-homologacao)"
```

Esperado: `RESULTADO: executor protegido.`

## 2. Plano sem alterar nada

```bash
sudo induscost-deploy-homologacao --check
```

Esperado: commit atual, alvo, testes alterados e migrations novas. Nada é parado nem alterado.

## 3. Deploy real de um commit da `main`

Num segundo terminal, durante o deploy, observe a janela:

```bash
sudo cat /var/lib/induscost/deploy-safety/homologacao/maintenance.state
ls -l /etc/cron.d/
systemctl list-timers --all 'induscost*'
sudo -u postgres psql -Atc "select d.datname, s.setconfig from pg_db_role_setting s join pg_database d on d.oid = s.setdatabase where d.datname = 'teste_bi_homolog'"
```

Esperado durante a janela:

- os arquivos `induscost*` saem de `/etc/cron.d`; os outros arquivos ficam;
- só os timers que estavam ativos param;
- o banco mostra `default_transaction_read_only=on`.

Ao fim: tudo volta, o `maintenance.state` vira `maintenance.<data>.done` e a trava some.

## 4. Falha antes das migrations (rollback só do código)

Use um alvo que **não** tenha migrations novas e um arquivo de ambiente de ensaio com o health apontando para uma
porta fechada. A configuração oficial não muda:

```bash
sudo cp /etc/induscost/deploy-executor-homologacao.env /root/ensaio-health.env
sudo sed -i 's#^HEALTH=.*#HEALTH=http://127.0.0.1:1/ensaio#; s#^HEALTH_TRIES=.*#HEALTH_TRIES=2#' /root/ensaio-health.env
sudo "$(cat /usr/local/lib/induscost/homologacao.current)/induscost-deploy-executor.sh" --env-file /root/ensaio-health.env <alvo-sem-migration>
```

Esperado:

- `banco não foi alterado por este deploy` ou `nenhuma migration foi aplicada`;
- o código volta ao commit anterior;
- o serviço volta;
- `ROLLBACK AUTOMÁTICO CONCLUÍDO`;
- a janela é encerrada.

Remova `/root/ensaio-health.env` ao final.

## 5. Interrupção do executor (recuperação)

Durante um deploy, na etapa `5/11 TESTES DO PACOTE`:

```bash
sudo pkill -9 -f induscost-deploy-executor.sh
```

Depois:

```bash
sudo induscost-deploy-homologacao
```

Esperado: recusa (46) e lista a janela pendente.

```bash
sudo induscost-deploy-homologacao --recover
```

Esperado: estado sem alterar nada. Confira `git -C /opt/induscost-homolog/app log -1` e o banco antes do próximo
comando:

```bash
sudo induscost-deploy-homologacao --recover --resume
```

Esperado: cron e timers como antes, trava removida. Se o código ficou no commit novo, rode um deploy normal ou volte
o código manualmente antes de religar o serviço.

## 6. Desinstalação e reinstalação (reversibilidade)

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env homologacao --uninstall
sudo sha256sum "$(command -v induscost-deploy-homologacao)"
```

Esperado: o hash é igual ao coletado em COLETA P9/H1. Reinstale com `--apply` e rode `--verify`.

## Critérios de aceite para seguir para a AWS

- [ ] Ensaio 0 com 15 OK e `--cleanup` feito.
- [ ] Instalação íntegra e verificador aprovado.
- [ ] Deploy real concluído, com a janela observada abrindo e fechando como descrito.
- [ ] Falha antes das migrations: rollback só do código, sistema de volta.
- [ ] Interrupção: recusa 46, `--recover --resume` devolvendo o estado anterior.
- [ ] Desinstalação devolvendo o executor original byte a byte.
- [ ] Saídas completas arquivadas.

Os cenários com migration incompatível (restauração e bloqueio) são exercitados no passo 0 (banco descartável) e nas
suítes locais com PostgreSQL 17 real. Não são forçados no banco da homologação.

Produção: mesmos passos 0–6, com `--env producao`, só com autorização explícita. O passo 0 cria bancos `ids_ensaio_*`
no cluster de produção e pede essa autorização à parte.
