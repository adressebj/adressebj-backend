import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Désactivation directe d'une adresse par l'administrateur : motif facultatif. */
export class DeactivateAddressDto {
  @ApiPropertyOptional({ example: 'Adresse frauduleuse confirmée.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
