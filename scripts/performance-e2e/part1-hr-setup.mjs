// Parte 1: RH entra, cria e edita o modelo, publica, cria o ciclo, escolhe pessoas,
// atribui líder, prepara, abre e emite os convites.
import { BASE, login, openModule, saveState, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9333);
try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = hr;

  await login(hr, "rh.teste@induscost.test");
  step("01 login do RH", true, await hr.eval("location.pathname"));

  await openModule(hr);
  await hr.shot("02-modulo-rh");
  const tabs = await hr.eval(`[...document.querySelectorAll('[data-testid="perf-tabs"] [role="tab"], [data-testid="perf-tabs"] button')].map(b => b.innerText.trim())`);
  step("02 acesso ao módulo", tabs.length >= 6, tabs.join(" | "));

  // 03 modelo
  await hr.clickTestId("perf-tabs-tab-modelos");
  await hr.waitTestId("perf-models-tab");
  await hr.clickTestId("perf-model-new");
  await hr.waitTestId("perf-model-create");
  await hr.type('[data-testid="perf-model-create-name"]', "Avaliação piloto 2026");
  await hr.clickTestId("perf-model-create-save");
  await hr.waitTestId("perf-model-editor", 20000);
  await hr.waitTestId("perf-question-DT-01");
  step("03 criação de modelo (rascunho com 12 perguntas)", (await hr.eval(`document.querySelectorAll('[data-testid^="perf-question-"][data-testid$="-self"]').length`)) === 12);

  // 04 edição das 12 perguntas: edita o texto de várias, a regra e reordena
  await hr.type('[data-testid="perf-question-DT-01-self"]', "Eu faço o meu trabalho com a qualidade pedida, sem retrabalho.");
  await hr.type('[data-testid="perf-question-DT-01-leader"]', "Faz o trabalho com a qualidade pedida, sem retrabalho.");
  await hr.type('[data-testid="perf-question-PO-02-self"]', "Eu dou ideias para melhorar o trabalho do meu setor.");
  await hr.type('[data-testid="perf-question-PO-02-leader"]', "Dá ideias para melhorar o trabalho do setor dele ou dela.");
  await hr.type('[data-testid="perf-rule-ruleSetId"]', "piloto-local-2026");
  await hr.clickTestId("perf-question-DT-03-add-role");
  await hr.type('[data-testid="perf-question-DT-03-role-0"]', "[DEMO] Operador de produção");
  await hr.type('[data-testid="perf-question-DT-03-role-text-0"]', "Regula a extrusora pela instrução de trabalho sem ajuda.");
  await hr.shot("04a-editor-modelo");
  await hr.clickTestId("perf-model-save");
  await hr.waitFor(`![...document.querySelectorAll('[data-testid="perf-model-save"]')].some(b => !b.disabled)`, { label: "salvou" });
  await sleep(500);
  await hr.click('[aria-label="Subir DT-02"]');
  await sleep(800);
  const order = await hr.eval(`[...document.querySelectorAll('[data-testid^="perf-question-DT-"]')].filter(e => /^perf-question-DT-0\\d$/.test(e.dataset.testid)).map(e => e.dataset.testid.replace("perf-question-", ""))`);
  step("04 edição das perguntas, regra e reordenação", order[0] === "DT-02" && order[1] === "DT-01", order.join(","));
  await hr.clickTestId("perf-model-preview-self");
  await hr.waitTestId("perf-model-preview-self");
  await hr.shot("04b-previa-pessoa");
  await hr.clickTestId("perf-model-preview-self");

  // 05 publicação
  await hr.clickTestId("perf-model-publish");
  await hr.waitTestId("perf-model-publish-confirm");
  await hr.clickTestId("perf-model-publish-confirm-save");
  await hr.waitTestId("perf-model-readonly", 20000);
  await hr.shot("05-modelo-publicado");
  step("05 publicação (versão fica somente leitura)", true);
  await hr.click('[data-testid="perf-model-editor"] button[aria-label="Fechar"], [data-testid="perf-model-editor"] [aria-label^="Fechar"]').catch(async () => hr.clickText("Fechar"));
  await sleep(500);

  // 06 ciclo
  await hr.clickTestId("perf-tabs-tab-ciclos");
  await hr.waitTestId("perf-cycles-tab");
  await hr.clickTestId("perf-cycle-new");
  await hr.waitTestId("perf-cycle-create");
  await hr.type('[data-testid="perf-cycle-create-name"]', "Ciclo piloto 2026-S2");
  await hr.type('[data-testid="perf-cycle-create-period"]', "2º semestre de 2026");
  // O tipo do ciclo não tem valor padrão na tela (ciclo de vida): o roteiro escolhe oficial.
  // Piloto local: ciclo de teste (o oficial exige o modelo de liderança, que a parte 1 não cria).
  await hr.select('[data-testid="perf-cycle-create-classification"]', "TEST");
  await hr.clickTestId("perf-cycle-create-save");
  await hr.waitTestId("perf-cycle-desk", 20000);
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-title"]')?.innerText.includes("Ciclo piloto 2026-S2")`);
  step("06 criação de ciclo", true);

  // 07 seleção de colaboradores (busca + todos do resultado + prévia de elegibilidade)
  await hr.clickTestId("perf-add-people");
  await hr.waitTestId("perf-add-people-dialog");
  await hr.type('[data-testid="perf-add-search"]', "[DEMO]");
  await hr.clickText("Buscar");
  await hr.waitFor(`document.querySelectorAll('[data-testid^="perf-add-pick-"]').length >= 10`, { label: "resultados" });
  for (const name of ["Carla Gerente", "Marcos Manutenção", "Bruno Líder"]) {
    // gestores não entram neste piloto
  }
  await hr.clickTestId("perf-add-select-all");
  for (const name of ["Carla Gerente", "Marcos Manutenção", "Bruno Líder"]) {
    await hr.click(`[data-testid="perf-add-pick-[DEMO] ${name}"]`);
  }
  await hr.shot("07a-selecao-pessoas");
  await hr.clickTestId("perf-add-people-dialog-save");
  await hr.waitTestId("perf-add-preview");
  await hr.shot("07b-previa-elegibilidade");
  const previewText = await hr.eval(`document.querySelector('[data-testid="perf-add-preview"]').innerText`);
  await hr.clickTestId("perf-add-people-dialog-save");
  await hr.waitFor(`document.querySelectorAll('[data-testid^="perf-person-"]').length >= 7`, { label: "pessoas na mesa" });
  await hr.shot("07c-mesa-com-pessoas");
  step("07 seleção de colaboradores e elegibilidade", /Não elegível/.test(previewText) && /Evidência insuficiente/.test(previewText), previewText.split("\n").filter((l) => /Elegível|Não elegível|Evidência/.test(l)).join(" / "));

  // 08 atribuição de líder por seletor visual (Fabi não tem gestor no cadastro)
  await hr.clickTestId("perf-leader-[DEMO] Fabi Sem Líder");
  await hr.waitTestId("perf-leader-dialog");
  await hr.type('[data-testid="perf-leader-picker-search"]', "Bruno");
  await hr.clickText("[DEMO] Bruno Líder", "button");
  await hr.waitTestId("perf-leader-picker-selected");
  await hr.type('[data-testid="perf-leader-reason"]', "Expedição sem gestor no cadastro; Bruno acompanha o turno.");
  await hr.shot("08-troca-lider");
  await hr.clickTestId("perf-leader-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-person-[DEMO] Fabi Sem Líder"]')?.innerText.includes("Bruno")`, { label: "líder atribuído" });
  step("08 atribuição de líder sem identificador interno", true);

  // 09 preparação
  await hr.clickTestId("perf-cycle-next");
  await hr.waitTestId("perf-transition-dialog");
  await hr.clickTestId("perf-transition-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-desk"]').innerText.includes("Abrir ciclo")`, { label: "preparado" });
  step("09 preparação", true);

  // 10 abertura com confirmação de piloto
  await hr.clickTestId("perf-cycle-next");
  await hr.waitTestId("perf-pilot-ack");
  const disabledBefore = await hr.eval(`document.querySelector('[data-testid="perf-transition-dialog-save"]').disabled`);
  await hr.click('[data-testid="perf-pilot-ack"]');
  await hr.shot("10-abertura-piloto");
  await hr.clickTestId("perf-transition-dialog-save");
  await hr.waitTestId("perf-invites-batch", 20000);
  step("10 abertura (exige aceite de piloto)", disabledBefore === true);

  // 11 emissão de QR Code em lote
  await hr.clickTestId("perf-invites-batch");
  await hr.waitTestId("perf-issued-panel", 20000);
  await hr.shot("11-convites-emitidos");
  const cards = await hr.eval(`JSON.parse(sessionStorage.getItem("ic-perf-print-cards") || "[]")`);
  const otps = await hr.eval(`Object.fromEntries([...document.querySelectorAll('[data-testid^="perf-otp-"]')].map(e => [e.dataset.testid.replace("perf-otp-", ""), e.innerText.trim()]))`);
  const ana = cards.find((c) => c.name.includes("Ana Souza"));
  step("11 emissão de QR Code (lote)", Boolean(ana && otps["[DEMO] Ana Souza"]), `${cards.length} fichas`);
  const cycleId = await hr.eval(`sessionStorage.getItem("ic-perf-cycle")`);

  // 11b ficha impressa sem código
  // Usa o botão real: a ficha abre em outra aba e herda o sessionStorage da aba do RH.
  const before = new Set((await browser.send("Target.getTargets")).targetInfos.map((t) => t.targetId));
  await hr.clickTestId("perf-invites-print");
  let printTarget = null;
  for (let i = 0; i < 50 && !printTarget; i += 1) {
    await sleep(200);
    printTarget = (await browser.send("Target.getTargets")).targetInfos.find((t) => !before.has(t.targetId) && t.type === "page");
  }
  if (!printTarget) throw new Error("aba das fichas não abriu");
  const print = await browser.attachTarget(printTarget.targetId, { width: 1000, height: 1200 });
  await sleep(1500);
  await print.waitTestId("perf-invite-sheet", 30000);
  await print.waitFor(`document.querySelectorAll('[data-testid^="perf-invite-card-"]').length >= 3`);
  const printText = await print.text();
  const leaked = Object.values(otps).some((code) => printText.includes(code));
  await print.fullShot("11b-fichas-impressao");
  await print.pdf("fichas-convite");
  step("11b ficha impressa não expõe o código", !leaked, `${(await print.eval(`document.querySelectorAll('[data-testid^="perf-invite-card-"]').length`))} fichas`);
  await print.close();

  saveState({ cycleId, invites: cards, otps });
  console.log("logs RH:", JSON.stringify(hr.logs.filter((l) => l.type !== "warning").slice(0, 10)));
} catch (error) {
  step("ERRO parte 1", false, error.message);
  try {
    const pages = await browser.send("Target.getTargets");
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    await globalThis.__hr?.shot("error-part1");
    console.log("logs:", JSON.stringify(globalThis.__hr?.logs.slice(-8)));
  } catch (e) { console.log("debug falhou", e.message); }
} finally {
  writeResults("part1");
  await browser.close();
}
