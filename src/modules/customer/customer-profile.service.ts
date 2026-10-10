import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import {
  CustomerAddressPayload,
  CustomerProfileUpdatedPayload,
  EVENTS,
} from '@common/types/events.types';
import { UpdateCustomerProfileDto } from './dto/profile.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';

const MAX_ADDRESSES = 10;
/** Must match Terms of Service §3 (User Accounts) */
export const MIN_CUSTOMER_AGE = 18;

@Injectable()
export class CustomerProfileService {
  private readonly logger = new Logger(CustomerProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  // ─── Profile ─────────────────────────────────────────────────────────────────

  async getProfile(customerId: string) {
    const user = await this.loadCustomer(customerId);
    return this.presentProfile(user);
  }

  /** Everything the "Profile Details" screen needs in one call. */
  async getProfileDetails(customerId: string) {
    const user = await this.loadCustomer(customerId);
    const [
      addresses,
      savedDrugs,
      savedPharmacies,
      lists,
      reservations,
      served,
    ] = await Promise.all([
      this.prisma.customerAddress.findMany({
        where: { customerId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      }),
      this.prisma.customerSavedDrug.count({ where: { customerId } }),
      this.prisma.customerSavedPharmacy.count({ where: { customerId } }),
      this.prisma.customerDrugList.count({ where: { customerId } }),
      this.prisma.reservation.count({ where: { customerId } }),
      this.prisma.reservation.count({
        where: { customerId, status: 'served' },
      }),
    ]);

    const profile = this.presentProfile(user);
    return {
      ...profile,
      addresses,
      defaultAddress:
        addresses.find((a) => a.isDefault) ?? addresses[0] ?? null,
      stats: {
        savedDrugs,
        savedPharmacies,
        drugLists: lists,
        reservations,
        reservationsServed: served,
      },
    };
  }

  async updateProfile(customerId: string, dto: UpdateCustomerProfileDto) {
    const user = await this.loadCustomer(customerId);
    const changed = Object.keys(dto).filter(
      (k) => dto[k as keyof UpdateCustomerProfileDto] !== undefined,
    );
    if (changed.length === 0)
      throw new BadRequestException('No fields to update');

    let dateOfBirth: Date | undefined;
    if (dto.dateOfBirth) {
      dateOfBirth = new Date(dto.dateOfBirth);
      const age =
        (Date.now() - dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (Number.isNaN(dateOfBirth.getTime()) || age > 120) {
        throw new BadRequestException('Date of birth is not valid');
      }
      // Terms of Service §3: users must be at least 18
      if (age < MIN_CUSTOMER_AGE) {
        throw new BadRequestException(
          `You must be at least ${MIN_CUSTOMER_AGE} to use FADA`,
        );
      }
    }

    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: customerId },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            ...(dto.phone && dto.phone !== user.phone
              ? { phone: dto.phone, phoneVerified: false }
              : {}),
          },
        }),
        this.prisma.customerProfile.upsert({
          where: { userId: customerId },
          create: {
            userId: customerId,
            firstName: dto.firstName ?? user.firstName ?? '',
            lastName: dto.lastName ?? user.lastName ?? '',
            gender: dto.gender,
            dateOfBirth,
          },
          update: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            gender: dto.gender,
            dateOfBirth,
          },
        }),
      ]);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('That phone number is already in use');
      }
      throw err;
    }

    const fresh = await this.loadCustomer(customerId);
    const presented = this.presentProfile(fresh);

    const payload: CustomerProfileUpdatedPayload = {
      customerId,
      changedFields: changed,
      isComplete: presented.completion.isComplete,
      updatedAt: new Date(),
    };
    this.eventBus.emit(EVENTS.CUSTOMER.PROFILE_UPDATED, payload);
    if (presented.completion.isComplete) {
      this.eventBus.emit(EVENTS.CUSTOMER.PROFILE_COMPLETED, payload);
    }
    return presented;
  }

  // ─── Addresses ───────────────────────────────────────────────────────────────

  async listAddresses(customerId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async addAddress(customerId: string, dto: CreateAddressDto) {
    const count = await this.prisma.customerAddress.count({
      where: { customerId },
    });
    if (count >= MAX_ADDRESSES) {
      throw new BadRequestException(
        `You can save at most ${MAX_ADDRESSES} addresses`,
      );
    }
    const makeDefault = dto.isDefault ?? count === 0; // first address is the default

    const address = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.create({
        data: {
          customerId,
          label: dto.label,
          addressLine: dto.addressLine,
          city: dto.city,
          state: dto.state,
          country: dto.country ?? 'Nigeria',
          latitude: dto.latitude,
          longitude: dto.longitude,
          isDefault: makeDefault,
        },
      });
    });

    const payload: CustomerAddressPayload = {
      customerId,
      addressId: address.id,
      isDefault: address.isDefault,
      occurredAt: new Date(),
    };
    this.eventBus.emit(EVENTS.CUSTOMER.ADDRESS_ADDED, payload);
    return address;
  }

  async updateAddress(
    customerId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ) {
    await this.loadAddress(customerId, addressId);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, NOT: { id: addressId } },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          label: dto.label,
          addressLine: dto.addressLine,
          city: dto.city,
          state: dto.state,
          country: dto.country,
          latitude: dto.latitude,
          longitude: dto.longitude,
          isDefault: dto.isDefault,
        },
      });
    });
  }

  async removeAddress(customerId: string, addressId: string) {
    const address = await this.loadAddress(customerId, addressId);
    await this.prisma.$transaction(async (tx) => {
      await tx.customerAddress.delete({ where: { id: addressId } });
      if (address.isDefault) {
        const next = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) {
          await tx.customerAddress.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { deleted: true };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async loadCustomer(customerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      include: { customerProfile: true },
    });
    if (!user || user.role !== 'customer')
      throw new NotFoundException('Customer not found');
    return user;
  }

  private async loadAddress(customerId: string, addressId: string) {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  private presentProfile(
    user: Prisma.UserGetPayload<{ include: { customerProfile: true } }>,
  ) {
    const p = user.customerProfile;
    const firstName = p?.firstName ?? user.firstName ?? '';
    const lastName = p?.lastName ?? user.lastName ?? '';
    const fields = {
      name: !!(firstName && lastName),
      email: !!user.email,
      phone: !!user.phone,
      gender: !!p?.gender,
      dateOfBirth: !!p?.dateOfBirth,
      avatar: !!(user.avatarUrl ?? p?.avatarUrl),
    };
    const filled = Object.values(fields).filter(Boolean).length;
    const total = Object.keys(fields).length;

    return {
      id: user.id,
      fadaId: user.fadaId,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      firstName,
      lastName,
      name: `${firstName} ${lastName}`.trim(),
      gender: p?.gender ?? null,
      dateOfBirth: p?.dateOfBirth ?? null,
      avatarUrl: user.avatarUrl ?? p?.avatarUrl ?? null,
      referralCode: p?.referralCode ?? null,
      memberSince: user.createdAt,
      completion: {
        percent: Math.round((filled / total) * 100),
        isComplete: filled === total,
        missing: Object.entries(fields)
          .filter(([, v]) => !v)
          .map(([k]) => k),
      },
    };
  }
}
