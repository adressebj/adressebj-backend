import { ApiPropertyOptional } from '@nestjs/swagger';
import { AddressCategory, AddressLifecycle } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Supervision du référentiel (admin) : filtres + pagination. */
export class AdminAddressesQueryDto {
  @ApiPropertyOptional({
    description: 'Recherche par préfixe de code (insensible à la casse)',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  quartierId?: string;

  @ApiPropertyOptional({ enum: AddressLifecycle })
  @IsOptional()
  @IsEnum(AddressLifecycle)
  lifecycle?: AddressLifecycle;

  @ApiPropertyOptional({ enum: AddressCategory })
  @IsOptional()
  @IsEnum(AddressCategory)
  category?: AddressCategory;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
