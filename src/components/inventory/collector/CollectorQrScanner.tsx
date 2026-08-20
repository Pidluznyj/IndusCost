/**
 * FASE 3 — scanner de QR do Collector.
 *
 * Usa a capability nativa do browser (BarcodeDetector + getUserMedia) — sem
 * biblioteca de scanning. Nos coletores Android/Chrome isso é suportado; onde
 * não for, o fallback manual permite digitar/colar o conteúdo da etiqueta,
 * que passa pela MESMA validação server-side (resolve-qr). O fallback não é
 * bypass de nada: autorização continua no deviceAuth.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";

type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

type Props = {
  /** Chamado com o texto cru do QR — a validação é toda do servidor. */
  onScan: (rawText: string) => void;
  disabled?: boolean;
};

export function CollectorQrScanner({ onScan, disabled }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<
    "starting" | "active" | "unavailable" | "insecure"
  >("starting");
  const [manualText, setManualText] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    async function start() {
      // Câmera exige contexto seguro (HTTPS ou localhost) — regra do browser,
      // sem bypass. Fora disso, só a entrada manual.
      if (!globalThis.isSecureContext) {
        setCameraState("insecure");
        setShowManual(true);
        return;
      }
      const Detector = getBarcodeDetectorCtor();
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        setShowManual(true);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraState("active");

        const detector = new Detector({ formats: ["qr_code"] });
        interval = setInterval(() => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || disabled) return;
          void detector
            .detect(video)
            .then((codes) => {
              const raw = codes[0]?.rawValue;
              if (raw) onScan(raw);
            })
            .catch(() => {
              /* frame ruim — tenta o próximo */
            });
        }, 350);
      } catch {
        if (!cancelled) {
          setCameraState("unavailable");
          setShowManual(true);
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stopCamera();
    };
  }, [onScan, disabled, attempt, stopCamera]);

  return (
    <div className="flex flex-col gap-3">
      {cameraState !== "unavailable" && cameraState !== "insecure" ? (
        <div className="relative overflow-hidden rounded-2xl bg-black" data-testid="collector-camera">
          <video ref={videoRef} className="h-64 w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="h-40 w-40 rounded-xl border-4 border-emerald-400/80" />
          </div>
          {cameraState === "starting" ? (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-lg text-white">
              Abrindo câmera…
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-base text-amber-900">
          {cameraState === "insecure"
            ? "Conexão sem HTTPS: o navegador bloqueia a câmera. Acesse pelo endereço https:// do tailnet ou use o campo abaixo."
            : "Câmera indisponível neste aparelho/navegador. Use o campo abaixo para digitar ou colar o conteúdo da etiqueta."}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setAttempt((n) => n + 1)}
          className="flex-1 rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 active:bg-slate-100"
        >
          Tentar câmera novamente
        </button>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="flex-1 rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-800 active:bg-slate-100"
        >
          Digitar código
        </button>
      </div>

      {showManual ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manualText.trim()) {
              onScan(manualText.trim());
              setManualText("");
            }
          }}
        >
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder="Cole aqui o conteúdo da etiqueta QR"
            rows={3}
            className="w-full rounded-xl border-2 border-slate-300 px-3 py-2 text-base"
            data-testid="collector-manual-qr"
          />
          <button
            type="submit"
            disabled={disabled || !manualText.trim()}
            className="rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-40"
          >
            Identificar etiqueta
          </button>
        </form>
      ) : null}
    </div>
  );
}
