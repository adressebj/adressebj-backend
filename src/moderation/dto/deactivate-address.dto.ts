import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Désactivation d'une adresse depuis un signalement. Le motif est facultatif. */
export class DeactivateAddressDto {
  @ApiPropertyOptional({ maxLength: 500, example: 'Adresse frauduleuse.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
