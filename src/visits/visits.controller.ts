import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfirmVisitDto } from './dto/confirm-visit.dto';
import { StartVisitDto } from './dto/start-visit.dto';
import { ConfirmResult, StartResult, VisitsService } from './visits.service';

@ApiTags('visits')
@Controller('visits')
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post('start')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Départ de navigation (anonyme, public)' })
  start(@Body() dto: StartVisitDto): Promise<StartResult> {
    return this.visits.start(dto);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Confirmation d’arrivée (web « J’y suis » ou clé API)',
  })
  confirm(
    @Body() dto: ConfirmVisitDto,
    @Headers('authorization') authHeader?: string,
  ): Promise<ConfirmResult> {
    return this.visits.confirm(dto, authHeader);
  }
}
