import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { AddressCategory, ApiEndpoint, RevisionStatus } from '@prisma/client';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { LocalisationsService } from '../localisations/localisations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutingService } from '../common/routing/routing.service';
import { AddressesService } from './addresses.service';

function buildPrismaMock() {
  return {
    address: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    addressRevision: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    quartier: { findUniqueOrThrow: jest.fn() },
    contribution: { findMany: jest.fn() },
    rating: { aggregate: jest.fn(), upsert: jest.fn() },
    report: { create: jest.fn() },
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
  let localisations: { resolveOrCreate: jest.Mock; cleanupIfEmpty: jest.Mock };
  let apiKeys: { logRequest: jest.Mock };
  let routing: { getEta: jest.Mock };
  let notifications: { notifyOwner: jest.Mock };
  let service: AddressesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    localisations = {
      resolveOrCreate: jest.fn(),
      cleanupIfEmpty: jest.fn().mockResolvedValue(undefined),
    };
    apiKeys = { logRequest: jest.fn().mockResolvedValue(undefined) };
    routing = { getEta: jest.fn() };
    notifications = { notifyOwner: jest.fn().mockResolvedValue(undefined) };
    service = new AddressesService(
      prisma as never,
      localisations as unknown as LocalisationsService,
      apiKeys as unknown as ApiKeysService,
      routing as unknown as RoutingService,
      notifications as unknown as NotificationsService,
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
    userId: 'owner-1',
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

      expect(res).toEqual({
        recorded: true,
        averageRating: 3.8,
        ratingCount: 13,
      });
      expect(prisma.rating.upsert).toHaveBeenCalledWith({
        where: { userId_addressId: { userId: 'user-1', addressId: 'addr-1' } },
        create: { userId: 'user-1', addressId: 'addr-1', stars: 4 },
        update: { stars: 4 },
      });
    });

    it.each([0, 6, 3.5])(
      'rejette une note hors bornes (%s) → INVALID_RATING',
      async (stars) => {
        await expect(
          service.rate('user-1', 'AKP-7X3K', stars),
        ).rejects.toMatchObject({
          response: { code: 'INVALID_RATING' },
        });
        expect(prisma.address.findUnique).not.toHaveBeenCalled();
        expect(prisma.rating.upsert).not.toHaveBeenCalled();
      },
    );

    it('404 si adresse non publiée (avant tout upsert)', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      await expect(service.rate('user-1', 'XXX-0000', 4)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.rating.upsert).not.toHaveBeenCalled();
    });

    it('alerte le propriétaire au franchissement du seuil de fiabilité', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.upsert.mockResolvedValue({});
      // avant : moyenne saine (3.0, 4 notes) ; après : dégradée (2.4, 5 notes)
      prisma.rating.aggregate
        .mockResolvedValueOnce({ _avg: { stars: 3.0 }, _count: { stars: 4 } })
        .mockResolvedValueOnce({ _avg: { stars: 2.4 }, _count: { stars: 5 } });

      await service.rate('user-1', 'AKP-7X3K', 1);

      expect(notifications.notifyOwner).toHaveBeenCalledWith(
        'owner-1',
        expect.objectContaining({ type: 'RELIABILITY_WARNING' }),
      );
    });

    it("n'alerte pas si la moyenne reste sous le seuil (déjà dégradée)", async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.upsert.mockResolvedValue({});
      // avant déjà sous le seuil → pas de nouveau franchissement
      prisma.rating.aggregate
        .mockResolvedValueOnce({ _avg: { stars: 2.0 }, _count: { stars: 5 } })
        .mockResolvedValueOnce({ _avg: { stars: 1.8 }, _count: { stars: 6 } });

      await service.rate('user-1', 'AKP-7X3K', 1);

      expect(notifications.notifyOwner).not.toHaveBeenCalled();
    });

    it("n'alerte pas sous le minimum d'évaluations", async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.rating.upsert.mockResolvedValue({});
      prisma.rating.aggregate
        .mockResolvedValueOnce({ _avg: { stars: null }, _count: { stars: 0 } })
        .mockResolvedValueOnce({ _avg: { stars: 1.0 }, _count: { stars: 2 } });

      await service.rate('user-1', 'AKP-7X3K', 1);

      expect(notifications.notifyOwner).not.toHaveBeenCalled();
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
      expect(apiKeys.logRequest).toHaveBeenCalledWith(
        'key-1',
        ApiEndpoint.VERIFY,
      );
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

  describe('eta', () => {
    const origin = { lat: 6.36, lng: 2.41 };

    it('délègue au RoutingService (destination = GPS Localisation) et métère ETA', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      routing.getEta.mockResolvedValue({
        etaMinutes: 11,
        distanceMeters: 4200,
        source: 'OSRM',
      });

      const res = await service.eta('AKP-7X3K', origin, 'key-1');

      expect(routing.getEta).toHaveBeenCalledWith(origin, {
        lat: 6.3676,
        lng: 2.4252,
      });
      expect(res).toEqual({
        code: 'AKP-7X3K',
        origin,
        destination: { lat: 6.3676, lng: 2.4252 },
        etaMinutes: 11,
        distanceMeters: 4200,
        source: 'OSRM',
      });
      expect(apiKeys.logRequest).toHaveBeenCalledWith('key-1', ApiEndpoint.ETA);
    });

    it('404 si jamais publiée — pas de routage ni de métering', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        publishedRevisionId: null,
        publishedRevision: null,
      });
      await expect(service.eta('AKP-7X3K', origin, 'key-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(routing.getEta).not.toHaveBeenCalled();
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });

    it('410 si désactivée — pas de routage ni de métering', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        lifecycle: 'DESACTIVEE',
        deactivatedAt: new Date('2026-03-14'),
      });
      await expect(service.eta('AKP-7X3K', origin, 'key-1')).rejects.toThrow(
        GoneException,
      );
      expect(routing.getEta).not.toHaveBeenCalled();
      expect(apiKeys.logRequest).not.toHaveBeenCalled();
    });
  });

  describe('report', () => {
    it('crée un signalement PENDING sur une adresse publiée', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.report.create.mockResolvedValue({ id: 'rep-1' });

      const res = await service.report('user-1', 'AKP-7X3K', 'Démolie');

      expect(res).toEqual({ reportId: 'rep-1', status: 'PENDING' });
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: { addressId: 'addr-1', userId: 'user-1', message: 'Démolie' },
      });
    });

    it('message absent → null', async () => {
      prisma.address.findUnique.mockResolvedValue(publishedAddress);
      prisma.report.create.mockResolvedValue({ id: 'rep-2' });

      await service.report('user-1', 'AKP-7X3K');
      expect(prisma.report.create).toHaveBeenCalledWith({
        data: { addressId: 'addr-1', userId: 'user-1', message: null },
      });
    });

    it('404 si adresse non publiée', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      await expect(service.report('user-1', 'XXX-0000')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.report.create).not.toHaveBeenCalled();
    });
  });

  describe('resolvePublishedAddress', () => {
    it('retourne id/code/ownerId d’une adresse publiée', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...publishedAddress,
        userId: 'owner-9',
      });
      const res = await service.resolvePublishedAddress('AKP-7X3K');
      expect(res).toEqual({
        id: 'addr-1',
        code: 'AKP-7X3K',
        ownerId: 'owner-9',
      });
    });
  });

  describe('mapAddresses', () => {
    const bounds = { north: 6.4, south: 6.34, east: 2.46, west: 2.4 };

    it('applique la matrice de visibilité (domicile muet, autres avec preview)', async () => {
      prisma.address.findMany.mockResolvedValue([
        {
          code: 'CAD-3M9P',
          localisation: { gpsLat: 6.366, gpsLng: 2.421 },
          publishedRevision: {
            category: 'COMMERCE',
            photoUrl: 'https://x/c.jpg',
          },
        },
        {
          code: 'AKP-7X3K',
          localisation: { gpsLat: 6.367, gpsLng: 2.425 },
          publishedRevision: {
            category: 'DOMICILE',
            photoUrl: 'https://x/d.jpg',
          },
        },
      ]);

      const res = await service.mapAddresses(bounds);

      expect(res[0]).toEqual({
        code: 'CAD-3M9P',
        category: 'COMMERCE',
        gps: { lat: 6.366, lng: 2.421 },
        muted: false,
        preview: { photoUrl: 'https://x/c.jpg', code: 'CAD-3M9P' },
      });
      expect(res[1]).toEqual({
        code: 'AKP-7X3K',
        category: 'DOMICILE',
        gps: { lat: 6.367, lng: 2.425 },
        muted: true,
        preview: null,
      });
    });

    it('ne retourne que les adresses publiées, actives et découvrables, dans la bbox', async () => {
      prisma.address.findMany.mockResolvedValue([]);
      await service.mapAddresses(bounds);
      expect(prisma.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            lifecycle: 'ACTIVE',
            mapDiscoverable: true,
            publishedRevisionId: { not: null },
            localisation: {
              gpsLat: { gte: 6.34, lte: 6.4 },
              gpsLng: { gte: 2.4, lte: 2.46 },
            },
          }),
        }),
      );
    });

    it('filtre par catégorie quand fournie', async () => {
      prisma.address.findMany.mockResolvedValue([]);
      await service.mapAddresses({ ...bounds, category: 'COMMERCE' });
      expect(prisma.address.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            publishedRevision: { category: 'COMMERCE' },
          }),
        }),
      );
    });

    it('bounding box invalide (north<south) → 400 INVALID_BOUNDING_BOX', async () => {
      await expect(
        service.mapAddresses({ north: 6.0, south: 6.4, east: 2.46, west: 2.4 }),
      ).rejects.toMatchObject({ response: { code: 'INVALID_BOUNDING_BOX' } });
      expect(prisma.address.findMany).not.toHaveBeenCalled();
    });
  });

  const ownedAddress = {
    id: 'addr-1',
    code: 'AKP-7X3K',
    userId: 'owner-1',
    lifecycle: 'ACTIVE',
    publishedRevisionId: 'rev-1',
    mapDiscoverable: true,
    localisationId: 'loc-1',
    localisation: { gpsLat: 6.3676, gpsLng: 2.4252 },
  };

  const updateDto = {
    category: AddressCategory.COMMERCE,
    steps: ['Nouveau repère', 'Portail vert'],
    photoUrl: 'https://example.com/new.jpg',
  };

  describe('update', () => {
    it('crée une nouvelle révision EN_ATTENTE (GPS = localisation), pointeur inchangé', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      prisma.addressRevision.findFirst.mockResolvedValue(null);
      prisma.addressRevision.create.mockResolvedValue({ id: 'rev-2' });

      const res = await service.update('owner-1', 'AKP-7X3K', updateDto);

      expect(res).toEqual({
        code: 'AKP-7X3K',
        revisionStatus: RevisionStatus.EN_ATTENTE_VALIDATION,
        published: true,
      });
      expect(prisma.addressRevision.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          addressId: 'addr-1',
          assembledText: 'Nouveau repère. Portail vert.',
          gpsLat: 6.3676,
          gpsLng: 2.4252,
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        }),
      });
      expect(prisma.address.update).not.toHaveBeenCalled();
    });

    it('409 si une révision est déjà en attente', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      prisma.addressRevision.findFirst.mockResolvedValue({ id: 'rev-pending' });
      await expect(
        service.update('owner-1', 'AKP-7X3K', updateDto),
      ).rejects.toMatchObject({
        response: { code: 'REVISION_ALREADY_PENDING' },
      });
      expect(prisma.addressRevision.create).not.toHaveBeenCalled();
    });

    it('403 si l’appelant n’est pas le propriétaire', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      await expect(
        service.update('intrus-9', 'AKP-7X3K', updateDto),
      ).rejects.toThrow(ForbiddenException);
    });

    it('404 si l’adresse n’existe pas', async () => {
      prisma.address.findUnique.mockResolvedValue(null);
      await expect(
        service.update('owner-1', 'XXX-0000', updateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('409 si l’adresse est désactivée', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...ownedAddress,
        lifecycle: 'DESACTIVEE',
      });
      await expect(
        service.update('owner-1', 'AKP-7X3K', updateDto),
      ).rejects.toMatchObject({
        response: { code: 'ADDRESS_ALREADY_DEACTIVATED' },
      });
    });
  });

  describe('setDiscoverable', () => {
    it('bascule mapDiscoverable du propriétaire', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      prisma.address.update.mockResolvedValue({
        code: 'AKP-7X3K',
        mapDiscoverable: false,
      });
      const res = await service.setDiscoverable('owner-1', 'AKP-7X3K', false);
      expect(res).toEqual({ code: 'AKP-7X3K', mapDiscoverable: false });
      expect(prisma.address.update).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { mapDiscoverable: false },
      });
    });

    it('403 pour un non-propriétaire', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      await expect(
        service.setDiscoverable('intrus-9', 'AKP-7X3K', false),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('deactivate', () => {
    it('désactive, périme la révision en attente et nettoie la localisation', async () => {
      prisma.address.findUnique.mockResolvedValue(ownedAddress);
      const addrUpdate = jest.fn().mockResolvedValue({});
      const revUpdateMany = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          address: { update: addrUpdate },
          addressRevision: { updateMany: revUpdateMany },
        }),
      );

      const res = await service.deactivate('owner-1', 'AKP-7X3K');

      expect(res).toEqual({ code: 'AKP-7X3K', lifecycle: 'DESACTIVEE' });
      expect(addrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'addr-1' },
          data: expect.objectContaining({
            lifecycle: 'DESACTIVEE',
            deactivatedById: 'owner-1',
          }),
        }),
      );
      expect(revUpdateMany).toHaveBeenCalledWith({
        where: {
          addressId: 'addr-1',
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        },
        data: { status: RevisionStatus.OBSOLETE },
      });
      expect(localisations.cleanupIfEmpty).toHaveBeenCalledWith('loc-1');
    });

    it('409 si déjà désactivée', async () => {
      prisma.address.findUnique.mockResolvedValue({
        ...ownedAddress,
        lifecycle: 'DESACTIVEE',
      });
      await expect(
        service.deactivate('owner-1', 'AKP-7X3K'),
      ).rejects.toMatchObject({
        response: { code: 'ADDRESS_ALREADY_DEACTIVATED' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
