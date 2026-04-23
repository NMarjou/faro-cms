"use client";

import { useTabContext } from "./TabContext";
import TabBar from "./TabBar";
import dynamic from "next/dynamic";

const ArticleEditor = dynamic(() => import("./ArticleEditor"), {
  ssr: false,
  loading: () => <p style={{ padding: 24 }}>Loading editor...</p>,
});

export default function Workspace({ children }: { children: React.ReactNode }) {
  const { tabs, activeFile, setActiveTab, closeTab } = useTabContext();

  // If no tabs are open, show the normal page content (dashboard, settings, etc.)
  if (tabs.length === 0 || activeFile === null) {
    return <>{children}</>;
  }

  return (
    <>
      <TabBar
        tabs={tabs}
        activeFile={activeFile}
        onSelect={setActiveTab}
        onClose={closeTab}
      />
      {/* Render all open editors, only show the active one */}
      {tabs.map((tab) => (
        <div
          key={tab.file}
          style={{ display: tab.file === activeFile ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}
        >
          <ArticleEditor file={tab.file} />
        </div>
      ))}
    </>
  );
}
