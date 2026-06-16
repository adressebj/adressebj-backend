import { ApiEndpoint } from '@prisma/client';
import { ApiKeysService } from './api-keys.service';

function buildPrismaMock() {
  return {
    apiRequestLog: { count: jest.fn(), create: jest.fn() },
    apiKey: { findUnique: jest.fn() },
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
