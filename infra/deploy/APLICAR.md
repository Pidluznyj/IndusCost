# Deploy seguro do IndusCost — executor versionado e biblioteca v3

Substitui os executores editados à mão (`/usr/local/bin/deploy-induscost-producao` na AWS e
`induscost-deploy-homologacao` no servidor-01) por um executor versionado, instalado e desinstalado por script.
Ninguém aplica isto automaticamente.

| Arquivo | Papel |
|---|---|
| `induscost-deploy-safety.sh` | Biblioteca (G1–G6 abaixo) |
| `induscost-deploy-executor.sh` | Executor completo (pré-condições → backup → código → testes → build → migrations → aplicação → encerramento; rollback) |
| `environments/producao.env`, `environments/homologacao.env` | As **únicas** diferenças entre ambientes; `A_COLETAR` bloqueia |
| `install-induscost-deploy.sh` | Instalação reversível (`--dry-run` padrão, `--apply`, `--verify`, `--uninstall`) com MANIFEST sha256 |
| `../../scripts/ops/checkDeployExecutorSafety.sh` | Verificador somente leitura (aceita o wrapper instalado) |
| `../../scripts/ops/rehearseDeploySafety.sh` | Ensaio no servidor em bancos descartáveis `ids_ensaio_*` |
| [COLETA.md](COLETA.md) | O que coletar antes de instalar |
| [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md) | Roteiro manual de validação |

## O incidente de 26/10/2026

1. O gate de testes falhou: um teste dependia do lock real de Contas a Receber, que a rotina real segurava.
2. O rollback do executor fez `dropdb teste_bi` + `createdb`. O `pg_restore` (como `postgres`) não leu o dump: o
   diretório era `root:root 0700`, e a conferência do dump tinha rodado como root.
3. A falha foi **antes** das migrations: o banco não precisava de restauração nenhuma.

## Garantias

| | Garantia | Como |
|---|---|---|
| G1 | Janela de manutenção seletiva e persistente | Ver o detalhamento abaixo da tabela |
| G2 | Trava de escrita | `default_transaction_read_only=on` no banco durante a janela: toda sessão nova só lê, inclusive superusuário e `nextval`. Só a URL das migrations recebe `options=-c default_transaction_read_only=off` |
| G3 | Prova de ausência de escrita (não depende do XID global) | Ver o detalhamento abaixo da tabela |
| G4 | Rollback por compatibilidade | Ver a decisão do rollback abaixo |
| G5 | Restauração fiel | Ver o detalhamento abaixo da tabela |
| G6 | Gate de testes isolado | Sem `.env`, banco inalcançável, chaves do `.env` vazias, locks temporários |

**G1 — janela de manutenção:**

- só os arquivos `/etc/cron.d/induscost*` saem, guardados com sha256;
- só os timers `induscost-*` **ativos** param; inativos ou com falha ficam intocados;
- serviços `induscost-*` e rotinas Nomus/Exposure já iniciadas são aguardados;
- o estado fica em `/var/lib/induscost/deploy-safety/<amb>/maintenance.state`;
- o `cron.service` inteiro nunca é parado;
- uma linha do IndusCost fora de `/etc/cron.d/induscost*` recusa o deploy (47).

**G3 — prova de ausência de escrita:**

- **tuplas** das tabelas de usuário (o autovacuum não conta);
- **sequências** (`nextval` não consome XID);
- **arquivos das tabelas** (`TRUNCATE` não conta tupla);
- **estrutura**;
- **sessões**: um observador durante as migrations e o contador de sessões no congelamento.

**G5 — restauração fiel:**

- banco atual congelado (`ALLOW_CONNECTIONS false`) e prova reconferida;
- banco novo com encoding, collation, dono, limite, ACL e configurações do original;
- `pg_restore` completo, com donos e permissões;
- conferência integral antes da troca;
- dois `RENAME` numa única transação;
- `<db>__failed_<ts>` preservado; nenhum `dropdb`.

### Decisão do rollback

| Situação | Ação |
|---|---|
| Falha antes das migrations | Banco intocado; só o código volta |
| Migrations não mudaram o schema | Banco intocado; só o código volta |
| Schema novo **compatível** com o código anterior | Banco **mantido** (sem perda nem parada); só o código volta |
| Incompatível e **prova fecha** (nada escrito desde o backup, ou a aplicação subiu sem escrever) | Restauração integral, depois volta o código |
| Incompatível **sem prova** (a aplicação escreveu, sessão estranha etc.) | **BLOQUEIO** (saída 2): nada é restaurado nem apagado; serviço parado; janela e trava mantidas; instruções impressas |

**Compatível** = só acrescenta coisas que o código anterior ignora:

- tabelas novas;
- colunas anuláveis ou com valor padrão/identidade;
- índices não únicos;
- views, funções, sequências e extensões novas;
- rótulos de enum ainda não usados;
- FK restritiva só se a tabela nova estiver vazia.

Qualquer remoção ou alteração, coluna obrigatória sem padrão, índice único, constraint ou trigger em tabela existente,
ou migration que apague dados, é **incompatível**.

### Códigos de saída

| Código | Significado |
|---|---|
| 0 | OK |
| 2 | BLOQUEIO |
| 3 | Configuração incompleta |
| 4 | Instalação adulterada |
| 5 | Outro deploy em andamento |
| 6 | Modo do servidor inesperado |
| 7 | Árvore suja |
| 8 | Alvo não é avanço rápido |
| 30–32 | Backup |
| 33–38, 44, 49 | Restauração (banco atual intocado) |
| 39 | Escrita durante o backup |
| 40 | Rotina não terminou |
| 41 | Sessão, 2PC, assinatura ou estatística desligada |
| 42 | Retomada da janela |
| 43 | Escrita depois do backup |
| 45 | Banco ausente |
| 46 | Janela pendente |
| 47 | Agendamento não gerenciado |
| 48 | Trava já usada por terceiros |

## Como aplicar

1. Coleta: [COLETA.md](COLETA.md). Os valores entram em `environments/<amb>.env`; as particularidades do executor
   atual viram configuração com teste.
2. Validação em homologação: [VALIDACAO-HOMOLOGACAO.md](VALIDACAO-HOMOLOGACAO.md), incluindo o ensaio
   `rehearseDeploySafety.sh`, a instalação, o deploy real, a falha, a interrupção e a desinstalação.
3. Produção: os mesmos passos, com autorização explícita.

Instalação, sempre começando pela simulação:

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env producao
```

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env producao --apply
```

```bash
sudo bash scripts/ops/checkDeployExecutorSafety.sh /usr/local/bin/deploy-induscost-producao
```

Uso depois de instalado:

```bash
sudo deploy-induscost-producao --check
```

```bash
sudo deploy-induscost-producao
```

Recuperação de uma janela interrompida (primeiro confere, depois retoma):

```bash
sudo deploy-induscost-producao --recover
```

```bash
sudo deploy-induscost-producao --recover --resume
```

Restauração manual depois de um BLOQUEIO (decisão do operador; descarta o que foi escrito depois do backup):

```bash
sudo deploy-induscost-producao --restore-backup /var/backups/induscost-production/deploys/<ts>
```

Para voltar ao executor anterior, byte a byte:

```bash
sudo bash infra/deploy/install-induscost-deploy.sh --env producao --uninstall
```

## Depois de um rollback com banco restaurado

O estado no momento da falha fica em `teste_bi__failed_<ts>`. A conferência fica em `<backup>/restore-journal`,
`restore-verification.diff`, `compat-report.txt` e `rollback-decision.txt`. Remover o banco `__failed_` só depois de
conferir, manualmente.

## Testes

| Suíte | O que roda |
|---|---|
| `src/lib/ops/deploySafety.test.ts` | Sem banco: janela seletiva, classificador, URL, gate, verificador |
| `src/lib/ops/deploySafety.pg17.integration.test.ts` | PostgreSQL 17 com psql/pg_dump/pg_restore/createdb **reais**: trava, prova, decisões, restauração, troca, quedas, recuperação e o ensaio do servidor |
| `src/lib/ops/deployExecutor.pg17.e2e.test.ts` | Executor **instalado**, com git e Prisma reais e PostgreSQL 17 real; systemd, npm, curl e flock simulados |

As suítes PostgreSQL rodam com `COMMISSION_PG17_BIN=<bin do PostgreSQL 17 com os clientes>`. Sem essa variável,
elas ficam puladas.
