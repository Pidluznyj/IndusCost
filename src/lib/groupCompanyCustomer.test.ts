import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GROUP_COMPANY_CNPJ_DIGITS,
  isGroupCompanyCustomer,
  isMarketBillingCustomer,
  normalizeCnpjDigits,
  normalizeCompanyName,
} from "./groupCompanyCustomer.js";
import { computeMonthProjection, computeYtdDailyAverageByWorkday } from "./salesOrderDashboardRules.js";

describe("groupCompanyCustomer", () => {
  it("normalizes CNPJ digits", () => {
    assert.equal(normalizeCnpjDigits("14.055.501/0001-80"), GROUP_COMPANY_CNPJ_DIGITS[0]);
    assert.equal(normalizeCnpjDigits("72.569.510/0001-95"), GROUP_COMPANY_CNPJ_DIGITS[1]);
  });

  it("excludes Koppetel by CNPJ", () => {
    assert.equal(
      isGroupCompanyCustomer({ taxId: "14.055.501/0001-80", companyName: "Outro Nome" }),
      true
    );
    assert.equal(isMarketBillingCustomer({ taxId: "14.055.501/0001-80" }), false);
  });

  it("excludes Lazarios by CNPJ", () => {
    assert.equal(
      isGroupCompanyCustomer({ taxId: "72.569.510/0001-95", companyName: "Cliente X" }),
      true
    );
  });

  it("excludes Lazarios by normalized company name", () => {
    assert.equal(isGroupCompanyCustomer({ companyName: "Lazarios Indústria Ltda" }), true);
    assert.equal(isGroupCompanyCustomer({ tradeName: "LAZARIOS" }), true);
  });

  it("excludes Koppetel by normalized name", () => {
    assert.equal(isGroupCompanyCustomer({ companyName: "Koppetel Comércio" }), true);
  });

  it("excludes SM by name patterns without CNPJ", () => {
    assert.equal(
      isGroupCompanyCustomer({ companyName: "SM Comércio de Plásticos Ltda" }),
      true
    );
    assert.equal(isGroupCompanyCustomer({ tradeName: "SM" }), true);
    assert.equal(
      isGroupCompanyCustomer({ companyName: "SM Com Plasticos SA" }),
      true
    );
  });

  it("does not exclude regular market customers", () => {
    assert.equal(
      isGroupCompanyCustomer({
        taxId: "12.345.678/0001-90",
        companyName: "Cliente Mercado Externo",
      }),
      false
    );
    assert.equal(isMarketBillingCustomer({ companyName: "Cliente Mercado Externo" }), true);
  });

  it("normalizeCompanyName removes accents and lowercases", () => {
    assert.equal(normalizeCompanyName("Comércio"), "comercio");
  });
});

describe("billing projection rules", () => {
  it("projected month equals YTD daily average times workdays in month", () => {
    const ytdAvg = computeYtdDailyAverageByWorkday(220_000, 22)!;
    assert.equal(computeMonthProjection(ytdAvg, 22), 220_000);
    assert.equal(computeMonthProjection(null, 22), null);
    assert.equal(computeMonthProjection(ytdAvg, 0), null);
  });
});
