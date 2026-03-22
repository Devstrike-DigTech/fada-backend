import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';

export class PharmacySearchQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Pharmacy name search term' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'User latitude for geo-fenced search' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ description: 'User longitude for geo-fenced search' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Search radius in km (default 5, auto-expands if few results)',
    default: 5,
    minimum: 0.5,
    maximum: 100,
  })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(100)
  @Type(() => Number)
  radiusKm?: number;

  @ApiPropertyOptional({ description: 'Filter by Nigerian state' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ description: 'Filter by city' })
  @IsOptional()
  @IsString()
  city?: string;
}
