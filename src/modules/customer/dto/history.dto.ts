import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SearchType } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';

export class SearchHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['drug', 'ailment', 'pharmacy'] })
  @IsOptional()
  @IsEnum(['drug', 'ailment', 'pharmacy'])
  searchType?: SearchType;
}

export class RepeatSearchDto {
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

  @ApiPropertyOptional({ default: 5, minimum: 0.5, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.5)
  @Max(100)
  radiusKm?: number;
}
