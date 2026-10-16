/**
 * Ficha de convite. O QR abre o portal. O código falado fica só na tela do RH.
 */
import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

type Card = { name: string; role?: string; cycle: string; url: string };

export function PerformanceInvitePrintPage() {
  const [cards, setCards] = useState<Card[]>([]);

  useEffect(() => {
    const raw = sessionStorage.getItem("ic-perf-print-cards");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Card[];
      if (Array.isArray(parsed)) setCards(parsed.filter((card) => card.url && card.name));
    } catch {
      setCards([]);
    }
  }, []);

  return (
    <main className="bg-white p-6 text-slate-900">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <p>Folhas de convite. O código de confirmação não está nesta página.</p>
        <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 text-white" onClick={() => window.print()}>Imprimir</button>
      </div>
      {cards.length === 0 && <p>Nenhum convite nesta sessão. Gere o convite na tela do ciclo e abra esta página de novo.</p>}
      <div className="grid gap-4">
        {cards.map((card) => (
          <article key={card.url} className="break-inside-avoid rounded-xl border border-slate-300 p-4">
            <p className="text-sm font-medium text-slate-500">IndusCost · Desempenho e Cultura</p>
            <h1 className="mt-1 text-xl font-semibold">{card.name}</h1>
            <p className="text-sm">{card.role} · {card.cycle}</p>
            <p className="mt-3 max-w-md text-sm">Aponte a câmera para o código. No celular, digite o número que o RH falar. A pesquisa não pede senha do sistema.</p>
            <div className="mt-4 flex justify-center">
              <QRCodeSVG value={card.url} size={180} includeMargin />
            </div>
            <p className="mt-3 text-xs text-slate-500">Documento interno. O link expira e pode ser cancelado pelo RH. Dúvida: procure o RH da unidade.</p>
          </article>
        ))}
      </div>
    </main>
  );
}
