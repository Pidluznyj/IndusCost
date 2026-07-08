import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  financeArTitlesPrintMoneyClass,
  financeArTitlesPrintStatusBadgeClass,
  financeArTitlesPrintTotalMoneyClass,
} from "./financeArTitlesPrintStatus.js";

describe("financeArTitlesPrintStatus", () => {
  it("status atrasado usa classe vermelha", () => {
    assert.match(financeArTitlesPrintStatusBadgeClass("overdue"), /--danger/);
  });

  it("status a vencer usa classe verde", () => {
    assert.match(financeArTitlesPrintStatusBadgeClass("upcoming"), /--success/);
  });

  it("status em aberto usa classe âmbar", () => {
    assert.match(financeArTitlesPrintStatusBadgeClass("open"), /--warning/);
  });

  it("status recebido usa classe verde", () => {
    assert.match(financeArTitlesPrintStatusBadgeClass("settled"), /--settled/);
  });

  it("status desconhecido usa classe cinza", () => {
    assert.match(financeArTitlesPrintStatusBadgeClass("foo"), /--unknown/);
  });

  it("valor em aberto vencido usa destaque de risco", () => {
    assert.match(financeArTitlesPrintMoneyClass("open", "overdue"), /--risk/);
  });

  it("valor recebido usa destaque verde", () => {
    assert.match(financeArTitlesPrintMoneyClass("received", "settled"), /--received/);
  });

  it("totais mantêm classes de destaque", () => {
    assert.match(financeArTitlesPrintTotalMoneyClass("received"), /--received/);
    assert.match(financeArTitlesPrintTotalMoneyClass("open"), /--open/);
  });
});
