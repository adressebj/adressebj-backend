import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/** Désinscription : on identifie l'abonnement à supprimer par son `endpoint`. */
export class UnsubscribeNotificationDto {
  @ApiProperty({ description: 'Endpoint push à désinscrire.' })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;
}
