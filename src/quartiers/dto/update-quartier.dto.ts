import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** Modification d'un quartier (admin) : tous champs optionnels (mise à jour partielle). */
export class UpdateQuartierDto {
  @ApiPropertyOptional({ example: 'Akpakpa Nord' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'AKN' })
  @IsOptional()
  @Matches(/^[A-Z0-9]{2,6}$/, {
    message:
      'Le préfixe doit comporter 2 à 6 caractères majuscules ou chiffres.',
  })
  prefix?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  polygon?: unknown;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
