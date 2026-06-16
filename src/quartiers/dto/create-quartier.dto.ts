import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Création manuelle d'un quartier (admin). Le préfixe alimente le code des adresses. */
export class CreateQuartierDto {
  @ApiProperty({ example: 'Akpakpa' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({
    example: 'AKP',
    description: 'Préfixe de code (2–6 caractères A–Z/0–9)',
  })
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message:
      'Le préfixe doit comporter 2 à 6 caractères majuscules ou chiffres.',
  })
  prefix!: string;

  @ApiPropertyOptional({ example: 6.3676 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  centerLat?: number;

  @ApiPropertyOptional({ example: 2.4252 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  centerLng?: number;

  @ApiPropertyOptional({
    description: 'Polygone GeoJSON du quartier (optionnel)',
  })
  @IsOptional()
  polygon?: unknown;
}
