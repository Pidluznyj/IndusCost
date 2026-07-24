/**
 * PERFORMANCE 02 — probe de fetch + contador de renders (somente DEV + flag).
 * Não altera respostas; só observa.
 */
import {
  DEV_PERF_BASELINE_STORAGE_KEY,
  isDevPerfBaselineClientEnabled,
  type DevPerfEndpointSample,
} from "@/src/lib/devPerfBaseline.js";

const samples: DevPerfEndpointSample[] = [];
const renderCounts = new Map<string, number>();
let fetchInstalled = false;
let navStart = 0;

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function installDevPerfBaselineClient(): void {
  if (typeof window === "undefined" || fetchInstalled) return;
  if (!isDevPerfBaselineClientEnabled()) return;
  fetchInstalled = true;
  navStart = nowMs();

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET") ?? "GET")
      .toString()
      .toUpperCase();
    let path = "";
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      path = new URL(url, window.location.origin).pathname;
    } catch {
      path = String(input);
    }

    const track =
      path.startsWith("/api/sales-orders") ||
      path.startsWith("/api/finance/") ||
      path.startsWith("/api/commercial/sales-order-flow");

    if (!track) return originalFetch(input, init);

    const t0 = nowMs();
    const res = await originalFetch(input, init);
    const totalMs = Math.round((nowMs() - t0) * 100) / 100;
    const clone = res.clone();
    let payloadBytesApprox: number | null = null;
    try {
      const buf = await clone.arrayBuffer();
      payloadBytesApprox = buf.byteLength;
    } catch {
      payloadBytesApprox = null;
    }

    const perfHeader = res.headers.get("X-IndusCost-Perf");
    let dbMs: number | null = null;
    let queryCount: number | null = null;
    if (perfHeader) {
      const db = /dbMs=([\d.]+)/.exec(perfHeader);
      const q = /queries=(\d+)/.exec(perfHeader);
      if (db) dbMs = Number(db[1]);
      if (q) queryCount = Number(q[1]);
    }

    const sample: DevPerfEndpointSample = {
      scenario: `browser:${method}:${path}`,
      method,
      path,
      status: res.status,
      totalMs,
      dbMs,
      queryCount,
      payloadBytesApprox,
      rowCountApprox: null,
      notes: `t+${Math.round(nowMs() - navStart)}ms since install`,
    };
    samples.push(sample);
    // eslint-disable-next-line no-console
    console.info(
      `[perf-baseline:fetch] ${method} ${path} ${res.status} ${totalMs}ms bytes≈${payloadBytesApprox ?? "?"}`
    );
    return res;
  };

  // eslint-disable-next-line no-console
  console.info(
    `[perf-baseline] client ativo. Desligar: localStorage.removeItem("${DEV_PERF_BASELINE_STORAGE_KEY}")`
  );
  (window as unknown as { __induscostPerfBaseline?: object }).__induscostPerfBaseline = {
    getSamples: () => [...samples],
    getRenderCounts: () => Object.fromEntries(renderCounts),
    clear: () => {
      samples.length = 0;
      renderCounts.clear();
    },
  };
}

/** Conta renders de componentes principais (chamar no corpo do componente). */
export function noteDevPerfRender(componentName: string): void {
  if (!isDevPerfBaselineClientEnabled()) return;
  renderCounts.set(componentName, (renderCounts.get(componentName) ?? 0) + 1);
}

export function getDevPerfClientSamples(): DevPerfEndpointSample[] {
  return [...samples];
}

export function getDevPerfRenderCounts(): Record<string, number> {
  return Object.fromEntries(renderCounts);
}
