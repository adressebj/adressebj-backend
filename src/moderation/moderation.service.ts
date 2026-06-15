import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RevisionStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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

@Injectable()
export class ModerationService {
  constructor(private readonly prisma: PrismaService) {}

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
