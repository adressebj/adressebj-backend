import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('renvoie le statut ok avec un timestamp ISO', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });
});
