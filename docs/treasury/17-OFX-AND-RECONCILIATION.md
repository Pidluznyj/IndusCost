# OFX e conciliação bancária

UI: `/finance/treasury/bank-movements`, alias `/finance/treasury/ofx`, workspace `/finance/treasury/reconcile`  
Flags: `treasury.ofxImport.enabled`, `treasury.reconciliation.enabled`.

## 1. Importação OFX

### Fluxo
1. **Preview** `POST /bank-imports/ofx/preview` (multipart `file`)  
   - Valida tamanho (limite OFX), MIME, parse OFX1/OFX2.  
   - Classifica linhas NEW / DUPLICATE / INVALID.  
   - Emite token temporário (TTL `TREASURY_OFX_PREVIEW_TOKEN_TTL_SECONDS`, 15 min).  
   - **Não** grava movimentos ainda.
2. **Apply** `POST /bank-imports/ofx/apply`  
   - Consome token; cria `TreasuryBankImportBatch` + `TreasuryBankMovement`.  
   - Idempotente por `fileSha256` / fingerprint.  
   - Audita IMPORT; enfileira recalc; gera sugestões (sem auto-match).

### Segurança
- Arquivo temporário + hash; sem persistir raw OFX permanente.
- Rate limit em preview/apply.
- Logs sem payload sensível completo.

## 2. Movimentos bancários

Model: `TreasuryBankMovement`  
Status de conciliação: `PENDING` \| `PARTIAL` \| `MATCHED` \| `UNMATCHED` \| `IGNORED`.

Listagem: `GET /bank-movements`, detalhe `GET /bank-movements/:id`.  
Lotes: `GET /bank-imports`.

## 3. Motor de sugestões

`domain/treasuryReconciliationSuggestionEngine.ts`  
Critérios: valor, documento, CNPJ/CPF, data, nome, histórico, direção.  
Faixas HIGH / MEDIUM / LOW — **nunca** auto-confirma.

## 4. Match / alocações

Service: `treasuryReconciliationMatchService.server.ts`

| Ação | Endpoint | Permissão |
|------|----------|-----------|
| Accept | `POST /reconciliations` | reconciliation `manage` |
| List por movimento | `GET /reconciliations?bankMovementId=` | view |
| Get | `GET /reconciliations/:id` | view |
| Unmatch | `POST /reconciliations/:id/unmatch` | manage |
| Reverse | `POST /reconciliations/:id/reverse` | reverse `execute` + frase `REVERTER` |

Suporta 1:1, 1:N, N:1; parcial; fee/juros/desconto/diferença/unidentified/transfer/manual.  
**Não** baixa título Nomus.

## 5. Workspace

`GET /reconcile/workspace` — resumo de pendentes/não conciliados/matches + amostra de movimentos.  
UI: `/finance/treasury/reconcile`.

## 6. Diferença vs Conciliação de Carteira

| | Bancária (Tesouraria) | Carteira (O2C) |
|--|----------------------|----------------|
| Objeto | Extrato OFX ↔ ledger/títulos | Pedido/NF/carteira |
| Models | `TreasuryBank*` / `TreasuryReconciliation*` | `PortfolioReconciliation*` |
| Mutação Nomus | Não | Não (outro domínio) |

## 7. Guia do usuário

[manuals/GUIDE-RECONCILIATION.md](./manuals/GUIDE-RECONCILIATION.md).
