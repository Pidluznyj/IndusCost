import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderListWhere } from "@/src/lib/salesOrdersListSummary.js";
import {
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV as FLAG,
  isNomusOpsExcludeMissingSalesOrdersEnabled,
} from "./nomusSourcePresencePolicy.js";
import {
  assertSalesOrderPresenceFlagDeclared,
  declaredSalesOrderPresenceFlag,
  useSalesOrderPresenceFlag,
  withSalesOrderPresenceFlag,
} from "./nomusSourcePresenceTestEnv.js";

// Regressão da homologação (flag ligada no .env do servidor): testes do CRM
// herdavam a variável do shell e 10 casos mudavam de resultado. Aqui se prova
// que o estado declarado vence qualquer valor herdado e que nada vaza.

/** Simula o valor que o processo herdou do shell/.env e devolve o original no fim. */
async function inheriting(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const original = process.env[FLAG];
  try {
    if (value === undefined) delete process.env[FLAG];
    else process.env[FLAG] = value;
    await run();
  } finally {
    if (original === undefined) delete process.env[FLAG];
    else process.env[FLAG] = original;
  }
}

const INHERITED = [undefined, "true", "1", " ON ", "false", "0"];
const whereExcludesConfirmedMissing = () =>
  JSON.stringify(buildSalesOrderListWhere({})).includes("MISSING_CONFIRMED");

describe("flag de presença de Pedidos de Venda em testes — estado declarado, nunca herdado", () => {
  it("o estado declarado vale sobre qualquer valor herdado, e o herdado volta intacto", async () => {
    for (const inherited of INHERITED) {
      await inheriting(inherited, async () => {
        await withSalesOrderPresenceFlag("OFF", () => {
          assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled(), false, `herdado ${inherited}`);
          assert.equal(whereExcludesConfirmedMissing(), false, `herdado ${inherited}`);
        });
        await withSalesOrderPresenceFlag("ON", () => {
          assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled(), true, `herdado ${inherited}`);
          assert.equal(whereExcludesConfirmedMissing(), true, `herdado ${inherited}`);
        });
        assert.equal(process.env[FLAG], inherited);
        assert.equal(FLAG in process.env, inherited !== undefined, "ausente continua ausente");
        assert.equal(declaredSalesOrderPresenceFlag(), null);
      });
    }
  });

  it("restaura valor e declaração mesmo quando o cenário falha", async () => {
    await inheriting("true", async () => {
      await assert.rejects(
        withSalesOrderPresenceFlag("OFF", () => {
          throw new Error("cenário quebrou");
        }),
        /cenário quebrou/
      );
      assert.equal(process.env[FLAG], "true");
      assert.equal(declaredSalesOrderPresenceFlag(), null);
    });
  });

  it("aninhado: o cenário interno não vaza para o externo", async () => {
    await withSalesOrderPresenceFlag("OFF", async () => {
      await withSalesOrderPresenceFlag("ON", () => {
        assert.equal(assertSalesOrderPresenceFlagDeclared("interno"), "ON");
      });
      assert.equal(assertSalesOrderPresenceFlagDeclared("externo"), "OFF");
      assert.equal(isNomusOpsExcludeMissingSalesOrdersEnabled(), false);
    });
  });

  it("fixture que depende da flag falha alto sem declaração — em qualquer ambiente", async () => {
    for (const inherited of INHERITED) {
      await inheriting(inherited, async () => {
        assert.throws(
          () => assertSalesOrderPresenceFlagDeclared("fixture X"),
          /fixture X: o resultado depende de NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENABLED\. Declare o estado/
        );
      });
    }
  });

  it("fixture detecta a flag alterada por fora do helper depois de declarada", async () => {
    await withSalesOrderPresenceFlag("OFF", () => {
      process.env[FLAG] = "true";
      assert.throws(
        () => assertSalesOrderPresenceFlagDeclared("fixture X"),
        /declarada OFF, mas process\.env resolve ON/
      );
    });
  });
});

describe("useSalesOrderPresenceFlag — declara a suíte inteira", () => {
  useSalesOrderPresenceFlag("ON");

  it("cada teste começa no estado declarado", () => {
    assert.equal(assertSalesOrderPresenceFlagDeclared("suíte"), "ON");
    assert.equal(whereExcludesConfirmedMissing(), true);
    // Um teste que suja o env...
    process.env[FLAG] = "false";
  });

  it("...não contamina o seguinte: o estado é reaplicado antes de cada teste", () => {
    assert.equal(assertSalesOrderPresenceFlagDeclared("suíte"), "ON");
  });
});

describe("fora da suíte declarada", () => {
  it("nada fica declarado depois que a suíte termina", () => {
    assert.equal(declaredSalesOrderPresenceFlag(), null);
  });
});
