import assert from "node:assert/strict";
import test from "node:test";
import { resolveCrmCommercialPersona } from "./crmCommercialPersona.ts";

const base = {
  role: "VIEWER",
  canViewShell: true,
  canViewGeneral: false,
  canViewSellerTab: true,
  canViewPortfolio: true,
  canViewCustomer360: true,
  canViewOwn: false,
  canViewAll: false,
};

test("VIEWER com perfil vendedor recebe somente escopo próprio", () => {
  const result = resolveCrmCommercialPersona({ ...base, canViewOwn: true });
  assert.equal(result.dataScope, "own");
  assert.equal(result.canUseCrm, true);
  assert.equal(result.canFilterAllSellers, false);
  assert.equal(result.sellerLocked, true);
});

test("own vence all em perfil custom incoerente", () => {
  const result = resolveCrmCommercialPersona({
    ...base,
    canViewOwn: true,
    canViewAll: true,
  });
  assert.equal(result.dataScope, "own");
  assert.equal(result.canFilterAllSellers, false);
});

test("Gestão Geral explícita transforma own + all em perfil global", () => {
  const result = resolveCrmCommercialPersona({
    ...base,
    canViewGeneral: true,
    canViewOwn: true,
    canViewAll: true,
  });
  assert.equal(result.dataScope, "global");
  assert.equal(result.canViewGeneral, true);
  assert.equal(result.canFilterAllSellers, true);
});

test("role SELLER nunca recebe global mesmo com grants indevidos", () => {
  const result = resolveCrmCommercialPersona({
    ...base,
    role: "SELLER",
    canViewGeneral: true,
    canViewOwn: true,
    canViewAll: true,
  });
  assert.equal(result.dataScope, "own");
  assert.equal(result.canViewGeneral, false);
  assert.equal(result.canFilterAllSellers, false);
});

test("gestor comercial permanece global", () => {
  const result = resolveCrmCommercialPersona({
    ...base,
    role: "COMMERCIAL_MANAGER",
    canViewGeneral: true,
    canViewAll: true,
  });
  assert.equal(result.dataScope, "global");
  assert.equal(result.canViewGeneral, true);
});

test("crm.view isolado não cria acesso útil para VIEWER", () => {
  const result = resolveCrmCommercialPersona({
    ...base,
    canViewSellerTab: false,
    canViewPortfolio: false,
    canViewCustomer360: false,
  });
  assert.equal(result.dataScope, "none");
  assert.equal(result.canUseCrm, false);
});
