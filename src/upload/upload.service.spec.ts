import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { UploadService } from './upload.service';

/** Reproduit l'algorithme Cloudinary : sha1(params triés "k=v" joints par "&" + secret). */
function expectedSignature(
  params: Record<string, string | number>,
  secret: string,
): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1')
    .update(toSign + secret)
    .digest('hex');
}

function buildService(env: Record<string, string>): UploadService {
  const config = {
    get: <T>(key: string, def: T): T => (env[key] as unknown as T) ?? def,
  } as unknown as ConfigService;
  return new UploadService(config);
}

describe('UploadService', () => {
  const env = {
    CLOUDINARY_CLOUD_NAME: 'demo-cloud',
    CLOUDINARY_API_KEY: '123456789',
    CLOUDINARY_API_SECRET: 'top-secret',
  };

  it('renvoie une charge utile complète et publique (jamais le secret)', () => {
    const res = buildService(env).signature();
    expect(res).toMatchObject({
      apiKey: '123456789',
      cloudName: 'demo-cloud',
      folder: 'adressebj/portals',
      transformation: 'q_auto,f_auto',
    });
    expect(typeof res.timestamp).toBe('number');
    expect(JSON.stringify(res)).not.toContain('top-secret');
  });

  it('signe exactement { folder, transformation, timestamp } avec le secret', () => {
    const res = buildService(env).signature();
    const expected = expectedSignature(
      {
        folder: 'adressebj/portals',
        transformation: 'q_auto,f_auto',
        timestamp: res.timestamp,
      },
      'top-secret',
    );
    expect(res.signature).toBe(expected);
  });

  it('503 UPLOAD_NOT_CONFIGURED si un identifiant manque', () => {
    const service = buildService({ ...env, CLOUDINARY_API_SECRET: '' });
    expect(() => service.signature()).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'UPLOAD_NOT_CONFIGURED' }),
      }),
    );
  });
});
