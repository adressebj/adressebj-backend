import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Signalement d'une adresse par un habitant. Le message est facultatif. */
export class ReportAddressDto {
  @ApiPropertyOptional({ maxLength: 500, example: 'La maison a été démolie.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
