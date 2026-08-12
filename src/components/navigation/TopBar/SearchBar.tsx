// src/components/navigation/TopBar/SearchBar.tsx
// -----------------------------------------------------------------------------
// BUSCA.
//
// DOIS DEFEITOS DE CONTEÚDO
//
//   1. O BOTÃO DE "POSIÇÃO ATUAL" IA PARA SÃO PAULO.
//      `title="Posição Atual"` com `onSearchCoord?.(-23.5505, -46.6333)`
//      cravado. Não é a posição de ninguém — é uma coordenada escrita à mão
//      com rótulo de geolocalização. Agora usa a API do navegador de verdade,
//      e diz o que acontece quando ela é negada.
//
//   2. A BUSCA CONHECIA CINCO CIDADES.
//      Uma escada de `if (q.includes("são paulo"))` com cinco casos. Qualquer
//      outra coisa que se digitasse não fazia NADA — sem mensagem, sem erro,
//      sem nem limpar o campo. O sistema já tem polígonos de país e estado no
//      servidor; enquanto não há geocodificação de verdade, o certo é dizer
//      que não achou em vez de engolir em silêncio.
//
// O que a busca ACEITA continua: coordenada em vários formatos, que é o que um
// instrumento precisa. E agora aceita mais formatos do que aceitava.
// -----------------------------------------------------------------------------

import React, { useState } from "react";
import { useUIStore } from "../../../store/uiStore";
import { Search, Crosshair, Command as CommandIcon } from "lucide-react";
import { lerCoordenada } from "../../../coord";

export const SearchBar: React.FC<{ onSearchCoord?: (lat: number, lng: number) => void }> = ({ onSearchCoord }) => {
  const { setCommandPaletteOpen } = useUIStore();
  const [q, setQ] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const enviar = (e: React.FormEvent) => {
    e.preventDefault();
    setAviso(null);
    if (!q.trim()) return;

    const c = lerCoordenada(q);
    if (c) { onSearchCoord?.(c.lat, c.lng); return; }

    // Não achou: DIZ. A versão anterior não fazia nada e não avisava nada.
    setAviso("Não reconheci. Tente uma coordenada: −23.55 −46.63 ou 23°33'S 46°38'O");
  };

  const minhaPosicao = () => {
    if (!navigator.geolocation) {
      setAviso("Este navegador não oferece geolocalização.");
      return;
    }
    setAviso(null);
    navigator.geolocation.getCurrentPosition(
      (p) => onSearchCoord?.(p.coords.latitude, p.coords.longitude),
      () => setAviso("Permissão de localização negada."),
      { timeout: 8000 }
    );
  };

  return (
    <div className="busca-caixa">
      <form className="busca" onSubmit={enviar} role="search">
        <Search size={14} strokeWidth={1.5} aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setAviso(null); }}
          placeholder="Coordenada: −23.55 −46.63  ou  23°33′S 46°38′O"
          aria-label="Ir para uma coordenada"
        />
        <button type="button" className="busca-icone" onClick={minhaPosicao} title="Ir para a minha posição">
          <Crosshair size={13} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="busca-atalho"
          onClick={() => setCommandPaletteOpen(true)}
          title="Abrir a paleta de comandos"
        >
          <CommandIcon size={10} strokeWidth={1.75} aria-hidden="true" />K
        </button>
      </form>
      {aviso && <p className="busca-aviso" role="status">{aviso}</p>}
    </div>
  );
};
