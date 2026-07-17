# DS-03.10 — Release candidate do stage de Documentos de Saída

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Escopo** | Integração do sync ao mecanismo oficial + revisão do stage DS-03 |
| **Data** | 2026-07-17 |
| **Ambiente** | Cursor local — **sem** acesso ao banco/servidor de produção |

---

## 1. Auditoria dos jobs existentes (antes da integração)

| Camada | Papel | Inclui Documentos de Saída? |
|---|---|---|
| `nomusSyncOrchestrator.ts` | Comercial sequencial (hard-fail): customers → products → BOM → proposals → sales-orders | **Não** (e não deve) |
| `runNomusDailySync.sh` | Diário de master-data (mesmo orquestrador) | **Não** |
| Runners por domínio (NF-e, AR, AP, pedidos) | Cron ~2h, lock próprio, soft-fail em overlap | **Não** (até DS-03.10) |
| `runNomusStockDocumentsSync.sh` | Shell + flock + logs | Existia; **sem cron** até DS-03.10 |

**Decisão:** integrar no **padrão financeiro por domínio** (como NF-e/AR), **não** no orquestrador comercial hard-fail.

---

## 2. Frequência e sequência finais

### Frequência oficial

```cron
23 */2 * * * INDUSCOST_APP_DIR=/opt/induscost /opt/induscost/scripts/runNomusStockDocumentsSync.sh apply >> /var/log/induscost-nomus-stock-documents-cron.log 2>&1
```

- **A cada 2 horas** — mesma cadência do ecossistema financeiro (NF-e `0 */2`, AR/AP `17 */2`).
- **Offset `23`** — evita colisão no mesmo minuto; **não inventa** cadência nova.
- Soft-fail: lock ocupado → `EXIT_CODE=0` / `SKIPPED` (não derruba outros syncs).

### Sequência operacional recomendada no servidor

1. Pedidos / NF-e / AR / AP (já existentes, independentes)
2. **Documentos de Saída** (este runner) — janela incremental
3. O2C rebuild / auditorias — **fora** deste sync (manual ou rotinas próprias)

Não há chamada duplicada ao mesmo endpoint Nomus: um único script TS por execução; um único cron para stock-documents.

### Incremental vs backfill

| Modo | Como | Automático? |
|---|---|---|
| Incremental | `NOMUS_STOCK_DOCUMENTS_INCREMENTAL=1` → janela a partir do checkpoint (`to − 7d` … hoje) ou lookback 14d | **Sim** (cron / Admin run) |
| Backfill amplo | `--from` / `--to` explícitos no CLI | **Somente manual** |
| Pontual | `--idNfe=` | Manual |

---

## 3. Revisão do stage (DS-03.1 → DS-03.10)

| Entrega | Artefato | Status RC |
|---|---|---|
| DS-03.1 Plano | `docs/output-documents/stage-remediation-plan.md` | ok |
| DS-03.2 Sync harden | `nomusStockDocumentsSyncLogic` — preserve itens em parcial | ok |
| DS-03.3 Schema | `NomusStockDocument` campos normalizados + migration | ok |
| DS-03.4 Mapper | `normalizeStockDocumentHeader` | ok |
| DS-03.5 Lifecycle | lock, IntegrationRun, checkpoint, completeness | ok |
| DS-03.6 Repair | preview/apply fill-only | ok (manual) |
| DS-03.7 Resolver | stage → NF/pedido/O2C/CR | ok |
| DS-03.8 Alocações | total uma vez; alocado por pedido | ok |
| DS-03.9 Financeiro | CR > documento > pedido | ok |
| DS-03.10 Integração | runner incremental + health + API | **este RC** |

### Checklist de aceite

- [x] Lock próprio (`/tmp/induscost-nomus-stock-documents.lock`)
- [x] Soft-fail em sobreposição (exit 0)
- [x] Logs próprios (`runner-stock-documents_*`)
- [x] Manual preservado (`npm run sync:nomus:stock-documents:*`)
- [x] Backfill somente manual
- [x] Sem orquestrador comercial / sem cron concorrente no mesmo endpoint
- [x] Health `stock-documents` (stale 2h)
- [x] API Admin: `GET/POST .../stock-documents-status|run`
- [ ] Cron instalado no servidor (operação — fora do Cursor)

---

## 4. Comandos

### Manual / preview

```bash
npm run sync:nomus:stock-documents:preview -- --from=2026-07-01 --to=2026-07-17
npm run sync:nomus:stock-documents:apply -- --from=2026-07-01 --to=2026-07-17
```

### Runner incremental (mesmo do cron)

```bash
./scripts/runNomusStockDocumentsSync.sh apply
# ou
npm run sync:nomus:stock-documents:runner:apply
```

### Backfill (manual)

```bash
npm run sync:nomus:stock-documents:apply -- --from=2025-01-01 --to=2026-07-17
```

### Testes aplicáveis

```bash
npm run test:nomus:stock-documents
npm run test:output-documents:resolver
npm run test:output-documents:allocation
npm run test:output-documents:financial-status
npm run test:output-documents:sync-integration
npm test
npm run build
```

---

## 5. Riscos remanescentes

- Cobertura real da janela incremental no servidor ainda depende da primeira execução + checkpoint.
- UI Admin card dedicada (opcional) — API já disponível; painel visual pode seguir depois.
- Comissões / `InventoryMovement` permanecem fora do stage (explícito no plano).
- Gate comercial de tela “Documentos de Saída” permanece pós-RC (fora de DS-03.10).
