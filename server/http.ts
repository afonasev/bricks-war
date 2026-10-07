import { isIP } from 'node:net';
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomService, RoomError, type Room, type Seat } from './rooms';
import { SnapshotPublisher } from './publication';
import { MAX_INPUT_BYTES, MAX_SNAPSHOT_BYTES, type ClientCommand } from '../src/network/protocol';

interface Link { socket: WebSocket; room: Room; seat: Seat; epoch: number; revision: number; snapshotAcks: boolean; outstanding: string[]; coalesced: boolean }
export interface CycleMetrics {durationMs:number;publicationMs:number;wireBytes:number;maxBufferedBytes:number;schedulerLagMs:number}
// This header is overwritten by our loopback reverse proxy. Never trust it on direct connections.
export function networkClientAddress(request: Pick<IncomingMessage, 'headers'> & {socket: Pick<IncomingMessage['socket'], 'remoteAddress'>}, trustProxy = false): string {
  const peer = request.socket.remoteAddress ?? 'unknown';
  const forwarded = request.headers['x-bricks-client-ip'];
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  return trustProxy && loopback && typeof forwarded === 'string' && isIP(forwarded) ? forwarded : peer;
}
export function createNetworkServer(service = new RoomService(), allowedOrigins: readonly string[] = [], observe?: (metrics:CycleMetrics)=>void, trustProxy = false) {
  const links = new Set<Link>();
  const rate = new Map<string, {start: number; count: number}>();
  const allow = (request: IncomingMessage) => request.headers.origin === `http://${request.headers.host}`
    || request.headers.origin === `https://${request.headers.host}` || allowedOrigins.includes(request.headers.origin ?? '');
  function throttle(key: string, limit: number, interval = 60_000) {
    const now = performance.now(); let entry = rate.get(key);
    if (!entry || now-entry.start >= interval) {entry = {start: now, count: 0}; rate.set(key, entry);}
    if (++entry.count > limit) throw new RoomError('rate', 'Слишком много запросов. Попробуйте позже.');
    if (rate.size > 5000) for (const [k,v] of rate) if (now-v.start > 60_000) rate.delete(k);
    if (rate.size > 10000) throw new RoomError('capacity', 'Сервис занят.');
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Content-Type', 'application/json; charset=utf-8');
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/network/')) {response.statusCode = 404; response.end('{}'); return;}
    try {
      throttle(`read:${networkClientAddress(request, trustProxy)}`, 3000);
      if (request.method === 'GET' && url.pathname === '/api/network/health') {
        response.end(JSON.stringify({ok: true, serviceId: service.serviceId, draining: service.draining})); return;
      }
      if (request.method === 'GET' && url.pathname === '/api/network/lobbies') {
        response.end(JSON.stringify(service.list(Number(url.searchParams.get('offset') ?? 0)))); return;
      }
      if (!allow(request)) throw new RoomError('origin', 'Недопустимый источник запроса.');
      if (request.method !== 'POST') throw new RoomError('method', 'Ожидается POST.');
      let body = ''; let size = 0;
      for await (const chunk of request) {size += chunk.length; if (size > MAX_INPUT_BYTES) throw new RoomError('size', 'Сообщение слишком большое.'); body += chunk;}
      const payload = JSON.parse(body);
      if (url.pathname === '/api/network/current') {
        const {room, seat} = service.authenticate(payload.credential);
        response.end(JSON.stringify(service.snapshot(room, seat))); return;
      }
      throttle(`write:${networkClientAddress(request, trustProxy)}`, 30);
      const credential = url.pathname === '/api/network/create'
        ? await service.create(payload.roomName, payload.name, payload.password ?? '', {rules:payload.rules, profile:payload.profile, bots:payload.bots})
        : url.pathname === '/api/network/join'
          ? await service.join(payload.roomId, payload.name, payload.password ?? '', payload.profile ?? {}) : null;
      if (!credential) throw new RoomError('endpoint', 'Неизвестный запрос.');
      response.end(JSON.stringify({credential}));
    } catch (error) {
      response.statusCode = error instanceof RoomError && error.code === 'rate' ? 429 : 400;
      response.end(JSON.stringify({error: error instanceof Error ? error.message : 'Некорректный запрос.', code: error instanceof RoomError ? error.code : 'message'}));
    }
  });
  const ws = new WebSocketServer({noServer: true, maxPayload: MAX_INPUT_BYTES, perMessageDeflate: {
    serverNoContextTakeover: true, clientNoContextTakeover: true, concurrencyLimit: 10,
    threshold: 1024, zlibDeflateOptions: {level: 3, memLevel: 7}
  }});
  const publisher=new SnapshotPublisher();
  let wireBytes=0;let publicationMs=0;let maxBufferedBytes=0;
  const observedEvents=new WeakMap<Room,number>();
  const pendingInputRooms=new Set<Room>();
  const nextPublication=new WeakMap<Room,number>();
  function publishRoom(room:Room,only?:Link) {
    const recipients=[...links].filter(l=>l.room===room&&(!only||l===only)&&l.socket.readyState===WebSocket.OPEN);
    if(!recipients.length)return;
    const eligible=recipients.filter(link=>{
      if(!link.seat.retained||!service.rooms.has(room.id)) {
        link.socket.send(JSON.stringify({type:'ended',message:'Место исключено или сессия завершена.'}));link.socket.close(1000);return false;
      }
      if(link.snapshotAcks&&link.outstanding.length>=4){link.coalesced=true;return false;}
      return link.socket.bufferedAmount<MAX_SNAPSHOT_BYTES*2;
    });
    if(!eligible.length)return;
    const started=performance.now();
    try {
      const publication=publisher.prepare(service,room);
      for(const link of eligible) {
        const manifest=publisher.manifest(publication,link.seat,link.snapshotAcks);
        // Reserve 14 bytes per WebSocket frame for transport framing. No per-client historical queue.
        if(link.socket.bufferedAmount+publication.wireBytes+Buffer.byteLength(manifest)+(publication.frames.length+1)*14>MAX_SNAPSHOT_BYTES*2)continue;
        link.socket.send(manifest);for(const frame of publication.frames)link.socket.send(frame);
        if(link.snapshotAcks)link.outstanding.push(publication.snapshotId);
        link.coalesced=false;
        link.revision=publication.revision;wireBytes+=publication.wireBytes+Buffer.byteLength(manifest);
        maxBufferedBytes=Math.max(maxBufferedBytes,link.socket.bufferedAmount);
      }
      observedEvents.set(room,room.eventSerial);
    }catch{for(const link of eligible)link.socket.close(1009,'Snapshot bound exceeded');}
    publicationMs+=performance.now()-started;
  }
  server.on('upgrade', (request, socket, head) => {
    try {
      throttle(`socket:${networkClientAddress(request, trustProxy)}`, 240);
      if (request.url !== '/network/socket' || !allow(request)) throw new RoomError('origin', 'Rejected');
      ws.handleUpgrade(request, socket, head, connection => ws.emit('connection', connection));
    } catch {socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy();}
  });
  ws.on('connection', socket => {
    let link: Link | null = null; let count = 0; let start = performance.now();
    const authTimeout = setTimeout(() => {if (!link) socket.close(1008, 'Authentication required');}, 5000);
    socket.on('error', () => {});
    socket.on('message', data => {
      try {
        const previousRevision=link?.room.revision;
        const now = performance.now(); if (now-start >= 1000) {start = now; count = 0;}
        if (++count > 120) throw new RoomError('rate', 'Слишком частый ввод.');
        const command = JSON.parse(data.toString()) as ClientCommand;
        if (!command || typeof command !== 'object') throw new RoomError('message', 'Некорректное сообщение.');
        if (!link) {
          if (command.type !== 'hello') throw new RoomError('auth', 'Требуется авторизация.');
          const connected = service.connect(command.credential, command.protocol, command.rulesVersion);
          for (const old of links) if (old.seat === connected.seat) {
            old.socket.send(JSON.stringify({type: 'replaced', message: 'Управление открыто в другой вкладке.'})); old.socket.close(1000);
          }
          link = {socket, ...connected, revision: -1, snapshotAcks: command.snapshotAcks===true, outstanding: [], coalesced: false}; links.add(link); clearTimeout(authTimeout);
        } else if(command.type==='ping') {
          if (Number.isFinite(command.nonce)) socket.send(JSON.stringify({type:'pong',nonce:command.nonce}));
          return;
        } else if(command.type==='snapshot-ack') {
          const index=link.outstanding.indexOf(command.snapshotId);
          if(index>=0){link.outstanding.splice(0,index+1);if(link.coalesced)publishRoom(link.room,link);}
          return;
        } else {
          service.command(link.room, link.seat, link.epoch, command);
          if(command.type==='input'&&link.seat.queue.length)pendingInputRooms.add(link.room);
        }
        // Significant changes publish immediately to every affected connection.
        if(command.type!=='input' && link.room.revision!==previousRevision && (command.type!=='heartbeat' || !command.visible || link.seat.awaitingRevision!==null))publishRoom(link.room);
      } catch (error) {
        socket.send(JSON.stringify({type: 'error', code: error instanceof RoomError ? error.code : 'message',
          message: error instanceof RoomError ? error.message : 'Некорректное сообщение.'}));
        if (!link || (error instanceof RoomError && ['rate','epoch','auth','ended','resync'].includes(error.code))) socket.close(1008);
      }
    });
    socket.on('close', () => {clearTimeout(authTimeout); if (link) {links.delete(link); service.disconnect(link.room,link.seat,link.epoch); publishRoom(link.room);}});
  });
  let previousCycle=performance.now();
  const step = setInterval(() => {
    const began=performance.now();const lag=Math.max(0,began-previousCycle-1000/60);previousCycle=began;
    const beforeInput=new Map([...pendingInputRooms].map(room=>[room,room.seats.map(seat=>`${seat.inputEpoch}:${seat.ack}`).join(',')]));
    service.advance();
    const rooms=new Set([...links].map(l=>l.room));
    for(const room of rooms) {
      const applied=beforeInput.has(room)&&beforeInput.get(room)!==room.seats.map(seat=>`${seat.inputEpoch}:${seat.ack}`).join(',');
      if(!room.seats.some(seat=>seat.queue.length))pendingInputRooms.delete(room);
      if(applied||began>=(nextPublication.get(room)??0)||observedEvents.get(room)!==room.eventSerial) {
        publishRoom(room);
        // Input and event publications replace the next periodic frame, rather than adding a near-duplicate.
        nextPublication.set(room,began+50);
      }
    }
    for(const room of pendingInputRooms)if(!service.rooms.has(room.id))pendingInputRooms.delete(room);
    observe?.({durationMs:performance.now()-began,publicationMs,wireBytes,maxBufferedBytes,schedulerLagMs:lag});
    publicationMs=0;wireBytes=0;maxBufferedBytes=0;
  }, 1000/60);
  const close = async () => {
    clearInterval(step);
    for (const link of links) {link.socket.send(JSON.stringify({type:'ended',message:'Сервис перезапущен. Этот матч завершён.'})); link.socket.close();}
    for (const client of ws.clients) client.terminate();
    ws.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  };
  return {server, service, close};
}
