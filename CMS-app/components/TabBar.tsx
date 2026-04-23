"use client";

export interface EditorTab {
  file: string;
  title: string;
  isDirty: boolean;
}

interface TabBarProps {
  tabs: EditorTab[];
  activeFile: string | null;
  onSelect: (file: string) => void;
  onClose: (file: string) => void;
}

export default function TabBar({ tabs, activeFile, onSelect, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <div
          key={tab.file}
          className={`tab-bar-item${tab.file === activeFile ? " active" : ""}`}
          onClick={() => onSelect(tab.file)}
          title={tab.file}
        >
          <span className="tab-bar-label">
            {tab.isDirty && <span className="tab-bar-dot" />}
            {tab.title}
          </span>
          <button
            className="tab-bar-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.file);
            }}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
