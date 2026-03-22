import { SetMetadata } from '@nestjs/common';

export enum UserRole {
  CUSTOMER = 'customer',
  PHARMACIST = 'pharmacist',
  ADMIN = 'admin',
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
