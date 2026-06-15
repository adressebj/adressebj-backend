import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalisationsService } from './localisations.service';

function buildPrismaMock() {
  return {
    quartier: { findMany: jest.fn() },
    localisation: { findMany: jest.fn(), create: jest.fn() },
    address: { count: jest.fn() },
  };
}

const config = {
  get: jest.fn().mockReturnValue('15'),
} as unknown as ConfigService;

describe('LocalisationsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: LocalisationsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new LocalisationsService(prisma as never, config);
  });

  describe('resolveQuartier', () => {
    it('retourne le quartier dont le polygone contient le point', async () => {
      prisma.quartier.findMany.mockResolvedValue([
        {
          id: 'q-poly',
          polygon: {
            type: 'Polygon',
            coordinates: [
              [
                [2, 6],
                [2, 7],
                [3, 7],
                [3, 6],
                [2, 6],
              ],
            ],
          },
          centerLat: 6.5,
          centerLng: 2.5,
        },
        { id: 'q-far', polygon: null, centerLat: 10, centerLng: 10 },
      ]);
      const q = await service.resolveQuartier(6.5, 2.5);
      expect(q.id).toBe('q-poly');
    });

    it('replie sur le quartier le plus proche du centre si aucun polygone ne contient', async () => {
      prisma.quartier.findMany.mockResolvedValue([
        { id: 'q-near', polygon: null, centerLat: 6.366, centerLng: 2.444 },
        { id: 'q-far', polygon: null, centerLat: 9.0, centerLng: 2.0 },
      ]);
      const q = await service.resolveQuartier(6.37, 2.44);
      expect(q.id).toBe('q-near');
    });

    it('lève COORDINATES_OUT_OF_COVERAGE si aucun quartier exploitable', async () => {
      prisma.quartier.findMany.mockResolvedValue([]);
      await expect(service.resolveQuartier(6.3, 2.4)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resolveOrCreate', () => {
    it('rattache à une localisation existante dans le rayon (≤ 15 m)', async () => {
      prisma.localisation.findMany.mockResolvedValue([
        { id: 'loc-1', gpsLat: 6.366, gpsLng: 2.444, quartierId: 'q1' },
      ]);
      const loc = await service.resolveOrCreate(6.366001, 2.444001);
      expect(loc.id).toBe('loc-1');
      expect(prisma.localisation.create).not.toHaveBeenCalled();
    });

    it('crée une nouvelle localisation si aucune dans le rayon (> 15 m)', async () => {
      prisma.localisation.findMany.mockResolvedValue([
        { id: 'loc-1', gpsLat: 6.366, gpsLng: 2.444, quartierId: 'q1' },
      ]);
      prisma.quartier.findMany.mockResolvedValue([
        { id: 'q-near', polygon: null, centerLat: 6.4, centerLng: 2.4 },
      ]);
      prisma.localisation.create.mockResolvedValue({ id: 'loc-new' });

      const loc = await service.resolveOrCreate(6.4, 2.4);
      expect(loc.id).toBe('loc-new');
      expect(prisma.localisation.create).toHaveBeenCalledWith({
        data: { quartierId: 'q-near', gpsLat: 6.4, gpsLng: 2.4 },
      });
    });
  });

  describe('cleanupIfEmpty', () => {
    it('supprime la localisation quand plus aucune adresse vivante', async () => {
      prisma.address.count.mockResolvedValue(0);
      const del = jest.fn();
      (prisma.localisation as Record<string, unknown>).delete = del;
      await service.cleanupIfEmpty('loc-1');
      expect(del).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
    });

    it('conserve la localisation s’il reste une adresse vivante', async () => {
      prisma.address.count.mockResolvedValue(2);
      const del = jest.fn();
      (prisma.localisation as Record<string, unknown>).delete = del;
      await service.cleanupIfEmpty('loc-1');
      expect(del).not.toHaveBeenCalled();
    });
  });
});
