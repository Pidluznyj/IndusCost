import React, { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { PEOPLE_PROFILE_PHOTO_MAX_BYTES } from "@/src/lib/peopleProfileRecordEdits";
import { profileDelete, profileFetchJson } from "./profile/profileClient";
import { initialsFromName } from "./profile/profileUi";

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * Foto do colaborador no modal de edição. Grava na hora (independe de "Salvar alterações").
 * Sem <form> próprio: só botões type="button" + input de arquivo oculto.
 */
export function EmployeePhotoField({
  employeeId,
  employeeName,
  canManage,
}: {
  employeeId: string;
  employeeName: string;
  canManage: boolean;
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setPhotoUrl(null);
    setError(null);
    profileFetchJson(`/api/employees/${employeeId}/profile`, { signal: ac.signal })
      .then((body) => {
        const url = (body as { identity?: { photoUrl?: string | null } } | null)?.identity?.photoUrl;
        setPhotoUrl(typeof url === "string" && url ? url : null);
      })
      .catch(() => {
        /* sem resumo (403/erro): mostra só as iniciais */
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [employeeId]);

  const upload = async (file: File) => {
    setError(null);
    if (!PHOTO_ACCEPT.split(",").includes(file.type)) {
      setError("Use uma imagem JPG, PNG ou WebP.");
      return;
    }
    if (file.size > PEOPLE_PROFILE_PHOTO_MAX_BYTES) {
      setError("A foto deve ter no máximo 5 MB.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const body = (await profileFetchJson(`/api/employees/${employeeId}/photo`, {
        method: "POST",
        body: fd,
      })) as { photoUrl?: string | null } | null;
      setPhotoUrl(body?.photoUrl ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar a foto.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Remover a foto deste colaborador?")) return;
    setError(null);
    setBusy(true);
    try {
      await profileDelete(`/api/employees/${employeeId}/photo`);
      setPhotoUrl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a foto.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/20 px-4 py-3">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-full border border-border bg-primary/10 flex items-center justify-center text-lg font-bold text-primary">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={`Foto de ${employeeName}`}
            className="h-full w-full object-cover"
            onError={() => setPhotoUrl(null)}
          />
        ) : loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <span aria-hidden>{initialsFromName(employeeName || "?")}</span>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-primary/80">Foto</p>
        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={PHOTO_ACCEPT}
              className="hidden"
              aria-label="Selecionar foto do colaborador"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void upload(file);
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Camera className="h-3.5 w-3.5" aria-hidden />
              )}
              {photoUrl ? "Trocar foto" : "Enviar foto"}
            </button>
            {photoUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove()}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-accent disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remover
              </button>
            ) : null}
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          JPG, PNG ou WebP até 5 MB. A foto é gravada na hora, sem depender de “Salvar alterações”.
        </p>
        {error ? (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
