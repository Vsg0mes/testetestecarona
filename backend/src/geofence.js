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

const pertoDoCampus = (lat, lng) =>
  typeof lat === 'number' &&
  typeof lng === 'number' &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  distanciaM(lat, lng, CAMPUS.lat, CAMPUS.lng) <= CAMPUS.raio;

// Projeta a posição atual do motorista no segmento mais próximo da polilinha e descarta o trecho já percorrido
function cortarPolilinha(pontos, posAtual) {
  if (!Array.isArray(pontos) || pontos.length < 2 || !posAtual) {
    return pontos || [];
  }
  const { lat: pLat, lng: pLng } = posAtual;
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
  const distProjM = distanciaM(pLat, pLng, melhorProj[0], melhorProj[1]);
  const resultado = [[pLat, pLng]];
  if (distProjM > 3 && restantes.length > 0) {
    const [proxLat, proxLng] = restantes[0];
    if (distanciaM(melhorProj[0], melhorProj[1], proxLat, proxLng) > 3) {
      resultado.push(melhorProj);
    }
  }
  return [...resultado, ...restantes];
}

// Cache em memória de rotas OSRM para evitar chamadas redundantes quando a posição não mudou
const rotaCache = new Map();

async function calcularRotaViaria(origem, destino) {
  if (
    !origem ||
    !destino ||
    typeof origem.lat !== 'number' ||
    typeof origem.lng !== 'number' ||
    typeof destino.lat !== 'number' ||
    typeof destino.lng !== 'number'
  ) {
    return null;
  }

  const distDiretaM = Math.round(distanciaM(origem.lat, origem.lng, destino.lat, destino.lng));
  if (distDiretaM <= 8) {
    return {
      distancia_m: distDiretaM,
      duracao_s: 0,
      geometria: [
        [origem.lat, origem.lng],
        [destino.lat, destino.lng],
      ],
    };
  }

  const destKey = `${destino.lat.toFixed(5)},${destino.lng.toFixed(5)}`;
  const cached = rotaCache.get(destKey);

  // Se o motorista se moveu menos de 8 metros desde o último cálculo OSRM para o mesmo destino, encurta a polilinha em cache
  if (cached && Date.now() - cached.ts < 30000) {
    const moveuM = distanciaM(origem.lat, origem.lng, cached.origem.lat, cached.origem.lng);
    if (moveuM < 8 && Array.isArray(cached.geometria) && cached.geometria.length >= 2) {
      const encurtada = cortarPolilinha(cached.geometria, origem);
      return {
        distancia_m: Math.max(distDiretaM, Math.round(cached.distancia_m - moveuM)),
        duracao_s: cached.duracao_s,
        geometria: encurtada,
      };
    }
  }

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: AbortSignal.timeout(2200) });
    if (res.ok) {
      const data = await res.json();
      const route = data?.routes?.[0];
      const coords = route?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const pontos = coords.map(([lng, lat]) => [lat, lng]);
        // Garante que o primeiro ponto parte exatamente do motorista e o último chega no destino
        const primeiro = pontos[0];
        if (distanciaM(origem.lat, origem.lng, primeiro[0], primeiro[1]) > 2) {
          pontos.unshift([origem.lat, origem.lng]);
        } else {
          pontos[0] = [origem.lat, origem.lng];
        }
        const ultimo = pontos[pontos.length - 1];
        if (distanciaM(destino.lat, destino.lng, ultimo[0], ultimo[1]) > 2) {
          pontos.push([destino.lat, destino.lng]);
        } else {
          pontos[pontos.length - 1] = [destino.lat, destino.lng];
        }

        const info = {
          origem: { lat: origem.lat, lng: origem.lng },
          distancia_m: Math.round(route.distance ?? distDiretaM),
          duracao_s: Math.round(route.duration ?? Math.round(distDiretaM / 10)),
          geometria: pontos,
          ts: Date.now(),
        };
        rotaCache.set(destKey, info);
        return {
          distancia_m: info.distancia_m,
          duracao_s: info.duracao_s,
          geometria: info.geometria,
        };
      }
    }
  } catch {}

  // Fallback: se já havia geometria em cache para este destino, encurta sobre ela; senão linha direta
  if (cached && Array.isArray(cached.geometria) && cached.geometria.length >= 2) {
    return {
      distancia_m: distDiretaM,
      duracao_s: Math.round(distDiretaM / 10),
      geometria: cortarPolilinha(cached.geometria, origem),
    };
  }

  return {
    distancia_m: distDiretaM,
    duracao_s: Math.round(distDiretaM / 10),
    geometria: [
      [origem.lat, origem.lng],
      [destino.lat, destino.lng],
    ],
  };
}

module.exports = { CAMPUS, distanciaM, pertoDoCampus, cortarPolilinha, calcularRotaViaria };
