import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { DevicePlatform, NotificationCategory } from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';
import { ALL_CATEGORIES, Channel } from '../notification.types';

const CATEGORY_VALUES = ALL_CATEGORIES as unknown as string[];

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'FCM registration token from the device' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsEnum(['ios', 'android', 'web'])
  platform: DevicePlatform;

  @ApiPropertyOptional({ example: 'Tecno Spark 10' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceName?: string;

  @ApiPropertyOptional({ example: '1.4.2' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;
}

export class NotificationHistoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: CATEGORY_VALUES })
  @IsOptional()
  @IsIn(CATEGORY_VALUES)
  category?: NotificationCategory;
}

export class MarkAllReadDto {
  @ApiPropertyOptional({
    enum: CATEGORY_VALUES,
    description: 'Only this category',
  })
  @IsOptional()
  @IsIn(CATEGORY_VALUES)
  category?: NotificationCategory;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;

  @ApiPropertyOptional({
    enum: CATEGORY_VALUES,
    isArray: true,
    description:
      'Categories to silence (push / SMS / email). account and billing cannot be muted.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(CATEGORY_VALUES, { each: true })
  mutedCategories?: NotificationCategory[];
}

export class BroadcastDto {
  @ApiProperty({ enum: ['customers', 'pharmacists', 'all', 'users'] })
  @IsIn(['customers', 'pharmacists', 'all', 'users'])
  audience: 'customers' | 'pharmacists' | 'all' | 'users';

  @ApiPropertyOptional({
    type: [String],
    description: 'Required when audience is "users"',
  })
  @ValidateIf((o: BroadcastDto) => o.audience === 'users')
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiProperty({ example: 'Christmas offer: 25% off every plan' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  title: string;

  @ApiProperty({ example: 'Use code XMAS25 before 31 December.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  body: string;

  @ApiPropertyOptional({ enum: ['system', 'marketing'], default: 'system' })
  @IsOptional()
  @IsIn(['system', 'marketing'])
  category?: 'system' | 'marketing';

  @ApiPropertyOptional({
    enum: ['in_app', 'push', 'sms', 'email'],
    isArray: true,
    default: ['in_app', 'push'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(['in_app', 'push', 'sms', 'email'], { each: true })
  channels?: Channel[];

  @ApiPropertyOptional({
    example: 'pharmacy/subscription',
    description: 'In-app route for taps',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  link?: string;
}
