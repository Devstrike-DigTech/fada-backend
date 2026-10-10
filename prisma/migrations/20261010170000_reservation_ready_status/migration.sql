-- The schema (and ReservationService) use the 'ready' status, but no earlier
-- migration created it. IF NOT EXISTS keeps this safe on databases that were
-- built with `prisma db push` and already have the value.
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'ready';
