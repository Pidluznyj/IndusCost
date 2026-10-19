/**
 * Fichas de convite (individual ou lote). O QR abre o portal; o código de confirmação
 * fica só na tela do RH e nunca nesta folha. Os links vêm da emissão feita nesta sessão
 * do navegador (o servidor guarda só o resumo criptográfico do token).
 */
import React, { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Printer, Trash2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { mergePrintBranding, resolvePrintLogoSrc } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import { formatDateBr } from "@/src/lib/hrPerformance/performanceDomain";
import { PRINT_CARDS_KEY } from "./CycleDesk";
import "./performance-print.css";

type Card = { name: string; role?: string; cycle: string; url: string; expiresAt?: string };

function readCards(): Card[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(PRINT_CARDS_KEY) || "[]") as Card[];
    return Array.isArray(parsed) ? parsed.filter((card) => card.url && card.name) : [];
  } catch {
    return [];
  }
}

export function PerformanceInvitePrintPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [cycle, setCycle] = useState("");
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  usePrintRouteBodyClass("perf-print-route");

  useEffect(() => {
    try {
      window.opener = null;
    } catch {
      /* sem opener */
    }
    const loaded = readCards();
    setCards(loaded);
    setCycle(loaded.at(-1)?.cycle ?? "");
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then((brand) => setBranding(mergePrintBranding(brand, DEFAULT_BRANDING)))
      .catch(() => undefined);
    const style = document.createElement("style");
    style.setAttribute("data-perf-invite-page", "true");
    style.textContent = "@page { size: A4 portrait; margin: 10mm; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const cycles = useMemo(() => [...new Set(cards.map((c) => c.cycle))], [cards]);
  const shown = cards.filter((c) => !cycle || c.cycle === cycle).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const logo = resolvePrintLogoSrc(branding);

  return (
    <div className="perf-print-page min-h-screen bg-slate-100 p-4 print:bg-white print:p-0">
      <div className="print-no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-3">
        <div className="text-sm">
          <p className="font-semibold">Fichas de convite · {shown.length}</p>
          <p className="text-xs text-slate-600">O código de confirmação não está nesta página. Entregue a ficha e fale o código pessoalmente.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {cycles.length > 1 ? (
            <select className="h-9 rounded-lg border border-border px-2 text-sm" aria-label="Ciclo" value={cycle} onChange={(e) => setCycle(e.target.value)}>
              {cycles.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
            onClick={() => {
              sessionStorage.removeItem(PRINT_CARDS_KEY);
              setCards([]);
            }}
          >
            <Trash2 className="h-4 w-4" aria-hidden /> Limpar fichas
          </button>
          <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground" onClick={() => triggerBrowserPrint()} disabled={shown.length === 0} data-testid="perf-invite-print">
            <Printer className="h-4 w-4" aria-hidden /> Imprimir
          </button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="print-no-print mx-auto max-w-[210mm] text-sm">Nenhuma ficha nesta sessão. Gere os convites na tela do ciclo e abra esta página de novo.</p>
      ) : null}
      <div className="mx-auto max-w-[210mm] bg-white p-[10mm] print:p-0" data-testid="perf-invite-sheet">
        {shown.map((card) => (
          <article key={card.url} className="perf-invite-card" data-testid={`perf-invite-card-${card.name}`}>
            <div className="flex items-center gap-3 border-b border-slate-200 pb-2">
              {logo ? <img src={logo} alt={branding.companyName} className="h-9 w-auto" /> : null}
              <div className="text-xs text-slate-600">
                <p className="font-semibold text-slate-900">{branding.companyName}</p>
                <p>Recursos Humanos · Pesquisa de desempenho e cultura</p>
              </div>
            </div>
            <h1 className="text-xl font-bold">{card.name}</h1>
            <p className="text-sm text-slate-700">
              {card.role ? `${card.role} · ` : ""}
              {card.cycle}
            </p>
            <ol className="perf-invite-steps">
              <li>Abra a câmera do celular e aponte para o quadrado abaixo.</li>
              <li>Toque no link que aparecer.</li>
              <li>Digite o código de 6 números que o RH vai falar para você.</li>
              <li>Responda uma pergunta por vez. Não precisa de senha do sistema.</li>
            </ol>
            <div className="perf-invite-qr">
              <QRCodeSVG value={card.url} size={160} marginSize={2} title={`Convite de ${card.name}`} />
            </div>
            <p className="text-xs text-slate-600">
              Este convite é pessoal. {card.expiresAt ? `Vale até ${formatDateBr(card.expiresAt)}. ` : ""}Se perder a folha, procure o RH: um novo convite cancela este. Sem celular? O RH ajuda você a responder num aparelho da empresa.
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
