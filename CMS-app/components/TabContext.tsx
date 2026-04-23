"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { EditorTab } from "./TabBar";

interface TabContextValue {
  tabs: EditorTab[];
  activeFile: string | null;
  openTab: (file: string, title: string) => void;
  closeTab: (file: string) => void;
  setActiveTab: (file: string) => void;
  markDirty: (file: string, dirty: boolean) => void;
}

const TabCtx = createContext<TabContextValue | null>(null);

export function useTabContext() {
  const ctx = useContext(TabCtx);
  if (!ctx) throw new Error("useTabContext must be used within TabProvider");
  return ctx;
}

export function TabProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeFile, setActiveFileState] = useState<string | null>(null);

  const openTab = useCallback((file: string, title: string) => {
    setTabs((prev) => {
      const exists = prev.find((t) => t.file === file);
      if (exists) return prev;
      return [...prev, { file, title, isDirty: false }];
    });
    setActiveFileState(file);
  }, []);

  const closeTab = useCallback((file: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.file === file);
      const next = prev.filter((t) => t.file !== file);
      // If closing the active tab, switch to adjacent
      if (file === activeFile && next.length > 0) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveFileState(next[newIdx].file);
      } else if (next.length === 0) {
        setActiveFileState(null);
      }
      return next;
    });
  }, [activeFile]);

  const setActiveTab = useCallback((file: string) => {
    setActiveFileState(file);
  }, []);

  const markDirty = useCallback((file: string, dirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.file === file ? { ...t, isDirty: dirty } : t))
    );
  }, []);

  return (
    <TabCtx.Provider value={{ tabs, activeFile, openTab, closeTab, setActiveTab, markDirty }}>
      {children}
    </TabCtx.Provider>
  );
}
