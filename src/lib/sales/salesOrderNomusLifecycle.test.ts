import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { summarizeSalesOrderNomusLifecycle, type SalesOrderNomusLifecycleItem } from "./salesOrderNomusLifecycle.ts";

const item = (value: number, flags: Partial<SalesOrderNomusLifecycleItem> = {}): SalesOrderNomusLifecycleItem => ({
  quantity: 10,
  totalNetValue: value,
  ...flags,
});

describe("ciclo de vida do pedido Nomus pelos itens (carteira e previsão de faturamento)", () => {
  it("1. pedido aberto com todos os itens ativos → valor do cabeçalho (indicador inalterado)", () => {
    const s = summarizeSalesOrderNomusLifecycle(1050, [item(500), item(500)]);
    assert.equal(s.state, "OPEN");
    assert.equal(s.forecastValue, 1050, "frete/ajuste do cabeçalho preservado quando nada foi cancelado");
    assert.equal(s.eligible, 1000);
  });

  it("2. pedido integralmente cancelado → fora da previsão; contratado e cancelado preservados", () => {
    const s = summarizeSalesOrderNomusLifecycle(1000, [item(600, { nomusIsCanceled: true }), item(400, { nomusIsCanceled: true })]);
    assert.equal(s.state, "FULLY_CANCELED");
    assert.equal(s.forecastValue, null);
    assert.equal(s.contracted, 1000);
    assert.equal(s.canceled, 1000);
    assert.equal(s.eligible, 0);
  });

  it("3. um item cancelado entre vários ativos → só o saldo ativo, sem subtrair do cabeçalho (sem dupla subtração)", () => {
    // Cabeçalho do Nomus pode ou não já ter abatido o item cancelado: o resultado é o mesmo.
    for (const header of [1000, 700]) {
      const s = summarizeSalesOrderNomusLifecycle(header, [item(300, { nomusIsCanceled: true }), item(400), item(300)]);
      assert.equal(s.state, "PARTIALLY_CANCELED");
      assert.equal(s.forecastValue, 700);
      assert.equal(s.canceled, 300);
    }
  });

  it("4. cancelamento parcial de quantidade sem evidência no payload → item continua ativo (pendência registrada)", () => {
    // `quantidadeCancelada` não aparece nos payloads reais (fixture PD 02130): sem bandeira, nada é abatido.
    const s = summarizeSalesOrderNomusLifecycle(1000, [item(1000, { nomusQuantityFulfilled: 0 })]);
    assert.equal(s.state, "OPEN");
    assert.equal(s.forecastValue, 1000);
  });

  it("5. item cortado → só a fração atendida é elegível; sem quantidade atendida nada é elegível", () => {
    const s = summarizeSalesOrderNomusLifecycle(1000, [item(1000, { nomusIsCut: true, nomusQuantityFulfilled: 4 })]);
    assert.equal(s.state, "OPEN");
    assert.equal(s.cut, 600);
    assert.equal(s.forecastValue, 400);
    const noQty = summarizeSalesOrderNomusLifecycle(1000, [item(1000, { nomusIsCut: true, nomusQuantityFulfilled: null })]);
    assert.equal(noQty.forecastValue, 0);
  });

  it("item que saiu do payload (stale) não é cancelamento, mas sai do saldo; todos fora → fora da previsão", () => {
    const partial = summarizeSalesOrderNomusLifecycle(1000, [item(0, { nomusIsStale: true }), item(500)]);
    assert.equal(partial.state, "PARTIALLY_CANCELED");
    assert.equal(partial.forecastValue, 500);
    const all = summarizeSalesOrderNomusLifecycle(1000, [item(0, { nomusIsStale: true })]);
    assert.equal(all.state, "ALL_ITEMS_REMOVED");
    assert.equal(all.forecastValue, null);
  });

  it("pedido sem itens (local/legado) mantém o valor do cabeçalho", () => {
    const s = summarizeSalesOrderNomusLifecycle(250, []);
    assert.equal(s.state, "NO_ITEMS");
    assert.equal(s.forecastValue, 250);
  });

  it("9. reativação: mesmo pedido com o item de volta ativo volta à previsão integral", () => {
    const canceled = summarizeSalesOrderNomusLifecycle(1000, [item(1000, { nomusIsCanceled: true })]);
    const reactivated = summarizeSalesOrderNomusLifecycle(1000, [item(1000, { nomusIsCanceled: false })]);
    assert.equal(canceled.forecastValue, null);
    assert.equal(reactivated.forecastValue, 1000);
  });
});
