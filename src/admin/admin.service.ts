import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAddressesQueryDto } from './dto/admin-addresses-query.dto';
import { CreateModeratorDto } from './dto/create-moderator.dto';
import {
  ModeratorAction,
  UpdateModeratorDto,
} from './dto/update-moderator.dto';

const BCRYPT_ROUNDS = 10;

export interface StaffView {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: Role;
  status: UserStatus;
}

export interface SuspensionView {
  id: string;
  status: UserStatus;
  suspendedReason: string | null;
}

export interface AdminAddressRow {
  code: string;
  category: string | null;
  lifecycle: string;
  published: boolean;
  quartier: { name: string; prefix: string } | null;
  ownerId: string;
  ownerDeleted: boolean;
  createdAt: Date;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminStats {
  addresses: {
    total: number;
    active: number;
    deactivated: number;
    published: number;
  };
  quartiers: { total: number; active: number };
  moderation: {
    pendingRevisions: number;
    pendingReports: number;
    pendingContributions: number;
  };
  habitants: number;
  apiKeysActive: number;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crée un compte Modérateur (email unique parmi les comptes vivants). */
  async createModerator(dto: CreateModeratorDto): Promise<StaffView> {
    const taken = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (taken && !taken.deletedAt) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Cet email est déjà associé à un compte.',
      });
    }
    const password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        password,
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
        role: Role.MODERATEUR,
        status: UserStatus.ACTIVE,
      },
    });
    return this.toStaffView(created);
  }

  /** Désactive / réactive / réinitialise le mot de passe d'un Modérateur. */
  async updateModerator(
    id: string,
    dto: UpdateModeratorDto,
  ): Promise<StaffView> {
    const moderator = await this.loadModerator(id);

    const data: Prisma.UserUpdateInput = {};
    switch (dto.action) {
      case ModeratorAction.DEACTIVATE:
        data.status = UserStatus.DEACTIVATED;
        break;
      case ModeratorAction.REACTIVATE:
        data.status = UserStatus.ACTIVE;
        break;
      case ModeratorAction.RESET:
        if (!dto.password) {
          throw new BadRequestException({
            code: 'PASSWORD_REQUIRED',
            message:
              'Un nouveau mot de passe est requis pour la réinitialisation.',
          });
        }
        data.password = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
        break;
    }

    const updated = await this.prisma.user.update({
      where: { id: moderator.id },
      data,
    });
    return this.toStaffView(updated);
  }

  /** Suspend un compte Habitant (gèle ses actions authentifiées). */
  async suspendUser(id: string, reason?: string): Promise<SuspensionView> {
    const user = await this.loadHabitant(id);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.SUSPENDED,
        suspendedReason: reason ?? null,
      },
    });
    return this.toSuspensionView(updated);
  }

  /** Lève la suspension d'un compte Habitant. */
  async unsuspendUser(id: string): Promise<SuspensionView> {
    const user = await this.loadHabitant(id);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { status: UserStatus.ACTIVE, suspendedReason: null },
    });
    return this.toSuspensionView(updated);
  }

  /** Supervision du référentiel : recherche + filtres + pagination. */
  async listAddresses(
    query: AdminAddressesQueryDto,
  ): Promise<Paginated<AdminAddressRow>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Prisma.AddressWhereInput = {};
    if (query.code) {
      where.code = { startsWith: query.code.toUpperCase() };
    }
    if (query.lifecycle) where.lifecycle = query.lifecycle;
    if (query.quartierId) {
      where.localisation = { quartierId: query.quartierId };
    }
    if (query.category) {
      where.publishedRevision = { category: query.category };
    }

    const [total, rows] = await Promise.all([
      this.prisma.address.count({ where }),
      this.prisma.address.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          publishedRevision: { select: { category: true } },
          localisation: { include: { quartier: true } },
          user: { select: { id: true, deletedAt: true } },
        },
      }),
    ]);

    const items: AdminAddressRow[] = rows.map((a) => ({
      code: a.code,
      category: a.publishedRevision?.category ?? null,
      lifecycle: a.lifecycle,
      published: a.publishedRevisionId !== null,
      quartier: a.localisation
        ? {
            name: a.localisation.quartier.name,
            prefix: a.localisation.quartier.prefix,
          }
        : null,
      ownerId: a.userId,
      ownerDeleted: a.user.deletedAt !== null,
      createdAt: a.createdAt,
    }));

    return { items, total, page, limit };
  }

  /** Agrégats du tableau de bord administrateur. */
  async stats(): Promise<AdminStats> {
    const [
      total,
      active,
      deactivated,
      published,
      quartiersTotal,
      quartiersActive,
      pendingRevisions,
      pendingReports,
      pendingContributions,
      habitants,
      apiKeysActive,
    ] = await Promise.all([
      this.prisma.address.count(),
      this.prisma.address.count({ where: { lifecycle: 'ACTIVE' } }),
      this.prisma.address.count({ where: { lifecycle: 'DESACTIVEE' } }),
      this.prisma.address.count({ where: { publishedRevisionId: { not: null } } }),
      this.prisma.quartier.count(),
      this.prisma.quartier.count({ where: { isActive: true } }),
      this.prisma.addressRevision.count({
        where: { status: 'EN_ATTENTE_VALIDATION' },
      }),
      this.prisma.report.count({ where: { status: 'PENDING' } }),
      this.prisma.contribution.count({ where: { status: 'PENDING' } }),
      this.prisma.user.count({
        where: { role: Role.HABITANT, deletedAt: null },
      }),
      this.prisma.apiKey.count({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      addresses: { total, active, deactivated, published },
      quartiers: { total: quartiersTotal, active: quartiersActive },
      moderation: {
        pendingRevisions,
        pendingReports,
        pendingContributions,
      },
      habitants,
      apiKeysActive,
    };
  }

  private async loadModerator(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt || user.role !== Role.MODERATEUR) {
      throw new NotFoundException({
        code: 'MODERATOR_NOT_FOUND',
        message: 'Modérateur introuvable.',
      });
    }
    return user;
  }

  private async loadHabitant(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || user.deletedAt || user.role !== Role.HABITANT) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'Habitant introuvable.',
      });
    }
    return user;
  }

  private toStaffView(user: User): StaffView {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
    };
  }

  private toSuspensionView(user: User): SuspensionView {
    return {
      id: user.id,
      status: user.status,
      suspendedReason: user.suspendedReason,
    };
  }
}
