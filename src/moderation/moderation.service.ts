import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContributionStatus,
  NotificationType,
  ReportStatus,
  RevisionStatus,
} from '@prisma/client';
import { LocalisationsService } from '../localisations/localisations.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

/** Au-delà de cette inactivité du propriétaire, un signalement est présenté avec présomption de validité. */
const INACTIVE_OWNER_DAYS = 90;

/**
 * Masque un numéro pour l'affichage modération : on ne révèle que les deux
 * derniers chiffres (`+229 •••• •• 42`). Tombstone (téléphone null) → tirets.
 */
function maskPhone(phone: string | null): string {
  if (!phone) return '••••••••';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 2) return '••••••••';
  return `••••••${digits.slice(-2)}`;
}

export interface PendingRevision {
  id: string;
  addressCode: string;
  category: string;
  steps: string[];
  assembledText: string;
  photoUrl: string;
  gps: { lat: number; lng: number };
  gpsAccuracyMeters: number;
  quartierName: string;
  ownerPhoneMasked: string;
  createdAt: Date;
  owner: { id: string; firstName: string | null; lastName: string | null };
  isFirstPublication: boolean;
}

export interface RevisionDecision {
  id: string;
  status: RevisionStatus;
  addressCode: string;
  published: boolean;
}

export interface PendingReport {
  id: string;
  addressCode: string;
  message: string | null;
  reporter: { id: string; firstName: string | null; lastName: string | null };
  ownerInactiveOver90Days: boolean;
  createdAt: Date;
}

export interface ReportDecision {
  id: string;
  status: ReportStatus;
  addressCode: string;
  addressDeactivated: boolean;
}

export interface PendingContribution {
  id: string;
  addressCode: string;
  message: string;
  author: { id: string; firstName: string | null; lastName: string | null };
  createdAt: Date;
}

export interface ContributionDecision {
  id: string;
  status: ContributionStatus;
  addressCode: string;
}

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localisations: LocalisationsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** File 1 : révisions en attente (créations + modifications). */
  async listPendingRevisions(): Promise<PendingRevision[]> {
    const revisions = await this.prisma.addressRevision.findMany({
      where: { status: RevisionStatus.EN_ATTENTE_VALIDATION },
      orderBy: { createdAt: 'asc' },
      include: {
        address: {
          select: {
            code: true,
            publishedRevisionId: true,
            user: {
              select: { id: true, firstName: true, lastName: true, phone: true },
            },
            localisation: { select: { quartier: { select: { name: true } } } },
          },
        },
      },
    });

    return revisions.map((r) => ({
      id: r.id,
      addressCode: r.address.code,
      category: r.category,
      steps: (r.steps as string[]) ?? [],
      assembledText: r.assembledText,
      photoUrl: r.photoUrl,
      gps: { lat: r.gpsLat, lng: r.gpsLng },
      // La précision de capture n'est pas stockée ; on expose la tolérance de
      // rattachement (15 m) comme borne indicative pour le modérateur.
      gpsAccuracyMeters: 15,
      quartierName: r.address.localisation?.quartier.name ?? '',
      ownerPhoneMasked: maskPhone(r.address.user.phone),
      createdAt: r.createdAt,
      owner: {
        id: r.address.user.id,
        firstName: r.address.user.firstName,
        lastName: r.address.user.lastName,
      },
      isFirstPublication: r.address.publishedRevisionId == null,
    }));
  }

  /**
   * Approbation : la révision devient PUBLIEE, le pointeur bascule, l'ancienne
   * publiée passe ARCHIVEE — atomique. Première publication = bascule sur la révision n°1.
   */
  async approveRevision(
    revisionId: string,
    moderatorId: string,
  ): Promise<RevisionDecision> {
    const revision = await this.loadPendingRevision(revisionId);
    const previousPublishedId = revision.address.publishedRevisionId;

    await this.prisma.$transaction(async (tx) => {
      await tx.addressRevision.update({
        where: { id: revision.id },
        data: {
          status: RevisionStatus.PUBLIEE,
          reviewedById: moderatorId,
          reviewedAt: new Date(),
        },
      });
      await tx.address.update({
        where: { id: revision.addressId },
        data: { publishedRevisionId: revision.id },
      });
      if (previousPublishedId) {
        await tx.addressRevision.update({
          where: { id: previousPublishedId },
          data: { status: RevisionStatus.ARCHIVEE },
        });
      }
    });

    await this.notifications.notifyOwner(revision.address.userId, {
      type: NotificationType.ADDRESS_VALIDATED,
      message: `Votre adresse ${revision.address.code} a été validée et est maintenant publique.`,
      addressId: revision.addressId,
      url: `/dashboard/address/${revision.address.code}`,
    });
    return {
      id: revision.id,
      status: RevisionStatus.PUBLIEE,
      addressCode: revision.address.code,
      published: true,
    };
  }

  /** Rejet : la révision devient REJETEE (motif obligatoire). Le pointeur ne bouge pas. */
  async rejectRevision(
    revisionId: string,
    moderatorId: string,
    reason: string,
  ): Promise<RevisionDecision> {
    const revision = await this.loadPendingRevision(revisionId);

    await this.prisma.addressRevision.update({
      where: { id: revision.id },
      data: {
        status: RevisionStatus.REJETEE,
        reviewedById: moderatorId,
        rejectionReason: reason,
        reviewedAt: new Date(),
      },
    });

    await this.notifications.notifyOwner(revision.address.userId, {
      type: NotificationType.ADDRESS_REJECTED,
      message: `Votre adresse ${revision.address.code} a été rejetée. Motif : ${reason}`,
      addressId: revision.addressId,
      url: `/dashboard/address/${revision.address.code}/edit`,
    });
    return {
      id: revision.id,
      status: RevisionStatus.REJETEE,
      addressCode: revision.address.code,
      published: revision.address.publishedRevisionId != null,
    };
  }

  // ─── File 2 : signalements ──────────────────────────────────────────────────

  /** File 2 : signalements en attente, avec présomption d'inactivité du propriétaire. */
  async listPendingReports(): Promise<PendingReport[]> {
    const reports = await this.prisma.report.findMany({
      where: { status: ReportStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        address: {
          select: { code: true, user: { select: { lastSessionAt: true } } },
        },
      },
    });

    const cutoff = new Date(Date.now() - INACTIVE_OWNER_DAYS * 86400_000);
    return reports.map((r) => ({
      id: r.id,
      addressCode: r.address.code,
      message: r.message,
      reporter: r.user,
      ownerInactiveOver90Days:
        r.address.user.lastSessionAt != null &&
        r.address.user.lastSessionAt < cutoff,
      createdAt: r.createdAt,
    }));
  }

  /** Marque un signalement comme résolu (sans action sur l'adresse). */
  async resolveReport(
    reportId: string,
    moderatorId: string,
  ): Promise<ReportDecision> {
    const report = await this.loadPendingReport(reportId);
    await this.prisma.report.update({
      where: { id: report.id },
      data: {
        status: ReportStatus.RESOLVED,
        reviewedById: moderatorId,
        reviewedAt: new Date(),
      },
    });
    return {
      id: report.id,
      status: ReportStatus.RESOLVED,
      addressCode: report.address.code,
      addressDeactivated: false,
    };
  }

  /**
   * Désactive l'adresse signalée : lifecycle DESACTIVEE, révision en attente →
   * OBSOLETE (sortie de file, sans rejet/motif), signalement → ACTIONED — atomique.
   * Puis nettoyage de la localisation si elle devient vide.
   */
  async deactivateFromReport(
    reportId: string,
    moderatorId: string,
    reason?: string,
  ): Promise<ReportDecision> {
    const report = await this.loadPendingReport(reportId);
    if (report.address.lifecycle === 'DESACTIVEE') {
      throw new ConflictException({
        code: 'ADDRESS_ALREADY_DEACTIVATED',
        message: 'Cette adresse est déjà désactivée.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id: report.addressId },
        data: {
          lifecycle: 'DESACTIVEE',
          deactivatedAt: new Date(),
          deactivatedById: moderatorId,
          deactivationReason: reason ?? null,
        },
      });
      await tx.addressRevision.updateMany({
        where: {
          addressId: report.addressId,
          status: RevisionStatus.EN_ATTENTE_VALIDATION,
        },
        data: { status: RevisionStatus.OBSOLETE },
      });
      await tx.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.ACTIONED,
          reviewedById: moderatorId,
          reviewedAt: new Date(),
        },
      });
    });

    if (report.address.localisationId) {
      await this.localisations.cleanupIfEmpty(report.address.localisationId);
    }

    await this.notifications.notifyOwner(report.address.userId, {
      type: NotificationType.ADDRESS_DEACTIVATED,
      message: reason
        ? `Votre adresse ${report.address.code} a été désactivée par la modération. Motif : ${reason}`
        : `Votre adresse ${report.address.code} a été désactivée par la modération.`,
      addressId: report.addressId,
      url: `/dashboard/address/${report.address.code}`,
    });
    return {
      id: report.id,
      status: ReportStatus.ACTIONED,
      addressCode: report.address.code,
      addressDeactivated: true,
    };
  }

  // ─── File 3 : contributions terrain ─────────────────────────────────────────

  /** File 3 : contributions terrain en attente. */
  async listPendingContributions(): Promise<PendingContribution[]> {
    const contributions = await this.prisma.contribution.findMany({
      where: { status: ContributionStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        address: { select: { code: true } },
      },
    });
    return contributions.map((c) => ({
      id: c.id,
      addressCode: c.address.code,
      message: c.message,
      author: c.user,
      createdAt: c.createdAt,
    }));
  }

  /** Approuve une contribution → info terrain publique (jamais injectée dans les steps). */
  async approveContribution(
    contributionId: string,
    moderatorId: string,
  ): Promise<ContributionDecision> {
    return this.decideContribution(
      contributionId,
      moderatorId,
      ContributionStatus.APPROVED,
    );
  }

  /** Rejette une contribution (aucune action sur l'adresse). */
  async rejectContribution(
    contributionId: string,
    moderatorId: string,
  ): Promise<ContributionDecision> {
    return this.decideContribution(
      contributionId,
      moderatorId,
      ContributionStatus.REJECTED,
    );
  }

  private async decideContribution(
    contributionId: string,
    moderatorId: string,
    status: ContributionStatus,
  ): Promise<ContributionDecision> {
    const contribution = await this.prisma.contribution.findUnique({
      where: { id: contributionId },
      include: { address: { select: { code: true } } },
    });
    if (!contribution) {
      throw new NotFoundException({
        code: 'CONTRIBUTION_NOT_FOUND',
        message: 'Contribution introuvable.',
      });
    }
    if (contribution.status !== ContributionStatus.PENDING) {
      throw new ConflictException({
        code: 'CONTRIBUTION_NOT_PENDING',
        message: 'Cette contribution a déjà été traitée.',
      });
    }
    await this.prisma.contribution.update({
      where: { id: contribution.id },
      data: { status, reviewedById: moderatorId, reviewedAt: new Date() },
    });
    return {
      id: contribution.id,
      status,
      addressCode: contribution.address.code,
    };
  }

  private async loadPendingReport(reportId: string) {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      include: {
        address: {
          select: {
            code: true,
            lifecycle: true,
            localisationId: true,
            userId: true,
          },
        },
      },
    });
    if (!report) {
      throw new NotFoundException({
        code: 'REPORT_NOT_FOUND',
        message: 'Signalement introuvable.',
      });
    }
    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException({
        code: 'REPORT_NOT_PENDING',
        message: 'Ce signalement a déjà été traité.',
      });
    }
    return report;
  }

  private async loadPendingRevision(revisionId: string) {
    const revision = await this.prisma.addressRevision.findUnique({
      where: { id: revisionId },
      include: {
        address: {
          select: { code: true, publishedRevisionId: true, userId: true },
        },
      },
    });
    if (!revision) {
      throw new NotFoundException({
        code: 'REVISION_NOT_FOUND',
        message: 'Révision introuvable.',
      });
    }
    if (revision.status !== RevisionStatus.EN_ATTENTE_VALIDATION) {
      throw new ConflictException({
        code: 'REVISION_NOT_PENDING',
        message: 'Cette révision a déjà été traitée.',
      });
    }
    return revision;
  }
}
