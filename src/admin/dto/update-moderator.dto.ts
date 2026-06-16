import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum ModeratorAction {
  DEACTIVATE = 'deactivate',
  REACTIVATE = 'reactivate',
  RESET = 'reset',
}

/**
 * Action sur un compte Modérateur : désactiver, réactiver, ou réinitialiser le
 * mot de passe (`password` requis pour `reset`).
 */
export class UpdateModeratorDto {
  @ApiProperty({ enum: ModeratorAction })
  @IsEnum(ModeratorAction, {
    message: 'action doit valoir deactivate, reactivate ou reset.',
  })
  action!: ModeratorAction;

  @ApiPropertyOptional({
    minLength: 8,
    description: 'Requis si action = reset',
  })
  @IsOptional()
  @IsString()
  @MinLength(8, {
    message: 'Le mot de passe doit comporter au moins 8 caractères.',
  })
  @MaxLength(72, {
    message: 'Le mot de passe ne doit pas dépasser 72 caractères.',
  })
  password?: string;
}
