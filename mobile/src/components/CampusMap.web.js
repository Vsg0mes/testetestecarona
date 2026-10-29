import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Tooltip, useMapEvents, useMap } from 'react-leaflet';
import { colors } from '../theme';

// Garante o CSS do Leaflet (sem ele os tiles se espalham pela página inteira)
if (typeof document !== 'undefined' && !document.getElementById('leaflet-css')) {
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}

// Projeta a posição atual do motorista na polilinha da rota e descarta o trecho já percorrido
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

  const restantes = pontos.slice(melhorSegIdx + 1);
  return [[pLat, pLng], melhorProj, ...restantes];
}

// Web: Leaflet + tiles OpenStreetMap escurecidos via CSS (sem API key)
function ClickHandler({ onPick }) {
  useMapEvents({
    click: (e) => {
      if (typeof onPick === 'function') {
        onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
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

  // Posição ao vivo do motorista (telemetria em tempo real)
  const motoristaVivo = useMemo(() => {
    const m = pessoas.find((u) => u.papel === 'MOTORISTA');
    if (m && typeof m.lat === 'number' && typeof m.lng === 'number') {
      return { lat: m.lat, lng: m.lng };
    }
    if (rota?.origem && typeof rota.origem.lat === 'number' && typeof rota.origem.lng === 'number') {
      return { lat: rota.origem.lat, lng: rota.origem.lng };
    }
    return null;
  }, [pessoas, rota?.origem?.lat, rota?.origem?.lng]);

  // Geometria de vias calculada via OSRM quando o backend não enviou geometria detalhada
  const [geometriaOsrmLocal, setGeometriaOsrmLocal] = useState(null);

  useEffect(() => {
    const orig = motoristaVivo || rota?.origem;
    const dest = rota?.destino;
    if (!orig || !dest || typeof orig.lat !== 'number' || typeof dest.lat !== 'number') {
      setGeometriaOsrmLocal(null);
      return;
    }
    if (Array.isArray(rota?.geometria) && rota.geometria.length > 2) {
      setGeometriaOsrmLocal(null);
      return;
    }

    let ativo = true;
    const url = `https://router.project-osrm.org/route/v1/driving/${orig.lng},${orig.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!ativo) return;
        const coords = d?.routes?.[0]?.geometry?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          setGeometriaOsrmLocal(coords.map(([lng, lat]) => [lat, lng]));
        }
      })
      .catch(() => {});

    return () => {
      ativo = false;
    };
  }, [
    motoristaVivo?.lat,
    motoristaVivo?.lng,
    rota?.origem?.lat,
    rota?.origem?.lng,
    rota?.destino?.lat,
    rota?.destino?.lng,
    rota?.geometria?.length,
  ]);

  // Polilinha dinâmica: parte sempre da localização atual do motorista e encurta conforme ele se desloca
  const posicoesRotaAtiva = useMemo(() => {
    if (!rota?.origem || !rota?.destino) return null;
    const orig = motoristaVivo || rota.origem;
    const base =
      Array.isArray(rota.geometria) && rota.geometria.length >= 2
        ? rota.geometria
        : Array.isArray(geometriaOsrmLocal) && geometriaOsrmLocal.length >= 2
          ? geometriaOsrmLocal
          : [
              [orig.lat, orig.lng],
              [rota.destino.lat, rota.destino.lng],
            ];
    return cortarPolilinha(base, orig);
  }, [rota, motoristaVivo, geometriaOsrmLocal]);

  const indoParaPassageiro = rota?.destino?.tipo === 'PASSAGEIRO';
  const corRota = indoParaPassageiro ? colors.primary2 : colors.primary;

  // Filtra passageiros já embarcados para não deixar pino antigo parado na rua
  const pessoasVisiveis = useMemo(
    () => pessoas.filter((u) => u.papel === 'MOTORISTA' || u.status_embarque !== 'EMBARCADO'),
    [pessoas]
  );

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, isolation: 'isolate', overflow: 'hidden' }}>
      <style>{`.tiles-dark { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6); }
        .leaflet-container { background: #0B1020; cursor: ${typeof onPick === 'function' ? 'crosshair' : 'default'}; }`}</style>
      <MapContainer center={c} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="tiles-dark"
          attribution='&copy; OpenStreetMap'
        />
        {typeof onPick === 'function' && <ClickHandler onPick={onPick} />}
        <FocoSos sos={sos} />

        {/* Perímetro do Geofence do Campus UNIFEB (500m) */}
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
          <Tooltip permanent direction="top" offset={[0, -10]}>
            🎓 Campus UNIFEB
          </Tooltip>
        </CircleMarker>

        {/* Pré-visualização antes de criar carona */}
        {p && (
          <CircleMarker
            center={p}
            radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: colors.primary, fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top">
              📍 Você (GPS Exato)
            </Tooltip>
          </CircleMarker>
        )}
        {p && (
          <Polyline
            positions={sentido === 'IDA' ? [p, c] : [c, p]}
            pathOptions={{ color: colors.primary, weight: 4, dashArray: '8 6' }}
          />
        )}

        {/* Rota Dinâmica Ativa (Motorista -> 1º Passageiro AGUARDANDO ou -> Campus UNIFEB) */}
        {posicoesRotaAtiva && posicoesRotaAtiva.length >= 2 && (
          <>
            <Polyline
              positions={posicoesRotaAtiva}
              pathOptions={{ color: '#0B1020', weight: 8, opacity: 0.7 }}
            />
            <Polyline
              positions={posicoesRotaAtiva}
              pathOptions={{ color: corRota, weight: 5, opacity: 0.95 }}
            />
          </>
        )}

        {/* Paradas de passageiros aguardando embarque */}
        {paradas.map((parada, idx) => (
          <CircleMarker
            key={`parada-${parada.usuario_id || parada.id}`}
            center={[parada.lat, parada.lng]}
            radius={idx === 0 ? 12 : 9}
            pathOptions={{
              color: '#fff',
              weight: 3,
              fillOpacity: 1,
              fillColor: idx === 0 ? colors.success : colors.primary,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -12]}>
              {idx === 0 ? `📍 Coleta: ${parada.nome}` : `🧍 ${idx + 1}ª Parada: ${parada.nome}`}
            </Tooltip>
          </CircleMarker>
        ))}

        {/* Pinos de telemetria ao vivo (Motorista e passageiros ainda não representados nas paradas) */}
        {pessoasVisiveis
          .filter((u) => u.papel === 'MOTORISTA' || !paradas.some((pr) => pr.usuario_id === u.usuario_id))
          .map((u) => (
            <CircleMarker
              key={u.usuario_id}
              center={[u.lat, u.lng]}
              radius={11}
              pathOptions={{
                color: '#fff',
                weight: 3,
                fillOpacity: 1,
                fillColor: u.papel === 'MOTORISTA' ? '#FFA502' : colors.success,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -12]}>
                {u.papel === 'MOTORISTA' ? '🚗' : '🧍'} {u.eu ? 'Você' : u.nome}
              </Tooltip>
            </CircleMarker>
          ))}

        {/* Alerta de SOS */}
        {sosPos && (
          <>
            <Circle
              center={sosPos}
              radius={120}
              pathOptions={{ color: colors.danger, fillColor: colors.danger, fillOpacity: 0.25, weight: 2 }}
            />
            <CircleMarker
              center={sosPos}
              radius={14}
              pathOptions={{ color: '#fff', weight: 4, fillColor: colors.danger, fillOpacity: 1 }}
            >
              <Tooltip permanent direction="top" offset={[0, -14]}>
                🚨 SOS #{sos.id}{sos.carro_placa ? ` · ${sos.carro_placa}` : ''}
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>
    </div>
  );
}
