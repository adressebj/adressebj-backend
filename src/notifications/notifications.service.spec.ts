import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import webpush from 'web-push';
import { NotificationsService } from './notifications.service';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

const mockedWebpush = webpush as jest.Mocked<typeof webpush>;

function buildPrismaMock() {
  return {
    pushSubscription: {
      upsert: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    notification: { create: jest.fn(), findMany: jest.fn() },
  };
}

function buildConfig(env: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string, def: T): T => (env[key] as unknown as T) ?? def,
  } as unknown as ConfigService;
}

const VAPID_ENV = {
  VAPID_PUBLIC_KEY: 'pub-key',
  VAPID_PRIVATE_KEY: 'priv-key',
  VAPID_SUBJECT: 'mailto:contact@adressebj.bj',
};

describe('NotificationsService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = buildPrismaMock();
  });

  function build(
    env: Record<string, string> = VAPID_ENV,
  ): NotificationsService {
    return new NotificationsService(prisma as never, buildConfig(env));
  }

  describe('configuration', () => {
    it('configure VAPID quand les clés sont présentes', () => {
      build();
      expect(mockedWebpush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:contact@adressebj.bj',
        'pub-key',
        'priv-key',
      );
    });

    it('ne configure pas VAPID si une clé manque', () => {
      build({ ...VAPID_ENV, VAPID_PRIVATE_KEY: '' });
      expect(mockedWebpush.setVapidDetails).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('upsert l’abonnement par endpoint, ré-attaché au compte courant', async () => {
      prisma.pushSubscription.upsert.mockResolvedValue({});
      const res = await build().subscribe('user-1', {
        endpoint: 'https://push/abc',
        keys: { p256dh: 'p', auth: 'a' },
      });
      expect(res).toEqual({ subscribed: true });
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith({
        where: { endpoint: 'https://push/abc' },
        create: {
          userId: 'user-1',
          endpoint: 'https://push/abc',
          p256dh: 'p',
          auth: 'a',
        },
        update: { userId: 'user-1', p256dh: 'p', auth: 'a' },
      });
    });
  });

  describe('unsubscribe', () => {
    it('supprime l’abonnement du compte courant', async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
      const res = await build().unsubscribe('user-1', 'https://push/abc');
      expect(res).toEqual({ unsubscribed: true });
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', endpoint: 'https://push/abc' },
      });
    });

    it('idempotent : unsubscribed=false si aucun abonnement', async () => {
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
      const res = await build().unsubscribe('user-1', 'https://push/x');
      expect(res).toEqual({ unsubscribed: false });
    });
  });

  describe('list', () => {
    it('renvoie l’historique avec le code adresse aplati', async () => {
      prisma.notification.findMany.mockResolvedValue([
        {
          id: 'n-1',
          type: NotificationType.ADDRESS_VALIDATED,
          message: 'Validée',
          readAt: null,
          createdAt: new Date('2026-06-17'),
          address: { code: 'AKP-1234' },
        },
        {
          id: 'n-2',
          type: NotificationType.RELIABILITY_WARNING,
          message: 'Dégradée',
          readAt: null,
          createdAt: new Date('2026-06-16'),
          address: null,
        },
      ]);
      const res = await build().list('user-1');
      expect(res[0]).toMatchObject({ id: 'n-1', addressCode: 'AKP-1234' });
      expect(res[1]).toMatchObject({ id: 'n-2', addressCode: null });
    });
  });

  describe('notifyOwner', () => {
    const payload = {
      type: NotificationType.ADDRESS_VALIDATED,
      message: 'Votre adresse AKP-1234 a été validée.',
      addressId: 'addr-1',
      url: '/dashboard/address/AKP-1234',
    };

    it('persiste toujours la notification', async () => {
      prisma.notification.create.mockResolvedValue({});
      prisma.pushSubscription.findMany.mockResolvedValue([]);
      await build().notifyOwner('user-1', payload);
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.ADDRESS_VALIDATED,
          message: payload.message,
          addressId: 'addr-1',
        },
      });
    });

    it('persiste sans pousser quand VAPID non configuré', async () => {
      prisma.notification.create.mockResolvedValue({});
      await build({}).notifyOwner('user-1', payload);
      expect(prisma.notification.create).toHaveBeenCalled();
      expect(prisma.pushSubscription.findMany).not.toHaveBeenCalled();
      expect(mockedWebpush.sendNotification).not.toHaveBeenCalled();
    });

    it('pousse vers chaque abonnement actif', async () => {
      prisma.notification.create.mockResolvedValue({});
      prisma.pushSubscription.findMany.mockResolvedValue([
        { endpoint: 'https://push/1', p256dh: 'p1', auth: 'a1' },
        { endpoint: 'https://push/2', p256dh: 'p2', auth: 'a2' },
      ]);
      mockedWebpush.sendNotification.mockResolvedValue({} as never);

      await build().notifyOwner('user-1', payload);

      expect(mockedWebpush.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('purge les endpoints morts (410) et conserve les autres échecs', async () => {
      prisma.notification.create.mockResolvedValue({});
      prisma.pushSubscription.findMany.mockResolvedValue([
        { endpoint: 'https://push/dead', p256dh: 'p1', auth: 'a1' },
        { endpoint: 'https://push/flaky', p256dh: 'p2', auth: 'a2' },
      ]);
      prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
      mockedWebpush.sendNotification
        .mockRejectedValueOnce({ statusCode: 410 })
        .mockRejectedValueOnce({ statusCode: 500 });

      await build().notifyOwner('user-1', payload);

      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: { in: ['https://push/dead'] } },
      });
    });

    it('un échec push ne fait jamais échouer l’opération', async () => {
      prisma.notification.create.mockResolvedValue({});
      prisma.pushSubscription.findMany.mockResolvedValue([
        { endpoint: 'https://push/1', p256dh: 'p1', auth: 'a1' },
      ]);
      mockedWebpush.sendNotification.mockRejectedValue({ statusCode: 500 });

      await expect(
        build().notifyOwner('user-1', payload),
      ).resolves.toBeUndefined();
    });
  });
});
