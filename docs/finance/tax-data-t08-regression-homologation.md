# T08 — Regressão fiscal completa · Deploy e homologação

**Atualizado:** 2026-07-16  
**Escopo:** T01–T07 (parser → persistência → backfill → PV Tributos → apuração/guias/AP/alocação → inteligência)  
**Regra:** este documento é operacional. **Não executar no servidor de produção** a partir deste prompt — só após revisão humana.

## 0. Resultado da regressão local (pré-RC)

| Check | Resultado |
|-------|-----------|
| `npx prisma validate` (com `DATABASE_URL` local/dummy de schema) | OK |
| `prisma migrate deploy` em banco isolado | Não executado aqui — exige URL isolada (ver §3.3) |
| `npm run test:finance:fiscal-regression` | OK (parser, persist, backfill, PV Tributos, settlements, inteligência, T08) |
| `orderFiscalFinancialMetrics` | OK |
| `npm run test:finance:accounts-payable` | OK |
| `npm run test:permission-contract` | OK |
| `check:frontend-server-imports` / `check:server-imports` / `check:browser-bundle` | OK |
| `npm test` | OK |
| `npm run build` | OK |

**Commits âncora T01–T07 (ancestrais de `main`):**

| Task | Hash (prefixo) | Assunto |
|------|----------------|---------|
| T01 | `4de802e` | docs audit + target model |
| T02 | `e1d85de` | persist structured NF-e fiscal taxes |
| T03 | `9560473` | historical XML backfill |
| T04 | `524cc3b` | aba Tributos PV / Auditoria 360 |
| T05 | `054c578` | apuração, guias, alocação |
| T06 | `8b97893` | settlements na aba Tributos |
| T07 | `dbbe742` | inteligência tributária + XLSX + drill |

## 1. Critérios de aceite (não declarar RC com falha)

| Critério | Esperado |
|----------|----------|
| Imposto ≠ saldo financeiro | Residual / diferença NF não vira CR |
| Residual ≠ imposto automático | `highlightedResidual` só auditoria |
| NF cancelada fora de totais válidos | Contadores `cancelled*` separados |
| Destacado ≠ pago | Labels A ≠ C |
| Pagamento só com guia/baixa/evidência/AP | Camada C |
| Alocação gerencial | `isManagerialOnly` / disclaimer D |
| Sem soma HEADER+ITEM | KPIs usam um escopo |
| Parser / backfill idempotentes | `xmlHash` + `parserVersion` |
| AP / Pedido / NF / CR preservados | Backfill não altera ledgers |
| Build + testes verdes | Ver §0 e §4 |

## 2. Migrations fiscais (repo)

| Migration | Conteúdo |
|-----------|----------|
| `20260726180000_nomus_nfe_fiscal_summary_lines` | `NomusNfeFiscalSummary` / `NomusNfeTaxLine` |
| `20260727120000_fiscal_apuration_guides_allocations` | Apuração, guia, proof, allocation, audit |

## 3. Comandos de servidor (roteiro — NÃO executar aqui)

### 3.1 Backup

```bash
# Exemplo PostgreSQL — ajustar host/db/user
pg_dump -Fc -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f "backup_induscost_$(date +%Y%m%d_%H%M%S).dump"
# Guardar também cópia de .env / secrets fora do dump se política exigir
```

### 3.2 Checagem de sync Nomus (pré-migration)

```bash
# Status recente de sync NF-e / AP (rotas internas ou logs do job)
# Confirmar que xmlRaw está populado nas NFs-alvo (02457, 02139, 02072)
npm run backfill:nomus:nfe-fiscal:dry -- --preview --order="PD 02457"
```

### 3.3 Migration (somente após backup)

```bash
# Validar schema (requer DATABASE_URL no ambiente do servidor)
npx prisma validate
npx prisma migrate deploy
npx prisma generate
```

**Banco isolado (homologação / CI):** apontar `DATABASE_URL` (ou URL dedicada) para um database **não produção**, por exemplo `induscost_t08_isolated`, rodar `migrate deploy`, depois repetir smoke. Nunca usar credencial de produção neste passo de ensaio.

### 3.4 Backfill fiscal (preview → apply)

```bash
# Preview / dry-run
npm run backfill:nomus:nfe-fiscal:dry
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --preview --order="PD 02457"
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run --limit=500 --out=tmp/nfe-fiscal-t08

# Apply controlado
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --limit=100 --batch=50 --out=tmp/nfe-fiscal-t08-apply
```

### 3.5 Build e restart

```bash
npm run check:frontend-server-imports
npm run check:server-imports
npm run build
npm run check:browser-bundle
# restart do processo Node/PM2/serviço conforme runbook do ambiente
```

### 3.6 Smoke tests pós-deploy

1. Login com perfil `taxes.view` / `finance.tax_apuration.view`.  
2. Abrir **PD 02457** → aba Tributos: produtos 3975, IPI 129,19, vNF 4104,19; labels Destacado ≠ Apurado ≠ Pago ≠ Alocado.  
3. Abrir **PD 02139** e **PD 02072** (watch list): sem inventar imposto; a faturar coerente.  
4. Pedido sem NF: resumo vazio / a faturar = ativo.  
5. Financeiro > Tributos > Apuração e guias: criar/listar guia; pagamento parcial; comprovante.  
6. Inteligência fiscal: filtro período + export XLSX; drill período→tributo→guia.  
7. Confirmar NF cancelada **não** entra em totais válidos.  
8. Confirmar AP vinculado à guia reflete pago oficial (sem ledger paralelo).

## 4. Suíte de regressão local (CI / pré-push)

```bash
# Schema (precisa DATABASE_URL no shell)
npx prisma validate
# Migration em banco isolado (DATABASE_URL do isolado — nunca produção):
#   npx prisma migrate deploy

npm run test:nomus:nfes
npm run test:finance:fiscal-regression
npx tsx --test src/lib/sales/orderFiscalFinancialMetrics.test.ts
npm run test:finance:accounts-payable
npm run test:permission-contract
npm run check:frontend-server-imports
npm run check:server-imports
npm run check:browser-bundle
npm test
npm run build
```

Script agregado: `npm run test:finance:fiscal-regression`.

## 5. Homologação — checklist de casos

| Caso | Onde validar |
|------|----------------|
| PD 02457 | Fixture + aba Tributos + backfill watch |
| PD 02139 / 02072 | Watch list + métricas pedido/NF |
| Pedido sem NF | `salesOrderFiscalTaxes` |
| NF parcial / várias NFs | Auditoria 360º / aba Tributos |
| NF cancelada | Fora de totais válidos |
| Devolução finNFe=4 | Parser |
| IPI / ICMS-ST / FCP / PIS / COFINS | Parser + HEADER |
| Guia sem pagamento | Status ISSUED |
| Pagamento parcial / juros / multa / compensação | Settlement client/service |
| Múltiplos pedidos por guia | Alocações gerenciais |
| XML sem tributos / campo novo (IBS/CBS) | Parser extensible |
| Relatórios | Inteligência fiscal + XLSX |
| Permissões / auditoria | Contract + settlement audit log |

## 6. Rollback

### 6.1 Dados de backfill (camada A)

```sql
-- Somente IDs do relatório apply; TaxLine cascateia com Summary
DELETE FROM "NomusNfeFiscalSummary"
WHERE "nomusNfeId" IN (/* ids do apply */);
```

### 6.2 Apuração / guias (camadas B–D)

```sql
-- Ordem: allocations → proofs → guides → lines → periods (+ audit se política exigir)
DELETE FROM "FiscalAllocation" WHERE ...;
DELETE FROM "FiscalPaymentProof" WHERE ...;
DELETE FROM "FiscalPaymentGuide" WHERE ...;
DELETE FROM "FiscalApurationLine" WHERE ...;
DELETE FROM "FiscalApurationPeriod" WHERE ...;
```

### 6.3 Schema

- Preferir restore do `pg_dump` (§3.1) se migration precisar ser revertida.  
- **Não** dropar tabelas fiscais em produção sem restore testado.  
- AP Nomus, SalesOrder, CR e `xmlRaw` **não** são alterados pelo backfill — não precisam rollback fiscal.

## 7. Artefatos de código (T01–T07)

- Parser/persist/backfill: `src/lib/nfeFiscal*.ts`, migrations `20260726*`  
- PV Tributos: `src/lib/sales-orders/salesOrderFiscalTaxes*`  
- Settlements: `src/lib/finance/fiscalSettlement*` + migration `20260727*`  
- Inteligência: `src/lib/finance/fiscalTaxIntelligence*` + UI `FiscalTaxIntelligencePanel`  
- Regressão: `src/lib/finance/fiscalRegression.t08.test.ts` + `npm run test:finance:fiscal-regression`
