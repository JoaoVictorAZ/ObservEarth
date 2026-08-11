// src/components/navigation/TopBar/SearchBar.tsx
import React, { useState } from "react";
import { useUIStore } from "../../../store/uiStore";
import { Search, Navigation, Command as CommandIcon } from "lucide-react";

export const SearchBar: React.FC<{ onSearchCoord?: (lat: number, lng: number) => void }> = ({ onSearchCoord }) => {
  const { setCommandPaletteOpen } = useUIStore();
  const [query, setQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    const q = query.trim().toLowerCase();

    const match = q.match(/^([+-]?\d+\.?\d*)\s*,\s*([+-]?\d+\.?\d*)$/);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        onSearchCoord?.(lat, lng);
      }
      return;
    }

    if (q.includes("são paulo")) onSearchCoord?.(-23.5505, -46.6333);
    else if (q.includes("rio")) onSearchCoord?.(-22.9068, -43.1729);
    else if (q.includes("tóquio") || q.includes("tokyo")) onSearchCoord?.(35.6762, 139.6503);
    else if (q.includes("nova york") || q.includes("new york")) onSearchCoord?.(40.7128, -74.0060);
    else if (q.includes("londres") || q.includes("london")) onSearchCoord?.(51.5074, -0.1278);
  };

  return (
    <form className="search" onSubmit={handleSearch}>
      <Search size={14} strokeWidth={1.5} color="var(--ink-3)" />
      <input
        type="text"
        placeholder="Buscar cidade, país ou lat, lng..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button
        type="button"
        style={{ background: "none", border: "none", color: "var(--ink-3)", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
        onClick={() => onSearchCoord?.(-23.5505, -46.6333)}
        title="Posição Atual"
      >
        <Navigation size={13} strokeWidth={1.5} color="var(--signal)" />
      </button>
      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: "3px 6px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: 4,
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--ink-3)",
          border: "none",
          cursor: "pointer",
        }}
      >
        <CommandIcon size={10} strokeWidth={1.5} /> K
      </button>
    </form>
  );
};
