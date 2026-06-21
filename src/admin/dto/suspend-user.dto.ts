import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Suspension d'un compte Habitant (admin) : motif facultatif. */
export class SuspendUserDto {
  @ApiPropertyOptional({ example: 'Comportement abusif signalé à répétition.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
