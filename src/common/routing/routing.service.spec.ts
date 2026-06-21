import { ConfigService } from '@nestjs/config';
import { RoutingService } from './routing.service';

describe('RoutingService', () => {
  const from = { lat: 6.36, lng: 2.41 };
  const to = { lat: 6.3676, lng: 2.4252 };

  function build(overrides: Record<string, string> = {}): RoutingService {
    const config = {
      get: (key: string) => overrides[key],
    } as unknown as ConfigService;
    return new RoutingService(config);
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('utilise OSRM quand la réponse est exploitable (durée → minutes, distance arrondie)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          code: 'Ok',
          routes: [{ duration: 665, distance: 4249.6 }],
        }),
    } as Response);

    const res = await build().getEta(from, to);

    expect(res).toEqual({
      etaMinutes: 11,
      distanceMeters: 4250,
      source: 'OSRM',
    });
  });

  it('repli ESTIMATE si OSRM répond une erreur HTTP', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    const res = await build().getEta(from, to);

    expect(res.source).toBe('ESTIMATE');
    expect(res.distanceMeters).toBeGreaterThan(0);
    expect(res.etaMinutes).toBeGreaterThanOrEqual(0);
  });

  it('repli ESTIMATE si OSRM renvoie un code non « Ok »', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ code: 'NoRoute', routes: [] }),
    } as Response);

    const res = await build().getEta(from, to);

    expect(res.source).toBe('ESTIMATE');
  });

  it('repli ESTIMATE si fetch lève (réseau/timeout)', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const res = await build().getEta(from, to);

    expect(res.source).toBe('ESTIMATE');
  });

  it("l'estimation locale respecte la vitesse moyenne configurée", async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));

    // Vitesse très basse → ETA strictement positive sur une distance non nulle.
    const slow = await build({ ROUTING_FALLBACK_SPEED_KMH: '1' }).getEta(
      from,
      to,
    );
    const fast = await build({ ROUTING_FALLBACK_SPEED_KMH: '60' }).getEta(
      from,
      to,
    );

    expect(slow.etaMinutes).toBeGreaterThan(fast.etaMinutes);
  });
});
