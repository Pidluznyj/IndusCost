import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mail,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk, fetchOk } from "@/src/lib/http";
import type { MaterialMarketQuoteAttachmentApiItem } from "@/src/lib/materialMarketQuoteAttachment";
import {
  getMaterialMarketQuoteAttachmentDownloadApiPath,
  getMaterialMarketQuoteAttachmentsApiPath,
} from "@/src/lib/materialsNavigation";
import { cn } from "@/src/lib/utils";

type Props = {
  materialId: string;
  quoteId: string;
  canEdit: boolean;
  onAttachmentsChanged?: () => void;
};

function attachmentIcon(type: MaterialMarketQuoteAttachmentApiItem["attachmentType"]) {
  switch (type) {
    case "IMAGE":
      return ImageIcon;
    case "SPREADSHEET":
      return FileSpreadsheet;
    case "EMAIL":
      return Mail;
    default:
      return FileText;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("pt-BR");
}

export function MaterialMarketQuoteAttachmentsPanel({
  materialId,
  quoteId,
  canEdit,
  onAttachmentsChanged,
}: Props) {
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MaterialMarketQuoteAttachmentApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<{ items: MaterialMarketQuoteAttachmentApiItem[] }>(
        getMaterialMarketQuoteAttachmentsApiPath(materialId, quoteId)
      );
      setItems(data.items);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Não foi possível carregar os anexos desta cotação."
      );
    } finally {
      setLoading(false);
    }
  }, [materialId, quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFile = async (file: File) => {
    if (!canEdit) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(getMaterialMarketQuoteAttachmentsApiPath(materialId, quoteId), {
        method: "POST",
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof data.message === "string" ? data.message : "Não foi possível enviar o arquivo."
        );
      }
      await load();
      onAttachmentsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao enviar anexo.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await uploadFile(file);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadFile(file);
  };

  const handleRemove = async (attachmentId: string) => {
    if (!window.confirm("Remover este anexo? Esta ação não pode ser desfeita.")) return;
    setRemovingId(attachmentId);
    setError(null);
    try {
      await fetchOk(
        `${getMaterialMarketQuoteAttachmentsApiPath(materialId, quoteId)}/${attachmentId}`,
        { method: "DELETE" }
      );
      await load();
      onAttachmentsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover o anexo.");
    } finally {
      setRemovingId(null);
    }
  };

  const canRemove = (item: MaterialMarketQuoteAttachmentApiItem) =>
    canEdit || (auth.user?.id && item.uploadedBy === auth.user.id);

  return (
    <div
      className="space-y-3 rounded-lg border border-border bg-background/80 p-3"
      data-testid={`material-market-quote-attachments-${quoteId}`}
    >
      <p className="text-sm font-semibold">Documentos anexados</p>

      {canEdit ? (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-4 text-center transition-colors",
            dragOver ? "border-primary bg-primary/5" : "border-border bg-muted/20"
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void handleDrop(e)}
        >
          <Paperclip className="h-5 w-5 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground">
            Arraste um arquivo ou selecione PDF, imagem, planilha, e-mail ou proposta.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.eml,.msg,.doc,.docx,application/pdf,image/*"
            onChange={(e) => void handleFileInput(e)}
            disabled={uploading}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            data-testid={`material-market-quote-attachment-upload-${quoteId}`}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="h-3.5 w-3.5" aria-hidden />
            )}
            Enviar anexo
          </button>
        </div>
      ) : null}

      {error ? (
        <p
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
          data-testid={`material-market-quote-attachment-error-${quoteId}`}
        >
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground py-2 text-center">Carregando anexos…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2 text-center">
          Nenhum documento anexado a esta cotação.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((item) => {
            const Icon = attachmentIcon(item.attachmentType);
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm"
                data-testid={`material-market-quote-attachment-row-${item.id}`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.originalFileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.attachmentTypeLabel} · {formatFileSize(item.fileSize)} ·{" "}
                    {formatUploadedAt(item.uploadedAt)}
                  </p>
                </div>
                {item.suggestedReliabilityLabel ? (
                  <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Conf. {item.suggestedReliabilityLabel}
                  </span>
                ) : null}
                <a
                  href={getMaterialMarketQuoteAttachmentDownloadApiPath(
                    materialId,
                    quoteId,
                    item.id
                  )}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-accent"
                  data-testid={`material-market-quote-attachment-download-${item.id}`}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                  Baixar
                </a>
                {canRemove(item) ? (
                  <button
                    type="button"
                    disabled={removingId === item.id}
                    onClick={() => void handleRemove(item.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                    data-testid={`material-market-quote-attachment-remove-${item.id}`}
                  >
                    {removingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    )}
                    Remover
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
