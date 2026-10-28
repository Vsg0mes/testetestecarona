import { MapContainer, TileLayer, Circle, CircleMarker, Polyline, Tooltip, useMapEvents } from 'react-leaflet';
import { colors } from '../theme';

// Garante o CSS do Leaflet (sem ele os tiles se espalham pela página inteira)
if (typeof document !== 'undefined' && !document.getElementById('leaflet-css')) {
  const link = document.createElement('link');
  link.id = 'leaflet-css';
  link.rel = 'stylesheet';
  link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
  document.head.appendChild(link);
}

// Web: Leaflet + tiles OpenStreetMap escurecidos via CSS (sem API key)
function ClickHandler({ onPick }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

export default function CampusMap({ campus, ponto, sentido, onPick, rota, pessoas = [] }) {
  const c = [campus.lat, campus.lng];
  const p = ponto && [ponto.lat, ponto.lng];
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0, isolation: 'isolate', overflow: 'hidden' }}>
      <style>{`.tiles-dark { filter: invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.6); }
        .leaflet-container { background: #0B1020; cursor: crosshair; }`}</style>
      <MapContainer center={c} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl={false}>
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="tiles-dark"
          attribution='&copy; OpenStreetMap'
        />
        <ClickHandler onPick={onPick} />
        <Circle center={c} radius={campus.raio}
          pathOptions={{ color: colors.primary2, fillColor: colors.primary2, fillOpacity: 0.15 }} />
        <CircleMarker center={c} radius={9}
          pathOptions={{ color: '#fff', weight: 3, fillColor: colors.primary2, fillOpacity: 1 }}>
          <Tooltip permanent direction="top" offset={[0, -10]}>🎓 Campus</Tooltip>
        </CircleMarker>
        {p && (
          <CircleMarker center={p} radius={8}
            pathOptions={{ color: '#fff', weight: 3, fillColor: colors.primary, fillOpacity: 1 }}>
            <Tooltip direction="top">Seu ponto</Tooltip>
          </CircleMarker>
        )}
        {p && (
          <Polyline positions={sentido === 'IDA' ? [p, c] : [c, p]}
            pathOptions={{ color: colors.primary, weight: 4, dashArray: '8 6' }} />
        )}
        {rota && (
          <Polyline positions={[[rota.origem.lat, rota.origem.lng], [rota.destino.lat, rota.destino.lng]]}
            pathOptions={{ color: colors.primary, weight: 4, dashArray: '8 6' }} />
        )}
        {pessoas.map((u) => (
          <CircleMarker key={u.usuario_id} center={[u.lat, u.lng]} radius={11}
            pathOptions={{ color: '#fff', weight: 3, fillOpacity: 1,
              fillColor: u.papel === 'MOTORISTA' ? '#FFA502' : colors.success }}>
            <Tooltip permanent direction="top" offset={[0, -12]}>
              {u.papel === 'MOTORISTA' ? '🚗' : '🧍'} {u.eu ? 'Você' : u.nome}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
