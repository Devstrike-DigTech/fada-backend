/**
 * Named throttlers registered in AppModule. `@SkipThrottle()` without
 * arguments only skips a throttler called "default", so always pass this.
 */
export const SKIP_ALL_THROTTLERS = { short: true, medium: true } as const;
