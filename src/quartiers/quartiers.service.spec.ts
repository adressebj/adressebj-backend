import { NotFoundException } from '@nestjs/common';
import { ApiEndpoint } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { QuartiersService } from './quartiers.service';

function buildPrismaMock() {
  return {
    quartier: { findMany: jest.fn(), findUnique: jest.fn() },
    visit: { findMany: jest.fn() },
  };
}

/** Construit une visite : départ à `departHourUtc`, durée `durationMin` (null = non confirmée). */
function visit(
  departHourUtc: number,
  durationMin: number | null,
  finalPrice: number | null = null,
) {
  const departAt = new Date(Date.UTC(2026, 5, 1, departHourUtc, 0, 0));
  const arrivedAt =
    durationMin === null
      ? null
      : new Date(departAt.getTime() + durationMin * 60000);
  return { departAt, arrivedAt, finalPrice };
}

describe('QuartiersService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let apiKeys: { reportingRatio: jest.Mock; logRequest: jest.Mock };
  let service: QuartiersService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    apiKeys = {
      reportingRatio: jest.fn(),
      logRequest: jest.fn().mockResolvedValue(undefined),
    };
    service = new QuartiersService(
      prisma as never,
      apiKeys as unknown as ApiKeysService,
    );
  });

  describe('listActive', () => {
    it('renvoie les quartiers actifs', async () => {
      prisma.quartier.findMany.mockResolvedValue([
        { id: 'q-1', name: 'Akpakpa', prefix: 'AKP' },
      ]);
      const res = await service.listActive();
      expect(res).toHaveLength(1);
      expect(prisma.quartier.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });
  });

  describe('analytics', () => {
    it('404 si le quartier est introuvable (avant tout métering)', async () => {
      prisma.quartier.findUnique.mockResolvedValue(null);
      await expect(service.analytics('q-x', 'key-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(apiKeys.reportingRatio).not.toHaveBeenCalled();
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });

    it('403 ANALYTICS_QUOTA_INSUFFICIENT si ratio < 80 % (pas de métering)', async () => {
      prisma.quartier.findUnique.mockResolvedValue({
        id: 'q-1',
        name: 'Akpakpa',
      });
      apiKeys.reportingRatio.mockResolvedValue({
        confirms: 6,
        resolves: 10,
        ratio: 0.6,
      });
      await expect(service.analytics('q-1', 'key-1')).rejects.toMatchObject({
        response: {
          code: 'ANALYTICS_QUOTA_INSUFFICIENT',
          message: expect.stringContaining('60%'),
        },
      });
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
      expect(prisma.visit.findMany).not.toHaveBeenCalled();
    });

    it('agrège les visites (médianes, successRate, peakHours) et métère ANALYTICS', async () => {
      prisma.quartier.findUnique.mockResolvedValue({
        id: 'q-1',
        name: 'Akpakpa',
      });
      apiKeys.reportingRatio.mockResolvedValue({
        confirms: 9,
        resolves: 10,
        ratio: 0.9,
      });
      // 5 visites : 4 confirmées (durées 10,12,8,30), 1 non confirmée.
      // départs : 3× à 8h, 2× à 17h → peak = 08:00-09:00 puis 17:00-18:00.
      prisma.visit.findMany.mockResolvedValue([
        visit(8, 10, 1000),
        visit(8, 12, 1200),
        visit(8, 8, 1400),
        visit(17, 30, 2000),
        visit(17, null, null),
      ]);

      const res = await service.analytics('q-1', 'key-1');

      expect(res).toMatchObject({
        quartierId: 'q-1',
        quartierName: 'Akpakpa',
        totalVisits: 5,
        medianEtaMinutes: 11, // médiane de [8,10,12,30] = (10+12)/2 = 11
        medianPriceFCFA: 1300, // médiane de [1000,1200,1400,2000] = (1200+1400)/2 = 1300
        peakHours: ['08:00-09:00', '17:00-18:00'],
        successRate: 0.8, // 4 confirmées / 5
        period: 'last_30_days',
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith(
        'key-1',
        ApiEndpoint.ANALYTICS,
      );
    });

    it('quartier sans visite : zéros et nulls, peakHours vide', async () => {
      prisma.quartier.findUnique.mockResolvedValue({ id: 'q-1', name: 'Vide' });
      apiKeys.reportingRatio.mockResolvedValue({
        confirms: 1,
        resolves: 1,
        ratio: 1,
      });
      prisma.visit.findMany.mockResolvedValue([]);

      const res = await service.analytics('q-1', 'key-1');

      expect(res).toMatchObject({
        totalVisits: 0,
        medianEtaMinutes: null,
        medianPriceFCFA: null,
        peakHours: [],
        successRate: null,
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith(
        'key-1',
        ApiEndpoint.ANALYTICS,
      );
    });

    it('ratio exactement à 80 % passe le quota', async () => {
      prisma.quartier.findUnique.mockResolvedValue({
        id: 'q-1',
        name: 'Akpakpa',
      });
      apiKeys.reportingRatio.mockResolvedValue({
        confirms: 8,
        resolves: 10,
        ratio: 0.8,
      });
      prisma.visit.findMany.mockResolvedValue([]);
      await expect(service.analytics('q-1', 'key-1')).resolves.toBeDefined();
    });
  });
});
