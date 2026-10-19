// Driver mínimo do Chrome via DevTools Protocol (sem dependências).
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

export async function launch({ port = 9333, profile, out }) {
  mkdirSync(out, { recursive: true });
  const proc = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-features=Translate,PrivacySandboxSettings4",
    "--lang=pt-BR",
    "about:blank",
  ], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 60; i += 1) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error("Chrome não abriu");
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ""}`));
      else resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  const browser = {
    send,
    listeners,
    out,
    async newContext() {
      const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
      return browserContextId;
    },
    async newPage(contextId, viewport = { width: 1366, height: 900, mobile: false }) {
      const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId: contextId });
      return attach(browser, targetId, viewport);
    },
    async attachTarget(targetId, viewport) {
      return attach(browser, targetId, viewport);
    },
    async close() {
      try {
        await send("Browser.close");
      } catch {
        /* já fechado */
      }
      proc.kill();
    },
  };
  return browser;
}

async function attach(browser, targetId, viewport) {
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const logs = [];
  let loadWaiters = [];
  browser.listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
      logs.push({ type: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 400) });
    }
    if (msg.method === "Runtime.exceptionThrown") logs.push({ type: "exception", text: (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 400) });
    if (msg.method === "Page.loadEventFired") {
      for (const fn of loadWaiters) fn();
      loadWaiters = [];
    }
  });
  await send("Page.enable");
  await send("Runtime.enable");
  const page = {
    targetId,
    sessionId,
    send,
    logs,
    async viewport(v) {
      await send("Emulation.setDeviceMetricsOverride", { width: v.width, height: v.height, deviceScaleFactor: 1, mobile: Boolean(v.mobile) });
      if (v.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    },
    async goto(url, waitMs = 0) {
      const loaded = new Promise((resolve) => loadWaiters.push(resolve));
      await send("Page.navigate", { url });
      await Promise.race([loaded, sleep(30000)]);
      if (waitMs) await sleep(waitMs);
    },
    async eval(expression) {
      const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(`eval: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result.value;
    },
    async waitFor(predicate, { timeout = 20000, label = predicate } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          if (await page.eval(`Boolean(${predicate})`)) return true;
        } catch {
          /* ainda carregando */
        }
        await sleep(150);
      }
      throw new Error(`timeout esperando: ${label}`);
    },
    async waitTestId(testId, timeout) {
      return page.waitFor(`document.querySelector('[data-testid="${testId}"]')`, { timeout, label: testId });
    },
    async click(selector, { timeout = 15000 } = {}) {
      await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, { timeout, label: selector });
      const rect = await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block: "center", inline: "center", behavior: "instant"}); return new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => { const r = el.getBoundingClientRect(); ok( { x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: Boolean(el.disabled) }); }))); })()`);
      if (rect.disabled) throw new Error(`desabilitado: ${selector}`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
      }
      await sleep(120);
    },
    async clickTestId(testId, opts) {
      return page.click(`[data-testid="${testId}"]`, opts);
    },
    async clickText(text, tag = "button", { timeout = 15000 } = {}) {
      const finder = `[...document.querySelectorAll(${JSON.stringify(tag)})].find((el) => el.offsetParent !== null && (el.innerText || el.textContent || "").trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}))`;
      await page.waitFor(finder, { timeout, label: `${tag}:${text}` });
      const marker = `pw-${Math.random().toString(36).slice(2)}`;
      await page.eval(`(() => { const el = ${finder}; el.setAttribute("data-pw", "${marker}"); })()`);
      return page.click(`[data-pw="${marker}"]`);
    },
    async type(selector, text, { clear = true } = {}) {
      await page.waitFor(`document.querySelector(${JSON.stringify(selector)})`, { label: selector });
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block: "center", behavior: "instant"}); el.focus(); if (${clear}) { el.select?.(); } })()`);
      if (clear) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 });
      }
      await send("Input.insertText", { text });
      await sleep(80);
    },
    async select(selector, value) {
      await page.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; setter.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
      await sleep(120);
    },
    async shot(name) {
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const file = join(browser.out, `${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
    async fullShot(name) {
      const metrics = await send("Page.getLayoutMetrics");
      const width = Math.ceil(metrics.cssContentSize?.width ?? metrics.contentSize.width);
      const height = Math.min(6000, Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height));
      const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
      const file = join(browser.out, `${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
    async pdf(name) {
      const { data } = await send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true });
      const file = join(browser.out, `${name}.pdf`);
      writeFileSync(file, Buffer.from(data, "base64"));
      return file;
    },
    async overflow() {
      return page.eval(`({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 })`);
    },
    async text() {
      return page.eval(`document.body.innerText`);
    },
    async close() {
      await browser.send("Target.closeTarget", { targetId });
    },
  };
  if (viewport) await page.viewport(viewport);
  return page;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
