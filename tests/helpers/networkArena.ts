import type { RoomService, Room, Seat } from '../../server/rooms';

/** Simulate first-render/loading completion in headless service consumers. */
export function startPreparedMatch(service: RoomService, room: Room, seat: Seat, epoch: number): void {
  service.command(room, seat, epoch, {type:'start'});
  for (const participant of room.seats.filter(s => s.kind === 'human' && s.retained)) {
    service.command(room, participant, participant.connectionEpoch, {type:'arena-prepared', matchId:room.matchId!});
  }
}
