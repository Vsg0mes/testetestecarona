const CAMPUS = {
  lat: Number(process.env.CAMPUS_LAT ?? -20.5747),
  lng: Number(process.env.CAMPUS_LNG ?? -48.5612),
  raio: Number(process.env.CAMPUS_RAIO_M ?? 500),
};

// Haversine em metros
function distanciaM(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const pertoDoCampus = (lat, lng) => distanciaM(lat, lng, CAMPUS.lat, CAMPUS.lng) <= CAMPUS.raio;

module.exports = { CAMPUS, pertoDoCampus };
