// Parte 6: validação técnica, calibração (com ajuste), homologação, Nine-Box, devolutiva, PDI,
// acompanhamento, PDFs, encerramento, painel e consulta histórica.
import { BASE, login, openModule, saveState, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9344);
try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__p = hr;
  await login(hr, "rh.teste@induscost.test");
  await openModule(hr);
  await hr.waitTestId("perf-cycle-desk", 30000);
  const cycleId = await hr.eval(`sessionStorage.getItem("ic-perf-cycle")`);
  await hr.clickTestId("perf-tabs-tab-calibracao");
  await hr.waitTestId("perf-calibration-table", 20000);

  const people = ["Ana Souza", "Bia Lima", "Fabi Sem Líder", "Otávio Pereira"];
  for (const name of people) {
    const row = `[DEMO] ${name}`;
    const needsValidation = await hr.eval(`Boolean(document.querySelector('[data-testid="perf-cal-validate-${row}"]')) && document.querySelector('[data-testid="perf-cal-row-${row}"]').innerText.includes("Aguardando validação")`);
    if (needsValidation) {
      await hr.clickTestId(`perf-cal-validate-${row}`);
      await hr.waitTestId("perf-validate-dialog");
      await hr.type('[data-testid="perf-validate-note"]', "Padrão do posto conferido com refugo e auditoria do semestre.");
      await hr.clickTestId("perf-validate-dialog-save");
      await hr.waitFor(`document.querySelector('[data-testid="perf-cal-row-${row}"]').innerText.includes("Validado")`, { label: `validado ${name}` });
    }
    await hr.clickTestId(`perf-cal-calibrate-${row}`);
    await hr.waitTestId("perf-calibrate-dialog");
    if (name === "Ana Souza") {
      await hr.select('[data-testid="perf-calibrate-decision"]', "ADJUST");
      await sleep(200);
      await hr.select('[data-testid="perf-calibrate-y"]', "MID");
      await hr.type('[data-testid="perf-calibrate-note"]', "Potencial alto ainda sem evidência de tarefas novas; mantido médio até o próximo ciclo.");
      await hr.shot("26a-calibracao-ajuste");
    } else {
      await hr.type('[data-testid="perf-calibrate-note"]', "Leitura do RH confirma a posição calculada.");
    }
    // Sem avaliação do líder (Otávio: Marcos não tem usuário no roteiro), a calibração exige exceção explícita.
    if (await hr.eval(`Boolean(document.querySelector('[data-testid="perf-accept-missing-leader"]'))`)) await hr.click('[data-testid="perf-accept-missing-leader"]');
    await hr.clickTestId("perf-calibrate-dialog-save");
    await hr.waitFor(`document.querySelector('[data-testid="perf-cal-row-${row}"]').innerText.includes("calibrado")`, { label: `calibrado ${name}` });
  }
  await hr.fullShot("26b-calibracao-concluida");
  const anaRow = await hr.eval(`document.querySelector('[data-testid="perf-cal-row-[DEMO] Ana Souza"]').innerText`);
  step("26 validação técnica e calibração (ajuste justificado preserva a original)", /Ajustado na calibração/.test(anaRow) && /Potencial médio/.test(anaRow));

  // 27 homologação
  await hr.clickTestId("perf-homologate");
  await hr.waitTestId("perf-homologate-dialog");
  await hr.clickTestId("perf-homologate-dialog-save");
  await hr.waitFor(`document.querySelectorAll('[data-testid^="perf-cal-row-"]')[0].innerText.includes("Oficial")`, { label: "oficial", timeout: 20000 });
  step("27 homologação", true);

  // 28 Nine-Box
  await hr.clickTestId("perf-tabs-tab-ninebox");
  await hr.waitTestId("perf-ninebox-tab", 20000);
  await sleep(800);
  await hr.clickTestId("perf-ninebox-cell-HIGH-MID");
  await hr.waitTestId("perf-ninebox-person-[DEMO] Ana Souza");
  await hr.fullShot("28-ninebox-oficial");
  const unplaced = await hr.eval(`document.querySelector('[data-testid="perf-ninebox-unplaced"]').innerText`);
  const lowSample = await hr.eval(`document.querySelector('[data-testid="perf-ninebox-tab"]').innerText.includes("Amostra pequena")`);
  step("28 Nine-Box oficial, detalhe, cultura à parte, sem evidência fora da grade", lowSample, unplaced);

  // 29 devolutiva (RH) + ciência presencial
  await hr.clickTestId("perf-tabs-tab-pdi");
  await hr.waitTestId("perf-feedback-table", 20000);
  await hr.clickTestId("perf-fb-create-[DEMO] Ana Souza");
  await hr.waitTestId("perf-feedback-dialog");
  await hr.type('[data-testid="perf-feedback-strength"]', "Qualidade constante e cuidado com o posto.");
  await hr.type('[data-testid="perf-feedback-improvement"]', "Assumir tarefas novas no setor.");
  await hr.type('[data-testid="perf-feedback-action"]', "Aprender a operar a dobradeira com o líder.");
  await hr.clickTestId("perf-feedback-dialog-save");
  await hr.waitTestId("perf-fb-ack-[DEMO] Ana Souza");
  await hr.clickTestId("perf-fb-ack-[DEMO] Ana Souza");
  await hr.waitTestId("perf-ack-dialog");
  await hr.select('[data-testid="perf-ack-action"]', "ACKNOWLEDGED");
  await hr.type('[data-testid="perf-ack-dialog"] textarea', "Quer começar pela dobradeira pequena.");
  await hr.clickTestId("perf-ack-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-fb-row-[DEMO] Ana Souza"]').innerText.includes("Ciência em")`, { label: "ciência" });
  const ackText = await hr.eval(`document.querySelector('[data-testid="perf-fb-row-[DEMO] Ana Souza"]').innerText`);
  step("29 devolutiva e ciência sem concordância", /Concordância não registrada/.test(ackText) && /presencial/.test(ackText));

  // 30 PDI + acompanhamento
  await hr.clickTestId("perf-fb-pdi-[DEMO] Ana Souza");
  await hr.waitTestId("perf-pdi-dialog");
  await hr.type('[data-testid="perf-pdi-title"]', "Operar a dobradeira pequena com supervisão");
  await hr.clickTestId("perf-pdi-dialog-save");
  await hr.waitTestId("perf-pdi-row-[DEMO] Ana Souza", 20000);
  await hr.clickTestId("perf-pdi-checkin-[DEMO] Ana Souza");
  await hr.waitTestId("perf-checkin-dialog");
  await hr.type('[data-testid="perf-checkin-note"]', "Primeiras duas peças feitas com o líder.");
  await hr.clickTestId("perf-checkin-dialog-save");
  await sleep(800);
  await hr.clickTestId("perf-pdi-status-[DEMO] Ana Souza");
  await hr.waitTestId("perf-pdi-status-dialog");
  await hr.select('[data-testid="perf-pdi-status"]', "DONE");
  await hr.type('[data-testid="perf-pdi-status-note"]', "Opera sozinha a dobradeira pequena desde 20/11.");
  await hr.clickTestId("perf-pdi-status-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-pdi-row-[DEMO] Ana Souza"]').innerText.includes("Concluída")`, { label: "concluída" });
  await hr.click('[data-testid="perf-pdi-row-[DEMO] Ana Souza"] button[aria-expanded]');
  await sleep(300);
  await hr.fullShot("30-pdi-acompanhamento");
  const pdiRow = await hr.eval(`document.querySelector('[data-testid="perf-pdi-row-[DEMO] Ana Souza"]').innerText`);
  step("30 PDI, acompanhamento e conclusão com histórico", /Primeiras duas peças/.test(pdiRow) && /Opera sozinha/.test(pdiRow));

  // 31 PDFs institucionais
  const anaParticipant = await hr.eval(`fetch("/api/hr/performance/cycles/${cycleId}/workspace").then(r => r.json()).then(ws => ws.people.find(p => p.participant.employeeName.includes("Ana Souza")).participant.id)`);
  const codes = {};
  for (const [kind, pid] of [["individual", anaParticipant], ["devolutiva", anaParticipant], ["pdi", anaParticipant], ["historico", anaParticipant], ["consolidado", null], ["ninebox", null]]) {
    const doc = await browser.newPage(ctx, { width: 1000, height: 1300 });
    await doc.goto(`${BASE}/performance-cycle/relatorio?cycleId=${cycleId}&kind=${kind}${pid ? `&participantId=${pid}` : ""}`);
    await doc.waitTestId("perf-print-document", 30000);
    await sleep(800);
    codes[kind] = await doc.eval(`document.title`);
    await doc.fullShot(`31-pdf-${kind}`);
    await doc.pdf(`relatorio-${kind}`);
    await doc.close();
  }
  step("31 emissão de PDF (6 tipos)", Object.values(codes).every((t) => /DCP-\d{8}-[0-9A-F]{6}/.test(t)), Object.values(codes).join(" | "));
  saveState({ reportCodes: codes, anaParticipant });

  // 32 encerramento
  await hr.clickTestId("perf-tabs-tab-ciclos");
  await hr.waitTestId("perf-cycle-desk", 20000);
  await hr.clickTestId("perf-cycle-next");
  await hr.waitTestId("perf-accept-pending");
  await hr.click('[data-testid="perf-accept-pending"]');
  await hr.clickTestId("perf-transition-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-desk"]').innerText.includes("Encerrado")`, { label: "encerrado", timeout: 20000 });
  await hr.shot("32-ciclo-encerrado");
  step("32 encerramento (pendência de devolutiva confirmada)", true);

  // painel e evolução
  await hr.clickTestId("perf-tabs-tab-painel");
  await hr.waitTestId("perf-dash-kpis", 20000);
  // Ciclo de teste: fora dos indicadores oficiais (a evolução fica vazia); o RH enxerga pela consulta rotulada.
  await hr.waitFor(`document.querySelector('[data-testid="perf-evolution-table"]') || /Nenhum ciclo/.test(document.body.innerText)`, { label: "evolução carregada", timeout: 20000 });
  await hr.fullShot("33-painel");
  const evoOfficial = await hr.eval(`fetch("/api/hr/performance/evolution").then(r => r.json())`);
  const evoAll = await hr.eval(`fetch("/api/hr/performance/evolution?includeNonOfficial=1").then(r => r.json())`);
  const evoRow = evoAll.cycles?.find((c) => c.name === "Ciclo piloto 2026-S2");
  step("33 painel com numerador/denominador; ciclo de teste fora da evolução oficial e rotulado na consulta do RH", /de 4/.test(await hr.eval(`document.querySelector('[data-testid="perf-dash-kpis"]').innerText`)) && !(evoOfficial.cycles ?? []).some((c) => c.name === "Ciclo piloto 2026-S2") && evoRow?.classification === "TEST", `oficial=${evoOfficial.cycles?.length ?? 0} · com teste=${evoAll.cycles?.length ?? 0}`);

  // consulta histórica (API da ficha) — mesma rota usada pela seção da ficha do colaborador
  const history = await hr.eval(`fetch("/api/hr/performance/employees/" + ${JSON.stringify(await hr.eval(`fetch("/api/hr/performance/cycles/${cycleId}/workspace").then(r => r.json()).then(ws => ws.people.find(p => p.participant.employeeName.includes("Ana Souza")).participant.employeeId)`))} + "/history?includeNonOfficial=1").then(r => r.json())`);
  step("34 consulta histórica (ciclo de teste só com includeNonOfficial)", history.cycles?.[0]?.quadrant === "Desempenho alto · Potencial médio", JSON.stringify(history.cycles?.[0] ?? {}).slice(0, 160));

  // responsividade do administrativo
  for (const vp of [{ width: 375, height: 812, mobile: true, name: "mobile" }, { width: 768, height: 1024, mobile: false, name: "tablet" }, { width: 1280, height: 800, name: "notebook" }, { width: 1920, height: 1080, name: "desktop" }]) {
    await hr.viewport(vp);
    await hr.goto(`${BASE}/performance-cycle`);
    await hr.waitTestId("perf-page", 30000);
    await hr.clickTestId("perf-tabs-tab-ciclos").catch(() => undefined);
    await hr.waitTestId("perf-cycle-desk", 20000);
    await sleep(600);
    const ov = await hr.overflow();
    await hr.shot(`35-admin-${vp.name}`);
    step(`35 administrativo ${vp.name} (${vp.width}px) sem rolagem lateral da página`, !ov.overflow, `scrollWidth=${ov.scrollWidth}`);
  }
  console.log("logs:", JSON.stringify(hr.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 6", false, error.message);
  try {
    await globalThis.__p?.shot("error-part6");
  } catch {}
} finally {
  writeResults("part6");
  await browser.close();
}
