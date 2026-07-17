import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getHomeFirstName,
  getHomeGreeting,
} from "@/src/components/HomePage.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("home autenticada", () => {
  it("personaliza a saudação com o primeiro nome", () => {
    assert.equal(getHomeFirstName("Paulo Roberto"), "Paulo");
    assert.equal(getHomeFirstName("  Maria  Silva  "), "Maria");
    assert.equal(getHomeFirstName(null), "usuário");
    assert.equal(getHomeGreeting(new Date(2026, 6, 16, 9)), "Bom dia");
    assert.equal(getHomeGreeting(new Date(2026, 6, 16, 15)), "Boa tarde");
    assert.equal(getHomeGreeting(new Date(2026, 6, 16, 21)), "Boa noite");
  });

  it("login e sessão ativa sempre chegam à home", () => {
    const login = read("src/components/AuthLoginPage.tsx");
    const loginRoute = read("src/components/PublicLoginRoute.tsx");
    const landingRoute = read("src/components/PublicLandingRoute.tsx");
    const defaultRedirect = read("src/components/DefaultModuleRedirect.tsx");
    assert.match(login, /navigate\("\/home", \{ replace: true \}\)/);
    assert.doesNotMatch(login, /redirectAfterLogin/);
    assert.match(loginRoute, /Navigate to="\/home" replace/);
    assert.doesNotMatch(loginRoute, /state\?\.from|redirectAfterLogin/);
    assert.match(landingRoute, /Navigate to="\/home" replace/);
    assert.match(defaultRedirect, /Navigate to="\/home" replace/);
  });

  it("home apresenta mercado, guia e funcionalidades", () => {
    const home = read("src/components/HomePage.tsx");
    const app = read("src/App.tsx");
    assert.match(app, /path="home" element=\{<HomePage \/>/);
    assert.match(home, /MARKET_HEADER_TICKER_API/);
    assert.match(home, /Dólar PTAX venda/);
    assert.match(home, /Petróleo Brent/);
    assert.match(home, /Abrir guia do sistema/);
    assert.match(home, /availableFeatures/);
    assert.match(home, /Curiosidades do sistema/);
  });
});
