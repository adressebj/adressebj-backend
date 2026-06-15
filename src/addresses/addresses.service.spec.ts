import { ConflictException } from '@nestjs/common';
import { AddressCategory, RevisionStatus } from '@prisma/client';
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
  let service: AddressesService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    localisations = { resolveOrCreate: jest.fn() };
    service = new AddressesService(
      prisma as never,
      localisations as unknown as LocalisationsService,
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
});
