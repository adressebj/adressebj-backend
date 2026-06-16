import { NotFoundException } from '@nestjs/common';
import { ApiEndpoint } from '@prisma/client';
import { API_KEY_PREFIX, ApiKeysService } from './api-keys.service';

function buildPrismaMock() {
  return {
    apiRequestLog: { count: jest.fn(), create: jest.fn() },
    apiKey: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };
}

describe('ApiKeysService.reportingRatio', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ApiKeysService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ApiKeysService(prisma as never);
  });

  it('ratio = CONFIRM / RESOLVE sur 30 jours', async () => {
    // 1er count = CONFIRM, 2e count = RESOLVE (ordre du Promise.all).
    prisma.apiRequestLog.count
      .mockResolvedValueOnce(9) // confirms
      .mockResolvedValueOnce(10); // resolves

    const res = await service.reportingRatio('key-1');

    expect(res).toEqual({ confirms: 9, resolves: 10, ratio: 0.9 });
    const calls = prisma.apiRequestLog.count.mock.calls;
    expect(calls[0][0].where).toMatchObject({
      apiKeyId: 'key-1',
      endpoint: ApiEndpoint.CONFIRM,
    });
    expect(calls[1][0].where).toMatchObject({
      apiKeyId: 'key-1',
      endpoint: ApiEndpoint.RESOLVE,
    });
    expect(calls[0][0].where.createdAt.gte).toBeInstanceOf(Date);
  });

  it('ratio = 0 si aucune résolution (dénominateur nul)', async () => {
    prisma.apiRequestLog.count
      .mockResolvedValueOnce(3) // confirms
      .mockResolvedValueOnce(0); // resolves

    const res = await service.reportingRatio('key-1');

    expect(res).toEqual({ confirms: 3, resolves: 0, ratio: 0 });
  });
});

describe('ApiKeysService.createKey / revokeKey', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: ApiKeysService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    service = new ApiKeysService(prisma as never);
  });

  it('génère une clé préfixée bj_live_ + 16 caractères', async () => {
    prisma.apiKey.create.mockImplementation(async ({ data }: any) => ({
      id: 'k1',
      ...data,
    }));
    const res = await service.createKey('Yango', '2027-01-01T00:00:00Z');
    expect(res.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(res.key.length).toBe(API_KEY_PREFIX.length + 16);
    const data = prisma.apiKey.create.mock.calls[0][0].data;
    expect(data.label).toBe('Yango');
    expect(data.expiresAt).toBeInstanceOf(Date);
  });

  it('deux clés générées diffèrent', async () => {
    prisma.apiKey.create.mockImplementation(async ({ data }: any) => data);
    const a = await service.createKey('A');
    const b = await service.createKey('B');
    expect(a.key).not.toBe(b.key);
  });

  it('révoque une clé existante (status REVOKED + revokedAt)', async () => {
    prisma.apiKey.findUnique.mockResolvedValue({ id: 'k1', status: 'ACTIVE' });
    prisma.apiKey.update.mockImplementation(async ({ data }: any) => ({
      id: 'k1',
      ...data,
    }));
    const res = await service.revokeKey('k1');
    expect(res.status).toBe('REVOKED');
    const data = prisma.apiKey.update.mock.calls[0][0].data;
    expect(data.revokedAt).toBeInstanceOf(Date);
  });

  it('clé inconnue → 404 API_KEY_NOT_FOUND', async () => {
    prisma.apiKey.findUnique.mockResolvedValue(null);
    await expect(service.revokeKey('nope')).rejects.toThrow(NotFoundException);
  });
});
