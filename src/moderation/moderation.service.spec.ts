import { ConflictException, NotFoundException } from '@nestjs/common';
import { RevisionStatus } from '@prisma/client';
import { ModerationService } from './moderation.service';

function buildPrismaMock() {
  return {
    addressRevision: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    address: { update: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('ModerationService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ModerationService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ModerationService(prisma as never);
  });

  describe('approveRevision', () => {
    it('publie la révision, bascule le pointeur et archive l’ancienne', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue({
        id: 'rev-2',
        addressId: 'addr-1',
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
        address: { code: 'AKP-1234', publishedRevisionId: 'rev-1' },
      });
      const revUpdate = jest.fn().mockResolvedValue({});
      const addrUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          addressRevision: { update: revUpdate },
          address: { update: addrUpdate },
        }),
      );

      const res = await service.approveRevision('rev-2', 'mod-1');

      expect(res).toMatchObject({ status: RevisionStatus.PUBLIEE, published: true });
      // nouvelle révision → PUBLIEE
      expect(revUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rev-2' },
          data: expect.objectContaining({ status: RevisionStatus.PUBLIEE, reviewedById: 'mod-1' }),
        }),
      );
      // pointeur bascule
      expect(addrUpdate).toHaveBeenCalledWith({
        where: { id: 'addr-1' },
        data: { publishedRevisionId: 'rev-2' },
      });
      // ancienne → ARCHIVEE
      expect(revUpdate).toHaveBeenCalledWith({
        where: { id: 'rev-1' },
        data: { status: RevisionStatus.ARCHIVEE },
      });
    });

    it('première publication : aucune archive si pas de version publiée', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        addressId: 'addr-1',
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
        address: { code: 'AKP-1234', publishedRevisionId: null },
      });
      const revUpdate = jest.fn().mockResolvedValue({});
      const addrUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          addressRevision: { update: revUpdate },
          address: { update: addrUpdate },
        }),
      );

      await service.approveRevision('rev-1', 'mod-1');
      // un seul update de révision (la nouvelle), pas d'archivage
      expect(revUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejette une révision introuvable (404)', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue(null);
      await expect(service.approveRevision('x', 'mod-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejette une révision déjà traitée (409)', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        status: RevisionStatus.PUBLIEE,
        address: { code: 'AKP-1234', publishedRevisionId: 'rev-1' },
      });
      await expect(service.approveRevision('rev-1', 'mod-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('rejectRevision', () => {
    it('passe la révision à REJETEE avec motif, sans toucher le pointeur', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue({
        id: 'rev-1',
        addressId: 'addr-1',
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
        address: { code: 'AKP-1234', publishedRevisionId: null },
      });
      prisma.addressRevision.update.mockResolvedValue({});

      const res = await service.rejectRevision('rev-1', 'mod-1', 'Photo illisible');

      expect(res.status).toBe(RevisionStatus.REJETEE);
      expect(prisma.address.update).not.toHaveBeenCalled();
      expect(prisma.addressRevision.update).toHaveBeenCalledWith({
        where: { id: 'rev-1' },
        data: expect.objectContaining({
          status: RevisionStatus.REJETEE,
          rejectionReason: 'Photo illisible',
          reviewedById: 'mod-1',
        }),
      });
    });
  });
});
