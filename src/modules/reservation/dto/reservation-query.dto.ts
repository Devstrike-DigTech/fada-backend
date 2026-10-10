import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';

export enum ReservationStatusFilter {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  READY = 'ready',
  SERVED = 'served',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
}

export class ReservationQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by reservation status',
    enum: ReservationStatusFilter,
  })
  @IsOptional()
  @IsEnum(ReservationStatusFilter)
  status?: ReservationStatusFilter;

  @ApiPropertyOptional({
    description: 'Filter reservations created on or after this date (ISO 8601)',
    example: '2025-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Filter reservations created on or before this date (ISO 8601)',
    example: '2025-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
