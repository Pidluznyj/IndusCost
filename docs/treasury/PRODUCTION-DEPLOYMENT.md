# Central de Tesouraria — Implantação em produção

**Audiência:** operador humano no servidor.  
**Cursor / agentes:** **não** executam backup, pull, migrate, build, restart nem validação em produção.

**Ambiente canônico**

| Item | Valor |
|------|--------|
| Diretório | `/opt/induscost` |
| Branch | `main` |
| Deploy oficial | `bash scripts/deploy-induscost.sh` → `scripts/deploy-server-main-update.sh` |
| App | Node na porta `3000` (`NODE_ENV=production`, `tsx server.ts`) |
| Log app | `/tmp/induscost-server.log` |
| Logs Tesouraria | `/tmp/induscost-treasury-deploy/` |

Documentos relacionados: [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) (resumo), [POST-DEPLOY-CHECKLIST.md](./POST-DEPLOY-CHECKLIST.md) (validação funcional A/B/C), [19-ROLLOUT.md](./19-ROLLOUT.md) (flags), [ROLLBACK.md](./ROLLBACK.md).

---

## Princípios de segurança operacional

1. **Backup antes de migrate.** Sem backup verificado, não continue.
2. **Somente `main`**, pull **fast-forward** (`git pull --ff-only`).
3. **Nunca** `prisma db push`, `prisma migrate dev`, `git reset --hard`, `DROP`/`TRUNCATE` ad hoc.
4. **Não apagar** dados/histórico da Tesouraria para “esconder” divergência.
5. Scripts de check/validação usam `set -Eeuo pipefail`, geram log e **abortam em erro**.
6. Gate de processo: lock `/tmp/induscost-deploy.lock` (pré-check); evitar deploy durante sync Nomus pesado.
7. Flags Tesouraria são **fail-closed** — ver [19-ROLLOUT.md](./19-ROLLOUT.md).

---

## Sequência oficial (checklist)

### 0) Pré-condições

- [ ] Janela de manutenção combinada.
- [ ] Acesso SSH ao host de `/opt/induscost`.
- [ ] `.env` de produção já existente (não editar via Cursor).
- [ ] Código Tesouraria já mergeado em `origin/main`.
- [ ] Decisão explícita sobre `TREASURY_MODULE_ENABLED` e subflags.

### 1) Backup

```bash
cd /opt/induscost
bash scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_treasury
```

Anote o caminho do `.dump` gerado (padrão sob `BACKUP_DIR`, tipicamente `/tmp/induscost-backups/`).

Opcional: `export BACKUP_FILE=/caminho/do/arquivo.dump`

### 2) Pré-checagem (obrigatória)

```bash
cd /opt/induscost
bash scripts/treasury/predeploy-check.sh --require-backup
```

O script:

- adquire lock de deploy (aborta se outro processo estiver no lock);
- exige branch `main` e working tree limpa;
- faz `git fetch` e reporta ahead/behind (não faz pull);
- valida artefatos Tesouraria + `prisma validate` + `npm run validate:treasury:deploy`;
- grava log em `/tmp/induscost-treasury-deploy/predeploy-check_*.log`.

**Se falhar: pare.** Não rode o deploy.

### 3) Deploy oficial

```bash
cd /opt/induscost
bash scripts/deploy-induscost.sh
```

Esse fluxo (ver `scripts/deploy-server-main-update.sh`) inclui, nesta ordem:

1. `git status` / log  
2. `git fetch origin main`  
3. revisão de commits/arquivos pendentes  
4. `git pull --ff-only origin main`  
5. `npx prisma validate`  
6. `npx prisma migrate deploy`  
7. `npx prisma generate`  
8. backfills/auditorias opcionais do script (NF-e — revisar saída)  
9. `NODE_ENV=production npm run build`  
10. restart do processo na porta 3000  
11. health/`app-version` smoke embutidos  

**Dependências:** se `package-lock.json` mudou e o deploy oficial não rodar `npm ci`, execute manualmente **antes** do build:

```bash
cd /opt/induscost
npm ci
```

### 4) Validação pós-deploy (obrigatória)

```bash
cd /opt/induscost
bash scripts/treasury/postdeploy-validation.sh
```

Verifica:

- porta 3000;
- `GET /api/health`;
- `GET /api/app-version`;
- HTML servindo bundle `/assets/index-*.js` (não Vite dev);
- `GET /api/finance/treasury/health` (200/401/403 ou 404 se flag OFF);
- `npm run validate:treasury:deploy`;
- tail do log do servidor.

Log: `/tmp/induscost-treasury-deploy/postdeploy-validation_*.log`.

### 5) Smoke funcional + checklist completo

Com usuário que tenha `finance.treasury` `view` e flags desejadas ON:

- `GET /api/finance/treasury/availability` → `enabled` + mapa `flags`
- UI `/finance/treasury` (abas conforme flags)
- Conferir logs: `tail -f /tmp/induscost-server.log`

Validação funcional detalhada (leitura / dados de teste / financeiro):  
**[POST-DEPLOY-CHECKLIST.md](./POST-DEPLOY-CHECKLIST.md)**

### 6) Flags / soft-launch

Ligar subflags na ordem de [19-ROLLOUT.md](./19-ROLLOUT.md).  
Flag OFF **não apaga dados** — só bloqueia API/UI.

### 7) Backfill opcional (complementos)

Somente após migrate estável e com usuário válido:

```bash
npm run backfill:treasury:title-complements:preview -- --title-type=all --from=YYYY-MM-DD --to=YYYY-MM-DD
npm run backfill:treasury:title-complements:apply -- --created-by-user-id=<UUID> --checkpoint-file=.tmp/treasury-complement-backfill.json
```

---

## Instalação de dependências

| Situação | Comando |
|----------|---------|
| Lockfile alterado no pull | `npm ci` |
| Hotfix sem mudança de deps | pode omitir se o deploy oficial não exigir |

Não use `npm install` ad hoc em produção sem necessidade.

---

## Logs

| Origem | Caminho |
|--------|---------|
| App Node | `/tmp/induscost-server.log` |
| Pré-check Tesouraria | `/tmp/induscost-treasury-deploy/predeploy-check_*.log` |
| Pós-validação Tesouraria | `/tmp/induscost-treasury-deploy/postdeploy-validation_*.log` |
| Backup | saída do `backupDatabaseBeforeDeploy.sh` + diretório `BACKUP_DIR` |

---

## Gate de processos concorrentes

| Lock | Uso |
|------|-----|
| `/tmp/induscost-deploy.lock` | Pré-check Tesouraria (`flock`) |
| `/tmp/induscost-nomus-sync-global.lock` | Sync Nomus diário — evitar deploy simultâneo se ativo |

O pré-check **aborta** se o lock de deploy estiver ocupado. Locks Nomus geram **aviso** (inspecione antes de migrar).

---

## O que este material não faz

- Não executa deploy a partir do Cursor.
- Não altera secrets/`.env`.
- Não aplica `reset --hard` nem apaga migrations/dados.
- Não substitui o julgamento do operador em caso de conflito git ou migrate falho → [ROLLBACK.md](./ROLLBACK.md).
