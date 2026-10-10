import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  activeSecrets,
  verifyWithRotation,
} from '@common/security/jwt-rotation';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '@infra/database/prisma.service';
import { SocketAuthService, SocketUser } from './socket-auth.service';
import { parseRoom, rooms } from './socket-rooms';

const MAX_ROOMS_PER_SOCKET = 50;
const SUBSCRIBE_LIMIT_PER_MINUTE = 60;

interface SocketData {
  user: SocketUser;
  subscribeWindowStart: number;
  subscribeCount: number;
}

type AckResult =
  | { ok: true; room: string }
  | { ok: false; room?: unknown; error: string };

/**
 * Authenticated Socket.IO gateway.
 *
 *  • Handshake: access JWT in `auth.token`, `Authorization: Bearer …`, or `?token=`.
 *    Invalid / missing tokens and deactivated accounts are refused before the
 *    connection opens (the client gets `connect_error`).
 *  • Personal rooms are joined automatically; everything else via
 *    `subscribe` / `unsubscribe` with an acknowledgement, after an
 *    authorization check (SocketAuthService).
 *  • CORS and the Redis adapter are configured in RedisIoAdapter.
 */
@WebSocketGateway({ namespace: '/' })
export class SocketGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly auth: SocketAuthService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticate(socket)
        .then((user) => {
          (socket.data as SocketData) = {
            user,
            subscribeWindowStart: Date.now(),
            subscribeCount: 0,
          };
          next();
        })
        .catch((err: Error) => next(new Error(err.message || 'unauthorized')));
    });
    this.logger.log('WebSocket gateway initialised (JWT handshake auth)');
  }

  async handleConnection(client: Socket): Promise<void> {
    const { user } = client.data as SocketData;
    const auto = [rooms.user(user.id)];
    if (user.role === 'customer')
      auto.push(rooms.customerReservations(user.id));
    if (user.role === 'admin') auto.push(rooms.adminFeed());
    await client.join(auto);
    client.emit('ready', { userId: user.id, rooms: auto });
    this.logger.debug(
      `Socket ${client.id} connected as ${user.role} ${user.id}`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Socket ${client.id} disconnected`);
  }

  // ─── Client → server ─────────────────────────────────────────────────────────

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: unknown } | string,
  ): Promise<AckResult> {
    const raw = typeof body === 'string' ? body : body?.room;
    const data = client.data as SocketData;

    if (!this.withinRateLimit(data))
      return { ok: false, room: raw, error: 'rate_limited' };

    const room = parseRoom(raw);
    if (!room) return { ok: false, room: raw, error: 'unknown_room' };
    if (client.rooms.has(room.name)) return { ok: true, room: room.name };
    if (client.rooms.size > MAX_ROOMS_PER_SOCKET)
      return { ok: false, room: raw, error: 'too_many_rooms' };

    let allowed = false;
    try {
      allowed = await this.auth.canJoin(data.user, room);
    } catch (err) {
      this.logger.warn(
        `Room check failed for ${room.name}: ${(err as Error).message}`,
      );
      return { ok: false, room: raw, error: 'check_failed' };
    }
    if (!allowed) return { ok: false, room: raw, error: 'forbidden' };

    await client.join(room.name);
    return { ok: true, room: room.name };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: unknown } | string,
  ): Promise<AckResult> {
    const raw = typeof body === 'string' ? body : body?.room;
    const room = parseRoom(raw);
    if (!room) return { ok: false, room: raw, error: 'unknown_room' };
    await client.leave(room.name);
    return { ok: true, room: room.name };
  }

  // ─── Server → client (used by RealtimeModule and notifications) ─────────────

  emitToUser(userId: string, event: string, data: unknown): void {
    this.emitToRooms([rooms.user(userId)], event, data);
  }

  emitToRoom(room: string, event: string, data: unknown): void {
    this.emitToRooms([room], event, data);
  }

  /** One delivery per socket even when it is in several of the rooms. */
  emitToRooms(roomNames: string[], event: string, data: unknown): void {
    if (!this.server || roomNames.length === 0) return;
    this.server.to(roomNames).emit(event, data);
  }

  // ─── Internals ───────────────────────────────────────────────────────────────

  private async authenticate(socket: Socket): Promise<SocketUser> {
    const authToken = (socket.handshake.auth as { token?: unknown } | undefined)
      ?.token;
    const header = socket.handshake.headers?.authorization;
    const query = socket.handshake.query?.token;
    const token =
      (typeof authToken === 'string' && authToken) ||
      (typeof header === 'string' &&
        header.startsWith('Bearer ') &&
        header.slice(7)) ||
      (typeof query === 'string' && query) ||
      '';
    if (!token) throw new Error('missing_token');

    let payload: { sub: string; role: string };
    try {
      payload = verifyWithRotation<{ sub: string; role: string }>(
        this.jwtService,
        token,
        activeSecrets(
          this.config.get<string>('jwt.accessSecret'),
          this.config.get<string>('jwt.accessSecretPrevious'),
        ),
      );
    } catch {
      throw new Error('invalid_token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) throw new Error('account_inactive');
    return { id: user.id, role: user.role };
  }

  private withinRateLimit(data: SocketData): boolean {
    const now = Date.now();
    if (now - data.subscribeWindowStart > 60_000) {
      data.subscribeWindowStart = now;
      data.subscribeCount = 0;
    }
    data.subscribeCount++;
    return data.subscribeCount <= SUBSCRIBE_LIMIT_PER_MINUTE;
  }
}
