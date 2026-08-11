// src/components/navigation/TopBar/TopBar.tsx
import React from "react";
import { LogoSection } from "./LogoSection";
import { SearchBar } from "./SearchBar";
import { ToolbarButtons } from "./ToolbarButtons";

export const TopBar: React.FC<{ onSearchCoord?: (lat: number, lng: number) => void }> = ({ onSearchCoord }) => {
  return (
    <header className="topbar">
      <LogoSection />
      <SearchBar onSearchCoord={onSearchCoord} />
      <ToolbarButtons onSearchCoord={onSearchCoord} />
    </header>
  );
};
