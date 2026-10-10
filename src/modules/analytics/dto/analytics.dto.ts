import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PeriodPreset } from '../analytics-dates';

export class PeriodQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', '365d'], default: '30d' })
  @IsOptional()
  @IsIn(['7d', '30d', '90d', '365d'])
  period?: PeriodPreset;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Overrides period (Lagos calendar day)',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class TrendsQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({ enum: ['drug', 'ailment', 'pharmacy'] })
  @IsOptional()
  @IsIn(['drug', 'ailment', 'pharmacy'])
  searchType?: 'drug' | 'ailment' | 'pharmacy';

  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export const LEADERBOARD_METRICS = [
  'reservationsServed',
  'reservationsCreated',
  'servedValueNgn',
  'searchAppearances',
  'adClicks',
  'newSaves',
] as const;
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number];

export class LeaderboardQueryDto extends PeriodQueryDto {
  @ApiPropertyOptional({
    enum: LEADERBOARD_METRICS,
    default: 'reservationsServed',
  })
  @IsOptional()
  @IsIn(LEADERBOARD_METRICS as unknown as string[])
  metric?: LeaderboardMetric;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class RebuildDto {
  @ApiPropertyOptional({ example: '2026-10-01' })
  @IsDateString()
  from: string;

  @ApiPropertyOptional({ example: '2026-10-09' })
  @IsDateString()
  to: string;
}
