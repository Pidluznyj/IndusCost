# Gestão de Frota — status final da implementação (Fase 1)

Relatório executivo e técnico do estado atual do módulo **Gestão de Frota** no IndusCost/ERP.

**Data de referência:** maio/2026 · branch `main`  
**Documentação relacionada:** [README.md](./README.md) · [manual-operacional.md](./manual-operacional.md) · [backlog-futuro.md](./backlog-futuro.md) · [deploy-servidor.md](./deploy-servidor.md) · [deploy-backup-rollback.md](./deploy-backup-rollback.md) · [../FLEET_PERMISSIONS.md](../FLEET_PERMISSIONS.md)

---

## 1. Resumo executivo

### Objetivo do módulo

Centralizar no ERP o **ciclo operacional da frota corporativa**: cadastro de veículos e motoristas, reservas com aprovação, retirada e devolução com quilometragem e checklist, manutenções, custos operacionais (abastecimento, multas, ocorrências), alertas, relatórios e trilha de auditoria — com controle de acesso por permissões.

### O que está pronto (Fase 1)

| Área | Status |
|------|--------|
| Modelo de dados PostgreSQL (16 tabelas, 12 enums) | Pronto |
| APIs REST `/api/fleet/*` com autenticação e RBAC | Pronto |
| UI desktop (`/fleet`) + uso em campo web (`/fleet/field`) | Pronto |
| Permissões legadas + granulares + presets Admin | Pronto |
| Dashboard, alertas, relatórios (JSON/CSV) | Pronto |
| Importação CSV veículos/motoristas (preview + apply) | Pronto |
| Testes automatizados (~106), smoke HTTP, validação de schema | Pronto |
| Deploy documentado (migrate, backup, rollback lógico) | Pronto |
| Tratamento de erros HTTP padronizado + logs operacionais | Pronto |
| Diagnóstico read-only de integridade de dados | Pronto |

### O que é fase futura

GPS/telemetria, Detran, integração contábil completa, upload real de arquivos, app mobile nativo, alçadas multi-nível, oficina/estoque de peças, RH/cartão combustível — ver [backlog-futuro.md](./backlog-futuro.md).

---

## 2. Escopo implementado

| Domínio | Implementado | Observação |
|---------|--------------|------------|
| **Banco** | Sim | Migrations `20260603120000`, `20260604120000`; seed `FleetSettings` |
| **APIs** | Sim | ~90+ rotas sob `/api/fleet` (10 arquivos de rotas) |
| **UI** | Sim | `FleetModule` + 10+ componentes; menu lateral `fleet` |
| **Permissões** | Sim | 8 legadas + 22 granulares; expansão em `fleetPermissionResolve.ts` |
| **Dashboard** | Sim | Cards + alertas; financeiro mascarado sem permissão |
| **Veículos** | Sim | CRUD, status, bloqueio, baixa (venda/devolução), km, alertas na lista |
| **Contratos** | Sim | Por veículo; alertas de vencimento/franquia km |
| **Documentos** | Sim | Por veículo + listagem global; status calculado (VALID/EXPIRING/EXPIRED) |
| **Motoristas** | Sim | CRUD, CNH, bloqueio/desbloqueio, CPF único ativo |
| **Reservas** | Sim | Agenda, conflito de período, aprovação/rejeição, cancelamento |
| **Retirada/devolução** | Sim | Checkout/checkin, `FleetUsage`, sync status veículo |
| **Checklist** | Sim | Retirada, devolução, inspeção, manutenção; itens críticos |
| **Manutenção** | Sim | Fluxo de status, bloqueio veículo, aprovação por valor, custo |
| **Custos** | Sim | `FleetCost`, abastecimentos, competência, cancelamento |
| **Ocorrências** | Sim | `FleetIncident` (sinistros); pode bloquear veículo e gerar manutenção |
| **Relatórios** | Sim | Frota, uso, custos, manutenção, documentos; CSV |
| **Auditoria** | Sim | `FleetAuditLog` + log `[fleet:action]` em ações críticas |
| **Settings** | Sim | Parâmetros chave/valor; UI na aba Configurações |

**Parcial / limitação explícita**

- **Anexos:** metadado + URL externa; sem storage/upload binário no servidor.
- **Contratos/documentos (UI):** abas no menu redirecionam contexto; operação principal na ficha do veículo.
- **Multas:** cadastro e fluxo de status; sem integração Detran.

---

## 3. Arquitetura

### 3.1 Modelos Prisma (16 tabelas)

`FleetVehicle`, `FleetVehicleContract`, `FleetVehicleDocument`, `FleetDriver`, `FleetReservation`, `FleetUsage`, `FleetChecklist`, `FleetChecklistItem`, `FleetMaintenance`, `FleetCost`, `FleetFueling`, `FleetFine`, `FleetIncident`, `FleetAttachment`, `FleetAuditLog`, `FleetSettings`.

**Enums (12):** `FleetVehicleOrigin`, `FleetVehicleStatus`, `FleetDriverStatus`, `FleetDocumentStatus`, `FleetReservationStatus`, `FleetMaintenanceStatus`, `FleetCostStatus`, `FleetChecklistResult`, `FleetIncidentStatus`, `FleetFineStatus`, `FleetUsageStatus`, `FleetChecklistType`, `FleetChecklistStatus`.

Schema: `prisma/schema.prisma` · Migrations: `prisma/migrations/20260603120000_*`, `20260604120000_*`.

### 3.2 Camada de serviço / domínio (`src/lib/fleet*.ts`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `fleetService.ts` | Validações de reserva, unicidade placa/CPF, `writeFleetAuditLog`, settings |
| `fleetValidation.ts` | Regras puras (km, CNH, conflito agenda, checklist, manutenção) |
| `fleetVehicleOps.ts` | Veículo, contrato, documento, alertas, ciclo de vida |
| `fleetDriverOps.ts` | Motoristas |
| `fleetReservationOps.ts` | Reservas, disponibilidade, cancelamento |
| `fleetUsageOps.ts` | Checkout/checkin, serialização usage |
| `fleetChecklistOps.ts` | Checklists |
| `fleetMaintenanceOps.ts` | Manutenções, sync status veículo |
| `fleetFinancialOps.ts` | Custos, abastecimento, multas, dashboard financeiro |
| `fleetManagementOps.ts` | Dashboard cards, relatórios, settings editáveis |
| `fleetAlertsService.ts` | Motor de alertas operacionais |
| `fleetReportsService.ts` | Queries de relatórios |
| `fleetCsvImport.ts` | Import CSV preview/apply |
| `fleetMobileUsage.ts` | Contexto uso em campo |
| `fleetListQuery.ts` | Paginação e filtros padronizados |
| `fleetPermissionResolve.ts` | Expansão legado → granular, `canFleet()` |
| `fleetRouteGuards.ts` | Middleware Express por guard |
| `fleetErrors.ts` | `mapFleetErrorToHttp`, logs técnicos |
| `fleetIntegrityDiagnostic.ts` | Diagnóstico read-only de integridade |

### 3.3 Rotas HTTP (`registerFleetRoutes` em `fleetRoutes.ts`)

| Módulo de rotas | Arquivo |
|-----------------|---------|
| Core (dashboard, vehicles base, settings) | `fleetRoutes.ts` |
| Veículos estendido (contratos, documentos, lifecycle) | `fleetVehicleRoutes.ts` |
| Motoristas | `fleetDriverRoutes.ts` |
| Reservas + checkout/checkin | `fleetReservationRoutes.ts` |
| Usage (contexto mobile) | `fleetUsageRoutes.ts` |
| Checklists | `fleetChecklistRoutes.ts` |
| Manutenções | `fleetMaintenanceRoutes.ts` |
| Financeiro (custos, fueling, fines, incidents, attachments) | `fleetFinancialRoutes.ts` |
| Alertas + relatórios | `fleetManagementRoutes.ts` |
| Import CSV | `fleetImportRoutes.ts` |

Registro no app: `server.ts` → `registerFleetRoutes(app, { requireAppAuth, getCurrentAppUser })`.

### 3.4 Frontend

| Peça | Caminho |
|------|---------|
| Módulo principal | `src/components/FleetModule.tsx` |
| Abas / fluxos | `src/components/fleet/FleetVehiclesTab.tsx`, `FleetDriversTab.tsx`, `FleetReservationsTab.tsx`, `FleetMaintenancesTab.tsx`, `FleetFinancialTab.tsx`, `FleetReportsTab.tsx`, `FleetMobileUsageFlow.tsx`, `FleetImportSettings.tsx`, `FleetVehicleDetailSheet.tsx`, `FleetCheckoutCheckinModal.tsx` |
| Permissões UI | `src/components/fleet/fleetPermissions.ts` |
| Utilitários UI | `src/components/fleet/fleetUi.tsx`, `src/lib/fleetFormat.ts`, `src/lib/fleetApiError.ts` |
| Tipos | `src/types/fleet.ts` |
| Rotas SPA | `/fleet`, `/fleet/field` (App) |

### 3.5 Permissões

- Catálogo: `src/lib/permissionCatalog.ts` (grupo Gestão de Frota).
- Presets: `src/lib/permissionCatalogUtils.ts` (`fleet_admin`, `fleet_operator`, `fleet_financial`, `fleet_maintenance`, `fleet_requester`, `fleet_viewer`).
- Backend: `fleetPermissionResolve.ts` + `fleetRouteGuards.ts`.
- Menu: `src/lib/modulePermissions.ts` (módulo `fleet`).

### 3.6 Testes e scripts

| Artefato | Função |
|----------|--------|
| `src/lib/fleetValidation.test.ts` | Regras de negócio, permissões, alertas, import, paginação |
| `src/lib/fleetIntegrityDiagnostic.test.ts` | Diagnóstico (overlap, km, documento) |
| `src/lib/fleetErrors.test.ts` | Mapeamento HTTP de erros |
| `scripts/fleetSmokeTest.ts` | Smoke HTTP E2E (`npm run test:fleet:smoke`) |
| `scripts/fleetE2eSmokeTest.ts` | Smoke domínio/Prisma |
| `scripts/fleetDbValidate.ts` | Validação schema no banco |
| `scripts/fleetIntegrityDiagnostic.ts` | Integridade dados (read-only) |
| `scripts/fleetServerDeployValidate.sh` | Orquestração deploy servidor |
| `scripts/backupDatabaseBeforeDeploy.sh` | Backup pré-deploy |
| `scripts/fleetImportCsv.ts` / `fleetSeedDemo.ts` | Utilitários operacionais |

---

## 4. Regras de negócio implementadas (principais)

1. **Placa única** entre veículos ativos (índice parcial; não duplicar em SOLD/INACTIVE/RETURNED).
2. **CPF único** entre motoristas ativos.
3. **Reserva:** `startDateTime < endDateTime`; sem sobreposição em status ocupante; veículo reservável conforme status.
4. **Documento vencido** pode bloquear nova reserva (setting `bloquearReservaDocumentoVencido`).
5. **Motorista:** autorizado para reserva; CNH válida e categoria mínima vs tipo de veículo; bloqueado/inativo não vincula.
6. **CNH vencida** bloqueia retirada se setting ativa (`bloquearRetiradaCnhVencida`).
7. **Aprovação de reserva** exige permissão `fleet.reservations.approve` (ou `fleet.manage`).
8. **Checkout:** veículo disponível; checklist completo; item crítico `NOT_OK` impede retirada; km coerente.
9. **Checkin:** km final ≥ km retirada; avarias podem gerar `FINISHED_WITH_PENDING`.
10. **Status veículo** sincronizado após reserva/manutenção (IN_USE, MAINTENANCE, BLOCKED, etc.).
11. **Manutenção:** transições de status validadas; `blocksVehicle` pode bloquear veículo; valor estimado acima do limiar exige aprovação.
12. **Custos:** valor não negativo; competência `YYYY-MM`; cancelados excluídos do dashboard.
13. **Valores financeiros** mascarados na API sem `fleet.financial.view` / expansão `fleet.manage`.
14. **`fleet.manage`** não inclui `fleet.settings.manage` (configuração exige permissão explícita).
15. **Import CSV:** preview sem gravar; apply com token de confirmação; linhas inválidas reportadas.
16. **Auditoria:** ações críticas em `FleetAuditLog` (status, cancelamento, settings, etc.).
17. **Alertas:** documentos/CNH/contratos vencendo, reserva atrasada, pagamentos (se permissão financeira).

---

## 5. Comandos de validação

### Desenvolvimento / CI

```bash
npx prisma validate
npx prisma generate
npm run test:fleet          # ~106 testes (validation + integrity + errors)
npm run lint                # tsc --noEmit
npm run build               # vite build
```

### Banco (requer `DATABASE_URL`)

```bash
npm run fleet:db-validate
npm run fleet:integrity:diagnostic
# opcional saída: --out=docs/generated/fleet-integrity-report.json
```

### Smoke (ambiente com app + banco)

```bash
npm run test:fleet:e2e
npm run test:fleet:smoke -- --confirm="RODAR SMOKE FROTA"
# Servidor em execução; credenciais FLEET_SMOKE_* ou SUPER_ADMIN
```

### Import CSV (opcional)

```bash
npm run fleet:import -- vehicles preview --file=./veiculos.csv
npm run fleet:import -- vehicles apply --file=./veiculos.csv --confirm="APLICAR_IMPORTACAO_FROTA"
```

---

## 6. Deploy

Roteiros: [deploy-servidor.md](./deploy-servidor.md) · [deploy-backup-rollback.md](./deploy-backup-rollback.md).

### Sequência recomendada

1. **Backup:** `./scripts/backupDatabaseBeforeDeploy.sh --reason=pre_deploy_frota`
2. **Git:** `git pull origin main` · anotar `git rev-parse HEAD`
3. **Migrations:** `npx prisma migrate status` → `npx prisma migrate deploy`
4. **Prisma:** `npx prisma validate` · `npx prisma generate`
5. **Qualidade:** `npm run test:fleet` · `npm run lint` · `npm run build`
6. **Banco:** `npm run fleet:db-validate`
7. **Permissões:** conceder `fleet.*` aos perfis (Admin → Usuários ou presets)
8. **Restart** da aplicação (PM2/systemd ou `nohup npm run dev` em dev)
9. **Smoke manual** UI + opcional `test:fleet:smoke`

### Migrations frota

| Migration | Conteúdo |
|-----------|----------|
| `20260603120000_add_fleet_management_module` | Schema completo frota + seed inicial settings |
| `20260604120000_fix_fleet_schema_alignment` | Índices idempotentes + seed settings complementar |

**Não usar** em produção: `prisma db push`, `prisma migrate dev`.

### Rollback lógico (incidente)

Parar app → restaurar backup pré-deploy (autorizado) → `git checkout <SHA estável>` → `npx prisma generate` → reiniciar. Não reverter migration manualmente no `_prisma_migrations`.

---

## 7. Permissões

### 7.1 Legadas (compatibilidade — continuam no catálogo)

| Permissão | Uso |
|-----------|-----|
| `fleet.view` | Acesso ao módulo e leitura geral |
| `fleet.manage` | Administração ampla (exceto settings) |
| `fleet.vehicles.edit` | Veículos, contratos, documentos |
| `fleet.reservations.create` | Reservas, checkout/checkin, checklists |
| `fleet.reservations.approve` | Aprovar/rejeitar reservas |
| `fleet.maintenance.manage` | Manutenções |
| `fleet.financial.view` | Valores e lançamentos financeiros |
| `fleet.settings.manage` | Parâmetros do módulo |

### 7.2 Granulares (catálogo Admin — expansão automática via legado)

`fleet.dashboard.view`, `fleet.vehicles.view`, `fleet.vehicles.create`, `fleet.vehicles.edit`, `fleet.vehicles.status.manage`, `fleet.contracts.view`, `fleet.contracts.manage`, `fleet.documents.view`, `fleet.documents.manage`, `fleet.drivers.view`, `fleet.drivers.manage`, `fleet.reservations.view`, `fleet.reservations.create`, `fleet.reservations.approve`, `fleet.reservations.manage`, `fleet.usage.checkout`, `fleet.usage.checkin`, `fleet.maintenance.view`, `fleet.maintenance.manage`, `fleet.costs.view`, `fleet.costs.manage`, `fleet.financial.view`, `fleet.reports.view`, `fleet.settings.manage`.

Detalhe: [../FLEET_PERMISSIONS.md](../FLEET_PERMISSIONS.md).

### 7.3 Perfis sugeridos (presets)

| Preset | Perfil típico |
|--------|----------------|
| Frota — Administrador | `fleet.view` + `fleet.manage` + `fleet.settings.manage` + financeiro |
| Frota — Operador | Visualização + reservas + checkout/check-in |
| Frota — Financeiro | Visualização + `fleet.financial.view` |
| Frota — Manutenção | Visualização + `fleet.maintenance.manage` |
| Frota — Solicitante | Visualização + criar reservas |
| Frota — Visualizador | Somente `fleet.view` |

`SUPER_ADMIN` possui todas as permissões do catálogo.

---

## 8. Pendências (fase futura)

Conforme [backlog-futuro.md](./backlog-futuro.md):

| Item | Status |
|------|--------|
| Upload real de anexos (S3/storage) | Pendência (hoje só URL) |
| Integração financeira / contabilidade geral | Pendência |
| Telemetria / GPS | Pendência |
| Integração Detran / órgãos | Pendência |
| App mobile nativo (iOS/Android) | Pendência (existe web `/fleet/field`) |
| Alçadas avançadas multi-nível | Parcial |
| Oficina / estoque de peças | Pendência |
| RH / cartão combustível automático | Pendência |
| Auditoria global de diff de permissões de usuário | Pendência (fase `AUDIT-LOG-B` planejada) |

---

## 9. Riscos conhecidos

| Risco | Impacto | Mitigação atual |
|-------|---------|-----------------|
| Migration frota irreversível sem restore | Alto em prod | Backup obrigatório; doc rollback |
| Dados inconsistentes (status vs usage) | Médio | `fleet:integrity:diagnostic`; correção manual |
| Export CSV grande em memória | Médio | Usar filtros; paginação JSON |
| Anexo só por URL | Baixo/médio | Processo manual externo |
| Usuário sem `fleet.view` após deploy | Baixo | Checklist permissões pós-deploy |
| `fleet.manage` sem settings | Confusão UX | Documentado; teste de permissões |
| Restore em prod sem parar app | Alto | Procedimento em deploy-backup-rollback |
| Dependência de km manual | Operacional | Treinamento; futura telemetria |

---

## 10. Próximos passos recomendados

### Operacional (curto prazo)

1. Executar deploy em homologação com checklist completo ([deploy-servidor.md](./deploy-servidor.md)).
2. Conceder permissões por perfil real (gestor, operador, financeiro).
3. Rodar `fleet:integrity:diagnostic` após carga inicial ou import CSV.
4. Treinar usuários com [manual-operacional.md](./manual-operacional.md).

### Produto (médio prazo — priorizar com negócio)

1. **Upload de anexos** (documentos, multas, checklist) — maior ganho operacional.
2. **Integração financeira** (centro de custo corporativo / export contábil).
3. **Notificações** (e-mail/Teams) para aprovação de reserva e alertas críticos.

### Técnico (médio prazo)

1. Log de auditoria de alteração de permissões de usuário (fase global ERP).
2. Ampliar cobertura de testes de integração HTTP em CI (smoke sem servidor manual).
3. Revisar performance de relatórios com volume alto (streaming CSV).

### Não recomendado sem planejamento

- `DROP` de tabelas Fleet em produção.
- `prisma migrate reset` em ambiente compartilhado.
- Restore de produção sem janela e autorização formal.

---

## Histórico de entregas relevantes (Git)

Commits recentes na linha frota (referência):

- `feat(fleet):` módulo base, alertas, relatórios, import CSV, mobile web, paginação
- `feat(auth):` permissões granulares e presets
- `fix(fleet):` permissões API/UI, schema, erros HTTP, smoke
- `test(fleet):` integridade, smoke API, diagnóstico dados
- `docs(fleet):` documentação operacional, deploy, backup/rollback

---

## Conclusão

A **Fase 1 da Gestão de Frota** está **implementada e validável** para uso operacional interno: cadastro, reserva, uso em campo (web), manutenção, custos, alertas, relatórios e governança de acesso. Limitações são conhecidas e documentadas; extensões externas (GPS, Detran, contábil, mobile nativo) permanecem no backlog explícito.

Para go-live: seguir backup → migrate deploy → validações → permissões → smoke → monitoramento de `app.log` nas primeiras 48h.
