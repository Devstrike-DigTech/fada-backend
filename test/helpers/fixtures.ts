import { randomUUID } from 'crypto';
import { TestApp } from './app';

let seq = 0;
const uniq = () =>
  `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export interface Actor {
  id: string;
  email: string;
  role: string;
  token: string;
}

/** Access token signed exactly like AuthService does. */
export function tokenFor(
  t: TestApp,
  user: { id: string; email: string; role: string },
): string {
  return t.jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' },
  );
}

export async function createCustomer(
  t: TestApp,
  over: { phone?: string } = {},
): Promise<Actor> {
  const u = uniq();
  const user = await t.prisma.user.create({
    data: {
      fadaId: `CUS${u}`.slice(0, 20),
      email: `cust.${u}@test.ng`,
      phone: over.phone,
      role: 'customer',
      isActive: true,
      isEmailVerified: true,
      customerProfile: { create: { firstName: 'Ada', lastName: 'Eze' } },
    },
  });
  return { ...user, token: tokenFor(t, user) };
}

export async function createAdmin(t: TestApp): Promise<Actor> {
  const u = uniq();
  const user = await t.prisma.user.create({
    data: {
      fadaId: `ADM${u}`.slice(0, 20),
      email: `admin.${u}@test.ng`,
      role: 'admin',
      isActive: true,
      isEmailVerified: true,
    },
  });
  return { ...user, token: tokenFor(t, user) };
}

export interface PharmacyFixture {
  owner: Actor;
  pharmacyId: string;
  branchId: string;
}

/** A verified pharmacy with an owner and a head branch at Enugu coordinates. */
export async function createPharmacy(
  t: TestApp,
  opts: { verified?: boolean; name?: string } = {},
): Promise<PharmacyFixture> {
  const u = uniq();
  const user = await t.prisma.user.create({
    data: {
      fadaId: `PHM${u}`.slice(0, 20),
      email: `owner.${u}@test.ng`,
      role: 'pharmacist',
      isActive: true,
      isEmailVerified: true,
    },
  });
  const pharmacy = await t.prisma.pharmacy.create({
    data: {
      fadaId: `PH${u}`.slice(0, 20),
      ownerId: user.id,
      name: opts.name ?? `Test Pharmacy ${u}`,
      state: 'Enugu',
      city: 'Enugu',
      isVerified: opts.verified ?? true,
      cacVerified: opts.verified ?? true,
      isActive: true,
      latitude: 6.4483,
      longitude: 7.5139,
    },
  });
  await t.prisma.pharmacistProfile.create({
    data: {
      userId: user.id,
      firstName: 'Obi',
      lastName: 'Nna',
      licenseType: 'PCN',
      licenseNumber: `L${u}`,
      pcnVerified: opts.verified ?? true,
      pharmacyId: pharmacy.id,
      roleInPharmacy: 'owner',
    },
  });
  const branch = await t.prisma.branch.create({
    data: {
      pharmacyId: pharmacy.id,
      name: 'Main',
      isHeadBranch: true,
      isActive: true,
      latitude: 6.4483,
      longitude: 7.5139,
    },
  });
  return {
    owner: { ...user, token: tokenFor(t, user) },
    pharmacyId: pharmacy.id,
    branchId: branch.id,
  };
}

export async function createDrug(
  t: TestApp,
  branchId: string,
  over: { name?: string; price?: number; stockAmount?: number } = {},
) {
  return t.prisma.drug.create({
    data: {
      branchId,
      name: over.name ?? `Drug ${uniq()}`,
      price: over.price ?? 1500,
      stockAmount: over.stockAmount ?? 25,
      stockStatus: (over.stockAmount ?? 25) > 0 ? 'in_stock' : 'out_of_stock',
    },
  });
}

export const bearer = (a: { token: string }) => ({
  Authorization: `Bearer ${a.token}`,
});
export const newId = () => randomUUID();
