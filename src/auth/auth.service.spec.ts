import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { SmsService } from './sms/sms.service';

type AnyFn = jest.Mock;

function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn() as AnyFn,
      create: jest.fn() as AnyFn,
      update: jest.fn() as AnyFn,
    },
    otpCode: {
      create: jest.fn() as AnyFn,
      findFirst: jest.fn() as AnyFn,
      update: jest.fn() as AnyFn,
      deleteMany: jest.fn() as AnyFn,
    },
    address: {
      findMany: jest.fn() as AnyFn,
      updateMany: jest.fn() as AnyFn,
      count: jest.fn() as AnyFn,
    },
    addressRevision: { updateMany: jest.fn() as AnyFn },
    localisation: { delete: jest.fn() as AnyFn },
    pushSubscription: { deleteMany: jest.fn() as AnyFn },
    notification: { deleteMany: jest.fn() as AnyFn },
    $transaction: jest.fn() as AnyFn,
  };
}

const baseUser = {
  id: 'u1',
  phone: '+22997000000',
  email: 'h@example.com',
  password: '', // rempli dans beforeAll
  firstName: null,
  lastName: null,
  role: Role.HABITANT,
  status: UserStatus.ACTIVE,
  deletedAt: null,
  lastSessionAt: null,
};

describe('AuthService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let jwt: { sign: AnyFn };
  let sms: { sendOtp: AnyFn };
  let service: AuthService;
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('motdepasse123', 4);
  });

  beforeEach(() => {
    prisma = buildPrismaMock();
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    sms = { sendOtp: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as never,
      jwt as unknown as JwtService,
      sms as unknown as SmsService,
    );
  });

  describe('requestOtp', () => {
    it('crée un OTP et déclenche le SMS', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.otpCode.create.mockResolvedValue({});

      const res = await service.requestOtp({ phone: '+22997000000' });

      expect(res).toEqual({ sent: true });
      expect(prisma.otpCode.create).toHaveBeenCalledTimes(1);
      const created = prisma.otpCode.create.mock.calls[0][0].data;
      expect(created.code).toMatch(/^\d{6}$/);
      expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(sms.sendOtp).toHaveBeenCalledWith('+22997000000', created.code);
    });

    it('refuse si le numéro est déjà associé à un compte vivant (409)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      await expect(
        service.requestOtp({ phone: '+22997000000' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.otpCode.create).not.toHaveBeenCalled();
    });

    it('autorise un numéro porté par une pierre tombale (deletedAt non null)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        deletedAt: new Date(),
      });
      prisma.otpCode.create.mockResolvedValue({});
      await expect(
        service.requestOtp({ phone: '+22997000000' }),
      ).resolves.toEqual({ sent: true });
    });
  });

  describe('register', () => {
    const dto = {
      phone: '+22997000000',
      code: '123456',
      email: 'h@example.com',
      password: 'motdepasse123',
    };

    it('inscrit un habitant et renvoie un JWT', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp1' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({
          user: { create: jest.fn().mockResolvedValue({ ...baseUser }) },
          otpCode: { update: jest.fn().mockResolvedValue({}) },
        }),
      );

      const res = await service.register(dto);

      expect(res.token).toBe('signed.jwt.token');
      expect(res.user).toMatchObject({ id: 'u1', role: Role.HABITANT });
      expect(res.user).not.toHaveProperty('password');
      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', role: Role.HABITANT });
    });

    it('rejette un OTP invalide ou expiré (401)', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(service.register(dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejette un email déjà utilisé (409)', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp1' });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // phone libre
        .mockResolvedValueOnce({ ...baseUser }); // email pris
      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('refuse phone ET email simultanés (400)', async () => {
      await expect(
        service.login({ phone: '+22997000000', email: 'a@b.c', password: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse aucun identifiant (400)', async () => {
      await expect(service.login({ password: 'x' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('connecte un habitant via phone et met à jour lastSessionAt', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        password: passwordHash,
      });
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        password: passwordHash,
      });

      const res = await service.login({
        phone: '+22997000000',
        password: 'motdepasse123',
      });

      expect(res.token).toBe('signed.jwt.token');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastSessionAt: expect.any(Date) },
      });
    });

    it('rejette un mauvais mot de passe (401)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        password: passwordHash,
      });
      await expect(
        service.login({ phone: '+22997000000', password: 'mauvais' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejette un compte suspendu (403)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        password: passwordHash,
        status: UserStatus.SUSPENDED,
      });
      await expect(
        service.login({ phone: '+22997000000', password: 'motdepasse123' }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateProfile', () => {
    it('met à jour les champs fournis et renvoie le profil public', async () => {
      prisma.user.update.mockResolvedValue({
        ...baseUser,
        firstName: 'Awa',
        email: 'new@example.com',
      });
      const res = await service.updateProfile('u1', {
        firstName: 'Awa',
        email: 'new@example.com',
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'new@example.com' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { firstName: 'Awa', email: 'new@example.com' },
      });
      expect(res).not.toHaveProperty('password');
      expect(res.firstName).toBe('Awa');
    });

    it("ne vérifie pas l'unicité si l'email n'est pas fourni", async () => {
      prisma.user.update.mockResolvedValue({ ...baseUser, lastName: 'Bello' });
      await service.updateProfile('u1', { lastName: 'Bello' });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { lastName: 'Bello' },
      });
    });

    it('rejette un email déjà pris par un autre compte vivant (409)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        id: 'autre',
      });
      await expect(
        service.updateProfile('u1', { email: 'taken@example.com' }),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('autorise son propre email (même id)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, id: 'u1' });
      prisma.user.update.mockResolvedValue({ ...baseUser });
      await expect(
        service.updateProfile('u1', { email: 'h@example.com' }),
      ).resolves.toBeDefined();
    });
  });

  describe('changePhone', () => {
    const dto = { phone: '+22997000001', code: '123456' };

    it('vérifie OTP, met à jour le numéro, marque OTP utilisé', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp1' });
      prisma.user.findUnique.mockResolvedValue(null); // nouveau numéro libre
      const updateUser = jest
        .fn()
        .mockResolvedValue({ ...baseUser, phone: dto.phone });
      const updateOtp = jest.fn().mockResolvedValue({});
      prisma.$transaction.mockImplementation(async (cb: any) =>
        cb({ user: { update: updateUser }, otpCode: { update: updateOtp } }),
      );

      const res = await service.changePhone('u1', dto);

      expect(res.phone).toBe(dto.phone);
      expect(updateUser).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { phone: dto.phone },
      });
      expect(updateOtp).toHaveBeenCalledWith({
        where: { id: 'otp1' },
        data: { used: true },
      });
    });

    it('rejette un OTP invalide (401)', async () => {
      prisma.otpCode.findFirst.mockResolvedValue(null);
      await expect(service.changePhone('u1', dto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejette un numéro déjà pris par un autre compte vivant (409)', async () => {
      prisma.otpCode.findFirst.mockResolvedValue({ id: 'otp1' });
      prisma.user.findUnique.mockResolvedValue({ ...baseUser, id: 'autre' });
      await expect(service.changePhone('u1', dto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('deleteAccount', () => {
    function mockTx() {
      const tx = {
        address: {
          findMany: jest.fn().mockResolvedValue([{ localisationId: 'loc1' }]),
          updateMany: jest.fn().mockResolvedValue({}),
          count: jest.fn().mockResolvedValue(0), // localisation devenue vide
        },
        addressRevision: { updateMany: jest.fn().mockResolvedValue({}) },
        localisation: { delete: jest.fn().mockResolvedValue({}) },
        user: { update: jest.fn().mockResolvedValue({}) },
        otpCode: { deleteMany: jest.fn().mockResolvedValue({}) },
        pushSubscription: { deleteMany: jest.fn().mockResolvedValue({}) },
        notification: { deleteMany: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation(async (cb: any) => cb(tx));
      return tx;
    }

    it('rejette si le téléphone ne correspond pas (400 PHONE_MISMATCH)', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      await expect(
        service.deleteAccount('u1', '+22900000000'),
      ).rejects.toMatchObject({ response: { code: 'PHONE_MISMATCH' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('anonymise : désactive adresses, obsolète révisions, purge loc/perso, scrub User', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      const tx = mockTx();

      const res = await service.deleteAccount('u1', '+22997000000');

      expect(res.deleted).toBe(true);
      expect(res.anonymizedAt).toEqual(expect.any(String));

      expect(tx.address.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', lifecycle: { not: 'DESACTIVEE' } },
        data: expect.objectContaining({
          lifecycle: 'DESACTIVEE',
          deactivatedById: 'u1',
        }),
      });
      expect(tx.addressRevision.updateMany).toHaveBeenCalledWith({
        where: { address: { userId: 'u1' }, status: 'EN_ATTENTE_VALIDATION' },
        data: { status: 'OBSOLETE' },
      });
      expect(tx.localisation.delete).toHaveBeenCalledWith({
        where: { id: 'loc1' },
      });
      expect(tx.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: expect.objectContaining({
          phone: null,
          email: null,
          password: null,
          firstName: null,
          lastName: null,
          deletedAt: expect.any(Date),
        }),
      });
      expect(tx.otpCode.deleteMany).toHaveBeenCalledWith({
        where: { phone: '+22997000000' },
      });
      expect(tx.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
      expect(tx.notification.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
      });
    });

    it('ne supprime pas une localisation encore occupée', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...baseUser });
      const tx = mockTx();
      tx.address.count.mockResolvedValue(2); // d'autres adresses vivantes restent

      await service.deleteAccount('u1', '+22997000000');

      expect(tx.localisation.delete).not.toHaveBeenCalled();
    });
  });
});
