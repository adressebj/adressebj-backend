import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role, User, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePhoneDto } from './dto/change-phone.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RequestOtpDto } from './dto/request-otp.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SmsService } from './sms/sms.service';
import { JwtPayload } from './types/jwt-payload';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const BCRYPT_ROUNDS = 10;

export interface PublicUser {
  id: string;
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: Role;
}

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface AccountDeletionResult {
  deleted: true;
  anonymizedAt: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
  ) {}

  /** Génère et envoie un OTP de vérification de numéro (inscription habitant). */
  async requestOtp(dto: RequestOtpDto): Promise<{ sent: true }> {
    const existing = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'Ce numéro est déjà associé à un compte.',
      });
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.otpCode.create({
      data: {
        phone: dto.phone,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    await this.sms.sendOtp(dto.phone, code);
    return { sent: true };
  }

  /** Inscription habitant : vérifie l'OTP, crée le compte, renvoie un JWT. */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        phone: dto.phone,
        code: dto.code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Code OTP invalide ou expiré.',
      });
    }

    const [phoneTaken, emailTaken] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone: dto.phone } }),
      this.prisma.user.findUnique({ where: { email: dto.email } }),
    ]);
    if (phoneTaken && !phoneTaken.deletedAt) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'Ce numéro est déjà associé à un compte.',
      });
    }
    if (emailTaken && !emailTaken.deletedAt) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Cet email est déjà associé à un compte.',
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone: dto.phone,
          email: dto.email,
          password: passwordHash,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          role: Role.HABITANT,
          status: UserStatus.ACTIVE,
          lastSessionAt: new Date(),
        },
      });
      await tx.otpCode.update({ where: { id: otp.id }, data: { used: true } });
      return created;
    });

    return this.buildAuthResult(user);
  }

  /** Connexion : habitant via phone, modérateur/admin via email. */
  async login(dto: LoginDto): Promise<AuthResult> {
    if ((dto.phone && dto.email) || (!dto.phone && !dto.email)) {
      throw new BadRequestException({
        code: 'INVALID_LOGIN_IDENTIFIER',
        message:
          'Fournir soit un numéro (habitant), soit un email (modérateur/admin).',
      });
    }

    const user = dto.phone
      ? await this.prisma.user.findUnique({ where: { phone: dto.phone } })
      : await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user || user.deletedAt || !user.password) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants incorrects.',
      });
    }

    const passwordOk = await bcrypt.compare(dto.password, user.password);
    if (!passwordOk) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Identifiants incorrects.',
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'ACCOUNT_NOT_ACTIVE',
        message:
          user.status === UserStatus.SUSPENDED
            ? 'Compte suspendu.'
            : 'Compte désactivé.',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastSessionAt: new Date() },
    });
    return this.buildAuthResult(updated);
  }

  /** Modification du profil habitant (nom, prénom, email). Email unique parmi les comptes vivants. */
  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<PublicUser> {
    if (dto.email !== undefined) {
      const taken = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (taken && taken.id !== userId && !taken.deletedAt) {
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Cet email est déjà associé à un compte.',
        });
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.email !== undefined) data.email = dto.email;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toPublicUser(updated);
  }

  /**
   * Changement de numéro : exige un OTP valide sur le nouveau numéro (vérifié via
   * `POST /auth/request-otp` au préalable). Le mot de passe n'est pas modifié.
   */
  async changePhone(userId: string, dto: ChangePhoneDto): Promise<PublicUser> {
    const otp = await this.prisma.otpCode.findFirst({
      where: {
        phone: dto.phone,
        code: dto.code,
        used: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Code OTP invalide ou expiré.',
      });
    }

    const taken = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });
    if (taken && taken.id !== userId && !taken.deletedAt) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_REGISTERED',
        message: 'Ce numéro est déjà associé à un compte.',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: userId },
        data: { phone: dto.phone },
      });
      await tx.otpCode.update({ where: { id: otp.id }, data: { used: true } });
      return u;
    });
    return this.toPublicUser(updated);
  }

  /**
   * Suppression de compte = anonymisation immédiate en pierre tombale (procédure #E).
   * UNE transaction : désactive les adresses, obsolète les révisions en attente, purge
   * les localisations devenues vides, scrub le User (PII → null, deletedAt = now), et
   * supprime les données perso (push, OTP, notifications). Évaluations/signalements/
   * contributions conservés (intégrité référentielle via la tombstone). Jamais de hard-delete.
   */
  async deleteAccount(
    userId: string,
    phone: string,
  ): Promise<AccountDeletionResult> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({
        code: 'INVALID_TOKEN',
        message: 'Session invalide.',
      });
    }
    if (!user.phone || user.phone !== phone) {
      throw new BadRequestException({
        code: 'PHONE_MISMATCH',
        message: 'Le numéro fourni ne correspond pas au compte.',
      });
    }

    const anonymizedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const addresses = await tx.address.findMany({
        where: { userId },
        select: { localisationId: true },
      });
      const localisationIds = new Set<string>();
      for (const a of addresses) {
        if (a.localisationId) localisationIds.add(a.localisationId);
      }

      await tx.address.updateMany({
        where: { userId, lifecycle: { not: 'DESACTIVEE' } },
        data: {
          lifecycle: 'DESACTIVEE',
          deactivatedAt: anonymizedAt,
          deactivatedById: userId,
        },
      });
      await tx.addressRevision.updateMany({
        where: { address: { userId }, status: 'EN_ATTENTE_VALIDATION' },
        data: { status: 'OBSOLETE' },
      });

      // Purge des localisations dont l'habitant retirait la dernière adresse vivante.
      for (const locId of localisationIds) {
        const remaining = await tx.address.count({
          where: { localisationId: locId, lifecycle: { not: 'DESACTIVEE' } },
        });
        if (remaining === 0) {
          await tx.localisation.delete({ where: { id: locId } });
        }
      }

      // Scrub : pierre tombale anonymisée (le cuid résiduel n'est pas une donnée perso).
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: null,
          email: null,
          password: null,
          firstName: null,
          lastName: null,
          deletedAt: anonymizedAt,
        },
      });

      // Données personnelles : purge intégrale.
      await tx.otpCode.deleteMany({ where: { phone } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
    });

    return { deleted: true, anonymizedAt: anonymizedAt.toISOString() };
  }

  private buildAuthResult(user: User): AuthResult {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    return {
      token: this.jwt.sign(payload),
      user: this.toPublicUser(user),
    };
  }

  private toPublicUser(user: User): PublicUser {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    };
  }
}
