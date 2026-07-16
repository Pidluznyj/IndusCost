# T03 — Backfill fiscal histórico (XML → Summary/Lines)

**Atualizado:** 2026-07-16  
**Depende de:** T02 (`NomusNfeFiscalSummary` / `NomusNfeTaxLine` + parser `nfe-xml-fiscal-v1`)

## Comandos futuros

```bash
# Dry-run / preview (não grava)
npm run backfill:nomus:nfe-fiscal:dry
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run --limit=500 --out=tmp/nfe-fiscal
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --preview --order="PD 02457"
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --dry-run --from=2025-01-01 --to=2025-12-31 --customer=60878889

# Auditoria de inconsistências
npm run backfill:nomus:nfe-fiscal:audit
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --audit --out=tmp/nfe-fiscal-audit

# Apply (exige --confirm-apply; NÃO produção sem revisão)
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --limit=100 --batch=50
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --force   # reparse mesma versão
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --only-missing

# Resume
npx tsx scripts/nomus-nfe-fiscal-backfill.ts --apply --confirm-apply --resume=tmp/run.resume.json --write-resume
```

Atalho legado: `npm run reparse:nomus:nfe-fiscal` → encaminha para o script T03 (default dry-run).

## Relatórios

| Artefato | Conteúdo |
|----------|----------|
| `*.json` | Inventário, totais por tributo HEADER, residuals, findings, rows (sem parse completo) |
| `*.csv` | Uma linha por NF (classes, action, vNF, taxes, pedidos, flags de auditoria) |
| `*.resume.json` | Cursor `lastExternalId` + contadores |

### Dry-run mostra

- XMLs analisáveis / ausentes / inválidos  
- Já processados (mesmo `xmlHash` + `parserVersion`) / stale parser / needs persist  
- Canceladas  
- Totais por tributo (HEADER)  
- Diferenças residual (`vNF` − componentes)  
- Pedidos afetados + watch list (02457 / 02139 / 02072)  
- Divergências (findings)

### Findings de auditoria

| Código | Significado |
|--------|-------------|
| `WATCH_ORDER` | PD 02457 / 02139 / 02072 |
| `NF_GT_ORDER` | vNF > líquido do pedido |
| `TAX_NO_COMPOSITION` | Diferença sem tributos no header |
| `NF_MULTI_ORDER` | NF em mais de um pedido |
| `DUPLICATE_CHAVE` | Mesma chave em vários externalId |
| `CANCELLED_WITH_CR` | Cancelada com CR (`sourceInvoiceId`) |
| `MISSING_XML` | Sem `xmlRaw` |

## Garantias

- Idempotente (skip se hash+versão iguais, salvo `--force`)  
- Lotes (`--batch`) + transação **por NF**  
- Retomável (`--resume` / `--write-resume` / `--after-external-id`)  
- **Não** modifica `xmlRaw`, SalesOrder, CR, comissão  
- Só grava `NomusNfeFiscalSummary` / `NomusNfeTaxLine`

## Rollback

```sql
DELETE FROM "NomusNfeFiscalSummary" WHERE "nomusNfeId" IN (...ids do relatório apply...);
-- NomusNfeTaxLine cascateia
```

## Riscos

- Apply em produção sem dry-run pode gravar milhares de linhas de uma vez — use `--limit` e resume.  
- NF sem XML só aparece como finding; não inventa imposto.  
- Não somar HEADER+ITEM nos KPIs.

## Testes

- `src/lib/nfeFiscalBackfill.test.ts`  
- `src/lib/nfeFiscalBackfill.server.test.ts`  
- `npm run test:nomus:nfes`
