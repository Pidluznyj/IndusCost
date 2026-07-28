# Arquitetura — Central de Tesouraria

## 1. Posicionamento

A Tesouraria é um **domínio novo** no IndusCost, separado de:

| Domínio existente | Papel | Relação com Tesouraria |
|-------------------|-------|------------------------|
| Nomus CR/CP (`NomusAccountsReceivable` / `Payable`) | Fonte oficial de títulos e baixas | Leitura via adapter; **sem cópia integral** |
| Fluxo de Caixa (`/finance/cash-flow`) | Projeção AR+AP gerencial | **Não** recalcula nem substitui |
| Conciliação de Carteira (O2C) | Pedido/NF/carteira | **Não** é conciliação bancária |
| Faturamento / pedidos / NF-e | Comercial/fiscal | Leitura contextual mínima; **não** soma como caixa |

## 2. Fronteira oficial vs local

```text
[OFICIAL — só leitura pela Tesouraria]
  NomusAccountsReceivable / NomusAccountsPayable
  Baixas agregadas no título (amountReceived/Paid, settlementDate)
  Sync Nomus (NomusSourceSyncRun / scripts)

[LOCAL — escrita Tesouraria]
  Contas financeiras, saldos, ledger, transferências
  Complementos (expectativa, promessa, cobrança, disputa, programação)
  Projeção persistida, exceções, alertas, fechamento
  OFX / movimentos bancários / matches de conciliação
  Auditoria append-only
```

## 3. Camadas de código

```text
src/components/finance/treasury/     UI (client-safe)
src/lib/treasury/contracts/          DTOs, enums, parsers (sem Prisma)
src/lib/treasury/domain/             Regras puras
src/lib/treasury/adapters/           Leitura Nomus
src/lib/treasury/mappers/            Row ↔ DTO
src/lib/treasury/repositories/       Persistência Prisma / memory
src/lib/treasury/services/           Casos de uso (+ .server.ts)
src/lib/treasury/controllers/        HTTP handlers
src/lib/treasury/treasuryRoutes.ts   Registro Express (fora de server.ts)
```

**Guardrails:** `check:frontend-server-imports` — UI não importa Prisma/server.

## 4. Fluxo de requisição

1. `requireAppAuth` (cookie de sessão).
2. `requireTreasuryModuleEnabled` (flag mestra fail-closed).
3. Subflag do domínio (quando aplicável).
4. `requireResource(resourceKey, action)` — backend é autoridade.
5. Controller → service → repository / regras puras.
6. Ações críticas → `writeTreasuryAuditLog` (append-only).
7. Mutações que afetam caixa → enqueue de recálculo de projeção (fila PostgreSQL).

## 5. Money e datas

| Tema | Padrão |
|------|--------|
| Persistência | Prisma `Decimal(20,2)` |
| DTO / API | string decimal (`"1234.56"`) |
| Kit | `treasuryMoney.ts` — sem float nativo em cálculos críticos |
| Data civil | `YYYY-MM-DD`, helpers `financeCivilDate` / contratos Tesouraria |
| Fuso operacional | `America/Sao_Paulo` |
| Timestamp | ISO com offset |

## 6. UI

Shell: `TreasuryModule` sob `/finance/treasury`.  
Abas: ver `treasuryFeatureUi.ts` (`TREASURY_UI_SECTIONS`).  
Padrões: Overlay/drawer, estados loading/vazio/erro/sem permissão, money pt-BR.

## 7. Integrações

| Integração | Direção | Notas |
|------------|---------|-------|
| Sync Nomus AR/AP | Entrada | Após SUCCESS + mudanças → hook de recalc |
| OFX | Entrada arquivo | Preview token → apply idempotente |
| Relatórios | Saída | CSV/XLSX/PDF locais |
| Backfill complementos | Ops CLI | `backfill:treasury:title-complements:*` |

## 8. O que a arquitetura proíbe

- Segunda base espelhando títulos Nomus.
- Somar pedido + NF + título + previsão como receitas distintas.
- Somar previsão e realização do mesmo título.
- Transferência interna alterando caixa consolidado.
- Substituir vencimento oficial na UI/API.
- `prisma db push` / `migrate dev` em produção.
- Deploy/alteração de `.env` pelo Cursor.
