# Regras de negócio — Central de Tesouraria

Regras implementadas em `src/lib/treasury/domain/**`. Este documento resume o comportamento obrigatório.

## 1. Títulos oficiais

1. CR/CP oficiais vivem em `NomusAccountsReceivable` / `NomusAccountsPayable`.
2. Tesouraria **não** faz upsert/delete nesses models.
3. `dueDate` oficial é imutável na Tesouraria.
4. Expectativa, promessa e programação são overlays locais.
5. Cancelamento oficial = presença/origem (ex.: `sourceRemovedAt` / lifecycle), não “esconder” título vencido.

Detalhe do adapter: [05-OFFICIAL-AR-AP-ADAPTER.md](./05-OFFICIAL-AR-AP-ADAPTER.md).

## 2. Saldos e posição

Camadas distintas (nunca fundidas silenciosamente):

| Camada | Significado |
|--------|-------------|
| Observado | Snapshot manual/OFX/fechamento |
| Calculado | Observado ± movimentos oficiais posteriores (quando aplicável) |
| Conciliado | Após match bancário |
| Divergência | `observado − calculado` — **sempre explícita** |

Contas com `includeInConsolidated=false` não entram no consolidado.

## 3. Previsto × realizado

- Previsto: overlays/agenda/programação/projeção por cenário.
- Realizado: baixas Nomus e/ou movimentos conciliados.
- **Proibido** somar previsto + realizado do mesmo título (`externalId`).
- Endpoint explícito: `GET /api/finance/treasury/forecast-vs-actual` (`doesNotSumForecastAndActual: true`).

## 4. Promessas, cobrança, contestações

| Recurso | Regras-chave |
|---------|--------------|
| Promessa | Não altera `dueDate` nem saldo oficial; status ACTIVE/FULFILLED/…; cancelamento lógico |
| Cobrança | Append-only; cancelamento lógico; timeline no drawer CR |
| Contestação | Não zera `balance*`; status OPEN/RESOLVED/CANCELLED |

## 5. Programação de pagamentos (CP)

- Intenção local (`scheduledDate` / `scheduledAmount` / conta / prioridade).
- Parcial permitido; saldo aberto preservado.
- Não altera vencimento oficial.
- Radar de vencimentos ≠ programação Tesouraria.

## 6. Transferências

1. Duas pernas lógicas (origem/destino) com `transferGroupId`.
2. Impacto no **consolidado = 0**.
3. Em trânsito enquanto status `SENT`.
4. Cancelamento gera trilha auditada (sem delete).

## 7. Lançamentos manuais

1. Natureza de criação via API: `MANUAL` ou `ADJUSTMENT`.
2. Reversão cria lançamento `REVERSAL` oposto e marca original `REVERSED`.
3. Sem exclusão física.
4. Não pode simular baixa oficial Nomus.
5. Dia `CLOSED` bloqueia novos lançamentos/reversões naquela data civil.

## 8. Exceções e alertas

- Exceções: upsert por `uniqueKey`; auto-resolve só quando seguro.
- Alertas: regras determinísticas + `TreasuryAlertSettings`; sem push/e-mail nesta versão.
- Divergência de saldo **não** é auto-fechada.

## 9. Fechamento

Ver [16-DAILY-CLOSING.md](./16-DAILY-CLOSING.md).

## 10. OFX / conciliação

Ver [17-OFX-AND-RECONCILIATION.md](./17-OFX-AND-RECONCILIATION.md).

## 11. Projeção / dupla contagem

Ver [15-PROJECTION-AND-DOUBLE-COUNTING.md](./15-PROJECTION-AND-DOUBLE-COUNTING.md).
