# Gestão de Frota — deploy e validação no servidor

Roteiro **não destrutivo** para `/opt/induscost` (produção/homologação).

**Proibido neste fluxo:** `prisma db push`, `prisma migrate dev`, apagar dados, `DROP`, `TRUNCATE`, alterar usuários sem autorização explícita.

**Script automatizado (somente orquestra os passos abaixo):**

```bash
cd /opt/induscost
chmod +x scripts/fleetServerDeployValidate.sh
./scripts/fleetServerDeployValidate.sh --validate-only    # git + prisma + testes + banco (sem reiniciar app)
./scripts/fleetServerDeployValidate.sh --with-restart     # igual + reinício na porta 3000 (após tudo OK)
```

---

## Pré-requisitos

- `DATABASE_URL` no `.env` do servidor (não commitar).
- Node/npm alinhados ao projeto.
- Acesso `git` ao remoto `origin`.
- Backup ou snapshot do banco **obrigatório** antes do primeiro `migrate deploy` da frota — ver [deploy-backup-rollback.md](./deploy-backup-rollback.md).

---

## 1. Git

```bash
cd /opt/induscost
git fetch origin
git status --branch --short
git log HEAD..origin/main --oneline
git log origin/main..HEAD --oneline
```

Se `HEAD..origin/main` listar commits (local atrás do remoto):

```bash
git pull --rebase origin main
```

Anote o commit após o pull:

```bash
git rev-parse HEAD
```

---

## 2. Migrations (somente deploy)

```bash
npx prisma migrate status
npx prisma migrate deploy
```

**Esperado para frota:**

| Migration | Função |
|-----------|--------|
| `20260603120000_add_fleet_management_module` | Tabelas/enums Fleet* |
| `20260604120000_fix_fleet_schema_alignment` | Índices idempotentes + seed `FleetSettings` |
| `20260528180000_fleet_list_query_indexes` | No-op (histórico; já aplicada ou vazia) |

Se `migrate status` mostrar migrations **pendentes** que não sejam da frota, trate com o time antes de seguir.

---

## 3. Prisma

```bash
npx prisma validate
npx prisma generate
```

---

## 4. Testes e build

```bash
npm run test:fleet
npm run lint
npm run build
```

Opcional (homologação com app parado):

```bash
npm run test:fleet:smoke
# Requer: servidor em execução, DATABASE_URL, --confirm="RODAR SMOKE FROTA"
```

---

## 5. Validação do banco (read-only)

```bash
npm run fleet:db-validate
```

Confirma:

- 16 tabelas `Fleet*`
- 13 enums `Fleet*`
- `FleetSettings` com chaves iniciais (seed)
- migrations frota registradas em `_prisma_migrations`

Consulta manual (PostgreSQL), se necessário:

```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
WHERE migration_name LIKE '%fleet%' OR migration_name LIKE '%20260603%'
ORDER BY finished_at;

SELECT key, value FROM "FleetSettings" ORDER BY key;
```

---

## 6. Permissões `fleet.*`

Catálogo em `src/lib/permissionCatalog.ts` — chaves obrigatórias:

| Permissão | Uso |
|-----------|-----|
| `fleet.view` | Ver módulo e APIs de leitura |
| `fleet.manage` | Administração ampla + import CSV |
| `fleet.vehicles.edit` | Veículos, contratos, documentos |
| `fleet.reservations.create` | Reservas, checkout/checkin |
| `fleet.reservations.approve` | Aprovar/rejeitar reservas |
| `fleet.maintenance.manage` | Manutenções |
| `fleet.financial.view` | Valores e lançamentos financeiros |
| `fleet.settings.manage` | Parâmetros `FleetSettings` |

**API (usuário admin):** `GET /api/admin/permissions/catalog` — deve listar as 8 chaves acima.

**Usuários operacionais:** conceder via Admin → Usuários (não alterar automaticamente neste roteiro).

Sugestão mínima para operador de frota:

- `fleet.view` + `fleet.reservations.create`
- Aprovador: + `fleet.reservations.approve`
- Gestor frota: + `fleet.manage` ou conjunto `vehicles.edit`, `maintenance.manage`, `financial.view`
- Parâmetros: + `fleet.settings.manage`

`SUPER_ADMIN` já possui todas as permissões do catálogo.

---

## 7. Reinício da aplicação (somente após passos 1–6 OK)

```bash
fuser -k 3000/tcp || true
sleep 2
nohup npm run dev > app.log 2>&1 &
sleep 5
tail -n 100 app.log
```

Em produção com systemd/PM2, use o gerenciador do ambiente em vez de `nohup npm run dev`.

Verificar:

- Sem `Error` / `500` repetido em `app.log` ao subir.
- `GET /api/health` responde.

---

## 8. Smoke manual (UI)

Com usuário que tenha `fleet.view` (ou `SUPER_ADMIN`):

| Tela | Esperado |
|------|----------|
| Menu **Gestão de Frota** | Visível |
| Dashboard | Cards e alertas carregam |
| Veículos | Lista (pode estar vazia) |
| Motoristas | Lista |
| Agenda / Reservas | Lista/calendário |
| Configurações | Parâmetros `FleetSettings` |

Se menu não aparecer: falta `fleet.view` no usuário — ajustar em Admin (não automatizar).

Monitorar durante o teste:

```bash
tail -f app.log | grep -E 'fleet|500|Error'
```

---

## Checklist rápido

- [ ] `git rev-parse HEAD` = commit esperado (`origin/main`)
- [ ] `migrate deploy` sem erro
- [ ] `fleet:db-validate` OK
- [ ] `test:fleet` 93 testes OK
- [ ] `lint` + `build` OK
- [ ] App reiniciada sem erro fatal
- [ ] UI frota acessível
- [ ] Permissões concedidas aos perfis corretos

---

## Rollback (somente se orientação explícita)

Plano completo: [deploy-backup-rollback.md](./deploy-backup-rollback.md).

Resumo: parar app → restaurar backup pré-deploy (autorizado) → `git checkout` commit anterior → `npx prisma generate` → reiniciar. Não reverter migration no histórico Prisma manualmente.

---

## Relatório pós-execução (preencher no servidor)

| Item | Resultado |
|------|-----------|
| Commit atual | `git rev-parse HEAD` |
| Migrations frota aplicadas | sim/não |
| Prisma validate/generate | OK/Falha |
| test:fleet | OK/Falha |
| lint / build | OK/Falha |
| fleet:db-validate | OK/Falha |
| App reiniciada | sim/não |
| Erros em app.log | … |
| Permissões usuários | pendente / OK |
| Próximo passo | … |
