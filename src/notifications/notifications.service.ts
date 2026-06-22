import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { SubscribeNotificationDto } from './dto/subscribe-notification.dto';

/** Charge utile métier d'une notification destinée au propriétaire d'une adresse. */
export interface NotifyPayload {
  type: NotificationType;
  message: string;
  /** Adresse concernée (rattachée au journal et nettoyée en `SetNull` si supprimée). */
  addressId?: string;
  /** Lien profond consommé par le service worker du frontend (jamais persisté). */
  url?: string;
}

export interface SubscribeResult {
  subscribed: true;
}

export interface UnsubscribeResult {
  unsubscribed: boolean;
}

export interface NotificationItem {
  id: string;
  type: NotificationType;
  message: string;
  addressCode: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Codes HTTP Web Push signifiant qu'un endpoint est mort → on purge l'abonnement. */
const GONE_STATUS = new Set([404, 410]);

/**
 * Transport Web Push (VAPID) + journal de notifications de l'habitant.
 *
 * `notifyOwner()` est appelé **depuis les services** (jamais un controller) sur les
 * déclencheurs métier (validation, rejet, dégradation de score, désactivation).
 * Chaque notification est **persistée** (consultable dans l'espace personnel) ; l'envoi
 * push est **best-effort** : un échec ne fait jamais échouer l'opération principale.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly configured: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY', '');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY', '');
    const subject = config.get<string>(
      'VAPID_SUBJECT',
      'mailto:contact@adressebj.bj',
    );

    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    } else {
      this.logger.warn(
        'VAPID non configuré : notifications persistées sans envoi push.',
      );
    }
  }

  /** Enregistre (ou ré-attache au compte courant) un abonnement push. Idempotent par endpoint. */
  async subscribe(
    userId: string,
    dto: SubscribeNotificationDto,
  ): Promise<SubscribeResult> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: {
        userId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
    });
    return { subscribed: true };
  }

  /** Désinscrit un endpoint appartenant à l'habitant courant. Idempotent. */
  async unsubscribe(
    userId: string,
    endpoint: string,
  ): Promise<UnsubscribeResult> {
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });
    return { unsubscribed: count > 0 };
  }

  /** Historique des notifications de l'habitant (plus récentes d'abord). */
  async list(userId: string): Promise<NotificationItem[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { address: { select: { code: true } } },
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      addressCode: n.address?.code ?? null,
      readAt: n.readAt,
      createdAt: n.createdAt,
    }));
  }

  /** Marque toutes les notifications non lues de l'habitant comme lues. */
  async markAllRead(userId: string): Promise<{ updated: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  /**
   * Persiste une notification pour `userId` et tente l'envoi push best-effort vers
   * tous ses abonnements. Les endpoints morts (404/410) sont purgés. N'échoue jamais.
   */
  async notifyOwner(userId: string, payload: NotifyPayload): Promise<void> {
    await this.prisma.notification.create({
      data: {
        userId,
        type: payload.type,
        message: payload.message,
        addressId: payload.addressId ?? null,
      },
    });

    if (!this.configured) {
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });
    if (subscriptions.length === 0) {
      return;
    }

    const body = JSON.stringify({
      type: payload.type,
      message: payload.message,
      url: payload.url,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        ),
      ),
    );

    const deadEndpoints: string[] = [];
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const status = (result.reason as { statusCode?: number })?.statusCode;
        if (status != null && GONE_STATUS.has(status)) {
          deadEndpoints.push(subscriptions[i].endpoint);
        } else {
          this.logger.warn(
            `Échec push (endpoint conservé), status=${status ?? 'inconnu'}`,
          );
        }
      }
    });

    if (deadEndpoints.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { endpoint: { in: deadEndpoints } },
      });
    }
  }
}
