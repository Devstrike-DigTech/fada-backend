import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  FeatureSuggestionStatus,
  SupportTicketPriority,
  SupportTicketStatus,
} from '@prisma/client';
import { PaginationDto } from '@common/dto/pagination.dto';
import {
  COMPLAINT_CATEGORY_KEYS,
  SUGGESTION_AREA_KEYS,
} from '../support.constants';

const TICKET_STATUSES = ['pending', 'in_review', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const SUGGESTION_STATUSES = [
  'submitted',
  'reviewing',
  'planned',
  'shipped',
  'declined',
];

export class CreateComplaintDto {
  @ApiProperty({ enum: COMPLAINT_CATEGORY_KEYS, example: 'reservation_issue' })
  @IsIn(COMPLAINT_CATEGORY_KEYS)
  category: string;

  @ApiProperty({ example: 'Drug not available at pickup' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  subject: string;

  @ApiProperty({
    minLength: 20,
    example:
      'I reserved Coartem at 2pm but the pharmacy said it was finished when I arrived.',
  })
  @IsString()
  @MinLength(20, {
    message: 'Please describe the issue in at least 20 characters',
  })
  @MaxLength(4000)
  description: string;

  @ApiPropertyOptional({ description: 'Reservation the complaint is about' })
  @IsOptional()
  @IsUUID()
  reservationId?: string;

  @ApiPropertyOptional({ description: 'Pharmacy the complaint is about' })
  @IsOptional()
  @IsUUID()
  pharmacyId?: string;
}

export class ComplaintQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: SupportTicketStatus;
}

export class TicketMessageDto {
  @ApiProperty({ example: 'I have attached my receipt number: 0042.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
}

export class CreateSuggestionDto {
  @ApiProperty({ enum: SUGGESTION_AREA_KEYS, example: 'reservations' })
  @IsIn(SUGGESTION_AREA_KEYS)
  area: string;

  @ApiProperty({ example: 'Remind me before my reservation expires' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title: string;

  @ApiProperty({
    example:
      'A push 30 minutes before expiry would stop me losing reservations.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;
}

// ─── Back office ──────────────────────────────────────────────────────────────

export class AdminTicketQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsIn(TICKET_STATUSES)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({ enum: COMPLAINT_CATEGORY_KEYS })
  @IsOptional()
  @IsIn(COMPLAINT_CATEGORY_KEYS)
  category?: string;

  @ApiPropertyOptional({ description: 'Admin user id, or "unassigned"' })
  @IsOptional()
  @IsString()
  assignedTo?: string;

  @ApiPropertyOptional({
    description: 'Ticket number, subject, or submitter email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AdminUpdateTicketDto {
  @ApiPropertyOptional({ enum: TICKET_STATUSES })
  @IsOptional()
  @IsEnum(TICKET_STATUSES)
  status?: SupportTicketStatus;

  @ApiPropertyOptional({ enum: PRIORITIES })
  @IsOptional()
  @IsEnum(PRIORITIES)
  priority?: SupportTicketPriority;

  @ApiPropertyOptional({
    description: 'Admin user id; null to unassign',
    nullable: true,
  })
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsUUID()
  assignedToId?: string | null;

  @ApiPropertyOptional({
    description: 'Shown to the user when resolved or closed',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNote?: string;
}

export class AdminTicketMessageDto extends TicketMessageDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Internal note: admins only, no notification',
  })
  @IsOptional()
  @IsBoolean()
  internal?: boolean;
}

export class AdminSuggestionQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: SUGGESTION_STATUSES })
  @IsOptional()
  @IsIn(SUGGESTION_STATUSES)
  status?: FeatureSuggestionStatus;

  @ApiPropertyOptional({ enum: SUGGESTION_AREA_KEYS })
  @IsOptional()
  @IsIn(SUGGESTION_AREA_KEYS)
  area?: string;
}

export class AdminUpdateSuggestionDto {
  @ApiProperty({ enum: SUGGESTION_STATUSES })
  @IsEnum(SUGGESTION_STATUSES)
  status: FeatureSuggestionStatus;

  @ApiPropertyOptional({ description: 'Shown to the submitter' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
