// Parte 8: histórico na ficha do colaborador (Pessoas / RH) e usuário desativado sem acesso.
import { BASE, login, sleep, start, step, writeResults } from "./common.mjs";
import { execFileSync } from "node:child_process";

const browser = await start(9346);
try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__p = hr;
  await login(hr, "rh.teste@induscost.test");
  await hr.goto(`${BASE}/employees`);
  await hr.waitFor(`[...document.querySelectorAll("tr")].some(tr => tr.innerText.includes("[DEMO] Ana Souza"))`, { timeout: 45000, label: "lista de pessoas" });
  await hr.eval(`(() => { const row = [...document.querySelectorAll("tr")].find(tr => tr.innerText.includes("[DEMO] Ana Souza")); row.querySelector('button[title="Ver ficha do colaborador"]').setAttribute("data-pw", "ficha-ana"); })()`);
  await hr.click('[data-pw="ficha-ana"]');
  await hr.waitFor(`[...document.querySelectorAll('[role="tab"]')].some(t => t.innerText.trim() === "Avaliações")`, { label: "aba Avaliações" });
  await hr.clickText("Avaliações", '[role="tab"]');
  await hr.waitTestId("people-performance-history", 20000);
  await sleep(500);
  const text = await hr.eval(`document.querySelector('[data-testid="people-performance-history"]').innerText`);
  await hr.shot("39-ficha-colaborador-historico");
  // Ciclo de teste nunca entra na ficha oficial; o mesmo registro (rota da ficha) devolve o resultado rotulado só com includeNonOfficial.
  const employeeId = await hr.eval(`fetch("/api/hr/performance/directory?q=" + encodeURIComponent("[DEMO] Ana Souza")).then(r => r.json()).then(d => d.employees.find(e => e.name === "[DEMO] Ana Souza").id)`);
  const labeled = await hr.eval(`fetch("/api/hr/performance/employees/${employeeId}/history?includeNonOfficial=1").then(r => r.json())`);
  const row = labeled.cycles?.find((c) => c.cycleName === "Ciclo piloto 2026-S2");
  step(
    "39 ficha do colaborador: ciclo de teste fora do histórico oficial e rotulado na consulta do RH",
    !/Ciclo piloto 2026-S2/.test(text) && row?.quadrant === "Desempenho alto · Potencial médio" && row?.classification === "TEST",
    `${text.split("\n").slice(0, 2).join(" / ")} · rotulado=${JSON.stringify(row ?? {}).slice(0, 120)}`
  );

  // usuário desativado perde acesso mesmo com sessão aberta
  const leaderCtx = await browser.newContext();
  const leader = await browser.newPage(leaderCtx, { width: 1200, height: 800 });
  await login(leader, "lider.teste@induscost.test");
  const before = await leader.eval(`fetch("/api/hr/performance/me").then(r => r.status)`);
  execFileSync(process.execPath, [process.env.TSX_CLI, process.env.TOGGLE_SCRIPT, "false"], { stdio: "inherit", env: process.env });
  const after = await leader.eval(`fetch("/api/hr/performance/team").then(r => r.status)`);
  execFileSync(process.execPath, [process.env.TSX_CLI, process.env.TOGGLE_SCRIPT, "true"], { stdio: "inherit", env: process.env });
  step("40 usuário desativado perde o acesso (sessão aberta)", before === 200 && after === 401, `antes=${before} depois=${after}`);
  console.log("logs:", JSON.stringify(hr.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 8", false, error.message);
  try {
    await globalThis.__p?.shot("error-part8");
  } catch {}
} finally {
  writeResults("part8");
  await browser.close();
}
