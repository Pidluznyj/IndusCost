# Caixa — Motor único-de-dia canônico e Cenários (Otimista/Realista/Pessimista)

**Escopo:** consolidação da tela `Financeiro → Tesouraria → Caixa`.
**Objetivo:** fonte única de verdade por dia, e gráfico de cenários que
reutiliza os motores canônicos já existentes na Tesouraria.

## 1. Motor único-de-dia — `TreasuryCaixaCanonicalDay`

**Arquivo:** `src/lib/treasury/domain/treasuryCaixaCanonicalDay.ts` (puro; sem
Prisma, sem I/O).

Consumido por: `Movimento de hoje`, `Linha do tempo — dia a dia`,
detalhamento diário e cenários. Não recalcula fluxo — compõe as MESMAS grids
canônicas de AR/AP que a Linha do tempo já usa.

### Dimensões por dia (disjuntas)

| Campo | O que soma | Data usada | Regra canônica |
|---|---|---|---|
| `receivableDue` | CR em aberto com vencimento no dia | `dueDate` | `sumOfficialArOpenDueByCivilDay` |
| `receivableReceived` | CR baixado no dia | `settlementDate` | motor oficial de recebido |
| `payableDue` | CP em aberto vencendo no dia | `operationalDueDate ?? dueDate` | `sumOfficialApOpenDueByCivilDay` |
| `payablePaid` | CP baixado no dia | `paymentDate → dueDate` (fallback canônico Nomus) | `resolveFinanceApEffectivePaymentDate` |
| `otherInflows`/`otherOutflows` | Ledger + transferências | `civilDate` do lançamento | fora do fluxo de título |

**Invariantes garantidos por construção (cobertos por teste):**
- Σ títulos da dimensão == total da dimensão do dia
- Dimensões AR/CP são disjuntas: um mesmo título nunca aparece em `Due` E em
  `Received/Paid` no mesmo dia (regra do saldo em aberto)
- Baixa parcial entra nas duas dimensões, com o valor certo em cada
  (`amountReceived`/`amountPaid` em Received/Paid, `balanceReceivable`/
  `balancePayable` em Due)
- Suspenso fora do fluxo Due, mas pago suspenso continua fato realizado
- Ausência = null explícito → UI mostra "—", nunca R$ 0,00 falso

### Agregados derivados

- `realizedInflows = receivableReceived + otherInflows`
- `realizedOutflows = payablePaid + otherOutflows`
- `projectedInflows = receivableDue`
- `projectedOutflows = payableDue`

### Saldo do dia

- `openingBalance` = fechamento REALIZADO do dia anterior
- `closingRealizedBalance = opening + realizedInflows − realizedOutflows`
- `closingProjectedBalance = closingRealized + projectedInflows − projectedOutflows`
  (não propaga na cadeia — projeção não vira "verdade" de saldo)

**Cadeia:** fechamento realizado de N-1 → abertura de N. Saldo inicial da
janela vem do último `realizedDay.closing` conhecido anterior ao primeiro dia
(reaproveita running-balance encadeado desde a gênese, zero consulta nova).

### Warnings tipados
- `NO_OPENING_BALANCE` — saldo inicial indisponível
- `PARTIAL_LOAD` — outras entradas/saídas parcialmente carregadas
- `OTHER_MOVEMENTS_NOT_LOADED` — ledger/transferência não carregados
  (rotina guiada só cobre HOJE por enquanto)

## 2. Política persistida — `TreasuryScenarioPolicy`

**Modelo Prisma:** `TreasuryScenarioPolicy` (singleton `id = "GLOBAL"`).
**Service:** `treasuryScenarioPolicyService.server.ts`.
**Auditoria:** `TreasuryAuditLog` (entityType `MODULE`, entityId
`SCENARIO_POLICY:GLOBAL`) com payload `before/after` e actor completo.

### Parâmetros iniciais (conservadores)

| Campo | Default | Efeito |
|---|---|---|
| `pessimisticEnabled` | `true` | Ligar/desligar a projeção pessimista com delay |
| `pessimisticReceivableDelayDays` | 15 | Atraso conservador aplicado a CR sem promessa firme/expected/confirmação |
| `pessimisticOverdueReceivableDelayDays` | null (usa 15) | Delay específico para CR vencido sem nova expectativa |
| `pessimisticTreatBrokenPromiseAsDelayed` | `true` | Promessa quebrada → aplica delay em vez de manter data original |
| `optimisticReceivableAdvanceLimitDays` | 0 | Sem antecipação artificial de CR (só usa datas registradas) |
| `optimisticPayableDelayLimitDays` | 0 | Sem postergação artificial de CP |
| `useCustomerBehaviorHistory` | `false` | Histórico desligado até haver fonte confiável |
| `useSupplierBehaviorHistory` | `false` | Idem |

### Segurança
- Update exige `canManage`/`SuperAdmin` (mesmo padrão de `TreasuryAlertSettings`).
- Cada update incrementa `version` e grava auditoria completa.
- Validação pura em `assertValidTreasuryScenarioPolicyPatch`: inteiro ≥ 0, ≤ 365.
- `getForEngine()` devolve defaults quando o singleton ainda não existir
  (setup local antes da migration rodar).

## 3. Motor dos 3 cenários — `computeTreasuryCaixaScenarios`

**Arquivo:** `src/lib/treasury/domain/treasuryCaixaScenarios.ts` (puro).
Reusa 100% do `treasuryMovementDateRules` (regras canônicas de data por
cenário `CONTRACTUAL/PROBABLE/CONFIRMED`).

### Mapeamento oficial

| Cenário spec | Regra AR | Regra AP |
|---|---|---|
| **Realista** | `PROBABLE` do movement engine (promessa ativa → expected → dueDate não vencido) | `PROBABLE` (schedule → expected → due) |
| **Otimista** | Data FAVORÁVEL MAIS CEDO entre promessa/expected/confirmed/due. Sem evidência = due (não antecipa) | Data FAVORÁVEL MAIS TARDIA entre schedule/expected/confirmed/due. Sem evidência = due (não posterga) |
| **Pessimista** | Promessa firme respeitada; vencido sem nova expectativa usa `pessimisticOverdueReceivableDelayDays` (fallback global); sem evidência aplica `pessimisticReceivableDelayDays`; promessa quebrada obedece `pessimisticTreatBrokenPromiseAsDelayed` | Data mais EXIGENTE (mais cedo) entre schedule/expected/due |

### Invariantes centrais
- Passado (dia < `asOfCivilDate`) IGUAL nos três cenários (só realized)
- Todos os cenários partem do MESMO saldo inicial
- Nenhum cenário projeta em data < asOf (clamp para hoje)
- Título sem saldo (balance ≤ 0) NÃO entra em cenário nenhum
- Baixa parcial: entra pelo saldo remanescente
- Política desligada → pessimista = contratual (dueDate rígido)
- Saldo encadeia por cenário: `closing(N-1) = opening(N)`

### Confiabilidade operacional
`HIGH` / `MEDIUM` / `LOW` calculada como razão entre valor com evidência
operacional (promessa/expected/scheduled/confirmed) e valor projetado total
no cenário Realista. Não é intervalo de confiança estatístico.

## 4. Endpoint único

**`GET /api/treasury/caixa/scenarios`**

Query params (todos opcionais):
- `asOfCivilDate` (default: hoje em SP)
- `horizonDays` (default: 90, teto: 365)
- `year`/`month`/`day` (delegado ao `getBoard` do Caixa)

**NÃO chama outro endpoint HTTP interno.** Consome:
- `createTreasuryCaixaService.getBoard()` para canonicalDays + AR/AP grids +
  saldo inicial (0 consultas novas ao banco)
- `createTreasuryScenarioPolicyService.getForEngine()` para os parâmetros
- Complementos operacionais (`TreasuryTitleOperationalComplement`) e
  promessas ativas (`TreasuryPaymentPromise`) — 2 consultas Prisma no total,
  filtradas por `externalId` dos títulos abertos

Guardrails: `requireAppAuth + moduleEnabled + viewOfficialReceivables +
viewOfficialPayables` (mesma auth do TREASURY_CAIXA_PATH).

## 5. Componente do gráfico — `TreasuryCaixaScenariosChart`

**Arquivo:** `src/components/finance/treasury/TreasuryCaixaScenariosChart.tsx`.

- 3 linhas (Otimista verde, Realista azul-destaque grosso, Pessimista vermelho)
  + faixa cinza "Intervalo de cenário" (área composta entre O/P)
- Tooltip por dia (dados do backend, sem cálculo no cliente)
- Cards de resumo por cenário: menor saldo, primeiro negativo, necessidade
  máxima de caixa, saldo final, diferença para o Realista
- Drill-down por dia+cenário: lista de títulos com regra aplicada
- Badge de confiabilidade (`HIGH/MEDIUM/LOW`) + painel expansível
  "Por que essa confiabilidade?" com motivos + versão da política
- Acessibilidade além da cor: legenda com nome, estilo de linha distinto,
  tooltip nomeando cenário

**"Intervalo de cenário" nunca é chamado de intervalo estatístico.**

## 6. Migrations
- `20260901120000_treasury_scenario_policy` — additiva pura: cria tabela +
  FK SetNull para AppUser + INSERT `ON CONFLICT DO NOTHING`. Rerun local
  não sobrescreve config.
- Não altera títulos, não faz backfill inventado.

## 7. Rollback conceitual
- Componente/rota/service podem ser removidos sem tocar em dados.
- Migration da política é aditiva; drop opcional, mas sem urgência (uma
  linha, não afeta motor de outras telas).
- Motor único-de-dia continua fonte canônica mesmo sem cenários — outras
  telas dependem dele agora.
