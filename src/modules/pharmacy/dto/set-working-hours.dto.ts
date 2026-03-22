import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum DayOfWeekDto {
  SUNDAY = 'sunday',
  MONDAY = 'monday',
  TUESDAY = 'tuesday',
  WEDNESDAY = 'wednesday',
  THURSDAY = 'thursday',
  FRIDAY = 'friday',
  SATURDAY = 'saturday',
}

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class WorkingHourEntryDto {
  @ApiProperty({ enum: DayOfWeekDto, example: DayOfWeekDto.MONDAY })
  @IsEnum(DayOfWeekDto)
  dayOfWeek: DayOfWeekDto;

  @ApiPropertyOptional({
    example: '08:00',
    description: 'Opening time in HH:mm format (24h). Required if isClosed is false.',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'openTime must be in HH:mm format (e.g. 08:00)' })
  openTime?: string;

  @ApiPropertyOptional({
    example: '20:00',
    description: 'Closing time in HH:mm format (24h). Required if isClosed is false.',
  })
  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX, { message: 'closeTime must be in HH:mm format (e.g. 20:00)' })
  closeTime?: string;

  @ApiProperty({
    example: false,
    description: 'Set to true if the branch is closed on this day',
  })
  @IsBoolean()
  isClosed: boolean;
}

export class SetWorkingHoursDto {
  @ApiProperty({
    type: [WorkingHourEntryDto],
    description: 'Array of 1–7 working hour entries (one per day)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => WorkingHourEntryDto)
  hours: WorkingHourEntryDto[];
}
