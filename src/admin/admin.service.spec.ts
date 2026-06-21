import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { ModeratorAction } from './dto/update-moderator.dto';

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    address: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

const moderator = {
  id: 'm1',
  email: 'mod@x.bj',
  firstName: null,
  lastName: null,
  role: Role.MODERATEUR,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  suspendedReason: null,
};

const habitant = {
  id: 'h1',
  email: 'h@x.bj',
  role: Role.HABITANT,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  suspendedReason: null,
};

describe('AdminService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: AdminService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new AdminService(prisma as never);
  });

  describe('createModerator', () => {
    it('crée un MODERATEUR avec mot de passe hashé, sans exposer le hash', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }: any) => ({
        ...moderator,
        ...data,
      }));

      const res = await service.createModerator({
        email: 'mod@x.bj',
        password: 'motdepasse123',
      });

      expect(res).not.toHaveProperty('password');
      expect(res.role).toBe(Role.MODERATEUR);
      const data = prisma.user.create.mock.calls[0][0].data;
      expect(data.password).not.toBe('motdepasse123'); // hashé
      expect(data.role).toBe(Role.MODERATEUR);
    });

    it('refuse un email déjà pris par un compte vivant (409)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...moderator });
      await expect(
        service.createModerator({
          email: 'mod@x.bj',
          password: 'motdepasse123',
        }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('updateModerator', () => {
    it('désactive (status DEACTIVATED)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...moderator });
      prisma.user.update.mockImplementation(async ({ data }: any) => ({
        ...moderator,
        ...data,
      }));
      const res = await service.updateModerator('m1', {
        action: ModeratorAction.DEACTIVATE,
      });
      expect(res.status).toBe(UserStatus.DEACTIVATED);
    });

    it('réinitialise le mot de passe (hash posé)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...moderator });
      prisma.user.update.mockResolvedValue({ ...moderator });
      await service.updateModerator('m1', {
        action: ModeratorAction.RESET,
        password: 'nouveaupass1',
      });
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.password).toBeDefined();
      expect(data.password).not.toBe('nouveaupass1');
    });

    it('reset sans mot de passe → 400 PASSWORD_REQUIRED', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...moderator });
      await expect(
        service.updateModerator('m1', { action: ModeratorAction.RESET }),
      ).rejects.toThrow(BadRequestException);
    });

    it('cible non-modérateur → 404 MODERATOR_NOT_FOUND', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...habitant });
      await expect(
        service.updateModerator('h1', { action: ModeratorAction.DEACTIVATE }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('suspendUser / unsuspendUser', () => {
    it('suspend un habitant avec motif', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...habitant });
      prisma.user.update.mockImplementation(async ({ data }: any) => ({
        ...habitant,
        ...data,
      }));
      const res = await service.suspendUser('h1', 'abus');
      expect(res.status).toBe(UserStatus.SUSPENDED);
      expect(res.suspendedReason).toBe('abus');
    });

    it('lève la suspension (status ACTIVE, motif effacé)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...habitant,
        status: UserStatus.SUSPENDED,
        suspendedReason: 'abus',
      });
      prisma.user.update.mockImplementation(async ({ data }: any) => ({
        ...habitant,
        ...data,
      }));
      const res = await service.unsuspendUser('h1');
      expect(res.status).toBe(UserStatus.ACTIVE);
      expect(res.suspendedReason).toBeNull();
    });

    it('cible non-habitant → 404 USER_NOT_FOUND', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...moderator });
      await expect(service.suspendUser('m1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listAddresses', () => {
    it('applique filtres + pagination et mappe les lignes', async () => {
      prisma.address.count.mockResolvedValue(1);
      prisma.address.findMany.mockResolvedValue([
        {
          code: 'AKP-7X3K',
          lifecycle: 'ACTIVE',
          publishedRevisionId: 'rev-1',
          publishedRevision: { category: 'COMMERCE' },
          localisation: { quartier: { name: 'Akpakpa', prefix: 'AKP' } },
          userId: 'u1',
          user: { id: 'u1', deletedAt: null },
          createdAt: new Date('2026-06-01'),
        },
      ]);

      const res = await service.listAddresses({
        code: 'akp',
        lifecycle: 'ACTIVE',
        page: 2,
        limit: 10,
      });

      expect(res).toMatchObject({ total: 1, page: 2, limit: 10 });
      expect(res.items[0]).toMatchObject({
        code: 'AKP-7X3K',
        category: 'COMMERCE',
        published: true,
        quartier: { prefix: 'AKP' },
        ownerId: 'u1',
        ownerDeleted: false,
      });
      const args = prisma.address.findMany.mock.calls[0][0];
      expect(args.where.code).toEqual({ startsWith: 'AKP' });
      expect(args.skip).toBe(10); // (page2-1)*limit10
      expect(args.take).toBe(10);
    });
  });
});
