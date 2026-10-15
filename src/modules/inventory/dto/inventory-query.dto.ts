import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { DrugTypeDto, PrescriptionTypeDto } from './add-drug.dto';

export const INVENTORY_SORT_FIELDS = [
  'name',
  'updatedAt',
  'stockAmount',
  'price',
] as const;
export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];

export enum StockStatusFilter {
  IN_STOCK = 'in_stock',
  LOW_STOCK = 'low_stock',
  OUT_OF_STOCK = 'out_of_stock',
}

export class InventoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    example: 'Paracetamol',
    description: 'Filter by drug name',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: StockStatusFilter,
    description: 'Filter by stock status',
  })
  @IsOptional()
  @IsEnum(StockStatusFilter)
  stockStatus?: StockStatusFilter;

  @ApiPropertyOptional({ description: 'Filter by category ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: PrescriptionTypeDto,
    description: 'Filter by prescription type',
  })
  @IsOptional()
  @IsEnum(PrescriptionTypeDto)
  prescriptionType?: PrescriptionTypeDto;

  @ApiPropertyOptional({
    enum: DrugTypeDto,
    description: 'Filter by drug type (oral, infusion, injectable, …)',
  })
  @IsOptional()
  @IsEnum(DrugTypeDto)
  drugType?: DrugTypeDto;

  @ApiPropertyOptional({ example: false, description: 'Include expired drugs' })
  @IsOptional()
  // "false" in a query string must stay false (Boolean('false') is true)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' || value === true
      ? true
      : value === 'false' || value === false
        ? false
        : value,
  )
  @IsBoolean()
  includeExpired?: boolean;

  @ApiPropertyOptional({
    enum: INVENTORY_SORT_FIELDS,
    default: 'name',
    description: 'Sort field; combine with sortOrder (asc | desc)',
  })
  @IsOptional()
  @IsIn(INVENTORY_SORT_FIELDS)
  declare sortBy?: InventorySortField;

  @ApiPropertyOptional({ enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  declare sortOrder?: 'asc' | 'desc';
}
