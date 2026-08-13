# Módulo de Metas IndusCost (OKR & Goal Engine) — Blueprint adaptado

> BRD original: "Enterprise OKR & Goal Engine". Este documento é a adaptação
> oficial à realidade do IndusCost (React+Vite, Express `server.ts`,
> Prisma/Postgres, jobs via scripts tsx + cron do servidor, permissões via
> contrato canônico `requireResource`). Decisões de produto confirmadas em
> 12/08/2026: módulo para TODOS os perfis de usuário (não só vendedores),
> menu no grupo **Administração**; Owner = `AppUser`; quotas (MVP 4) por
> pessoa da entidade-alvo (ex.: vendedor Nomus `externalSellerId`).

## Decisões arquiteturais (vs. BRD genérico)

| Tema | BRD sugeria | Decisão IndusCost |
|---|---|---|
| Fila assíncrona | BullMQ/RabbitMQ | Script `scripts/goalSnapshotsDailyV1.ts` + cron do servidor (padrão dos syncs Nomus); "Atualizar Agora" com `pg_try_advisory_lock` por KR |
| Query dinâmica | Knex / `$queryRawUnsafe` | `Prisma.sql` parametrizado + dicionário-whitelist; input do usuário guarda **chaves**, nunca SQL. `$queryRawUnsafe` proibido |
| Metadados | Expor tabela+campo por domínio | Métricas e filtros **curados** apontando para motores oficiais (ex.: Receita = `queryMonthlyFiscalNfe`, nunca `NomusNfe` crua) |
| Validação | Zod | Parse tipado manual (padrão `treasurySchemas.ts`) |
| Front | Next + react-hook-form | React 18 + Vite; filtros no padrão da casa **rascunho × Aplicar** |
| Permissão | — | Recurso `admin.goals` no contrato canônico; deny by default; SUPER_ADMIN bypass |

## Modelo de dados (MVP 1)

- `Goal` — objetivo qualitativo: título, descrição, `startDate`/`endDate`,
  `status DRAFT|ACTIVE|DONE|ARCHIVED`, `ownerAppUserId`. Progresso é derivado
  (roll-up) — nunca gravado à mão. Exclusão física só sem snapshots; com
  histórico vira `ARCHIVED` (soft-delete).
- `GoalKeyResult` — KR quantitativo: título, `domain COMERCIAL|PRODUCAO|
  FINANCEIRO|SUPRIMENTOS|PESSOAS|OUTROS`, `trackingType INCREASE|DECREASE`,
  `baseline`/`target`/`achievedValue` (Decimal 20,6 — nunca float), `unit`
  (rótulo livre: R$, un, %, h), `weight` (>0, default 1), `ownerAppUserId`,
  `manualTracking` (MVP 1: true), `ruleJson` (MVP 2+: chaves do dicionário),
  datas herdadas/validadas contra o Goal pai.
- `GoalKeyResultSnapshot` — histórico imutável: `@@unique([keyResultId,
  snapshotDate])`, 1/dia; dias passados NUNCA são reescritos (RN-009); o dia
  corrente é upsertado (última leitura do dia vence). `achievedValue` do KR é
  sempre o valor vivo; o gráfico lê os snapshots.

## Fórmulas (domínio puro `goalProgress.ts`, 100% testado)

- Progresso do KR: `clamp((achieved − baseline) / (target − baseline), 0, 1)`
  — funciona para INCREASE e DECREASE (target<baseline inverte o sinal).
  `target == baseline` ⇒ progresso 0 por definição (meta inválida sinalizada).
- Roll-up do Objetivo (RN-010): `Σ(progresso×peso)/Σ(pesos dos KRs ativos)`;
  KRs arquivados ficam fora. Recalculado após qualquer escrita de valor e ao
  fim do job de snapshots (MVP 3).

## Roadmap por MVP (uma missão por fase, gates completos)

1. **MVP 1 — Alicerce (esta missão):** migration, CRUD Goal/KR, valor
   realizado manual (com snapshot do dia), cockpit com progresso/roll-up e
   visão "Minhas Metas". Permissão `admin.goals` + item no menu
   Administração.
2. **MVP 2 — Motor:** `goalMetadata.ts` (dicionário curado por domínio) +
   tradutor `ruleJson → Prisma.sql` + testes via script dry-run.
3. **MVP 3 — Workflow:** rule builder na UI (dropdowns pelo dicionário,
   input por tipo), job noturno `goalSnapshotsDailyV1` + "Atualizar Agora"
   (advisory lock, anti duplo-clique no backend).
4. **MVP 4 — Pessoas:** `GoalKeyResultQuota` (rateio nominal, Σ ≤ target,
   pessoaFK do dicionário com override no modo avançado), visão por
   colaborador e `GoalInitiative` (kanban TODO/DOING/DONE com assignee e
   dueDate).

## Invariantes de segurança (todas as fases)

- Somente leitura dos espelhos Nomus — writeback proibido.
- Snapshots de dias passados imutáveis; reprocessamento idempotente.
- Painel nunca roda query pesada on-the-fly (lê snapshot/cache).
- Recurso `admin.goals`: view para consumo, create/update para gestão de
  metas, manage para exclusão/arquivamento. Deny by default.
