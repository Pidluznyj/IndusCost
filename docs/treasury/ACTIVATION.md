# Central de Tesouraria — Ativação operacional (ADMIN / SUPER_ADMIN)

**Escopo:** liberar o módulo já entregue para `SUPER_ADMIN` e `ADMIN`, sem ampliar
`COMMERCIAL_MANAGER` / `SELLER` / `VIEWER`, e sem ativar processos externos
(e-mail, push, webhook, movimentação bancária automática, mutação Nomus).

**Código de referência:** `treasuryFeatureFlags.ts`, `treasuryRollout.ts`,
`permissionResourceSeedData.ts` (`ROLE_MATRIX.ADMIN`), `treasuryNavigation.ts`,
`treasuryAdminPermissionSeed.ts`, menu em `navigationGroups.ts` / `Sidebar.tsx`.

## O que o deploy do código faz (e o que não faz)

| Camada | Comportamento |
|--------|----------------|
| Feature flags | **Opt-in.** Mestra ausente = **OFF**. Ativar: `TREASURY_MODULE_ENABLED=1`. |
| Subflags | Com mestra ON e env ausente = ON. Opt-out seletivo: `=0`. Valor inválido = OFF. |
| Fail-closed | Flag ID desconhecida → OFF. Valor env desconhecido → OFF. Mestra inválida → OFF. |
| Menu | Item **Tesouraria** em Financeiro quando mestra ON **e** `finance.treasury` view. |
| Rota FE | `/finance/treasury` (módulo `treasury`, não herda de `finance.view`). |
| APIs | `requireAppAuth` → flag → `requireResource`. Mestra OFF → 404. |
| Roles | `ROLE_MATRIX.ADMIN` declara defaults oficiais. Produção usa seed **aditivo** restrito. |
| Processos externos | Permanecem desligados. Deploy **não** movimenta dinheiro nem altera Nomus. |

**Deploy sozinho não ativa a Tesouraria.** É necessário seed restrito (ADMIN) + env explícita + restart.

## Pós-deploy (servidor) — sequência obrigatória

### 1) Dry-run do seed restrito (padrão)

```bash
cd /opt/induscost
npm run treasury:permissions:seed
```

Equivale a dry-run: **não grava**. Revisar o relatório (recursos/permissões a criar).

### 2) Apply somente após aprovação

```bash
cd /opt/induscost
npm run treasury:permissions:seed -- --apply
```

O script:

- afeta **somente** o papel `ADMIN`;
- afeta **somente** `finance.treasury` e `finance.treasury.*`;
- **cria** registros ausentes;
- **não atualiza** `RolePermission` existente (preserva personalizações);
- **não remove** nada;
- **não toca** CM / SELLER / VIEWER, overrides, AccessProfile, `AppUser.permissions`;
- usa **transação**;
- é **idempotente**.

### 3) NÃO executar

```bash
# PROIBIDO para esta ativação — reescreve RolePermission de toda a matriz
npm run permissions:seed -- --sync-role-defaults
```

### 4) Ativar a mestra (opt-in) e reiniciar

No `.env` do serviço (não commitado):

```bash
TREASURY_MODULE_ENABLED=1
```

Reiniciar o processo (`systemctl restart induscost` ou fluxo oficial de deploy).  
Mudança de variável **exige restart**.

Desligamento emergencial:

```bash
TREASURY_MODULE_ENABLED=0
```

Opt-out seletivo (exemplo):

```bash
TREASURY_REPORTS_ENABLED=0
```

Lista completa: `.env.example` e [19-ROLLOUT.md](./19-ROLLOUT.md).

## Processos externos (permanecem desligados)

- Envio de e-mail / push / webhook de alertas
- Cron de alertas externos (`treasury.alerts.scan` no-op / não envia)
- Integração bancária que movimente dinheiro
- Transmissão automática de pagamento
- Mutação de títulos oficiais Nomus

Alertas na UI (dashboard/agenda) são **cálculo interno** — não disparam comunicação externa.

## Pré-requisitos de dados (não bloqueiam abertura)

A UI deve abrir com estados vazios. Operação real tipicamente exige:

1. Conta financeira cadastrada
2. Snapshot de saldo (quando for operar posição)
3. ACL de usuário×conta (quando restringir por conta)
4. Sync Nomus CR/CP já operacional (leitura)
5. Backfill de complementos **somente se** houver gap — script oficial em
   `treasuryTitleComplementBackfill` (não executar daqui; ver runbook)

## Validação rápida (após seed + env + restart)

1. Login `ADMIN` → menu Financeiro → **Tesouraria**
2. Abrir `/finance/treasury`
3. `GET /api/finance/treasury/availability` → `enabled: true`
4. Login `SELLER` → item Tesouraria **ausente**; API → 403
5. Sem `TREASURY_MODULE_ENABLED` (ou `=0`) → menu oculto; API → 404

Checklist completo: [POST-DEPLOY-CHECKLIST.md](./POST-DEPLOY-CHECKLIST.md).
