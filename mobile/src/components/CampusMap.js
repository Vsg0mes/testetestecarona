import { StyleSheet } from 'react-native';
import MapView, { Marker, Circle, Polyline } from 'react-native-maps';
import { colors } from '../theme';

// Nativo: react-native-maps
export default function CampusMap({ campus, ponto, sentido = 'IDA', onPick, rota, pessoas = [], sos = null }) {
  const c = { latitude: campus.lat, longitude: campus.lng };
  const p = ponto && { latitude: ponto.lat, longitude: ponto.lng };
  const sosCoord = sos && typeof sos.lat === 'number' && typeof sos.lng === 'number'
    ? { latitude: sos.lat, longitude: sos.lng }
    : null;
  return (
    <MapView
      style={StyleSheet.absoluteFill}
      userInterfaceStyle="dark"
      showsUserLocation
      initialRegion={{ ...c, latitudeDelta: 0.04, longitudeDelta: 0.04 }}
      onPress={typeof onPick === 'function' ? (e) => {
        const { latitude, longitude } = e.nativeEvent.coordinate;
        onPick({ lat: latitude, lng: longitude });
      } : undefined}
    >
      <Circle center={c} radius={campus.raio} strokeColor={colors.primary2} fillColor="rgba(0,210,211,0.15)" />
      <Marker coordinate={c} title="Campus UNIFEB" pinColor="turquoise" />
      {p && <Marker coordinate={p} title="Você (GPS Exato)" pinColor="violet" />}
      {p && (
        <Polyline coordinates={sentido === 'IDA' ? [p, c] : [c, p]}
          strokeColor={colors.primary} strokeWidth={4} lineDashPattern={[8, 6]} />
      )}
      {rota && (
        <Polyline
          coordinates={[
            { latitude: rota.origem.lat, longitude: rota.origem.lng },
            { latitude: rota.destino.lat, longitude: rota.destino.lng },
          ]}
          strokeColor={colors.primary} strokeWidth={4} lineDashPattern={[8, 6]} />
      )}
      {pessoas.map((u) => (
        <Marker key={u.usuario_id} coordinate={{ latitude: u.lat, longitude: u.lng }}
          title={`${u.papel === 'MOTORISTA' ? '🚗' : '🧍'} ${u.eu ? 'Você' : u.nome}`}
          pinColor={u.papel === 'MOTORISTA' ? 'orange' : 'green'} />
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
