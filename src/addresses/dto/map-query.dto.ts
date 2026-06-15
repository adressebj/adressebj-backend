import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AddressCategory } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Aire géographique (bounding box) + filtre catégorie optionnel pour la carte. */
export class MapQueryDto {
  @ApiProperty({ example: 6.4 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  north!: number;

  @ApiProperty({ example: 6.34 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  south!: number;

  @ApiProperty({ example: 2.46 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  east!: number;

  @ApiProperty({ example: 2.4 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  west!: number;

  @ApiPropertyOptional({ enum: AddressCategory })
  @IsOptional()
  @IsEnum(AddressCategory)
  category?: AddressCategory;
}
