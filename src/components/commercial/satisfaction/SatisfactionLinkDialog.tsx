/**
 * Diálogo do link público da pesquisa (individual ou geral).
 *
 * Existe porque copiar direto para o clipboard falhava em silêncio:
 * `navigator.clipboard` só está disponível em contexto seguro (HTTPS ou
 * localhost) — acessando a homologação por HTTP na LAN ele é `undefined` e o
 * antigo `navigator.clipboard?.writeText(...)` não copiava nada, mas a UI
 * dizia "copiado". Aqui o link é sempre VISÍVEL e selecionável, o botão
 * copiar tem fallback (`execCommand`) e reporta falha de verdade, e o QR
 * permite enviar por foto/WhatsApp sem depender de clipboard nenhum.
 *
 * Também resolve o teste interno: "Abrir pesquisa" abre o formulário público
 * na MESMA origem do app (extraindo o token do fragmento), então funciona
 * antes mesmo de o hostname público externo existir.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, ExternalLink, TriangleAlert, X } from "lucide-react";

export type SatisfactionLinkDialogData = {
  /** URL entregue pelo backend — pode ser absoluta (host público) ou relativa. */
  url: string;
  /** Prefixo não sensível do token, para o operador reconhecer o link. */
  tokenPrefix: string;
  /** true quando um link anterior foi invalidado nesta emissão. */
  rotated: boolean;
  /** Título do contexto: nome do cliente ou "Link geral". */
  title: string;
};

type Props = {
  data: SatisfactionLinkDialogData | null;
  onClose: () => void;
};

/** Copia com fallback para contexto não-seguro (HTTP na LAN). */
async function copyTextRobust(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* cai no fallback */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * URL de teste na MESMA origem do app: extrai o token do fragmento e monta
 * `origin/r#token`. Assim "Abrir pesquisa" funciona na homologação interna
 * mesmo antes do hostname público externo estar roteado.
 */
function buildSameOriginTestUrl(url: string): string | null {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) return null;
  const token = url.slice(hashIndex + 1);
  if (!token) return null;
  return `${window.location.origin}/r#${token}`;
}

export function SatisfactionLinkDialog({ data, onClose }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  // URL relativa (SATISFACTION_PUBLIC_BASE_URL ausente) vira absoluta na
  // origem atual — um QR de "/r#token" seria inutil no celular.
  const displayUrl = useMemo(() => {
    if (!data) return "";
    return data.url.startsWith("http")
      ? data.url
      : `${window.location.origin}${data.url}`;
  }, [data]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setCopyState("idle");
  }, [data?.url]);

  useEffect(() => {
    if (!data) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, onClose]);

  const testUrl = useMemo(
    () => (data ? buildSameOriginTestUrl(data.url) : null),
    [data]
  );

  const handleCopy = useCallback(async () => {
    if (!data) return;
    const ok = await copyTextRobust(displayUrl);
    setCopyState(ok ? "copied" : "failed");
    if (!ok) {
      // Deixa o link selecionado para o Ctrl+C manual.
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [data, displayUrl]);

  if (!data) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Link da pesquisa — ${data.title}`}
      data-testid="satisfaction-link-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[520px] overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#1e3a8a]">
              Comercial · Satisfação
            </p>
            <h2 className="text-[16px] font-bold text-[#0f172a]">
              Link da pesquisa — {data.title}
            </h2>
            <p className="mt-0.5 text-[12px] text-[#6b7280]">
              Identificador para suporte:{" "}
              <span className="font-mono font-semibold">{data.tokenPrefix}…</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#6b7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
            data-testid="satisfaction-link-dialog-close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          {data.rotated ? (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Um novo link foi gerado. <strong>O link anterior deixou de funcionar</strong> —
                envie somente este.
              </span>
            </div>
          ) : null}

          <div
            className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-[12px] text-blue-900"
            role="note"
          >
            <span>
              Por segurança, este link é exibido <strong>somente agora</strong>. Copie ou
              fotografe o QR antes de fechar — depois só será possível gerar um novo link
              (invalidando este).
            </span>
          </div>

          {/* Link sempre visível e selecionável — não dependemos do clipboard. */}
          <div>
            <label
              htmlFor="satisfaction-link-url"
              className="mb-1 block text-[12px] font-semibold text-[#374151]"
            >
              Link para enviar ao cliente
            </label>
            <div className="flex gap-2">
              <input
                id="satisfaction-link-url"
                ref={inputRef}
                readOnly
                value={displayUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-[#D1D5DB] bg-[#F9FAFB] px-3 py-2 font-mono text-[12px] text-[#111827]"
                data-testid="satisfaction-link-url"
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[#1D4ED8] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#1E40AF]"
                data-testid="satisfaction-link-copy"
              >
                {copyState === "copied" ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar
                  </>
                )}
              </button>
            </div>
            {copyState === "failed" ? (
              <p className="mt-1 text-[12px] font-medium text-[#B91C1C]" role="alert">
                O navegador bloqueou a cópia automática (conexão sem HTTPS). O link ficou
                selecionado acima — use Ctrl+C.
              </p>
            ) : null}
          </div>

          {/* QR: envia por foto/WhatsApp sem depender de clipboard. */}
          <div className="flex flex-col items-center gap-2 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-4">
            <QRCodeSVG
              value={displayUrl}
              size={180}
              marginSize={2}
              data-testid="satisfaction-link-qr"
            />
            <p className="text-[11px] text-[#6b7280]">
              O cliente pode apontar a câmera do celular para abrir a pesquisa.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F3F4F6] pt-3">
            {testUrl ? (
              <a
                href={testUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                data-testid="satisfaction-link-open-test"
                title="Abre o formulário público nesta mesma aplicação, em nova aba"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir pesquisa (testar como cliente)
              </a>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-2 text-[12px] font-semibold text-[#6b7280] hover:bg-[#F3F4F6]"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
