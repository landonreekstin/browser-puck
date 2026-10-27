import { randomInt } from "node:crypto";
import type { Config } from "@puck/shared";
import { Room } from "./room";

// No I/O/0/1 lookalikes in codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export class Rooms {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly cfg: Config,
    private readonly now: () => number,
  ) {}

  create(): Room {
    let code: string;
    do {
      code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, this.cfg, this.now);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  update(): void {
    for (const [code, room] of this.rooms) {
      room.update();
      if (room.isEmpty()) this.rooms.delete(code);
    }
  }

  get size(): number {
    return this.rooms.size;
  }
}
