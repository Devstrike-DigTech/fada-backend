import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export enum StockUpdateMode {
  /** Replace stock with the exact value provided */
  SET = 'set',
  /** Add to existing stock */
  ADD = 'add',
  /** Subtract from existing stock */
  SUBTRACT = 'subtract',
}

export class UpdateStockDto {
  @ApiProperty({
    enum: StockUpdateMode,
    example: StockUpdateMode.SET,
    description:
      '"set" replaces stock, "add" increments, "subtract" decrements',
  })
  @IsEnum(StockUpdateMode)
  mode: StockUpdateMode;

  @ApiProperty({ example: 50, description: 'Quantity (must be ≥ 0)' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({
    example: 'Restock from supplier',
    description: 'Optional reason for audit trail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
