import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Length } from 'class-validator';

/** Création d'une clé API intégrateur (admin). La clé en clair n'est renvoyée qu'ici. */
export class CreateApiKeyDto {
  @ApiProperty({ example: 'Yango — production' })
  @IsString()
  @Length(1, 120)
  label!: string;

  @ApiPropertyOptional({
    example: '2027-01-01T00:00:00Z',
    description:
      'Expiration optionnelle (ISO 8601). Sans valeur = pas d’expiration.',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
