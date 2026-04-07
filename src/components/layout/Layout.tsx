import React from "react";
import { Sidebar } from "./Sidebar";
import { motion, AnimatePresence } from "motion/react";

interface LayoutProps {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export const Layout = ({ children, activeTab, onTabChange }: LayoutProps) => {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans antialiased text-foreground">
      {/* Sidebar - Fixed on the left */}
      <Sidebar activeTab={activeTab} onTabChange={onTabChange} />

      {/* Main Content - Scrollable area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header / Navbar (Optional but good for breadcrumbs/user profile) */}
        <header className="h-16 border-b border-border flex items-center justify-between px-8 bg-card/50 backdrop-blur-sm z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/50 border border-border">
              <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs font-medium text-muted-foreground">Sistema Online</span>
            </div>
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
              <span className="text-xs font-bold text-primary">PA</span>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
          <AnimatePresence mode="wait">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="max-w-7xl mx-auto w-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};
