// Roteiro de navegador do módulo Desempenho e Cultura (Chrome real via DevTools Protocol).
// Só para ambiente LOCAL com dados fictícios (scripts/seedPerformanceLocalDemo.ts).
// Variáveis: PERF_DEMO_PASSWORD (obrigatória), PERF_E2E_BASE (padrão http://localhost:3100),
// PERF_E2E_OUT (padrão tmp/performance-e2e, ignorado pelo Git).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, sleep } from "./cdp.mjs";

export const BASE = process.env.PERF_E2E_BASE ?? "http://localhost:3100";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("PERF_E2E_BASE precisa ser local.");
export const WORK = resolve(process.env.PERF_E2E_OUT ?? "tmp/performance-e2e");
export const OUT = join(WORK, "shots");
mkdirSync(OUT, { recursive: true });
const STATE = join(WORK, "state.json");
const PASSWORD = process.env.PERF_DEMO_PASSWORD ?? "";
if (PASSWORD.length < 12) throw new Error("Defina PERF_DEMO_PASSWORD (a mesma usada no seed).");

export function loadState() {
  return existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
}
export function saveState(next) {
  writeFileSync(STATE, JSON.stringify({ ...loadState(), ...next }, null, 2));
}

export const results = [];
export function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` · ${detail}` : ""}`);
}

export async function start(port = 9333) {
  return launch({ port, profile: join(WORK, `chrome-prof-${port}`), out: OUT });
}

export async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.waitFor(`document.querySelector('input[type="email"]')`);
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitFor(`!location.pathname.startsWith("/login")`, { timeout: 30000, label: "login redirect" });
  await sleep(500);
}

export async function openModule(page) {
  await page.goto(`${BASE}/performance-cycle`);
  await page.waitTestId("perf-page", 45000);
}

export function writeResults(name) {
  writeFileSync(join(WORK, `results-${name}.json`), JSON.stringify(results, null, 2));
}

export { sleep };
