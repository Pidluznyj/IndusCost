# Etapa 23 — Handoff de PR

## Objetivo

Consumir Caixa canônico + movimentos bancários + motor de conciliação já existentes numa
visão unificada, com conciliação manual funcional, sem criar segunda autoridade financeira.

## Arquitetura

Read-only: 3 adaptadores puros (canônico, bancário, conciliação) → read model unificado
(função pura) → orquestrador com I/O (compõe 3 serviços oficiais) → API → UI.
Write: UI monta payload → delega às rotas `POST /reconciliations` / `.../unmatch` /
`.../reverse` já existentes (agora com o P0 de concorrência corrigido).

## Componentes reutilizados

`treasuryCaixaService`, `treasuryBankMovementQueryService` (com ACL),
`treasuryReconciliationMatchService` (accept/unmatch/reverse — motor oficial),
`runTreasuryReconciliationSuggestionEngine`, `treasuryMoney.ts`,
`TreasuryReconciliationReverseConfirmDialog` (UI madura reaproveitada),
tela de Transferências (link, não duplicada).

## Lacunas implementadas nesta branch

CS-000/000b (correção do P0 de concorrência — residual de movimento, residual de título,
idempotência), CS-001–016 (contratos, 3 adaptadores, read model, API read-only,
workspace, sugestões, conciliação manual completa com ajustes, unmatch, reverse).

## Tabelas e migrations

Uma migration aditiva: `20260905120000_treasury_reconciliation_idempotency` — coluna
`idempotencyKey` nullable em `TreasuryReconciliationMatch` + índice único
`(companyCode, idempotencyKey)`. Rollback: `DROP INDEX` + `DROP COLUMN`, sem perda de dado.
**Não aplicada** em nenhum banco durante esta execução (Postgres local indisponível).

## APIs

```
GET  /api/finance/treasury/cash-support
GET  /api/finance/treasury/cash-support/summary
GET  /api/finance/treasury/cash-support/suggestions
```
Escritas reaproveitam rotas já existentes de `/api/finance/treasury/reconciliations`.

## UI

`/finance/treasury/cash-support` — gate `reconcile` (mesmo RBAC/flag da conciliação).

## Permissões / feature flag

`finance.treasury.reconciliation.view` (leitura) e `.manage`/`.reconciliationReverse`
(escrita, via rotas já existentes). Flag `treasury.reconciliation.enabled`. Nenhum
recurso RBAC novo foi criado.

## Testes

96 testes próprios do Cash Support (contratos 17, adaptadores 33, read model 11,
sugestões 8, controller 9, componentes 24 — alguns números se sobrepõem por reuso de
suíte) + 12 de concorrência do P0 + regressão de 20 testes do motor de conciliação
pré-existente. Todos passando. `check:frontend-server-imports`, `check:browser-bundle`
e `npm run build` verdes.

## Riscos

- Exportação e revalidação de fonte (CS-017) não implementadas — ver revisão final.
- N+1 em `cashSupportService.getReadModel` ao buscar matches ativos por movimento
  (aceitável para volume de uma página, documentado como limitação de escala).
- Nunca validado contra Postgres real nesta rodada.

## Rollback

Reverter os commits desta branch (nenhuma migration aplicada em banco real ainda).
Se a migration `20260905120000` for aplicada em algum ambiente, rollback via
`DROP INDEX "TreasuryReconciliationMatch_companyCode_idempotencyKey_key"; ALTER TABLE
"TreasuryReconciliationMatch" DROP COLUMN "idempotencyKey";`.

## Validação manual

Não realizada (ambiente sem Postgres). Ver `09-end-to-end-validation.md` para o roteiro
a seguir quando o banco estiver disponível.

## Itens pós-MVP

CS-017 (revalidação de fonte), CS-018 (maker-checker — sem padrão institucional),
exportação/observabilidade completas, cobertura de extrato OFX (requer alterar o
parser, fora do escopo por decisão do ADR).
