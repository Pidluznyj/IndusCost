# Central de Tesouraria — Rollback em produção

**Audiência:** operador humano em `/opt/induscost`.  
**Cursor / agentes:** **não** executam rollback em produção.

Este documento cobre falha após deploy da Tesouraria (ou deploy geral que a incluiu). Complementa [PRODUCTION-DEPLOYMENT.md](./PRODUCTION-DEPLOYMENT.md).

---

## Princípios

1. **Preservar dados financeiros** — não apagar tabelas/histórico Tesouraria para “limpar” erro.
2. **Sem `git reset --hard`** como primeira opção automática; preferir checkout de commit conhecido + rebuild.
3. **Sem `prisma migrate reset` / `db push` / `migrate dev`** em produção.
4. Se a migration já alterou o schema de forma incompatível com o código anterior, o caminho seguro é **restaurar backup do PostgreSQL** + redeploy do código anterior.
5. Registrar horário, commit bom/ruim, caminho do dump e motivo no ticket/ops.

---

## Decisão rápida

| Sintoma | Ação preferencial |
|---------|-------------------|
| App não sobe / HTML em modo Vite | Reiniciar em `NODE_ENV=production` (mesmo commit); se persistir → rollback de código |
| Health global falha após pull/build | Rollback de código para último commit bom + rebuild/restart |
| `migrate deploy` falhou **antes** de concluir | Não force; inspecione erro; se DB intacto, corrija e reexecute; se parcial/incerto → restore backup |
| Migration aplicada + bug de dados/regra | Avaliar hotfix forward; se crítico → restore backup + código anterior |
| Só flag/config errada | Ajustar env (fail-closed) — **não** precisa rollback de schema |

---

## A) Rollback só de processo (sem mudar código)

Use quando o commit está OK, mas o processo morreu ou subiu em modo errado.

```bash
cd /opt/induscost

# Identificar PID na 3000
ss -ltnp | grep ':3000' || true
PID=$(ss -ltnp 2>/dev/null | grep ':3000' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "${PID:-}" ]; then
  kill "$PID"
  sleep 4
fi

NODE_ENV=production nohup npx tsx server.ts > /tmp/induscost-server.log 2>&1 &
sleep 8
curl -fsS http://127.0.0.1:3000/api/health
bash scripts/treasury/postdeploy-validation.sh
```

---

## B) Rollback de código (migration **não** foi o problema)

Pré-requisitos:

- Working tree limpa ou alterações irrelevantes descartadas **manualmente** pelo operador.
- Commit bom conhecido (`GOOD_SHA`).

```bash
cd /opt/induscost
git status --short
git log --oneline -15

# Anote o commit ruim atual
git rev-parse HEAD

# Vá para o commit bom (não usa reset --hard)
git checkout <GOOD_SHA>

# Se package-lock mudou entre commits:
npm ci

npx prisma generate
# NÃO rode migrate deploy para “voltar” schema sem plano —
# só generate + build se o schema do commit bom for compatível com o DB atual.

NODE_ENV=production npm run build

PID=$(ss -ltnp 2>/dev/null | grep ':3000' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "${PID:-}" ]; then kill "$PID"; sleep 4; fi
NODE_ENV=production nohup npx tsx server.ts > /tmp/induscost-server.log 2>&1 &
sleep 8

curl -fsS http://127.0.0.1:3000/api/health
bash scripts/treasury/postdeploy-validation.sh
```

Para voltar a acompanhar `main` depois do hotfix:

```bash
git checkout main
git pull --ff-only origin main
# só quando o forward-fix estiver pronto
```

---

## C) Rollback com restore de banco (migration / dados)

Use quando:

- `migrate deploy` aplicou migration Tesouraria problemática; ou
- dados ficaram inconsistentes e não há hotfix seguro.

### 1) Parar app

```bash
cd /opt/induscost
PID=$(ss -ltnp 2>/dev/null | grep ':3000' | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1 || true)
if [ -n "${PID:-}" ]; then kill "$PID"; sleep 4; fi
```

### 2) Restaurar dump do pré-deploy

O dump veio de `scripts/backupDatabaseBeforeDeploy.sh` (formato custom `-Fc`).

Exemplo (ajuste usuário/DB conforme o ambiente; **não** copie senhas para o chat):

```bash
# Exemplo ilustrativo — operador usa o procedimento local do host
# pg_restore --clean --if-exists --no-owner --dbname=<DB> /caminho/do/backup.dump
```

Confirme tamanho/data do arquivo antes de restaurar.

### 3) Código no commit pré-deploy

```bash
cd /opt/induscost
git checkout <GOOD_SHA>
npm ci
npx prisma generate
NODE_ENV=production npm run build
NODE_ENV=production nohup npx tsx server.ts > /tmp/induscost-server.log 2>&1 &
sleep 8
bash scripts/treasury/postdeploy-validation.sh
```

### 4) Pós-restore

- Validar health + availability.
- **Não** rode de novo `migrate deploy` até o forward-fix estar mergeado e testado.
- Documente o incidente.

---

## D) Rollback só de feature (flags)

Se o código/schema estão OK mas o módulo gera risco operacional:

1. Desligar `TREASURY_MODULE_ENABLED` (e/ou subflags) no `.env` do servidor.
2. Reiniciar o processo Node.
3. Dados permanecem no PostgreSQL (fail-closed; sem delete).

Ordem de flags: [19-ROLLOUT.md](./19-ROLLOUT.md).

---

## Proibido em rollback

- `git reset --hard` automatizado / sem autorização explícita do operador
- `prisma migrate reset`, `db push`, `migrate dev`
- `DROP TABLE` / `TRUNCATE` em tabelas `Treasury*`
- Apagar arquivos de backup ou logs para ocultar falha
- Forçar deploy com working tree suja

---

## Evidências a guardar

- Commit ruim e commit bom (`git rev-parse`)
- Caminho do `.dump` de backup
- Logs: `/tmp/induscost-server.log`, `/tmp/induscost-treasury-deploy/*`
- Saída de `postdeploy-validation.sh` (sucesso ou falha)
