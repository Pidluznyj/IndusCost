import React from "react";
import { 
  FileText, 
  Download, 
  BarChart3, 
  PieChart, 
  Calendar,
  Search
} from "lucide-react";
import { motion } from "motion/react";

export const ReportsModule = () => {
  const reports = [
    { title: "Relatório de Custos por Produto", description: "Detalhamento de CIU, CIF e OPEX por SKU.", icon: BarChart3 },
    { title: "Análise de Margem de Contribuição", description: "Rentabilidade por canal de venda e produto.", icon: PieChart },
    { title: "Custo de Mão de Obra Direta", description: "Evolução de salários e encargos por departamento.", icon: Calendar },
    { title: "Eficiência de Centros de Trabalho", description: "Ocupação e custo HM real vs orçado.", icon: FileText },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold tracking-tight">Relatórios e BI</h2>
          <p className="text-xs text-muted-foreground">Exporte dados e analise indicadores de performance.</p>
        </div>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar relatório..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reports.map((report, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="p-6 bg-card rounded-2xl border border-border shadow-sm hover:shadow-md transition-all flex items-start gap-4 group cursor-pointer"
          >
            <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <report.icon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <h3 className="font-bold text-base mb-1">{report.title}</h3>
              <p className="text-sm text-muted-foreground mb-4">{report.description}</p>
              <button className="flex items-center gap-2 text-xs font-bold text-primary hover:underline">
                <Download className="h-3 w-3" />
                Gerar PDF / Excel
              </button>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="p-12 text-center border-2 border-dashed border-border rounded-3xl bg-accent/5">
        <BarChart3 className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
        <h3 className="text-lg font-bold text-muted-foreground">Módulo de BI Avançado</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
          Integre seus dados com ferramentas de visualização externa ou utilize nossos dashboards customizados para análise profunda.
        </p>
        <button className="mt-6 px-6 py-2 bg-primary text-primary-foreground rounded-xl font-bold text-sm hover:opacity-90 transition-opacity">
          Solicitar Customização
        </button>
      </div>
    </div>
  );
};
