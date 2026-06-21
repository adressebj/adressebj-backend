import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, Max, Min } from 'class-validator';

/** Point de départ (origine) du trajet pour l'estimation ETA vers l'adresse. */
export class EtaQueryDto {
  @ApiProperty({ example: 6.3676, description: 'Latitude de l’origine' })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  fromLat!: number;

  @ApiProperty({ example: 2.4252, description: 'Longitude de l’origine' })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  fromLng!: number;
}
