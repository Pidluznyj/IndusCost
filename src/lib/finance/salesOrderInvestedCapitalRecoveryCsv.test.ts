import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildInvestedCapitalRecoveryCsv } from "./salesOrderInvestedCapitalRecoveryCsv.js";
import { buildSalesOrderInvestedCapitalRecoverySnapshot } from "./salesOrderInvestedCapitalRecoverySnapshot.js";

const TODAY = "2026-09-01";

function row(input: { id: string; sale: number; capital: number | null; received: number; outstanding: number; name?: string }) {
  return buildSalesOrderInvestedCapitalRecoverySnapshot(
    {
      salesOrderId: input.id,
      orderCode: `PD ${input.id}`,
      customerId: "c",
      customerName: input.name ?? "Cliente",
      sellerName: null,
      saleValue: input.sale,
      invoicedValue: input.sale,
      investedCapital: input.capital,
      investedCapitalUnavailableReason: input.capital == null ? "sem custo" : null,
      orderStatus: "SENT_TO_NOMUS",
      orderStatusLabel: "Enviado",
      industrialCost: input.capital == null ? null : input.capital,
      totalTaxes: input.capital == null ? null : 0,
      taxSourceLabel: null,
      realReceivables: [
        { externalId: 1, dueDate: "2026-06-01", settlementDate: "2026-06-05", amountReceivable: input.received, amountReceived: input.received, balanceReceivable: 0 },
        { externalId: 2, dueDate: "2026-10-01", settlementDate: null, amountReceivable: input.outstanding, amountReceived: 0, balanceReceivable: input.outstanding },
      ],
    },
    TODAY
  );
}

describe("Recuperação do Dinheiro Investido — CSV do detalhamento", () => {
  it("transcreve as colunas do DTO (CASO A e CASO D), com BOM, ';' e números pt-BR", () => {
    const csv = buildInvestedCapitalRecoveryCsv([
      row({ id: "A", sale: 100, capital: 60, received: 75, outstanding: 25, name: 'Cliente "Aspas" Ltda' }),
      row({ id: "D", sale: 100, capital: null, received: 50, outstanding: 50 }),
    ]);
    assert.ok(csv.startsWith("﻿"));
    const lines = csv.replace("﻿", "").trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /^"PV";"Cliente";"Vendido";"Capital investido";"Custo industrial";"Imposto";"Margem econômica";"Recebido";"Capital recuperado";"Ganho realizado";"Capital na rua";"Falta receber";"Capital a recuperar";"Ganho a receber";"Capital sem CR";"% recuperado";"Status";"Recuperado em";"Previsão de recuperação"$/);
    // CASO A: margem 40, recuperado 60, ganho 15, na rua 0, capital no CR 0, ganho a receber 25, sem CR 0.
    assert.equal(
      lines[1],
      '"PD A";"Cliente ""Aspas"" Ltda";"100,00";"60,00";"60,00";"0,00";"40,00";"75,00";"60,00";"15,00";"0,00";"25,00";"0,00";"25,00";"0,00";"100,00";"Capital recuperado";"2026-06-05";""'
    );
    // CASO D: sem capital → colunas de capital vazias (nunca 0), recebido/falta receber preservados.
    assert.equal(
      lines[2],
      '"PD D";"Cliente";"100,00";"";"";"";"";"50,00";"";"";"";"50,00";"";"";"";"";"Dados insuficientes";"";""'
    );
  });

  it("sem linhas, só o cabeçalho", () => {
    const lines = buildInvestedCapitalRecoveryCsv([]).replace("﻿", "").trim().split("\r\n");
    assert.equal(lines.length, 1);
  });
});
