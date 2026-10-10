import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditQueryDto } from './dto/admin-audit-query.dto';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@Roles(UserRole.ADMIN)
@Controller({ path: 'admin/dashboard', version: '1' })
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Platform-wide snapshot: users, pharmacies, inventory, reservations, revenue, ads, promotions',
  })
  overview() {
    return this.dashboard.overview();
  }

  @Get('audit-logs')
  @ApiOperation({ summary: 'Back-office audit trail' })
  auditLogs(@Query() query: AdminAuditQueryDto) {
    return this.audit.list({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }
}
