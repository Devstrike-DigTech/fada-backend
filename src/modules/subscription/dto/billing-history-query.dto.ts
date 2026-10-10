import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaymentStatus } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class BillingHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['paid', 'failed', 'pending', 'refunded'] })
  @IsOptional()
  @IsEnum(['paid', 'failed', 'pending', 'refunded'])
  status?: PaymentStatus;
}
