# T02 — Extração e persistência fiscal do XML (implementação)

**Atualizado:** 2026-07-16  
**Base:** [tax-data-target-model.md](./tax-data-target-model.md)

## Entregue

| Peça | Path |
|------|------|
| Modelos | `NomusNfeFiscalSummary`, `NomusNfeTaxLine` em `prisma/schema.prisma` |
| Migration | `prisma/migrations/20260726180000_nomus_nfe_fiscal_summary_lines/` |
| Parser | `src/lib/nfeFiscalXmlParser.ts` (`nfe-xml-fiscal-v1`) |
| Persistência | `src/lib/nfeFiscalPersist.ts` |
| Fixture PD 02457 | `src/lib/nfeFiscalFixtures.ts` |
| Sync hook | `scripts/nomusNfesSync.ts` → `ensureNomusNfeFiscalPersisted` |
| Backfill | `scripts/reparseNomusNfeFiscal.ts` (`npm run reparse:nomus:nfe-fiscal`) |

## Regras

- XML original permanece em `NomusNfe.xmlRaw`.
- Valores oficiais do XML — sem recalcular por alíquota.
- HEADER e ITEM coexistem; **não somar os dois** no mesmo KPI.
- `highlightedResidual` ≠ saldo financeiro.
- Cancelada: `isCancelled=true`, tributos ainda persistidos.
- Idempotência: `xmlHash` + `parserVersion`.

## Migration

Versionada no repo. **Não** aplicar em produção neste prompt. Em ambiente isolado: `npx prisma migrate deploy` (com `DATABASE_URL` do isolado).
