import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import { colors } from '../theme';

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

// Nativo: react-native-maps
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
  const c = { latitude: campus.lat, longitude: campus.lng };
  const p = ponto && { latitude: ponto.lat, longitude: ponto.lng };
  const sosCoord =
    sos && typeof sos.lat === 'number' && typeof sos.lng === 'number'
      ? { latitude: sos.lat, longitude: sos.lng }
      : null;

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

  const coordsRota = useMemo(() => {
    if (!rota?.origem || !rota?.destino) return null;
    const orig = motoristaVivo || rota.origem;
    const base =
      Array.isArray(rota.geometria) && rota.geometria.length >= 2
        ? cortarPolilinha(rota.geometria, orig)
        : [
            [orig.lat, orig.lng],
            [rota.destino.lat, rota.destino.lng],
          ];
    return base.map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
  }, [rota, motoristaVivo]);

  const indoParaPassageiro = rota?.destino?.tipo === 'PASSAGEIRO';
  const corRota = indoParaPassageiro ? colors.primary2 : colors.primary;

  const pessoasVisiveis = useMemo(
    () => pessoas.filter((u) => u.papel === 'MOTORISTA' || u.status_embarque !== 'EMBARCADO'),
    [pessoas]
  );

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      userInterfaceStyle="dark"
      showsUserLocation
      initialRegion={{ ...c, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
      onPress={
        typeof onPick === 'function'
          ? (e) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              onPick({ lat: latitude, lng: longitude });
            }
          : undefined
      }
    >
      <Circle center={c} radius={campus.raio} strokeColor={colors.primary2} fillColor="rgba(0,210,211,0.15)" />
      <Marker coordinate={c} title="Campus UNIFEB" pinColor="turquoise" />
      {p && <Marker coordinate={p} title="Você (GPS Exato)" pinColor="violet" />}
      {p && (
        <Polyline
          coordinates={sentido === 'IDA' ? [p, c] : [c, p]}
          strokeColor={colors.primary}
          strokeWidth={4}
          lineDashPattern={[8, 6]}
        />
      )}
      {coordsRota && coordsRota.length >= 2 && (
        <Polyline coordinates={coordsRota} strokeColor={corRota} strokeWidth={5} />
      )}
      {paradas.map((parada, idx) => (
        <Marker
          key={`parada-${parada.usuario_id || parada.id}`}
          coordinate={{ latitude: parada.lat, longitude: parada.lng }}
          title={idx === 0 ? `📍 Coleta: ${parada.nome}` : `🧍 ${idx + 1}ª Parada: ${parada.nome}`}
          pinColor={idx === 0 ? 'green' : 'violet'}
        />
      ))}
      {pessoasVisiveis
        .filter((u) => u.papel === 'MOTORISTA' || !paradas.some((pr) => pr.usuario_id === u.usuario_id))
        .map((u) => (
          <Marker
            key={u.usuario_id}
            coordinate={{ latitude: u.lat, longitude: u.lng }}
            title={`${u.papel === 'MOTORISTA' ? '🚗' : '🧍'} ${u.eu ? 'Você' : u.nome}`}
            pinColor={u.papel === 'MOTORISTA' ? 'orange' : 'green'}
          />
        ))}
      {sosCoord && (
        <Marker
          coordinate={sosCoord}
          title={`🚨 SOS #${sos.id}${sos.carro_placa ? ` · ${sos.carro_placa}` : ''}`}
          pinColor="red"
        />
      )}
    </MapView>
  );
}
