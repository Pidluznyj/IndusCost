# T01 — Plano de exibição fiscal no detalhe do Pedido de Venda

**Atualizado:** 2026-07-16  
**Status:** plano de UX/dados — **sem implementação** neste prompt  
**Base:** [tax-source-of-truth.md](./tax-source-of-truth.md), [tax-data-target-model.md](./tax-data-target-model.md), [order-nfe-cr-financial-separation.md](./order-nfe-cr-financial-separation.md)

## 1. Objetivo

No detalhe do Pedido de Venda (e na Auditoria 360º alinhada), mostrar tributos de forma que o usuário **nunca** confunda:

- o que a NF destacou,
- o que a empresa apurou no período,
- o que foi pago em guia,
- o que foi alocado gerencialmente ao pedido.

## 2. Layout proposto (quatro blocos)

```
┌─ Pedido PD ##### ─────────────────────────────────────────┐
│ Totais comerciais (já existem): líquido, frete,           │
│   “Impostos comerciais (pedido)” = SalesOrder.totalTaxes  │
│   [badge: estimado/comercial — não é NF]                  │
├─ A. Destacados nas NFs vinculadas ────────────────────────┤
│   Por NF: número | vProd | vNF | breakdown ou residual    │
│   Soma A (NFs válidas)                                    │
├─ B. Apurado (período) — se houver vínculo ────────────────┤
│   “Não disponível” até F4, ou link para período           │
├─ C. Recolhido (guias) ────────────────────────────────────┤
│   “Não disponível” até F3                                 │
├─ D. Alocado a este pedido ────────────────────────────────┤
│   “Não disponível” até F4; depois lista de alocações      │
└───────────────────────────────────────────────────────────┘
```

### Regras de UI

1. Labels **explícitos**: “Destacados (NF)”, “Apurado (período)”, “Recolhido (guia)”, “Alocado (gerencial)”.  
2. Tooltip no agregado legado: *“Diferença vNF − produtos; pode incluir frete/encargos; não é imposto pago.”*  
3. Nunca somar A+B+C+D num único KPI “Impostos”.  
4. NF cancelada: aparece na lista A com status, **fora** dos totalizadores válidos (já é regra O2C).

## 3. Superfícies impactadas (futuro)

| Superfície | Hoje | Alvo |
|------------|------|------|
| `SalesOrdersModule` detalhe | `totalTaxes` comercial | + bloco A; badges |
| Relatório / XLSX PV | “Impostos destacados NF” | Manter nome; detalhar colunas por taxCode quando F2 |
| Auditoria 360º NF tab | `highlightedTaxesValue` + item JSON | Preferir `NfeTaxLine` |
| `/taxes` | Regras % | Renomear mentalmente “Configuração fiscal de precificação” (já shell “Configuração Fiscal”) — não misturar com A–D |
| Financeiro Contas a Pagar | Genérico | Filtro futuro `guideType` |

## 4. Matriz campo → exibição no pedido

| Campo / conceito | Origem | Disponível hoje | Header/item | Oficial/estimado | Migration | Backfill | Exibição no detalhe do pedido |
|------------------|--------|-----------------|-------------|------------------|-----------|----------|-------------------------------|
| totalTaxes pedido | SalesOrder | sim | pedido | comercial | — | — | Bloco comerciais, badge “comercial” |
| xmlVNF | NomusNfe | sim | H | oficial | — | — | Coluna Total NF no bloco A |
| valorLiquido | NomusNfe | sim | H | oficial produtos | — | — | Coluna Produtos |
| highlighted residual | derivado | sim | H | aproximação A | F2 preferir linhas | — | “Destacados (agregado)” com caveat |
| vIPI / vICMS / … | XML | só xmlRaw | H/I | oficial A | F1 summary/lines | reparse | Colunas/chips por tributo |
| vFrete | XML | só xmlRaw | H | oficial | F1 | reparse | Linha “Frete NF” separada de impostos |
| vTotTrib item | JSON | parcial | I | oficial se presente | F1 XML | reparse | Coluna item Auditoria |
| IBS/CBS/IS | — | não | — | futuro | F5 | — | Oculto |
| TaxRule % | config | sim | pricing | estimado | — | — | Só margem / não no bloco A |
| Guia / pago | — | não | — | C | F3 | AP tipado? | Bloco C |
| Alocação | — | não | — | D | F4 | — | Bloco D |

## 5. Sequência de entrega sugerida (pós-T01)

| Etapa | Entrega | Critério de aceite |
|-------|---------|-------------------|
| T01 | Docs (este pacote) | Commit docs only |
| T02 | Parser XML v2 + reparse job + summary/lines | PD 02457: IPI (ou residual explicado) bate com XML |
| T03 | UI bloco A no pedido + Auditoria 360º | Labels e caveats; sem misturar pago |
| T04 | Guias + provas + link AP | Um DARF de teste pago visível em C |
| T05 | Apuração + alocação D | Relatório gerencial pedido ≠ NF destacada |

## 6. Casos de teste manuais (quando houver UI)

1. Pedido sem NF → bloco A vazio; comerciais podem ter `totalTaxes`.  
2. Pedido com NF produtos ≠ vNF → destacado > 0; tooltip caveat.  
3. NF cancelada → não soma em A válido.  
4. Usuário com TaxRule 18% → margem mostra estimado; bloco A independente.  
5. (Futuro) Guia paga sem alocação → C > 0, D = 0 no pedido.

## 7. Fora de escopo deste plano

- Implementar tabelas Prisma.  
- Alterar sync Nomus.  
- Renomear rota `/taxes` (avaliar depois para evitar quebrar permissões `taxes.*`).
