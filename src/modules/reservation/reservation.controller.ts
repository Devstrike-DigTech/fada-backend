import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  CurrentUser,
  CurrentUserData,
} from '@common/decorators/current-user.decorator';
import { Roles, UserRole } from '@common/decorators/roles.decorator';
import { ReservationService } from './reservation.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { ReservationQueryDto } from './dto/reservation-query.dto';
import { CancelReservationDto } from './dto/cancel-reservation.dto';
import { ServeReservationDto } from './dto/serve-reservation.dto';

@ApiTags('Reservations')
@Controller({ path: 'reservations', version: '1' })
@ApiBearerAuth('access-token')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  // ─── Customer Endpoints ──────────────────────────────────────────────────────

  /**
   * POST /reservations
   * Customer creates a reservation for drugs at a specific branch.
   */
  @Post()
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a reservation',
    description:
      'Customer reserves one or more drugs at a branch. ' +
      'Returns an alphanumeric code and a QR code URL for pickup. ' +
      'Reservation expires automatically after 2 hours if not collected.',
  })
  createReservation(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateReservationDto,
  ) {
    return this.reservationService.createReservation(user.sub, dto);
  }

  /**
   * GET /reservations/mine
   * Customer retrieves their own reservation history.
   */
  @Get('mine')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({
    summary: 'List my reservations',
    description:
      "Returns the authenticated customer's reservations, paginated.",
  })
  listMyReservations(
    @CurrentUser() user: CurrentUserData,
    @Query() query: ReservationQueryDto,
  ) {
    return this.reservationService.listCustomerReservations(user.sub, query);
  }

  /**
   * PATCH /reservations/:id/cancel
   * Customer cancels one of their own pending or confirmed reservations.
   */
  @Patch(':id/cancel')
  @Roles(UserRole.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a reservation (customer)',
    description: 'Allowed while the reservation is pending or confirmed.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  cancelByCustomer(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CancelReservationDto,
  ) {
    return this.reservationService.cancelByCustomer(user.sub, id, dto);
  }

  // ─── Shared (Customer + Pharmacist) ─────────────────────────────────────────

  /**
   * GET /reservations/:id
   * Customers see their own; pharmacists/staff see reservations for their branch.
   */
  @Get(':id')
  @Roles(UserRole.CUSTOMER, UserRole.PHARMACIST, UserRole.STAFF)
  @ApiOperation({
    summary: 'Get reservation by ID',
    description:
      'Customers may only access their own reservations. ' +
      'Pharmacists and staff may access reservations for branches they manage.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  getReservationById(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.reservationService.getReservationById(id, user.sub, user.role);
  }

  // ─── Pharmacist / Staff Endpoints ────────────────────────────────────────────

  /**
   * GET /reservations/branch/:branchId
   * Lists all reservations for a specific branch (owner/operator/staff).
   */
  @Get('branch/:branchId')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @ApiOperation({
    summary: 'List branch reservations',
    description:
      'Returns paginated reservations for a branch. ' +
      'Accessible to the pharmacy owner, operators, and branch staff.',
  })
  @ApiParam({ name: 'branchId', description: 'Branch ID' })
  listBranchReservations(
    @CurrentUser() user: CurrentUserData,
    @Param('branchId') branchId: string,
    @Query() query: ReservationQueryDto,
  ) {
    return this.reservationService.listBranchReservations(
      user.sub,
      branchId,
      query,
    );
  }

  /**
   * GET /reservations/verify/:code
   * Lookup reservation by the alphanumeric code or QR-scan result.
   * Used by pharmacists at the counter to pull up the customer's order.
   */
  @Get('verify/:code')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @ApiOperation({
    summary: 'Verify reservation by code (QR scan)',
    description:
      'Looks up a reservation using the alphanumeric code (e.g. RSV3AB9XY2). ' +
      'Used when a customer presents their QR code or reads out their code at the counter.',
  })
  @ApiParam({
    name: 'code',
    description: 'Reservation alphanumeric code (case-insensitive)',
    example: 'RSV3AB9XY2',
  })
  verifyByCode(
    @CurrentUser() user: CurrentUserData,
    @Param('code') code: string,
  ) {
    return this.reservationService.verifyByCode(code, user.sub);
  }

  /**
   * PATCH /reservations/:id/confirm
   * Pharmacy confirms the reservation — drugs are set aside.
   */
  @Patch(':id/confirm')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a reservation',
    description:
      'Pharmacy acknowledges the reservation and sets aside the drugs. ' +
      'Transition: pending → confirmed.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  confirmReservation(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
  ) {
    return this.reservationService.confirmReservation(user.sub, id);
  }

  /**
   * PATCH /reservations/:id/ready
   * Drugs have been physically prepared and are ready for pickup.
   */
  @Patch(':id/ready')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark reservation ready for pickup',
    description:
      'Pharmacy signals that the drugs have been dispensed and bagged. ' +
      'Transition: confirmed → ready.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  markReady(@CurrentUser() user: CurrentUserData, @Param('id') id: string) {
    return this.reservationService.markReady(user.sub, id);
  }

  /**
   * PATCH /reservations/:id/serve
   * Customer has collected the drugs — stock is deducted and reservation closes.
   */
  @Patch(':id/serve')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark reservation as served',
    description:
      'Pharmacist confirms the customer has collected their drugs. ' +
      'Stock is deducted from the branch inventory at this point. ' +
      'Transition: ready OR confirmed → served.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  serveReservation(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: ServeReservationDto,
  ) {
    return this.reservationService.serveReservation(user.sub, id, dto);
  }

  /**
   * PATCH /reservations/:id/cancel-pharmacy
   * Pharmacy cancels a reservation (e.g. drugs unavailable, customer no-show).
   */
  @Patch(':id/cancel-pharmacy')
  @Roles(UserRole.PHARMACIST, UserRole.STAFF)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a reservation (pharmacy)',
    description:
      'Pharmacy cancels a pending, confirmed, or ready reservation. ' +
      'A reason should be provided so the customer is informed.',
  })
  @ApiParam({ name: 'id', description: 'Reservation ID' })
  cancelByPharmacy(
    @CurrentUser() user: CurrentUserData,
    @Param('id') id: string,
    @Body() dto: CancelReservationDto,
  ) {
    return this.reservationService.cancelByPharmacy(user.sub, id, dto);
  }
}
