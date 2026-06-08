import React, { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Loader2, Power, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { fetchJsonOk } from "@/src/lib/http";
import { copyTextToClipboard } from "@/src/lib/clipboardCopy";
import { formatFleetApiError } from "@/src/components/fleet/fleetUi";

type TokenInfo = {
  vehicleId: string;
  hasToken: boolean;
  publicToken: string | null;
  status: string | null;
  revokedAt: string | null;
  baseUrl: string | null;
  publicPath: string | null;
  publicUrl: string | null;
};

type Props = {
  vehicleId: string;
  canManage: boolean;
};

export function FleetVehicleChecklistQrPanel({ vehicleId, canManage }: Props) {
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<TokenInfo>(
        `/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/checklist-token`
      );
      setInfo(data);
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao carregar QR de checklist."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/checklist-token`, {
        method: "POST",
      });
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao gerar token."));
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    if (!canManage) return;
    if (
      !window.confirm(
        "Regenerar o token invalidará QR Codes impressos anteriormente. Continuar?"
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchJsonOk(
        `/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/checklist-token/regenerate`,
        { method: "POST" }
      );
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao regenerar token."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!canManage) return;
    if (!window.confirm("Revogar o QR Code? O link deixará de funcionar até gerar um novo.")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await fetchJsonOk(
        `/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/checklist-token/revoke`,
        { method: "POST" }
      );
      await load();
    } catch (e: unknown) {
      setError(formatFleetApiError(e, "Erro ao revogar token."));
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    const url = info?.publicUrl ?? info?.publicPath;
    if (!url) return;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const qrValue = info?.publicUrl ?? info?.publicPath ?? "";
  const isActive = info?.status === "ACTIVE" && info?.hasToken;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <QrCode className="h-5 w-5 text-slate-600" />
        <h3 className="font-semibold text-slate-900">QR Code de checklist do veículo</h3>
      </div>
      <p className="text-sm text-slate-600">
        Imprima e fixe este QR dentro do carro. O condutor escaneia, informa o CPF e faz check-in ou
        check-out da reserva compatível.
      </p>
      <p className="text-xs text-slate-500">
        Use a mesma <strong>publicReservationBaseUrl</strong> dos parâmetros de frota (ex.:{" "}
        <code>http://192.168.100.5:3000</code>).
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={
                isActive
                  ? "rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800"
                  : "rounded-full bg-slate-100 px-2 py-0.5 text-slate-600"
              }
            >
              {isActive ? "Token ativo" : info?.status === "REVOKED" ? "Revogado" : "Sem token"}
            </span>
          </div>

          {isActive && qrValue && (
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <div className="rounded-lg border bg-white p-3">
                <QRCodeSVG value={qrValue} size={180} level="M" />
              </div>
              <div className="flex-1 space-y-2 text-sm w-full">
                <p className="break-all font-mono text-xs text-slate-700">{qrValue}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                    onClick={() => void copyLink()}
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? "Copiado!" : "Copiar link"}
                  </button>
                  {info?.publicUrl?.startsWith("http") && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
                      onClick={() => window.open(info.publicUrl!, "_blank")}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Abrir
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Imprima em tamanho legível (mín. 4×4 cm) e proteja contra umidade.
                </p>
              </div>
            </div>
          )}

          {canManage && (
            <div className="flex flex-wrap gap-2 pt-1">
              {!info?.hasToken || info.status === "REVOKED" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void generate()}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                  Gerar QR
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void regenerate()}
                    className="inline-flex items-center gap-1 rounded border px-3 py-2 text-sm"
                  >
                    <RefreshCw className={cnIcon(busy)} />
                    Regenerar token
                  </button>
                  <button
                    type="button"
                    disabled={busy || info.status === "REVOKED"}
                    onClick={() => void revoke()}
                    className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-2 text-sm text-red-700"
                  >
                    <Power className="h-4 w-4" />
                    Revogar
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function cnIcon(spin: boolean) {
  return spin ? "h-4 w-4 animate-spin" : "h-4 w-4";
}
