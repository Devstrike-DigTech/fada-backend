import { SocketAuthService } from './socket-auth.service';
import { parseRoom, rooms } from './socket-rooms';
import { PrismaService } from '@infra/database/prisma.service';

const PH = '11111111-1111-1111-1111-111111111111';
const BR = '22222222-2222-2222-2222-222222222222';
const BR2 = '33333333-3333-3333-3333-333333333333';
const RES = '44444444-4444-4444-4444-444444444444';
const CUST = '55555555-5555-5555-5555-555555555555';

type Who = 'owner' | 'operatorStaff' | 'branchStaff' | 'stranger';

function svc(who: Who) {
  const profile = who === 'owner' ? { roleInPharmacy: 'owner' } : null;
  const staff =
    who === 'operatorStaff'
      ? [{ role: 'operator', branchId: null }]
      : who === 'branchStaff'
        ? [{ role: 'staff', branchId: BR }]
        : [];
  const prisma = {
    pharmacistProfile: { findFirst: jest.fn().mockResolvedValue(profile) },
    pharmacyStaff: { findMany: jest.fn().mockResolvedValue(staff) },
    branch: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === BR || where.id === BR2 ? { pharmacyId: PH } : null,
        ),
      ),
    },
    reservation: {
      findUnique: jest.fn().mockResolvedValue({
        customerId: CUST,
        branchId: BR,
        branch: { pharmacyId: PH },
      }),
    },
    batchUploadJob: {
      findUnique: jest.fn().mockResolvedValue({ branchId: BR2 }),
    },
  } as unknown as PrismaService;
  return new SocketAuthService(prisma);
}

const can = (
  who: Who,
  room: string,
  userId = 'staff-user',
  role = 'pharmacist',
) => svc(who).canJoin({ id: userId, role }, parseRoom(room)!);

describe('SocketAuthService.canJoin', () => {
  it('lets owners and operators see the whole pharmacy and billing', async () => {
    await expect(can('owner', rooms.pharmacyReservations(PH))).resolves.toBe(
      true,
    );
    await expect(can('owner', rooms.pharmacyBilling(PH))).resolves.toBe(true);
    await expect(can('operatorStaff', rooms.pharmacyBilling(PH))).resolves.toBe(
      true,
    );
  });

  it('limits branch staff to their branch and keeps billing private', async () => {
    await expect(
      can('branchStaff', rooms.branchReservations(BR)),
    ).resolves.toBe(true);
    await expect(
      can('branchStaff', rooms.branchReservations(BR2)),
    ).resolves.toBe(false);
    await expect(
      can('branchStaff', rooms.pharmacyReservations(PH)),
    ).resolves.toBe(false);
    await expect(can('branchStaff', rooms.pharmacyBilling(PH))).resolves.toBe(
      false,
    );
    await expect(can('branchStaff', rooms.reservation(RES))).resolves.toBe(
      true,
    );
    await expect(can('branchStaff', rooms.batchUpload(RES))).resolves.toBe(
      false,
    );
  });

  it('lets a customer into their own reservation only', async () => {
    await expect(
      can('stranger', rooms.reservation(RES), CUST, 'customer'),
    ).resolves.toBe(true);
    await expect(
      can('stranger', rooms.reservation(RES), 'someone-else', 'customer'),
    ).resolves.toBe(false);
    await expect(
      can('stranger', rooms.customerReservations(CUST), CUST, 'customer'),
    ).resolves.toBe(true);
    await expect(
      can('stranger', rooms.customerReservations(CUST), 'x', 'customer'),
    ).resolves.toBe(false);
  });

  it('keeps strangers out and admins in', async () => {
    await expect(can('stranger', rooms.pharmacyReservations(PH))).resolves.toBe(
      false,
    );
    await expect(can('stranger', rooms.adminFeed())).resolves.toBe(false);
    await expect(
      can('stranger', rooms.adminFeed(), 'a', 'admin'),
    ).resolves.toBe(true);
    await expect(
      can('stranger', rooms.pharmacyBilling(PH), 'a', 'admin'),
    ).resolves.toBe(true);
  });
});
