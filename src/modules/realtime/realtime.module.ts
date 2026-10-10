import { Module } from '@nestjs/common';
import { RealtimeListener } from './realtime.listener';

/**
 * Bridges domain events to Socket.IO rooms. The gateway itself lives in the
 * global SocketModule (infrastructure); this module only decides what to
 * broadcast and to whom.
 */
@Module({
  providers: [RealtimeListener],
})
export class RealtimeModule {}
