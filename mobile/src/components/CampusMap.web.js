import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Circle,
  CircleMarker,
  Marker,
  Polyline,
  Tooltip,
  useMapEvents,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import { colors } from '../theme';

// ── CSS: Leaflet base + animações do marcador seta + botão recentralizar ──
if (typeof document !== 'undefined' && !document.getElementById('leaflet-css')) {
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}
if (typeof document !== 'undefined' && !document.getElementById('carona-map-css')) {
  const style = document.createElement('style');
  style.id = 'carona-map-css';
  style.textContent = `
    .tiles-dark { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6); }
    .leaflet-container { background: #0B1020; cursor: default; }
    .motorista-arrow-wrapper {
      position: relative; width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
    }
    .motorista-arrow-pulse {
      position: absolute; inset: 0; border-radius: 50%;
      background: rgba(255,165,2,0.28);
      animation: pulse-ring 1.8s ease-out infinite;
    }
    @keyframes pulse-ring {
      0%  { transform: scale(0.7); opacity: 0.9; }
      70% { transform: scale(1.7); opacity: 0; }
      100%{ transform: scale(1.7); opacity: 0; }
    }
    .btn-recentralizar {
      position: absolute; bottom: 24px; right: 14px; z-index: 999;
      background: rgba(18,24,51,0.95); border: 1.5px solid #00D2D3;
      border-radius: 12px; padding: 9px 14px; cursor: pointer;
      display: flex; align-items: center; gap: 7px;
      font-family: system-ui, sans-serif; font-size: 13px; font-weight: 700;
      color: #00D2D3; box-shadow: 0 4px 20px rgba(0,210,211,0.25);
      transition: all 0.2s ease; white-space: nowrap;
      animation: fade-in-up 0.25s ease;
    }
    .btn-recentralizar:hover {
      background: rgba(0,210,211,0.15);
      box-shadow: 0 4px 24px rgba(0,210,211,0.45);
      transform: translateY(-1px);
    }
    .btn-recentralizar:active { transform: translateY(0); }
    @keyframes fade-in-up {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ── Utilitários ───────────────────────────────────────────────────────────────

/** Projeta posição do motorista na polilinha e descarta trecho já percorrido */
function cortarPolilinha(pontos, posAtual) {
  if (!Array.isArray(pontos) || pontos.length < 2 || !posAtual) return pontos || [];
  const pLat = Number(posAtual.lat);
  const pLng = Number(posAtual.lng);
  if (!Number.isFinite(pLat) || !Number.isFinite(pLng)) return pontos;
  const cosLat = Math.cos((pLat * Math.PI) / 180);
  let menorDist2 = Infinity;
  let melhorSegIdx = 0;
  let melhorProj = [pLat, pLng];
  for (let i = 0; i < pontos.length - 1; i++) {
    const [aLat, aLng] = pontos[i];
    const [bLat, bLng] = pontos[i + 1];
    const dx = (bLng - aLng) * cosLat;
    const dy = bLat - aLat;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-12) {
      const px = (pLng - aLng) * cosLat;
      const py = pLat - aLat;
      t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    }
    const projLat = aLat + t * (bLat - aLat);
    const projLng = aLng + t * (bLng - aLng);
    const ex = (pLng - projLng) * cosLat;
    const ey = pLat - projLat;
    const d2 = ex * ex + ey * ey;
    if (d2 < menorDist2) {
      menorDist2 = d2;
      melhorSegIdx = i;
      melhorProj = [projLat, projLng];
    }
  }
  return [[pLat, pLng], melhorProj, ...pontos.slice(melhorSegIdx + 1)];
}

/** Calcula bearing (0-360°) entre dois pontos geográficos */
function calcularBearing(de, para) {
  if (!de || !para) return null;
  const lat1 = (de.lat * Math.PI) / 180;
  const lat2 = (para.lat * Math.PI) / 180;
  const dLng = ((para.lng - de.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Cria L.divIcon com seta SVG rotacionada (motorista) */
function criarIconeSeta(graus) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
    <g transform="rotate(${graus},20,20)">
      <ellipse cx="20" cy="33" rx="8" ry="3.5" fill="rgba(0,0,0,0.3)"/>
      <polygon points="20,4 30,34 20,27 10,34" fill="#FFA502" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
      <circle cx="20" cy="20" r="3.5" fill="#fff" opacity="0.9"/>
    </g>
  </svg>`;
  return L.divIcon({
    html: `<div class="motorista-arrow-wrapper"><div class="motorista-arrow-pulse"></div>${svg}</div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    tooltipAnchor: [0, -22],
  });
}

// ── Sub-componentes Leaflet ───────────────────────────────────────────────────

function ClickHandler({ onPick }) {
  useMapEvents({
    click: (e) => {
      if (typeof onPick === 'function') onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

function FocoSos({ sos }) {
  const map = useMap();
  useEffect(() => {
    if (sos && typeof sos.lat === 'number' && typeof sos.lng === 'number') {
      map.setView([sos.lat, sos.lng], 15, { animate: true });
    }
  }, [map, sos?.id, sos?.lat, sos?.lng]);
  return null;
}

/** Modo siga-me: centraliza no motorista e detecta drag manual */
function NavegacaoController({ motoristaPos, autoRecentrar, onDragStart, mapRef }) {
  const map = useMap();
  useEffect(() => { if (mapRef) mapRef.current = map; }, [map, mapRef]);
  useEffect(() => {
    if (!autoRecentrar || !motoristaPos) return;
    map.panTo([motoristaPos.lat, motoristaPos.lng], { animate: true, duration: 0.8 });
  }, [map, autoRecentrar, motoristaPos?.lat, motoristaPos?.lng]);
  useMapEvents({ dragstart: () => { if (typeof onDragStart === 'function') onDragStart(); } });
  return null;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function CampusMap({
  campus,
  ponto,
  sentido = 'IDA',
  onPick,
  rota,
  pessoas = [],
  paradas = [],
  sos = null,
}) {
  const c = [campus.lat, campus.lng];
  const p = ponto && [ponto.lat, ponto.lng];
  const temSosCoord = sos && typeof sos.lat === 'number' && typeof sos.lng === 'number';
  const sosPos = temSosCoord ? [sos.lat, sos.lng] : null;

  // Estado do modo siga-me
  const [autoRecentrar, setAutoRecentrar] = useState(true);
  const mapRef = useRef(null);

  // Cálculo de bearing (heading) do motorista
  const posAnteriorRef = useRef(null);
  const [bearing, setBearing] = useState(0);

  // Posição ao vivo do motorista (telemetria em tempo real)
  const motoristaVivo = useMemo(() => {
    const m = pessoas.find((u) => u.papel === 'MOTORISTA');
    if (m && typeof m.lat === 'number' && typeof m.lng === 'number') return { lat: m.lat, lng: m.lng };
    if (rota?.origem && typeof rota.origem.lat === 'number') return { lat: rota.origem.lat, lng: rota.origem.lng };
    return null;
  }, [pessoas, rota?.origem?.lat, rota?.origem?.lng]);

  useEffect(() => {
    if (!motoristaVivo) return;
    const anterior = posAnteriorRef.current;
    if (anterior) {
      const b = calcularBearing(anterior, motoristaVivo);
      if (b !== null) setBearing(b);
    }
    posAnteriorRef.current = motoristaVivo;
  }, [motoristaVivo?.lat, motoristaVivo?.lng]);

  const iconeSeta = useMemo(() => criarIconeSeta(bearing), [bearing]);

  // Geometria via OSRM quando o backend não enviou rota detalhada
  const [geometriaOsrmLocal, setGeometriaOsrmLocal] = useState(null);
  useEffect(() => {
    const orig = motoristaVivo || rota?.origem;
    const dest = rota?.destino;
    if (!orig || !dest || typeof orig.lat !== 'number' || typeof dest.lat !== 'number') {
      setGeometriaOsrmLocal(null); return;
    }
    if (Array.isArray(rota?.geometria) && rota.geometria.length > 2) {
      setGeometriaOsrmLocal(null); return;
    }
    let ativo = true;
    fetch(`https://router.project-osrm.org/route/v1/driving/${orig.lng},${orig.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo) return;
        const coords = d?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2)
          setGeometriaOsrmLocal(coords.map(([lng, lat]) => [lat, lng]));
      })
      .catch(() => {});
    return () => { ativo = false; };
  }, [
    motoristaVivo?.lat, motoristaVivo?.lng,
    rota?.origem?.lat, rota?.origem?.lng,
    rota?.destino?.lat, rota?.destino?.lng,
    rota?.geometria?.length,
  ]);

  const posicoesRotaAtiva = useMemo(() => {
    if (!rota?.origem || !rota?.destino) return null;
    const orig = motoristaVivo || rota.origem;
    const base =
      Array.isArray(rota.geometria) && rota.geometria.length >= 2 ? rota.geometria
      : Array.isArray(geometriaOsrmLocal) && geometriaOsrmLocal.length >= 2 ? geometriaOsrmLocal
      : [[orig.lat, orig.lng], [rota.destino.lat, rota.destino.lng]];
    return cortarPolilinha(base, orig);
  }, [rota, motoristaVivo, geometriaOsrmLocal]);

  const indoParaPassageiro = rota?.destino?.tipo === 'PASSAGEIRO';
  const corRota = indoParaPassageiro ? colors.primary2 : colors.primary;

  const pessoasVisiveis = useMemo(
    () => pessoas.filter((u) => u.papel === 'MOTORISTA' || u.status_embarque !== 'EMBARCADO'),
    [pessoas]
  );

  const modoNavegacaoAtivo = Boolean(motoristaVivo && rota);
  const handleDragStart = useCallback(() => setAutoRecentrar(false), []);
  const handleRecentralizar = useCallback(() => {
    if (!motoristaVivo || !mapRef.current) return;
    mapRef.current.panTo([motoristaVivo.lat, motoristaVivo.lng], { animate: true, duration: 0.6 });
    setAutoRecentrar(true);
  }, [motoristaVivo]);

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, isolation: 'isolate', overflow: 'hidden' }}>
      <MapContainer center={c} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="tiles-dark"
          attribution='&copy; OpenStreetMap'
        />
        {typeof onPick === 'function' && <ClickHandler onPick={onPick} />}
        <FocoSos sos={sos} />

        {/* Controlador modo siga-me */}
        {modoNavegacaoAtivo && (
          <NavegacaoController
            motoristaPos={motoristaVivo}
            autoRecentrar={autoRecentrar}
            onDragStart={handleDragStart}
            mapRef={mapRef}
          />
        )}

        {/* Geofence Campus UNIFEB */}
        <Circle
          center={c}
          radius={campus.raio}
          pathOptions={{ color: colors.primary2, fillColor: colors.primary2, fillOpacity: 0.15 }}
        />
        <CircleMarker
          center={c}
          radius={9}
          pathOptions={{ color: '#fff', weight: 3, fillColor: colors.primary2, fillOpacity: 1 }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>🎓 Campus UNIFEB</Tooltip>
        </CircleMarker>

        {/* Pré-visualização antes de criar carona */}
        {p && (
          <CircleMarker center={p} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: colors.primary, fillOpacity: 1 }}>
            <Tooltip permanent direction="top">📍 Você (GPS Exato)</Tooltip>
          </CircleMarker>
        )}
        {p && (
          <Polyline
            positions={sentido === 'IDA' ? [p, c] : [c, p]}
            pathOptions={{ color: colors.primary, weight: 4, dashArray: '8 6' }}
          />
        )}

        {/* Rota ativa */}
        {posicoesRotaAtiva && posicoesRotaAtiva.length >= 2 && (
          <>
            <Polyline positions={posicoesRotaAtiva} pathOptions={{ color: '#0B1020', weight: 8, opacity: 0.7 }} />
            <Polyline positions={posicoesRotaAtiva} pathOptions={{ color: corRota, weight: 5, opacity: 0.95 }} />
          </>
        )}

        {/* Paradas de passageiros aguardando embarque */}
        {paradas.map((parada, idx) => (
          <CircleMarker
            key={`parada-${parada.usuario_id || parada.id}`}
            center={[parada.lat, parada.lng]}
            radius={idx === 0 ? 12 : 9}
            pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1, fillColor: idx === 0 ? colors.success : colors.primary }}
          >
            <Tooltip permanent direction="top" offset={[0, -12]}>
              {idx === 0 ? `📍 Coleta: ${parada.nome}` : `🧍 ${idx + 1}ª Parada: ${parada.nome}`}
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Marcadores de telemetria ao vivo */}
        {pessoasVisiveis
          .filter((u) => u.papel === 'MOTORISTA' || !paradas.some((pr) => pr.usuario_id === u.usuario_id))
          .map((u) => {
            if (u.papel === 'MOTORISTA') {
              // ─ Seta direcional para o motorista ─
              return (
                <Marker key={u.usuario_id} position={[u.lat, u.lng]} icon={iconeSeta}>
                  <Tooltip permanent direction="top" offset={[0, -22]}>
                    🚗 {u.eu ? 'Você (Motorista)' : u.nome}
                  </Tooltip>
                </Marker>
              );
            }
            // ─ Marcador circular tradicional para passageiros ─
            return (
              <CircleMarker
                key={u.usuario_id}
                center={[u.lat, u.lng]}
                radius={11}
                pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1, fillColor: colors.success }}
              >
                <Tooltip permanent direction="top" offset={[0, -12]}>
                  🧍 {u.eu ? 'Você' : u.nome}
                </Tooltip>
              </CircleMarker>
            );
          })}

        {/* Alerta de SOS */}
        {sosPos && (
          <>
            <Circle center={sosPos} radius={120} pathOptions={{ color: colors.danger, fillColor: colors.danger, fillOpacity: 0.25, weight: 2 }} />
            <CircleMarker center={sosPos} radius={14} pathOptions={{ color: '#fff', weight: 4, fillColor: colors.danger, fillOpacity: 1 }}>
              <Tooltip permanent direction="top" offset={[0, -14]}>
                🚨 SOS #{sos.id}{sos.carro_placa ? ` · ${sos.carro_placa}` : ''}
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {/* Botão flutuante "Recentralizar" — aparece quando o usuário arrastou o mapa */}
      {modoNavegacaoAtivo && !autoRecentrar && (
        <button className="btn-recentralizar" onClick={handleRecentralizar} title="Voltar para a posição do motorista">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2" x2="12" y2="6"/>
            <line x1="12" y1="18" x2="12" y2="22"/>
            <line x1="2" y1="12" x2="6" y2="12"/>
            <line x1="18" y1="12" x2="22" y2="12"/>
          </svg>
          Recentralizar
        </button>
      )}
    </div>
  );
}
