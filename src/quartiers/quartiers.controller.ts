import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { QuartierSummary, QuartiersService } from './quartiers.service';

@ApiTags('quartiers')
@Controller('quartiers')
export class QuartiersController {
  constructor(private readonly quartiers: QuartiersService) {}

  @Get()
  @ApiOperation({ summary: 'Liste des quartiers actifs' })
  list(): Promise<QuartierSummary[]> {
    return this.quartiers.listActive();
  }
}
