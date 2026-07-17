# SYNC-09 — Observabilidade da reconciliação Nomus

| | |
|---|---|
| **Projeto** | IndusCost / My Industry |
| **Ticket** | SYNC-09 |
| **Pré-requisitos** | SYNC-01…08 |
| **Atualizado** | 2026-07-17 |

---

## Checklist

| # | Pergunta | Decisão |
|---|----------|---------|
| 1 | Já existe painel de sincronizações? | **Sim** — Settings → hub Nomus Sync |
| 2 | Já existe API de runs? | IntegrationRun sim; **NomusSourceSyncRun** era write-only → agora com GET |
| 3 | Estender sem módulo paralelo? | **Sim** — card + rotas no hub existente |
| 4 | Dados sensíveis protegidos? | Sem `rawPayload` / tokens; `sanitizeObservabilitySummaryJson` |
| 5 | Métricas dos runs oficiais? | **Sim** — somente `NomusSourceSyncRun` |

---

## APIs

| Método | Path | Permissão |
|--------|------|-----------|
| GET | `/api/settings/nomus-sync/source-reconciliation-status` | `admin.settings.nomus_sync` **view** |
| GET | `/api/settings/nomus-sync/source-reconciliation-records` | idem |

Alertas **nunca** confirmam ausência (`confirmsAbsence: false`).

---

## UI

`NomusSourceReconciliationObservabilityCard` no Settings (abaixo AR/AP sync cards).

Frontend só apresenta DTO — sem regras de lifecycle.

---

## Código

| Peça | Path |
|------|------|
| Pure | `src/lib/nomus/nomusSourceReconciliationObservability.ts` |
| Server | `src/lib/nomus/nomusSourceReconciliationObservability.server.ts` |
| Routes | `src/lib/settingsNomusSyncRoutes.ts` |
| Card | `src/components/NomusSourceReconciliationObservabilityCard.tsx` |
