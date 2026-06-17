import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

/** Dossier Cloudinary où atterrissent les photos d'adresses (portails). */
const UPLOAD_FOLDER = 'adressebj/portals';
/** Transformation appliquée à l'upload : ~500 Ko → ~80–120 Ko sans perte perceptible. */
const UPLOAD_TRANSFORMATION = 'q_auto,f_auto';

/** Charge utile remise au frontend pour un upload direct vers Cloudinary. */
export interface UploadSignature {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  folder: string;
  transformation: string;
}

/**
 * Génère une signature Cloudinary côté serveur : le frontend uploade les octets
 * directement vers Cloudinary, le backend ne manipule jamais de binaire (cf. CdC §10).
 */
@Injectable()
export class UploadService {
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: ConfigService) {
    this.cloudName = config.get<string>('CLOUDINARY_CLOUD_NAME', '');
    this.apiKey = config.get<string>('CLOUDINARY_API_KEY', '');
    this.apiSecret = config.get<string>('CLOUDINARY_API_SECRET', '');
  }

  /**
   * Signe `{ folder, transformation, timestamp }` avec le secret Cloudinary.
   * `apiKey`/`file` ne sont volontairement pas signés (cf. exigence Cloudinary).
   * Lève une 503 si les identifiants ne sont pas configurés — jamais de signature factice.
   */
  signature(): UploadSignature {
    if (!this.cloudName || !this.apiKey || !this.apiSecret) {
      throw new ServiceUnavailableException({
        code: 'UPLOAD_NOT_CONFIGURED',
        message: "Le service d'upload n'est pas configuré.",
      });
    }

    const timestamp = Math.round(Date.now() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      {
        folder: UPLOAD_FOLDER,
        transformation: UPLOAD_TRANSFORMATION,
        timestamp,
      },
      this.apiSecret,
    );

    return {
      signature,
      timestamp,
      apiKey: this.apiKey,
      cloudName: this.cloudName,
      folder: UPLOAD_FOLDER,
      transformation: UPLOAD_TRANSFORMATION,
    };
  }
}
