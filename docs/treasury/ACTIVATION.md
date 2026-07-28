# Central de Tesouraria — Ativação operacional (ADMIN / SUPER_ADMIN)

**Escopo:** liberar o módulo já entregue para `SUPER_ADMIN` e `ADMIN`, sem ampliar
`COMMERCIAL_MANAGER` / `SELLER` / `VIEWER`, e sem ativar processos externos
(e-mail, push, webhook, movimentação bancária automática, mutação Nomus).

**Código de referência:** `treasuryFeatureFlags.ts`, `treasuryRollout.ts`,
`permissionResourceSeedData.ts` (`ROLE_MATRIX.ADMIN`), `treasuryNavigation.ts`,
menu em `navigationGroups.ts` / `Sidebar.tsx`.

## O que o deploy deste commit ativa

| Camada | Comportamento |
|--------|----------------|
| Feature flags | Catálogo conhecido **default ON** se a env estiver ausente. Opt-out: `TREASURY_MODULE_ENABLED=0` (mestra) ou subflag `=0`. |
| Fail-closed | Flag ID desconhecida → sempre OFF. Valor env desconhecido → OFF. |
| Menu | Item **Tesouraria** em Financeiro quando mestra ON **e** `finance.treasury` view. |
| Rota FE | `/finance/treasury` (módulo `treasury`, não herda de `finance.view`). |
| APIs | Continuam com `requireAppAuth` → flag → `requireResource`. |
| Roles | `ADMIN` recebe bags `finance.treasury*` no seed oficial. `SUPER_ADMIN` permanece bypass global. Demais roles: default deny. |

## Pós-deploy (servidor) — obrigatório para ADMIN existentes

O seed de permissões é **create-only** por padrão. Para atualizar defaults de
roles já existentes (incluir Tesouraria no `ADMIN`):

```bash
cd /opt/induscost
npm run permissions:seed -- --sync-role-defaults
```

Não imprime segredos. Não altera SSH/Webmin/firewall. Não reinicia o serviço.
Não roda migration. Não muta Nomus.

Opcional (catálogo canônico, se ainda não sincronizado):

```bash
cd /opt/induscost
npm run permissions:seed:contract:apply
```

## Variáveis de ambiente

Nenhuma variável é **obrigatória** para ativar (default-on).

Desligamento emergencial:

```bash
# no .env do serviço (não commitado)
TREASURY_MODULE_ENABLED=0
```

Opt-out seletivo de submódulo (exemplo: relatórios):

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

## Validação rápida (após deploy + seed)

1. Login `ADMIN` → menu Financeiro → **Tesouraria**
2. Abrir `/finance/treasury`
3. `GET /api/finance/treasury/availability` → `enabled: true`
4. Login `SELLER` → item Tesouraria **ausente**; API → 403
5. Com `TREASURY_MODULE_ENABLED=0` → menu oculto; API → 404

Checklist completo: [POST-DEPLOY-CHECKLIST.md](./POST-DEPLOY-CHECKLIST.md).
