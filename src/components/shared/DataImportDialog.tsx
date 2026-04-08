// src/components/shared/DataImportDialog.tsx
import React, { useState, useRef } from "react";
import { 
  X, 
  Upload, 
  Download, 
  FileSpreadsheet, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  ChevronRight,
  AlertTriangle,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/src/lib/utils";
import { ImportEntityConfig, ImportResult, ImportError } from "@/src/lib/importer/types";

interface DataImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  config: ImportEntityConfig;
  templateUrl: string;
  previewUrl: string;
  confirmUrl: string;
}

export const DataImportDialog = ({
  isOpen,
  onClose,
  onSuccess,
  config,
  templateUrl,
  previewUrl,
  confirmUrl
}: DataImportDialogProps) => {
  const [step, setStep] = useState<"upload" | "preview" | "success">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<ImportResult<any> | Record<string, ImportResult<any>> | null>(null);
  const [activeSheet, setActiveSheet] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ count?: number; skipped?: number; productsCreated?: number; bomCreated?: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(previewUrl, {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      setPreviewData(data);
      if (data && !data.data && typeof data === "object") {
        setActiveSheet(Object.keys(data)[0]);
      }
      setStep("preview");
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!previewData) return;
    
    const isMulti = !("data" in previewData);
    const payload = isMulti 
      ? Object.entries(previewData as Record<string, ImportResult<any>>).reduce((acc, [k, v]) => ({ ...acc, [k.toLowerCase()]: v.data }), {})
      : { data: (previewData as ImportResult<any>).data };

    setLoading(true);

    try {
      const res = await fetch(confirmUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      setImportResult(result);
      setStep("success");
      onSuccess();
    } catch (error) {
      console.error("Confirm error:", error);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setFile(null);
    setPreviewData(null);
    setActiveSheet(null);
    setImportResult(null);
  };

  if (!isOpen) return null;

  const currentPreview = activeSheet && previewData && !("data" in previewData) 
    ? (previewData as Record<string, ImportResult<any>>)[activeSheet] 
    : (previewData as ImportResult<any>);

  const totalValidRows = previewData && !("data" in previewData)
    ? Object.values(previewData as Record<string, ImportResult<any>>).reduce((acc, v) => acc + v.validRows, 0)
    : (previewData as ImportResult<any>)?.validRows || 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-card w-full max-w-4xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Importar {config.entityName}s</h3>
              <p className="text-xs text-muted-foreground">Siga os passos para importar dados via planilha</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-full transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {step === "upload" && (
              <motion.div 
                key="upload"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h4 className="font-bold flex items-center gap-2">
                      <Download className="h-4 w-4 text-primary" />
                      1. Baixe o Modelo
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Utilize nossa planilha padrão para garantir que os dados estejam no formato correto.
                    </p>
                    <a 
                      href={templateUrl}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 transition-colors text-sm font-medium"
                    >
                      <Download className="h-4 w-4" />
                      Baixar Template .xlsx
                    </a>
                  </div>
                  <div className="space-y-4">
                    <h4 className="font-bold flex items-center gap-2">
                      <Info className="h-4 w-4 text-primary" />
                      Instruções
                    </h4>
                    <ul className="text-xs text-muted-foreground space-y-2">
                      <li>• Não altere o cabeçalho da planilha.</li>
                      <li>• Campos marcados como [OBRIGATÓRIO] devem ser preenchidos.</li>
                      <li>• Verifique os tipos de dados (números, datas, etc).</li>
                      <li>• O sistema validará duplicidade de códigos.</li>
                    </ul>
                  </div>
                </div>

                <div className="pt-6 border-t border-border">
                  <h4 className="font-bold flex items-center gap-2 mb-4">
                    <Upload className="h-4 w-4 text-primary" />
                    2. Faça o Upload
                  </h4>
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "border-2 border-dashed border-border rounded-xl p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all",
                      file && "border-primary bg-primary/5"
                    )}
                  >
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleFileChange} 
                      className="hidden" 
                      accept=".xlsx,.xls,.csv"
                    />
                    {file ? (
                      <div className="space-y-2">
                        <FileSpreadsheet className="h-12 w-12 mx-auto text-primary" />
                        <p className="font-bold text-sm">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(2)} KB</p>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Remover arquivo
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                        <p className="font-medium">Clique ou arraste o arquivo aqui</p>
                        <p className="text-xs text-muted-foreground">Suporta .xlsx, .xls e .csv</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {step === "preview" && currentPreview && (
              <motion.div 
                key="preview"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-bold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    3. Pré-visualização e Validação
                  </h4>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Total</p>
                      <p className="text-sm font-bold">{currentPreview.totalRows}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-green-600 uppercase">Válidos</p>
                      <p className="text-sm font-bold text-green-600">{currentPreview.validRows}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] font-bold text-red-600 uppercase">Erros</p>
                      <p className="text-sm font-bold text-red-600">{currentPreview.invalidRows}</p>
                    </div>
                  </div>
                </div>

                {/* Sheet Tabs */}
                {activeSheet && previewData && !("data" in previewData) && (
                  <div className="flex items-center gap-2 border-b border-border">
                    {Object.keys(previewData as Record<string, ImportResult<any>>).map(sheet => (
                      <button
                        key={sheet}
                        onClick={() => setActiveSheet(sheet)}
                        className={cn(
                          "px-4 py-2 text-xs font-bold border-b-2 transition-all",
                          activeSheet === sheet 
                            ? "border-primary text-primary bg-primary/5" 
                            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50"
                        )}
                      >
                        {sheet} ({ (previewData as Record<string, ImportResult<any>>)[sheet].validRows })
                      </button>
                    ))}
                  </div>
                )}

                {currentPreview.errors.length > 0 && (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 space-y-2">
                    <p className="text-xs font-bold text-red-600 flex items-center gap-2">
                      <AlertCircle className="h-3 w-3" />
                      Erros Encontrados ({currentPreview.errors.length})
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {currentPreview.errors.map((err, i) => (
                        <p key={i} className="text-[10px] text-red-500">
                          Linha {err.row}: {err.column ? `[${err.column}] ` : ""}{err.message}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="sticky top-0 bg-accent z-10">
                        <tr>
                          {/* Use keys from the first row of data if available, or fallback to config if it matches activeSheet */}
                          {Object.keys(currentPreview.data[0] || {}).map(key => (
                            <th key={key} className="p-2 font-bold border-b border-border uppercase">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {currentPreview.data.slice(0, 50).map((row, i) => (
                          <tr key={i} className="hover:bg-accent/30">
                            {Object.keys(row).map(key => (
                              <td key={key} className="p-2">{String(row[key])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {currentPreview.data.length > 50 && (
                    <div className="p-2 text-center bg-accent/20 text-[10px] text-muted-foreground">
                      Mostrando apenas as primeiras 50 linhas de {currentPreview.data.length}
                    </div>
                  )}
                </div>

                {currentPreview.validRows === 0 && (
                  <div className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-orange-500" />
                    <p className="text-xs text-orange-600 font-medium">
                      Nenhuma linha válida encontrada nesta aba. Verifique os erros acima.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {step === "success" && importResult && (
              <motion.div 
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-12 text-center space-y-6"
              >
                <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center mx-auto text-green-500">
                  <CheckCircle2 className="h-12 w-12" />
                </div>
                <div>
                  <h4 className="text-2xl font-bold">Importação Concluída!</h4>
                  <p className="text-muted-foreground">Os dados foram processados com sucesso.</p>
                </div>
                <div className="flex items-center justify-center gap-8">
                  {importResult.productsCreated !== undefined ? (
                    <>
                      <div className="text-center">
                        <p className="text-xs font-bold text-muted-foreground uppercase">Itens Criados</p>
                        <p className="text-3xl font-black text-primary">{importResult.productsCreated}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-bold text-muted-foreground uppercase">Linhas de Estrutura</p>
                        <p className="text-3xl font-black text-orange-500">{importResult.bomCreated}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-center">
                        <p className="text-xs font-bold text-muted-foreground uppercase">Importados</p>
                        <p className="text-3xl font-black text-primary">{importResult.count}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-bold text-muted-foreground uppercase">Ignorados</p>
                        <p className="text-3xl font-black text-orange-500">{importResult.skipped}</p>
                      </div>
                    </>
                  )}
                </div>
                <button 
                  onClick={onClose}
                  className="px-8 py-2 rounded-lg bg-primary text-primary-foreground font-bold hover:opacity-90 transition-opacity"
                >
                  Fechar
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        {step !== "success" && (
          <div className="p-6 border-t border-border bg-accent/10 flex items-center justify-between">
            <button 
              onClick={step === "upload" ? onClose : () => setStep("upload")}
              className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
            >
              {step === "upload" ? "Cancelar" : "Voltar"}
            </button>
            <div className="flex items-center gap-3">
              {step === "upload" ? (
                <button 
                  disabled={!file || loading}
                  onClick={handleUpload}
                  className="flex items-center gap-2 bg-primary text-primary-foreground px-8 py-2 rounded-lg font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
                  Analisar Planilha
                </button>
              ) : (
                <button 
                  disabled={!previewData || totalValidRows === 0 || loading}
                  onClick={handleConfirm}
                  className="flex items-center gap-2 bg-green-600 text-white px-8 py-2 rounded-lg font-bold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Confirmar Importação ({totalValidRows})
                </button>
              )}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
