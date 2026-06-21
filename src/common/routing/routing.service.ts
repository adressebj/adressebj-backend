import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { distanceMeters } from '../geo/haversine';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Provenance de l'estimation : routage réel OSRM, ou repli local (vol d'oiseau). */
export type EtaSource = 'OSRM' | 'ESTIMATE';

export interface EtaResult {
  etaMinutes: number;
  distanceMeters: number;
  source: EtaSource;
}

/** Facteur de sinuosité urbain appliqué à la distance à vol d'oiseau dans le repli. */
const URBAN_DETOUR_FACTOR = 1.3;

/**
 * Encapsule le routage cartographique (CdC : tout service externe derrière un service interne).
 *
 * Délègue à OSRM public (`router.project-osrm.org`) pour l'ETA voiture. En cas
 * d'indisponibilité (réseau, timeout, réponse inexploitable), repli **gracieux** sur une
 * estimation locale : distance Haversine majorée d'un facteur de détour urbain, divisée par
 * une vitesse moyenne. Le repli est signalé par `source: 'ESTIMATE'` — jamais d'erreur remontée.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fallbackSpeedKmh: number;

  constructor(config: ConfigService) {
    this.baseUrl =
      config.get<string>('OSRM_BASE_URL') ?? 'https://router.project-osrm.org';
    this.timeoutMs = Number(config.get<string>('OSRM_TIMEOUT_MS') ?? 3000);
    this.fallbackSpeedKmh = Number(
      config.get<string>('ROUTING_FALLBACK_SPEED_KMH') ?? 25,
    );
  }

  /** ETA voiture entre deux points. Ne lève jamais : repli local si OSRM échoue. */
  async getEta(from: GeoPoint, to: GeoPoint): Promise<EtaResult> {
    try {
      const route = await this.fetchOsrmRoute(from, to);
      if (route) {
        return {
          etaMinutes: Math.round(route.duration / 60),
          distanceMeters: Math.round(route.distance),
          source: 'OSRM',
        };
      }
    } catch (err) {
      this.logger.warn(
        `OSRM indisponible, repli sur estimation locale : ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    return this.estimate(from, to);
  }

  /** Appelle OSRM ; renvoie `null` si la réponse est inexploitable. Peut lever (réseau/timeout). */
  private async fetchOsrmRoute(
    from: GeoPoint,
    to: GeoPoint,
  ): Promise<{ duration: number; distance: number } | null> {
    const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${this.baseUrl}/route/v1/driving/${path}?overview=false`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        code?: string;
        routes?: { duration: number; distance: number }[];
      };
      if (body.code !== 'Ok' || !body.routes?.length) return null;
      const { duration, distance } = body.routes[0];
      if (typeof duration !== 'number' || typeof distance !== 'number') {
        return null;
      }
      return { duration, distance };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Estimation locale (repli) : Haversine × détour urbain, à vitesse moyenne. */
  private estimate(from: GeoPoint, to: GeoPoint): EtaResult {
    const straight = distanceMeters(from.lat, from.lng, to.lat, to.lng);
    const roadMeters = straight * URBAN_DETOUR_FACTOR;
    const minutes = Math.round(
      (roadMeters / 1000 / this.fallbackSpeedKmh) * 60,
    );
    return {
      etaMinutes: minutes,
      distanceMeters: Math.round(roadMeters),
      source: 'ESTIMATE',
    };
  }
}
