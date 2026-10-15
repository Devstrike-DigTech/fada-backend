import { Job } from 'bull';
import { PcnVerificationProcessor } from './pcn-verification.processor';
import { PrismaService } from '@infra/database/prisma.service';
import { EventBusService } from '@infra/events/event-bus.service';
import { PcnRegistryService } from '@infra/registries/pcn-registry.service';
import { EVENTS } from '@common/types/events.types';

/**
 * The registry lookup is slow and runs in the background. An admin can
 * approve the licence while it runs; the job must never undo that.
 */
function setup(opts: { found: boolean; verifiedDuringLookup: boolean }) {
  let verified = false;
  const prisma = {
    pharmacistProfile: {
      findUnique: jest.fn(({ select }: { select?: unknown }) =>
        Promise.resolve(
          select
            ? { pcnVerified: verified }
            : {
                userId: 'u1',
                firstName: 'Emeka',
                pcnVerified: false,
                user: { email: 'emeka@fada.test' },
              },
        ),
      ),
      updateMany: jest.fn(({ where }: { where: { pcnVerified: boolean } }) => {
        const hit = where.pcnVerified === verified;
        if (hit) verified = true;
        return Promise.resolve({ count: hit ? 1 : 0 });
      }),
      update: jest.fn(),
    },
  };
  const registry = {
    lookupLicense: jest.fn(() => {
      if (opts.verifiedDuringLookup) verified = true; // admin approves meanwhile
      return Promise.resolve({ found: opts.found });
    }),
  };
  const events = { emit: jest.fn() };
  const processor = new PcnVerificationProcessor(
    prisma as unknown as PrismaService,
    events as unknown as EventBusService,
    registry as unknown as PcnRegistryService,
  );
  const job = {
    data: { pharmacistId: 'u1', licenseNumber: 'PCN-1' },
  } as unknown as Job;
  return { processor, job, prisma, events, isVerified: () => verified };
}

describe('PcnVerificationProcessor', () => {
  it('keeps an admin approval made while the registry had no match', async () => {
    const s = setup({ found: false, verifiedDuringLookup: true });
    await s.processor.processPcnVerification(s.job as never);
    expect(s.isVerified()).toBe(true);
    expect(s.prisma.pharmacistProfile.update).not.toHaveBeenCalled();
    expect(s.events.emit).not.toHaveBeenCalledWith(
      EVENTS.PHARMACY.PCN_VERIFICATION_FAILED,
      expect.anything(),
    );
  });

  it('verifies when the registry finds the licence', async () => {
    const s = setup({ found: true, verifiedDuringLookup: false });
    await s.processor.processPcnVerification(s.job as never);
    expect(s.isVerified()).toBe(true);
    expect(s.events.emit).toHaveBeenCalledWith(
      EVENTS.PHARMACY.PCN_VERIFICATION_COMPLETED,
      expect.objectContaining({ isValid: true }),
    );
  });

  it('does not announce again when an admin got there first', async () => {
    const s = setup({ found: true, verifiedDuringLookup: true });
    await s.processor.processPcnVerification(s.job as never);
    expect(s.events.emit).not.toHaveBeenCalled();
  });

  it('reports a miss when nobody verified it', async () => {
    const s = setup({ found: false, verifiedDuringLookup: false });
    await s.processor.processPcnVerification(s.job as never);
    expect(s.isVerified()).toBe(false);
    expect(s.events.emit).toHaveBeenCalledWith(
      EVENTS.PHARMACY.PCN_VERIFICATION_FAILED,
      expect.objectContaining({ isValid: false }),
    );
  });
});
