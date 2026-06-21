import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  ContributionStatus,
  ReportStatus,
  RevisionStatus,
} from '@prisma/client';
import { LocalisationsService } from '../localisations/localisations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ModerationService } from './moderation.service';

function buildPrismaMock() {
  return {
    addressRevision: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
    },
    address: { update: jest.fn() },
    report: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    contribution: {
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

describe('ModerationService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let localisations: { cleanupIfEmpty: jest.Mock };
  let notifications: { notifyOwner: jest.Mock };
  let service: ModerationService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    localisations = { cleanupIfEmpty: jest.fn().mockResolvedValue(undefined) };
    notifications = { notifyOwner: jest.fn().mockResolvedValue(undefined) };
    service = new ModerationService(
      prisma as never,
      localisations as unknown as LocalisationsService,
      notifications as unknown as NotificationsService,
    );
  });

  describe('approveRevision', () => {
    it('publie la révision, bascule le pointeur et archive l’ancienne', async () => {
      prisma.addressRevision.findUnique.mockResolvedValue({
        id: 'rev-2',
        addressId: 'addr-1',
        status: RevisionStatus.EN_ATTENTE_VALIDATION,
        address: {
          code: 'AKP-1234',
          publishedRevisionId: 'rev-1',
          userId: 'owner-1',
        },
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

      expect(res).toMatchObject({
        status: RevisionStatus.PUBLIEE,
        published: true,
      });
      // nouvelle révision → PUBLIEE
      expect(revUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rev-2' },
          data: expect.objectContaining({
            status: RevisionStatus.PUBLIEE,
            reviewedById: 'mod-1',
          }),
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
      // le propriétaire est notifié de la validation
      expect(notifications.notifyOwner).toHaveBeenCalledWith(
        'owner-1',
        expect.objectContaining({ type: 'ADDRESS_VALIDATED' }),
      );
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
        address: {
          code: 'AKP-1234',
          publishedRevisionId: null,
          userId: 'owner-1',
        },
      });
      prisma.addressRevision.update.mockResolvedValue({});

      const res = await service.rejectRevision(
        'rev-1',
        'mod-1',
        'Photo illisible',
      );

      expect(res.status).toBe(RevisionStatus.REJETEE);
      expect(prisma.address.update).not.toHaveBeenCalled();
      expect(notifications.notifyOwner).toHaveBeenCalledWith(
        'owner-1',
        expect.objectContaining({ type: 'ADDRESS_REJECTED' }),
      );
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

  describe('resolveReport', () => {
    it('passe le signalement à RESOLVED sans toucher l’adresse', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        addressId: 'addr-1',
        status: ReportStatus.PENDING,
        address: {
          code: 'AKP-1234',
          lifecycle: 'ACTIVE',
          localisationId: 'loc-1',
        },
      });
      prisma.report.update.mockResolvedValue({});

      const res = await service.resolveReport('rep-1', 'mod-1');

      expect(res).toMatchObject({
        status: ReportStatus.RESOLVED,
        addressDeactivated: false,
      });
      expect(prisma.address.update).not.toHaveBeenCalled();
      expect(localisations.cleanupIfEmpty).not.toHaveBeenCalled();
    });

    it('rejette un signalement déjà traité (409)', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        status: ReportStatus.RESOLVED,
        address: {
          code: 'AKP-1234',
          lifecycle: 'ACTIVE',
          localisationId: 'loc-1',
        },
      });
      await expect(service.resolveReport('rep-1', 'mod-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('signalement introuvable (404)', async () => {
      prisma.report.findUnique.mockResolvedValue(null);
      await expect(service.resolveReport('x', 'mod-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deactivateFromReport', () => {
    it('désactive l’adresse, périme la révision en attente, ACTIONNE le signalement, nettoie la localisation', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        addressId: 'addr-1',
        status: ReportStatus.PENDING,
        address: {
          code: 'AKP-1234',
          lifecycle: 'ACTIVE',
          localisationId: 'loc-1',
          userId: 'owner-1',
        },
      });
      const addrUpdate = jest.fn().mockResolvedValue({});
      const revUpdateMany = jest.fn().mockResolvedValue({});
      const repUpdate = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          address: { update: addrUpdate },
          addressRevision: { updateMany: revUpdateMany },
          report: { update: repUpdate },
        }),
      );

      const res = await service.deactivateFromReport(
        'rep-1',
        'mod-1',
        'Fraude',
      );

      expect(res).toMatchObject({
        status: ReportStatus.ACTIONED,
        addressDeactivated: true,
      });
      expect(addrUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'addr-1' },
          data: expect.objectContaining({
            lifecycle: 'DESACTIVEE',
            deactivatedById: 'mod-1',
            deactivationReason: 'Fraude',
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
      expect(notifications.notifyOwner).toHaveBeenCalledWith(
        'owner-1',
        expect.objectContaining({ type: 'ADDRESS_DEACTIVATED' }),
      );
    });

    it('refuse de désactiver une adresse déjà désactivée (409)', async () => {
      prisma.report.findUnique.mockResolvedValue({
        id: 'rep-1',
        addressId: 'addr-1',
        status: ReportStatus.PENDING,
        address: {
          code: 'AKP-1234',
          lifecycle: 'DESACTIVEE',
          localisationId: null,
        },
      });
      await expect(
        service.deactivateFromReport('rep-1', 'mod-1'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('contributions', () => {
    it('approuve une contribution PENDING', async () => {
      prisma.contribution.findUnique.mockResolvedValue({
        id: 'c-1',
        status: ContributionStatus.PENDING,
        address: { code: 'AKP-1234' },
      });
      prisma.contribution.update.mockResolvedValue({});

      const res = await service.approveContribution('c-1', 'mod-1');

      expect(res.status).toBe(ContributionStatus.APPROVED);
      expect(prisma.contribution.update).toHaveBeenCalledWith({
        where: { id: 'c-1' },
        data: expect.objectContaining({
          status: ContributionStatus.APPROVED,
          reviewedById: 'mod-1',
        }),
      });
    });

    it('rejette une contribution PENDING', async () => {
      prisma.contribution.findUnique.mockResolvedValue({
        id: 'c-1',
        status: ContributionStatus.PENDING,
        address: { code: 'AKP-1234' },
      });
      prisma.contribution.update.mockResolvedValue({});

      const res = await service.rejectContribution('c-1', 'mod-1');
      expect(res.status).toBe(ContributionStatus.REJECTED);
    });

    it('contribution déjà traitée (409)', async () => {
      prisma.contribution.findUnique.mockResolvedValue({
        id: 'c-1',
        status: ContributionStatus.APPROVED,
        address: { code: 'AKP-1234' },
      });
      await expect(service.approveContribution('c-1', 'mod-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('contribution introuvable (404)', async () => {
      prisma.contribution.findUnique.mockResolvedValue(null);
      await expect(service.rejectContribution('x', 'mod-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
