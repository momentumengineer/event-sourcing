import type { Command } from "./Command";
import type { Event } from "./Event";

export abstract class AggregateRoot<E extends Event, C extends Command> {
  constructor(readonly id: string) {}

  abstract apply(event: E): void;

  abstract handle(command: C): E[];
}
