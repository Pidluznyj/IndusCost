# Prompt 00 — Baseline técnico: Central de Tesouraria

**Data:** 2026-07-27  
**Branch:** `feature/treasury-center`  
**HEAD no momento da medição:** `d52a986` (docs Prompt 00a/00b)  
**Escopo:** medição apenas — sem correção de falhas antigas não relacionadas

---

## 1. Decisão de branch e proteção de WIP

### Git status inicial (antes do baseline)

Working tree em `main` (ahead 4 — commits de docs treasury) com WIP **não relacionado** (análise Lucro×Caixa / nav):

- Modified: `server.ts`, `App.tsx`, `Sidebar.tsx`, `financeModulesAccess.ts`, `financeNavigation.ts`, `permissionContract/resources.ts`, vários `sidebar*`, etc.
- Untracked: `src/components/finance/profit-cash/`, `src/lib/financeProfitCashAnalysis*.ts`

### Proteção aplicada

| Ação | Detalhe |
|------|---------|
| Stash | `wip-profit-cash-unrelated-before-treasury-baseline` |
| Stash | `wip-profit-cash-tracked-remaining-before-treasury` |
| Stash | `wip-profit-cash-untracked-remaining-before-treasury` |
| Stash | `wip-feat-finance-lucro-caixa-before-treasury-baseline-rerun` (reaparecimento ao mudar contexto) |
| Stash | `wip-tracked-carried-into-treasury-branch` |
| Backup filesystem | `%TEMP%\induscost-wip-profit-cash-backup-20260727` (cópia; **fora** do `tsc`) |

**Observação OneDrive:** alguns `git stash -u` falharam parcialmente com `Permission denied` em pastas (`profit-cash`, `scripts/output`, etc.). Por isso houve stashes múltiplos + backup em `%TEMP%`.

### Branch

```text
git checkout -b feature/treasury-center   # criada a partir de main @ d52a986
```

Baseline e commits deste passo ficam em **`feature/treasury-center`**.

### Como restaurar o WIP Lucro×Caixa (quando necessário)

```bash
# listar
git stash list

# restaurar o mais completo relevante (ajustar índice após inspecionar)
git stash apply stash^{/wip-feat-finance-lucro-caixa}
# e/ou
git stash apply stash^{/wip-tracked-carried-into-treasury}
```

Preferir aplicar em `feat/finance-lucro-caixa` (se existir) — **não** misturar com commits de Tesouraria.

---

## 2. Ambiente medido

| Item | Valor |
|------|-------|
| OS | Windows 10 (win32) |
| Package manager | npm (`package-lock.json` v3) |
| Node deps (amostra) | `react@19.2.4`, `express@4.22.1`, `@prisma/client@5.22.0`, `vite@6.4.2`, `typescript@5.8.3` |
| `.env` local | **Ausente** no workspace do Cursor |
| Backend build separado | **Não existe** — runtime `tsx server.ts` |

---

## 3. Comandos executados e resultados

| # | Passo | Comando | Exit | Classificação |
|---|-------|---------|------|---------------|
| 1 | Dependências | `npm ls --depth=0` | **0** | OK |
| 2a | Prisma validate (sem env) | `npx prisma validate` | **1** | **Ambiente** — `DATABASE_URL` ausente (P1012) |
| 2b | Prisma validate (URL dummy em memória) | `DATABASE_URL=postgresql://… npx prisma validate` | **0** | OK — schema válido |
| 3 | TypeScript / lint | `npm run lint` (`tsc --noEmit`) | **2** | **Preexistente** — 1236 erros TS; 0 menções a `treasury` |
| 4 | FE→server imports | `npm run check:frontend-server-imports` | **0** | OK (744 arquivos) |
| 5 | Server imports | `npm run check:server-imports` | **0** | OK |
| 6 | Startup prisma scope | `npm run test:server-startup` | **0** | OK (2/2) |
| 7 | Build frontend | `npm run build` (`vite build`) | **0** | OK (~58s; warning chunk size) |
| 8 | Build backend | N/A | — | Não há pipeline separado |
| 9 | Testes adjacentes financeiro | `npm run test:finance:cash-flow` | **0** | OK — **441/441** pass |

`npm run test:unit` completo **não** foi executado neste passo (custo/tempo alto; suíte cash-flow + checks de import/startup cobrem o baseline seguro para iniciar Tesouraria). Recomendado no Prompt 27.

---

## 4. Classificação de falhas

### 4.1 Falhas de ambiente

| Falha | Evidência | Impacto Tesouraria | Ação |
|-------|-----------|--------------------|------|
| `prisma validate` sem `DATABASE_URL` | P1012 em `schema.prisma:7` | Não bloqueia desenho/código local se validate usar URL dummy; **bloqueia** qualquer migrate/runtime DB sem `.env` real do usuário | Usuário mantém `.env` fora do Cursor; script baseline injeta URL dummy **só** para validate |

**Não** foi criado `.env` (proibido alterar segredos/credenciais).

### 4.2 Falhas preexistentes (não corrigidas)

| Falha | Evidência | Impacto Tesouraria |
|-------|-----------|--------------------|
| `tsc --noEmit` com **1236** erros | Top: `src/lib/*`, `scripts/*`, `server.ts` (56), portfolio/cash-flow components, commissions, `tmp-audits/` | **Não bloqueante** para iniciar domínio Tesouraria em módulos novos tipados, desde que novos arquivos não aumentem a dívida sem controle |
| Warning Vite chunk >500kB | build OK com aviso | Cosmético |

Amostra de erros preexistentes (não treasury):

- `scripts/audit-*-rules-consumption.ts` — export removido `loadFinanceArManagementRowsFromPrisma`
- `server.ts` — narrowing/`Decimal` vs `number` em market intelligence
- Diversos testes/scripts de comissão/portfolio desalinhados com tipos atuais

### 4.3 Falhas bloqueantes para a Tesouraria

| Item | Status |
|------|--------|
| Impossibilidade de criar branch / preservar WIP | Mitigado (stashes + backup) |
| Schema Prisma inválido | **Não** — validate OK com URL dummy |
| Build frontend quebrado | **Não** — build OK |
| Imports FE→Prisma | **Não** — check OK |
| Ausência de runner de teste | **Não** — `tsx --test` OK |
| Dívida `tsc` global | **Não bloqueante** para P01, mas exige que código novo Tesouraria seja limpo e preferencialmente coberto por testes dedicados |

**Veredito:** baseline **permite avançar** para Prompt 01 (foundation), com lint global tratado como dívida preexistente (modo soft no script).

---

## 5. Script reutilizável criado

Projeto **não** tinha orquestrador de baseline de Tesouraria. Equivalentes parciais já existiam (`lint`, `build`, `build:safe`, checks de import).

Criado:

| Artefato | Função |
|----------|--------|
| `scripts/runTreasuryBaseline.mjs` | Orquestra deps → prisma validate → lint (soft) → checks → startup test → build |
| `npm run validate:treasury-baseline` | Entrada npm |

Comportamento:

- Não grava `.env`
- Se `DATABASE_URL` ausente, usa URL dummy **somente** no processo de `prisma validate`
- `TREASURY_BASELINE_LINT_SOFT=1` (default): falha de `tsc` não derruba exit crítico
- `TREASURY_BASELINE_LINT_SOFT=0`: lint vira crítico

---

## 6. Backend vs frontend

| Pipeline | Existe? | Comando |
|----------|---------|---------|
| Frontend production build | Sim | `npm run build` → Vite → `dist/` |
| Backend compile step | Não | `tsx server.ts` / produção tipicamente Node+tsx ou equivalente no servidor do usuário |
| Monólito | Sim | Mesmo processo Express serve API + SPA |

---

## 7. Riscos observados neste passo

1. OneDrive/`Permission denied` atrapalha `git stash -u` — sempre confirmar `git status` após stash.
2. Backup dentro de `tmp/` no repo pode ser pego pelo `tsc` (tsconfig sem `exclude`) — backup foi movido para `%TEMP%`.
3. Branch `feat/finance-lucro-caixa` coexistiu no mesmo HEAD; cuidado ao restaurar stash na branch errada.
4. Lint global vermelho mascara regressões — Tesouraria deve ter `test:treasury` próprio cedo (plano P01/P27).

---

## 8. Checklist Prompt 00 — baseline

- [x] `git status` verificado; WIP preservado (stash + backup)
- [x] Branch `feature/treasury-center` criada/utilizada
- [x] Dependências verificadas
- [x] TypeScript/lint executado (resultado classificado)
- [x] Testes relevantes executados (startup + cash-flow)
- [x] `prisma validate` executado (env vs dummy)
- [x] Build frontend executado
- [x] Backend separado documentado como N/A
- [x] `04-BASELINE.md` criado
- [x] Script `validate:treasury-baseline` criado (sem equivalente prévio)
- [x] Falhas antigas **não** corrigidas neste passo
- [x] Sem avanço para Prompt 01 de implementação
