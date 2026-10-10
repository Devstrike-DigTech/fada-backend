import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationDto } from '@common/dto/pagination.dto';

/** Pagination plus optional viewer coordinates so results carry a distance. */
export class SavedItemsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ example: 6.4483 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 7.5139 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

const toArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string') return undefined;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
};

export class SaveStatusQueryDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Comma-separated or repeated',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  drugIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Comma-separated or repeated',
  })
  @IsOptional()
  @Transform(toArray)
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  pharmacyIds?: string[];
}

export class CreateDrugListDto {
  @ApiProperty({ example: 'Mum’s monthly meds' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}

export class RenameDrugListDto extends CreateDrugListDto {}

export class AddListItemDto {
  @ApiProperty()
  @IsUUID()
  drugId: string;

  @ApiPropertyOptional({ default: 1, minimum: 1, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;
}

export class UpdateListItemDto {
  @ApiProperty({ minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
}

export class ReserveFromListDto {
  @ApiPropertyOptional({
    description:
      'Branch to reserve from. Required when the list spans several branches.',
  })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
