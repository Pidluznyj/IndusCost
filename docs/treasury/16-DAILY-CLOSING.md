# Fechamento diário — Central de Tesouraria

UI: `/finance/treasury/closing`  
API: `/api/finance/treasury/daily-closing*`  
Flag: `treasury.dailyClosing.enabled`  
Código: serviços/regras `treasuryDailyClosing*`.

## 1. Conceito

Fechamento **versionado e imutável** por `companyCode` + `civilDate` + `version`.

| Status | Significado |
|--------|-------------|
| `OPEN` | Rascunho/em preparação (quando existir) |
| `CLOSED` | Congelado; payload/hash imutáveis |
| `REOPENED` | Marcador histórico; reabertura cria **nova** versão |

Reabertura **não** edita in-place o fechamento CLOSED anterior.

## 2. Preview (obrigatório antes de fechar)

`GET /daily-closing/preview`

Retorna:
- posição resumida;
- gates (bloqueios absolutos × ressalvas);
- `sourceHash` (mudança de fonte → conflito 409 no close);
- `canClose*` / lista de caveats necessários.

## 3. Gates

### Bloqueios absolutos (`TREASURY_DAILY_CLOSING_ABSOLUTE_BLOCK_CODES`)
Impedem fechar mesmo com ressalva:
- `DAY_ALREADY_CLOSED`
- `MISSING_OBSERVED_BALANCE`
- `NEGATIVE_BALANCE_FORBIDDEN`
- `SOURCE_DATA_UNAVAILABLE`
- `OPEN_SUSPECTED_DUPLICATE`

### Exigem ressalva explícita (`TREASURY_DAILY_CLOSING_CAVEAT_REQUIRED_CODES`)
- `RECONCILIATION_DIFFERENCE`
- `STALE_BALANCE`
- `EXPIRED_PROMISE`
- `TRANSFER_IN_TRANSIT`
- `PENDING_RECEIVABLE` / `PENDING_PAYABLE`
- `UNRECONCILED_MOVEMENT`
- `ACCOUNT_BELOW_MINIMUM`
- `SYNC_DELAYED`

### Avisos (não bloqueiam)
- `PENDING_RECEIVABLE_FUTURE` / `PENDING_PAYABLE_FUTURE`
- `BALANCE_NEAR_MINIMUM`

## 4. Close / reopen

| Ação | Endpoint | Permissão |
|------|----------|-----------|
| Fechar | `POST /daily-closing` | `finance.treasury.closing` `close` |
| Reabrir | `POST /daily-closing/:id/reopen` | `reopen` |
| Listar/obter | `GET /daily-closing`, `GET …/:id` | `view` |

Close usa lock advisory empresa+data; rate limit crítico.

## 5. Pós-fechamento

Mudanças financeiras posteriores **não** reescrevem o CLOSED.  
Detecção: exceção `FINANCIAL_CHANGE_AFTER_CLOSING` (alias pós-fechamento) — tratamento formal / reabertura.

## 6. Congelamento

Filhos persistidos no close:
- posições por conta;
- pendências;
- exceções;
- caveats;
- hashes `sourceHash` / `contentHash`.

## 7. Checklist operacional

Ver guia: [manuals/GUIDE-DAY-CLOSING.md](./manuals/GUIDE-DAY-CLOSING.md).
