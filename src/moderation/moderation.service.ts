import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ContributionStatus,
  ReportStatus,
  RevisionStatus,
} from '@prisma/client';
import { LocalisationsService } from '../localisations/localisations.service';
import { PrismaService } from '../prisma/prisma.service';

/** Au-delà de cette inactivité du propriétaire, un signalement est présenté avec présomption de validité. */
const INACTIVE_OWNER_DAYS = 90;

export interface PendingRevision {
  id: string;
  addressCode: string;
  category: string;
  assembledText: string;
  photoUrl: string;
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
            user: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    return revisions.map((r) => ({
      id: r.id,
      addressCode: r.address.code,
      category: r.category,
      assembledText: r.assembledText,
      photoUrl: r.photoUrl,
      createdAt: r.createdAt,
      owner: r.address.user,
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

    // TODO(notifications): notifier l'auteur (ADDRESS_VALIDATED) — module à venir.
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

    // TODO(notifications): notifier l'auteur (ADDRESS_REJECTED + motif) — module à venir.
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

    // TODO(notifications): notifier le propriétaire (ADDRESS_DEACTIVATED + motif).
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
          select: { code: true, lifecycle: true, localisationId: true },
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
        address: { select: { code: true, publishedRevisionId: true } },
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
