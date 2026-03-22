import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { PrescriptionTypeDto } from './add-drug.dto';

export enum StockStatusFilter {
  IN_STOCK = 'in_stock',
  LOW_STOCK = 'low_stock',
  OUT_OF_STOCK = 'out_of_stock',
}

export class InventoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'Paracetamol', description: 'Filter by drug name' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: StockStatusFilter, description: 'Filter by stock status' })
  @IsOptional()
  @IsEnum(StockStatusFilter)
  stockStatus?: StockStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ enum: PrescriptionTypeDto, description: 'Filter by prescription type' })
  @IsOptional()
  @IsEnum(PrescriptionTypeDto)
  prescriptionType?: PrescriptionTypeDto;

  @ApiPropertyOptional({ example: false, description: 'Include expired drugs' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeExpired?: boolean;
}
