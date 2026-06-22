import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SubscribeNotificationDto } from './dto/subscribe-notification.dto';
import { UnsubscribeNotificationDto } from './dto/unsubscribe-notification.dto';
import {
  NotificationItem,
  NotificationsService,
  SubscribeResult,
  UnsubscribeResult,
} from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.HABITANT)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enregistrer un abonnement push (habitant)' })
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscribeNotificationDto,
  ): Promise<SubscribeResult> {
    return this.notifications.subscribe(user.id, dto);
  }

  @Delete('unsubscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Se désinscrire des notifications push (habitant)' })
  unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnsubscribeNotificationDto,
  ): Promise<UnsubscribeResult> {
    return this.notifications.unsubscribe(user.id, dto.endpoint);
  }

  @Get()
  @ApiOperation({ summary: 'Historique des notifications (habitant)' })
  list(@CurrentUser() user: AuthUser): Promise<NotificationItem[]> {
    return this.notifications.list(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marquer toutes les notifications comme lues' })
  markAllRead(@CurrentUser() user: AuthUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }
}
