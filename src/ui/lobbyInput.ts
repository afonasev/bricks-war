import { isLobbyHuman, type LobbySlot } from './lobbyState';

export const LOBBY_Y_HOLD_MS = 700;
export type LobbyMenuOwner = { kind: 'pointer' } | { kind: 'gamepad'; index: number; token: number };
export function ownsLobby(owner: LobbyMenuOwner, index: number, token: number): boolean {
  return owner.kind === 'gamepad' && owner.index === index && owner.token === token;
}
/** Skip human identities and in-flight drafts; bots exchange positions rather than disappear. */
export function nextLobbyPosition(slots: readonly LobbySlot[], current: number, reserved: ReadonlySet<number>): number {
  for (let step = 1; step < slots.length; step++) {
    const next = (current + step) % slots.length;
    if (!reserved.has(next) && !isLobbyHuman(slots[next]!)) return next;
  }
  return current;
}
/** A gesture is tied to a connection, not a slot. A held admission cannot become a second action. */
export class LobbyYGesture {
  private readonly held = new Map<number, { token: number; since: number; consumed: boolean }>();
  clear(): void { this.held.clear(); }
  retain(connections: ReadonlyMap<number, { token: number }>): void {
    for (const [index, state] of this.held) if (connections.get(index)?.token !== state.token) this.held.delete(index);
  }
  update(index: number, token: number, down: boolean, joined: boolean, now: number): 'join' | 'move' | 'edit' | null {
    let state = this.held.get(index);
    if (state?.token !== token) { this.held.delete(index); state = undefined; }
    if (!down) {
      this.held.delete(index);
      return state && !state.consumed && joined ? now - state.since >= LOBBY_Y_HOLD_MS ? 'edit' : 'move' : null;
    }
    if (!state) {
      this.held.set(index, { token, since: now, consumed: !joined });
      return joined ? null : 'join';
    }
    if (!state.consumed && now - state.since >= LOBBY_Y_HOLD_MS) {
      state.consumed = true;
      return 'edit';
    }
    return null;
  }
}
