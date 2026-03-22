/**
 * Minimal type declaration for passport-apple.
 * The package ships no bundled types and @types/passport-apple does not exist.
 */
declare module 'passport-apple' {
  import { Strategy as PassportStrategy } from 'passport';

  export interface AuthenticateOptions {
    clientID: string;
    teamID: string;
    keyID: string;
    privateKeyString?: string;
    privateKeyLocation?: string;
    callbackURL: string;
    scope?: string[];
    passReqToCallback?: boolean;
  }

  export class Strategy extends PassportStrategy {
    constructor(options: AuthenticateOptions, verify: (...args: unknown[]) => void);
    name: string;
    authenticate(req: unknown, options?: unknown): void;
  }
}
