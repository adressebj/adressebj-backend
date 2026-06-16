import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ApiEndpoint } from '@prisma/client';
import { AddressesService } from '../addresses/addresses.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { VisitsService } from './visits.service';

function buildPrismaMock() {
  return {
    visit: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('VisitsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let addresses: { resolvePublishedAddress: jest.Mock };
  let apiKeys: { validate: jest.Mock; logRequest: jest.Mock };
  let service: VisitsService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    addresses = { resolvePublishedAddress: jest.fn() };
    apiKeys = {
      validate: jest.fn(),
      logRequest: jest.fn().mockResolvedValue(undefined),
    };
    service = new VisitsService(
      prisma as never,
      addresses as unknown as AddressesService,
      apiKeys as unknown as ApiKeysService,
    );
  });

  describe('start', () => {
    it('résout l’adresse publiée et crée la visite', async () => {
      addresses.resolvePublishedAddress.mockResolvedValue({ id: 'addr-1' });
      prisma.visit.create.mockResolvedValue({ id: 'visit-1' });

      const res = await service.start({
        addressCode: 'AKP-7X3K',
        departAt: '2026-05-17T09:00:00Z',
      });

      expect(res).toEqual({ visitId: 'visit-1' });
      expect(prisma.visit.create).toHaveBeenCalledWith({
        data: {
          addressId: 'addr-1',
          departAt: new Date('2026-05-17T09:00:00Z'),
        },
      });
    });

    it('propage le 404 d’une adresse non publiée', async () => {
      addresses.resolvePublishedAddress.mockRejectedValue(
        new NotFoundException({ code: 'ADDRESS_NOT_FOUND' }),
      );
      await expect(
        service.start({
          addressCode: 'XXX-0000',
          departAt: '2026-05-17T09:00:00Z',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('confirm — mode web (sans clé API)', () => {
    it('met à jour la visite et renvoie recorded', async () => {
      prisma.visit.findUnique.mockResolvedValue({
        id: 'visit-1',
        departAt: new Date('2026-05-17T09:00:00Z'),
      });
      prisma.visit.update.mockResolvedValue({});

      const res = await service.confirm({
        visitId: 'visit-1',
        arrivedAt: '2026-05-17T09:14:00Z',
      });

      expect(res).toEqual({ visitId: 'visit-1', recorded: true });
      expect(prisma.visit.update).toHaveBeenCalledWith({
        where: { id: 'visit-1' },
        data: { arrivedAt: new Date('2026-05-17T09:14:00Z') },
      });
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });

    it('400 VISIT_ID_REQUIRED si visitId manquant', async () => {
      await expect(
        service.confirm({ arrivedAt: '2026-05-17T09:14:00Z' }),
      ).rejects.toMatchObject({ response: { code: 'VISIT_ID_REQUIRED' } });
    });

    it('404 si la visite est introuvable', async () => {
      prisma.visit.findUnique.mockResolvedValue(null);
      await expect(
        service.confirm({ visitId: 'nope', arrivedAt: '2026-05-17T09:14:00Z' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('400 INVALID_VISIT_TIMESTAMPS si arrivée avant départ', async () => {
      prisma.visit.findUnique.mockResolvedValue({
        id: 'visit-1',
        departAt: new Date('2026-05-17T09:00:00Z'),
      });
      await expect(
        service.confirm({
          visitId: 'visit-1',
          arrivedAt: '2026-05-17T08:00:00Z',
        }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_VISIT_TIMESTAMPS' },
      });
      expect(prisma.visit.update).not.toHaveBeenCalled();
    });

    it('un Bearer JWT (non bj_live_) reste en mode web', async () => {
      prisma.visit.findUnique.mockResolvedValue({
        id: 'visit-1',
        departAt: new Date('2026-05-17T09:00:00Z'),
      });
      prisma.visit.update.mockResolvedValue({});
      await service.confirm(
        { visitId: 'visit-1', arrivedAt: '2026-05-17T09:14:00Z' },
        'Bearer some.jwt.token',
      );
      expect(apiKeys.validate).not.toHaveBeenCalled();
      expect(prisma.visit.update).toHaveBeenCalled();
    });
  });

  describe('confirm — mode API (clé bj_live_)', () => {
    const apiHeader = 'Bearer bj_live_integrationkey01';

    it('valide la clé, crée la visite complète et métère CONFIRM', async () => {
      apiKeys.validate.mockResolvedValue({ id: 'key-1' });
      addresses.resolvePublishedAddress.mockResolvedValue({ id: 'addr-1' });
      prisma.visit.create.mockResolvedValue({ id: 'visit-9' });

      const res = await service.confirm(
        {
          addressCode: 'AKP-7X3K',
          departAt: '2026-05-17T09:00:00Z',
          arrivedAt: '2026-05-17T09:14:00Z',
          finalPrice: 1500,
        },
        apiHeader,
      );

      expect(res).toEqual({ visitId: 'visit-9', recorded: true });
      expect(prisma.visit.create).toHaveBeenCalledWith({
        data: {
          addressId: 'addr-1',
          departAt: new Date('2026-05-17T09:00:00Z'),
          arrivedAt: new Date('2026-05-17T09:14:00Z'),
          apiKeyId: 'key-1',
          finalPrice: 1500,
        },
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith(
        'key-1',
        ApiEndpoint.CONFIRM,
      );
    });

    it('400 VISIT_FIELDS_REQUIRED si addressCode/departAt manquent', async () => {
      apiKeys.validate.mockResolvedValue({ id: 'key-1' });
      await expect(
        service.confirm({ arrivedAt: '2026-05-17T09:14:00Z' }, apiHeader),
      ).rejects.toMatchObject({ response: { code: 'VISIT_FIELDS_REQUIRED' } });
    });

    it('400 INVALID_VISIT_TIMESTAMPS si arrivée avant départ', async () => {
      apiKeys.validate.mockResolvedValue({ id: 'key-1' });
      await expect(
        service.confirm(
          {
            addressCode: 'AKP-7X3K',
            departAt: '2026-05-17T09:00:00Z',
            arrivedAt: '2026-05-17T08:00:00Z',
          },
          apiHeader,
        ),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_VISIT_TIMESTAMPS' },
      });
      expect(prisma.visit.create).not.toHaveBeenCalled();
    });

    it('propage le 401 d’une clé invalide', async () => {
      apiKeys.validate.mockRejectedValue(
        new UnauthorizedException({ code: 'API_KEY_INVALID' }),
      );
      await expect(
        service.confirm(
          {
            addressCode: 'AKP-7X3K',
            departAt: '2026-05-17T09:00:00Z',
            arrivedAt: '2026-05-17T09:14:00Z',
          },
          apiHeader,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
