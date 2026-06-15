import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Bascule de la découvrabilité cartographique d'une adresse. */
export class DiscoverableDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  discoverable!: boolean;
}
