import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Encapsule l'envoi de SMS (CdC : tout service externe derrière un service interne).
 *
 * En l'absence d'identifiants Africa's Talking (cf. docs/USER_ACTIONS.md), un provider
 * « dev » journalise le code au lieu de l'envoyer — le flux OTP reste testable end-to-end.
 * Le provider réel Africa's Talking sera branché ici quand les clés seront fournies.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.enabled = Boolean(
      this.config.get<string>('AT_API_KEY') &&
        this.config.get<string>('AT_USERNAME'),
    );
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const message = `AdresseBJ : votre code de vérification est ${code}. Il expire dans 10 minutes.`;
    if (!this.enabled) {
      // Provider dev : pas d'envoi réel, on trace pour permettre le test du flux.
      this.logger.warn(`[SMS DEV] → ${phone} : ${message}`);
      return;
    }
    // TODO(USER_ACTIONS): brancher le SDK Africa's Talking ici (clés AT_*).
    this.logger.log(`SMS envoyé à ${phone}.`);
  }
}
