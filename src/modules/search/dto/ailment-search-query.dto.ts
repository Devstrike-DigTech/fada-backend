import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '@common/dto/pagination.dto';

export class AilmentSearchQueryDto extends PaginationDto {
  @ApiProperty({ description: 'Ailment or symptom to search for (e.g. "fever", "headache", "malaria")' })
  @IsString()
  @IsNotEmpty()
  q: string;

  @ApiPropertyOptional({ description: 'User latitude for geo-fenced results' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  @Type(() => Number)
  latitude?: number;

  @ApiPropertyOptional({ description: 'User longitude for geo-fenced results' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  @Type(() => Number)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Search radius in km (default 5, auto-expands if few results)', default: 5, minimum: 0.5, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(100)
  @Type(() => Number)
  radiusKm?: number;
}
