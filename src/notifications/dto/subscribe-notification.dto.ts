import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';

/** Clés de chiffrement de l'abonnement Web Push (champ `keys` du `PushSubscription` navigateur). */
export class PushKeysDto {
  @ApiProperty({ description: 'Clé publique P-256 ECDH du client.' })
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @ApiProperty({ description: "Secret d'authentification du client." })
  @IsString()
  @IsNotEmpty()
  auth!: string;
}

/**
 * Corps d'abonnement push : exactement la forme `PushSubscription.toJSON()` du
 * navigateur (`{ endpoint, keys: { p256dh, auth } }`).
 */
export class SubscribeNotificationDto {
  @ApiProperty({ description: 'Endpoint push fourni par le navigateur.' })
  @IsString()
  @IsNotEmpty()
  endpoint!: string;

  @ApiProperty({ type: PushKeysDto })
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}
