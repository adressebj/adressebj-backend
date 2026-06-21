import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsString, Length } from 'class-validator';

/** Départ de navigation (anonyme, public). */
export class StartVisitDto {
  @ApiProperty({ example: 'AKP-7X3K' })
  @IsString()
  @Length(3, 20)
  addressCode!: string;

  @ApiProperty({ example: '2026-05-17T09:00:00Z' })
  @IsISO8601()
  departAt!: string;
}
