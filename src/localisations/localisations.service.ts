import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Localisation, Quartier } from '@prisma/client';
import { distanceMeters } from '../common/geo/haversine';
import { pointInPolygon } from '../common/geo/point-in-polygon';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Rattachement et cycle de vie des localisations (point physique partagé).
 * Le quartier est porté par la LOCALISATION et figé à sa création.
 * Prototype : filtrage applicatif du rayon (production : PostGIS ST_DWithin).
 */
@Injectable()
export class LocalisationsService {
  private readonly radiusM: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.radiusM = Number(config.get<string>('LOCALISATION_RADIUS_METERS') ?? 15);
  }

  /** Quartier d'un point : point-dans-polygone si dispo, sinon le plus proche du centre. */
  async resolveQuartier(lat: number, lng: number): Promise<Quartier> {
    const quartiers = await this.prisma.quartier.findMany({
      where: { isActive: true },
    });

    const containing = quartiers.find(
      (q) => q.polygon && pointInPolygon([lng, lat], q.polygon),
    );
    if (containing) return containing;

    const withCenter = quartiers.filter(
      (q) => q.centerLat != null && q.centerLng != null,
    );
    if (withCenter.length === 0) {
      throw new BadRequestException({
        code: 'COORDINATES_OUT_OF_COVERAGE',
        message: 'Ces coordonnées ne sont rattachables à aucun quartier couvert.',
      });
    }
    return withCenter.reduce((best, q) =>
      distanceMeters(lat, lng, q.centerLat!, q.centerLng!) <
      distanceMeters(lat, lng, best.centerLat!, best.centerLng!)
        ? q
        : best,
    );
  }

  /**
   * Retourne la localisation existante dans le rayon, sinon en crée une nouvelle
   * (avec résolution de son quartier). Les coordonnées d'une localisation sont
   * figées par son premier créateur.
   */
  async resolveOrCreate(lat: number, lng: number): Promise<Localisation> {
    const candidates = await this.prisma.localisation.findMany();
    const match = candidates.find(
      (l) => distanceMeters(lat, lng, l.gpsLat, l.gpsLng) <= this.radiusM,
    );
    if (match) return match;

    const quartier = await this.resolveQuartier(lat, lng);
    return this.prisma.localisation.create({
      data: { quartierId: quartier.id, gpsLat: lat, gpsLng: lng },
    });
  }

  /**
   * Supprime la localisation si elle n'a plus aucune adresse vivante.
   * À appeler après toute désactivation d'adresse.
   */
  async cleanupIfEmpty(localisationId: string): Promise<void> {
    const remaining = await this.prisma.address.count({
      where: { localisationId, lifecycle: { not: 'DESACTIVEE' } },
    });
    if (remaining === 0) {
      await this.prisma.localisation.delete({ where: { id: localisationId } });
    }
  }
}
