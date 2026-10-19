// Parte 2: celular simulado (QR → código → respostas → interrupção → retomada → envio)
// e preenchimento assistido em aparelho da empresa, aberto pelo botão do RH.
import { BASE, loadState, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const state = loadState();
const browser = await start(9340);
const answer = async (page, testId) => {
  await page.clickTestId(testId);
  await page.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("salva")`, { label: "salvo", timeout: 15000 });
  await page.clickTestId("portal-next");
  await sleep(150);
};
try {
  const ana = state.invites.find((c) => c.name.includes("Ana Souza"));
  const otp = state.otps["[DEMO] Ana Souza"];
  const phoneCtx = await browser.newContext();
  const phone = await browser.newPage(phoneCtx, { width: 390, height: 844, mobile: true });
  globalThis.__hr = phone;

  // 12 acesso pelo celular (QR = URL com #t=)
  await phone.goto(ana.url);
  await phone.waitTestId("portal-code", 30000);
  const hashGone = await phone.eval("location.hash === ''");
  await phone.shot("12-celular-codigo");
  step("12 acesso pelo celular via QR", hashGone, "token apagado da barra");

  // 13 confirmação de identidade (erro primeiro, depois certo)
  await phone.type('[data-testid="portal-otp"]', "000000");
  await phone.clickTestId("portal-otp-submit");
  await phone.waitFor(`document.querySelector('[role="alert"]')`, { label: "erro de código" });
  const wrong = await phone.eval(`document.querySelector('[role="alert"]').innerText`);
  await phone.type('[data-testid="portal-otp"]', otp);
  await phone.clickTestId("portal-otp-submit");
  await phone.waitTestId("portal-intro", 20000);
  await phone.shot("13-celular-intro");
  step("13 confirmação de identidade", /incorreto/i.test(wrong), wrong);

  // 14 preenchimento parcial
  await phone.clickTestId("portal-start");
  await phone.waitTestId("portal-question");
  await phone.shot("14a-celular-pergunta-1");
  const preselected = await phone.eval(`document.querySelectorAll('[aria-pressed="true"]').length`);
  const ov390 = await phone.overflow();
  for (let i = 0; i < 6; i += 1) await answer(phone, i === 2 ? "portal-option-na" : "portal-option-4");
  await phone.shot("14b-celular-pergunta-7");
  step("14 preenchimento parcial (6 de 12, sem pré-seleção, sem rolagem lateral)", preselected === 0 && !ov390.overflow, `pré-selecionadas=${preselected} largura=${ov390.scrollWidth}`);

  // 14c conexão instável: a resposta fica na fila e é reenviada sozinha
  await phone.send("Network.enable");
  await phone.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await phone.clickTestId("portal-option-3");
  await phone.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("Sem internet")`, { label: "aviso offline", timeout: 15000 });
  await phone.shot("14c-celular-sem-internet");
  await phone.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await phone.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("salva")`, { label: "reenvio", timeout: 20000 });
  step("14c conexão instável: aviso honesto e reenvio automático", true);
  await phone.clickTestId("portal-next");
  await sleep(200);

  // 15 interrupção: sai da página sem enviar
  await phone.goto("about:blank");
  step("15 interrupção (página fechada no meio)", true);

  // 16 retomada pelo mesmo aparelho (cookie de sessão), começa na primeira sem resposta
  await phone.goto(`${BASE}/avaliacao`);
  await phone.waitTestId("portal-question", 30000);
  const progress = await phone.eval(`document.querySelector('[data-testid="portal-progress"]').innerText`);
  await phone.shot("16-celular-retomada");
  step("16 retomada", /Pergunta 8 de 12/.test(progress) && /7 respondida/.test(progress), progress);

  // telas pequenas
  for (const width of [320, 360]) {
    await phone.viewport({ width, height: 700, mobile: true });
    await sleep(300);
    const ov = await phone.overflow();
    await phone.shot(`16b-celular-${width}px`);
    step(`16b celular ${width}px sem rolagem lateral`, !ov.overflow, `scrollWidth=${ov.scrollWidth}`);
  }
  await phone.viewport({ width: 390, height: 844, mobile: true });

  // 17 conclusão
  for (let i = 0; i < 5; i += 1) await answer(phone, "portal-option-3");
  await phone.waitTestId("portal-review");
  await phone.fullShot("17a-celular-revisao");
  await phone.clickTestId("portal-send");
  await phone.waitTestId("portal-done", 20000);
  await phone.shot("17b-celular-concluido");
  await phone.goto(`${BASE}/avaliacao`);
  await phone.waitTestId("portal-closed", 20000);
  step("17 conclusão (envio único, sessão encerrada)", true);
  const reuse = await phone.eval(`fetch("/api/public/performance/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: ${JSON.stringify(decodeURIComponent(new URL(ana.url).hash.slice(3)))} }) }).then(r => r.json())`);
  step("17c QR já usado não reabre", reuse.ok === false, reuse.message);

  // 17d preenchimento assistido (Bia) pelo botão do RH
  const hrCtx = await browser.newContext();
  const hr = await browser.newPage(hrCtx, { width: 1440, height: 900 });
  await login(hr, "rh.teste@induscost.test");
  await openModule(hr);
  await hr.waitTestId("perf-cycle-desk", 30000);
  await hr.clickTestId("perf-assist-[DEMO] Bia Lima");
  await hr.waitTestId("perf-assist-dialog");
  await hr.type('[data-testid="perf-assist-dialog-reason"]', "Sem celular; responde no tablet do RH.");
  const before = new Set((await browser.send("Target.getTargets")).targetInfos.map((t) => t.targetId));
  await hr.clickTestId("perf-assist-dialog-save");
  let target = null;
  for (let i = 0; i < 50 && !target; i += 1) {
    await sleep(200);
    target = (await browser.send("Target.getTargets")).targetInfos.find((t) => !before.has(t.targetId) && t.type === "page");
  }
  const tablet = await browser.attachTarget(target.targetId, { width: 820, height: 1180, mobile: true });
  await tablet.waitTestId("portal-intro", 30000);
  const assistedNote = await tablet.text();
  await tablet.clickTestId("portal-start");
  for (let i = 0; i < 12; i += 1) await answer(tablet, i % 5 === 0 ? "portal-option-2" : "portal-option-3");
  await tablet.waitTestId("portal-review");
  const sendDisabled = await tablet.eval(`document.querySelector('[data-testid="portal-send"]').disabled`);
  await tablet.click('[data-testid="portal-assist-confirm"]');
  await tablet.fullShot("17d-assistido-confirmacao");
  await tablet.clickTestId("portal-send");
  await tablet.waitTestId("portal-done", 20000);
  const doneText = await tablet.text();
  step("17d preenchimento assistido (motivo, confirmação da pessoa, aparelho liberado)", /ajuda do RH/.test(assistedNote) && sendDisabled && /devolver o aparelho/i.test(doneText));
  console.log("logs celular:", JSON.stringify(phone.logs.filter((l) => l.type !== "warning")), "tablet:", JSON.stringify(tablet.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 2", false, error.message);
  try {
    await globalThis.__hr?.shot("error-part2");
  } catch {}
} finally {
  writeResults("part2");
  await browser.close();
}
