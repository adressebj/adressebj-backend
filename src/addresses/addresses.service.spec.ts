import {
  ConflictException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { AddressCategory, ApiEndpoint, RevisionStatus } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { LocalisationsService } from '../localisations/localisations.service';
import { AddressesService } from './addresses.service';

function buildPrismaMock() {
  return {
    address: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
    },
    addressRevision: { create: jest.fn() },
    quartier: { findUniqueOrThrow: jest.fn() },
    contribution: { findMany: jest.fn() },
    rating: { aggregate: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn(),
  };
}

const dto = {
  category: AddressCategory.DOMICILE,
  steps: ['Tourner à gauche', 'Maison bleue'],
  photoUrl: 'https://example.com/p.jpg',
  gpsLat: 6.3662,
  gpsLng: 2.3912,
};

describe('AddressesService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let localisations: { resolveOrCreate: jest.Mock };
  let apiKeys: { logRequest: jest.Mock };
  let service: AddressesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    localisations = { resolveOrCreate: jest.fn() };
    apiKeys = { logRequest: jest.fn().mockResolvedValue(undefined) };
    service = new AddressesService(
      prisma as never,
      localisations as unknown as LocalisationsService,
      apiKeys as unknown as ApiKeysService,
    );
  });

  describe('generateUniqueCode', () => {
    it('renvoie un code préfixé et unique, sans collision sur 1000 essais', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      for (let i = 0; i < 1000; i++) {
        const code = await service.generateUniqueCode('AKP');
        expect(code).toMatch(/^AKP-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
      }
    });

    it('réessaie tant que le code existe déjà', async () => {
      prisma.address.findUnique
        .mockResolvedValueOnce({ id: 'x' }) // collision
        .mockResolvedValueOnce({ id: 'y' }) // collision
        .mockResolvedValueOnce(null); // libre
      const code = await service.generateUniqueCode('CAD');
      expect(code.startsWith('CAD-')).toBe(true);
      expect(prisma.address.findUnique).toHaveBeenCalledTimes(3);
    });
  });

  describe('create', () => {
    it('crée l’adresse + la révision n°1 EN_ATTENTE_VALIDATION', async () => {
      localisations.resolveOrCreate.mockResolvedValue({
        id: 'loc-1',
        quartierId: 'q-1',
      });
      prisma.address.findFirst.mockResolvedValue(null);
      prisma.quartier.findUniqueOrThrow.mockResolvedValue({ prefix: 'AKP' });
      prisma.address.findUnique.mockResolvedValue(null);

      const addrCreate = jest.fn().mockResolvedValue({ id: 'addr-1' });
      const revCreate = jest.fn().mockResolvedValue({ id: 'rev-1' });
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          address: { create: addrCreate },
          addressRevision: { create: revCreate },
        }),
      );

      const res = await service.create('user-1', dto);

      expect(res.revisionStatus).toBe(RevisionStatus.EN_ATTENTE_VALIDATION);
      expect(res.code).toMatch(/^AKP-/);
      expect(addrCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          localisationId: 'loc-1',
          lifecycle: 'ACTIVE',
        }),
      });
      expect(revCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          addressId: 'addr-1',
          assembledText: 'Tourner à gauche. Maison bleue.',
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        }),
      });
    });

    it('refuse une 2ᵉ adresse du même habitant sur la même localisation (409)', async () => {
      localisations.resolveOrCreate.mockResolvedValue({
        id: 'loc-1',
        quartierId: 'q-1',
      });
      prisma.address.findFirst.mockResolvedValue({ code: 'AKP-1234' });

      await expect(service.create('user-1', dto)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('listMine', () => {
    it('mappe l’état (publiée, catégorie, statut de révision)', async () => {
      prisma.address.findMany.mockResolvedValue([
        {
          code: 'AKP-1234',
          lifecycle: 'ACTIVE',
          mapDiscoverable: true,
          publishedRevisionId: 'rev-1',
          publishedRevision: { category: 'DOMICILE' },
          revisions: [{ category: 'DOMICILE', status: 'PUBLIEE' }],
          createdAt: new Date('2026-06-01'),
        },
      ]);
      const res = await service.listMine('user-1');
      expect(res[0]).toMatchObject({
        code: 'AKP-1234',
        published: true,
        category: 'DOMICILE',
        currentRevisionStatus: 'PUBLIEE',
      });
    });
  });

  const publishedAddress = {
    id: 'addr-1',
    code: 'AKP-7X3K',
    lifecycle: 'ACTIVE',
    publishedRevisionId: 'rev-1',
    publishedRevision: {
      category: 'DOMICILE',
      steps: ['Partir du marché'],
      assembledText: 'Partir du marché.',
      photoUrl: 'https://res.cloudinary.com/x.jpg',
    },
    localisation: {
      gpsLat: 6.3676,
      gpsLng: 2.4252,
      quartier: { id: 'q-1', name: 'Akpakpa', prefix: 'AKP' },
    },
    deactivatedAt: null,
    createdAt: new Date('2026-05-01'),
  };

  describe('resolve', () => {
    it('renvoie le contenu publié, le GPS Localisation et métère l’appel', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);

      const res = await service.resolve('AKP-7X3K', 'key-1');

      expect(res).toMatchObject({
        code: 'AKP-7X3K',
        category: 'DOMICILE',
        quartier: { id: 'q-1', name: 'Akpakpa', prefix: 'AKP' },
        gps: { lat: 6.3676, lng: 2.4252 },
        assembledText: 'Partir du marché.',
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith(
        'key-1',
        ApiEndpoint.RESOLVE,
      );
    });

    it('404 si inexistante', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      await expect(service.resolve('XXX-0000', 'key-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });

    it('404 si active mais jamais publiée (existence non exposée)', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        publishedRevisionId: null,
        publishedRevision: null,
      });
      await expect(service.resolve('AKP-7X3K', 'key-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('410 si désactivée', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        lifecycle: 'DESACTIVEE',
        deactivatedAt: new Date('2026-03-14'),
      });
      await expect(service.resolve('AKP-7X3K', 'key-1')).rejects.toThrow(
        GoneException,
      );
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });
  });

  describe('getPublicPage', () => {
    it('renvoie le contenu + moyenne arrondie + notes terrain approuvées', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { stars: 3.6666 },
        _count: { stars: 12 },
      });
      prisma.contribution.findMany.mockResolvedValue([
        { message: 'Sens unique le matin', createdAt: new Date('2026-05-02') },
      ]);

      const res = await service.getPublicPage('AKP-7X3K');

      expect(res).toMatchObject({
        code: 'AKP-7X3K',
        quartier: { name: 'Akpakpa', prefix: 'AKP' },
        averageRating: 3.7,
        ratingCount: 12,
      });
      expect(res.fieldNotes).toHaveLength(1);
      expect(prisma.contribution.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { addressId: 'addr-1', status: 'APPROVED' },
        }),
      );
    });

    it('averageRating null si aucune évaluation', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { stars: null },
        _count: { stars: 0 },
      });
      prisma.contribution.findMany.mockResolvedValue([]);

      const res = await service.getPublicPage('AKP-7X3K');
      expect(res.averageRating).toBeNull();
      expect(res.ratingCount).toBe(0);
    });
  });

  describe('rate', () => {
    it('upsert la note puis renvoie la moyenne recalculée', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.upsert.mockResolvedValue({});
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { stars: 3.75 },
        _count: { stars: 13 },
      });

      const res = await service.rate('user-1', 'AKP-7X3K', 4);

      expect(res).toEqual({ recorded: true, averageRating: 3.8, ratingCount: 13 });
      expect(prisma.rating.upsert).toHaveBeenCalledWith({
        where: { userId_addressId: { userId: 'user-1', addressId: 'addr-1' } },
        create: { userId: 'user-1', addressId: 'addr-1', stars: 4 },
        update: { stars: 4 },
      });
    });

    it.each([0, 6, 3.5])('rejette une note hors bornes (%s) → INVALID_RATING', async (stars) => {
      await expect(service.rate('user-1', 'AKP-7X3K', stars)).rejects.toMatchObject({
        response: { code: 'INVALID_RATING' },
      });
      expect(prisma.address.findUnique).not.toHaveBeenCalled();
      expect(prisma.rating.upsert).not.toHaveBeenCalled();
    });

    it('404 si adresse non publiée (avant tout upsert)', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      await expect(service.rate('user-1', 'XXX-0000', 4)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.rating.upsert).not.toHaveBeenCalled();
    });
  });

  describe('verify', () => {
    it('renvoie moyenne + published, et métère VERIFY', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.aggregate.mockResolvedValue({
        _avg: { stars: 3.7 },
        _count: { stars: 12 },
      });

      const res = await service.verify('AKP-7X3K', 'key-1');

      expect(res).toEqual({
        code: 'AKP-7X3K',
        published: true,
        averageRating: 3.7,
        ratingCount: 12,
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith('key-1', ApiEndpoint.VERIFY);
    });

    it('410 si désactivée (pas de métering)', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        lifecycle: 'DESACTIVEE',
        deactivatedAt: new Date('2026-03-14'),
      });
      await expect(service.verify('AKP-7X3K', 'key-1')).rejects.toThrow(
        GoneException,
      );
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });
  });
});
