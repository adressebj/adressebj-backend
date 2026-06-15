import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorBody {
  statusCode: number;
  error: string;
  code: string;
  message: string | string[];
  [key: string]: unknown;
}

/**
 * Normalise toutes les erreurs vers le format enrichi NestJS :
 * `{ statusCode, error, code, message }`. Le champ `code` est une constante
 * machine consommée par le frontend et les intégrateurs (cf. CdC backend §4).
 *
 * Pour fournir un `code`, lever une HttpException dont la réponse est un objet :
 *   throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: '...' });
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = this.buildBody(exception, status);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} → ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json(body);
  }

  private buildBody(exception: unknown, status: number): ErrorBody {
    const defaultError = HttpStatus[status] ?? 'Error';

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      if (typeof res === 'string') {
        return {
          statusCode: status,
          error: defaultError,
          code: this.fallbackCode(status),
          message: res,
        };
      }
      const obj = res as Record<string, unknown>;
      // Les champs métier additionnels (ex. address_code, deactivated_at) sont
      // conservés ; les champs canoniques ci-dessous priment.
      return {
        ...obj,
        statusCode: status,
        error: (obj.error as string) ?? defaultError,
        code: (obj.code as string) ?? this.fallbackCode(status),
        message: (obj.message as string | string[]) ?? exception.message,
      };
    }

    return {
      statusCode: status,
      error: defaultError,
      code: 'INTERNAL_ERROR',
      message: 'Une erreur interne est survenue.',
    };
  }

  /** Code machine générique quand aucun code métier n'est fourni. */
  private fallbackCode(status: number): string {
    return (HttpStatus[status] ?? 'ERROR')
      .toString()
      .toUpperCase()
      .replace(/\s+/g, '_');
  }
}
