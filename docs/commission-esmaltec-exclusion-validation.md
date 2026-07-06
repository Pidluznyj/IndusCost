# Validação — exclusão de comissão (ESMALTEC)

Documento operacional para validar o cenário **ESMALTEC não comissiona**.  
A regra **não está hardcoded** — deve ser cadastrada em **Comissões → Exceções por cliente** (`CommissionCustomerExclusionRule`).

---

## 1. Pré-requisito: cadastrar a regra

| Campo | Valor esperado (exemplo) |
|-------|--------------------------|
| Cliente | ESMALTEC (via autocomplete / `customerExternalId` Nomus) |
| Motivo | Ex.: _Política comercial — cliente corporativo sem comissão_ |
| Vigência inicial | `2026-01-01` |
| Vigência final | _(vazio = sem fim)_ |
| Status | ACTIVE |

**UI:** `/commissions/exclusoes-cliente` — permissão `commissions.rules.view`.

Após cadastro, novos cálculos e reprocessamentos passam a zerar comissão na data de referência (NF ou pedido).

---

## 2. Como validar (checklist)

| # | Pergunta | Como verificar |
|---|----------|----------------|
| 1 | Regra existe? | API/UI Exceções por cliente ou script de auditoria |
| 2 | UI cadastra ESMALTEC? | Modal CRUD + `CustomerAutocompleteFilter` |
| 3 | Motor aplica exclusão? | `commission-calculation-service` + metadata `customerExcluded` |
| 4 | Auditoria mostra motivo? | Colunas `motivoExclusao`, alerta `CLIENTE_SEM_COMISSAO` |
| 5 | Fechamento zera comissão? | PAYABLE — `payableCommissionTotal` ignora comissão liberada |
| 6 | Previsão zera comissão? | FORECAST — `expectedCommissionTotal` = 0 para linhas excluídas |
| 7 | Export mostra motivo? | CSV: `comissionavel`, `motivoExclusao`, `regraExclusaoId` |
| 8 | Reprocessamento tem preview? | `preview-commission-customer-exclusion-impact.ts` |
| 9 | AP/Nomus intactos? | Scripts read-only; motor não chama financeiro Nomus |
| 10 | Testes/build OK? | `npm run test:commissions`, `npm run build` |

---

## 3. Scripts de auditoria (read-only)

```bash
# Relatório completo do cliente no período
npx tsx scripts/audit-commission-customer-exclusion.ts \
  --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31

# JSON / CSV
npx tsx scripts/audit-commission-customer-exclusion.ts \
  --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31 --json

npx tsx scripts/audit-commission-customer-exclusion.ts \
  --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31 --csv

# Regenerar este doc a partir do banco (opcional)
npx tsx scripts/audit-commission-customer-exclusion.ts \
  --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31 --write-doc
```

Preview de impacto antes de reprocessar:

```bash
npx tsx scripts/preview-commission-customer-exclusion-impact.ts \
  --customer="ESMALTEC" --from=2026-01-01 --to=2026-12-31
```

Apply (somente após revisão):

```bash
npx tsx scripts/apply-commission-customer-exclusion-reprocess.ts \
  --rule-id=<UUID-da-regra> --from=2026-01-01 --to=2026-12-31 --apply --skip-closed-months
```

---

## 4. Impacto esperado

Para vendas ESMALTEC com regra vigente na data da NF/pedido:

| Métrica | Esperado |
|---------|----------|
| Pedido/NF/CR na auditoria | **Visíveis** |
| Base / valor vendido | **Preservados** |
| `ratePercent` / comissão | **0,00** |
| `releasedAmount` | **0,00** (após reprocessamento ou cálculo novo) |
| Status comissão | `SEM_COMISSAO` |
| Motivo | Texto da regra (`exclusionReason`) |
| Regra | `exclusionRuleId` no metadata / CSV |

### Impacto por mês

- **Referência NF/pedido:** agrupamento por `confirmedAt` ou data do pedido.
- **Settlement (fechamento):** agrupamento por `settlementDate` do CR — define em qual mês a comissão liberada seria paga (zero após exclusão).

> Valores reais dependem dos dados Nomus no período. Execute o script de auditoria com `DATABASE_URL` configurada.

---

## 5. Como aparece nas telas

### Auditoria Visual (`/commissions/auditoria`)

- Linha permanece com pedido, NF, CR, base rateada.
- `comissionavel` = NÃO.
- Comissão prevista/liberada = R$ 0,00.
- Alerta: _Cliente excluído de comissionamento — {motivo}_.

### Fechamento do mês (`/commissions`)

- Títulos baixados do cliente podem aparecer (valor recebido).
- **Comissão a pagar** no mês = R$ 0,00 para essas linhas.
- Card total de comissão liberada não inclui valor excluído.

### Previsão (`/commissions/previsao`)

- Títulos em aberto/futuros visíveis.
- Comissão prevista = R$ 0,00 (linhas com comissão zero podem ser omitidas do agrupamento, mas não geram valor a pagar).

### Export CSV

Colunas relevantes (Auditoria Visual):

- `comissionavel` → `NAO`
- `motivoExclusao` → motivo cadastrado
- `regraExclusaoId` → UUID da regra
- `comissaoPrevista` / `comissaoLiberada` → `0`

Script de auditoria CSV (`audit-commission-customer-exclusion.ts --csv`):

- `base_vendida`, `valor_recebido`, `comissao_atual`, `comissao_apos`, `motivo`, `regra_id`

---

## 6. Validação automatizada (CI)

Testes em `commissionCustomerExclusionAudit.test.ts` usam fixture **genérico** (`CLIENTE EXCLUIDO SA`) — sem hardcode de ESMALTEC no código:

- Fechamento mensal → comissão liberada zero
- Previsão → comissão prevista zero
- Apuração GENERATED → comissão prevista zero
- Export CSV contém `motivoExclusao` e motivo da regra

---

## 7. Limitações

1. **Regra no cadastro** — ESMALTEC só zera comissão se a regra ACTIVE existir com vigência correta.
2. **Histórico** — registros calculados antes da regra exigem **reprocessamento** explícito.
3. **Registros pagos** — podem ficar bloqueados se `paidCommissionBlockAutoChange` estiver ativo.
4. **Fechamento** — status derivado de `CommissionPaymentBatch`; não há entidade persistida de “mês fechado”.
5. **Previsão** — linhas com comissão 0 podem não entrar no agrupamento FORECAST, mas não geram pagamento.
6. **Ambiente local** — scripts CLI requerem PostgreSQL (`DATABASE_URL`).

---

## 8. Referência técnica

| Componente | Arquivo |
|------------|---------|
| Cadastro regra | `commissionCustomerExclusionRules.server.ts` |
| Motor cálculo | `commission-calculation-service.server.ts` |
| Metadata exclusão | `commissionCustomerExclusionApply.ts` |
| Auditoria visual | `commissionVisualAudit.ts` |
| Preview/reprocess | `commissionCustomerExclusionReprocess*.ts` |
| Script auditoria | `scripts/audit-commission-customer-exclusion.ts` |

---

_Última revisão: fluxo de validação documentado. Para impacto numérico real, executar auditoria contra banco de produção/homologação._
