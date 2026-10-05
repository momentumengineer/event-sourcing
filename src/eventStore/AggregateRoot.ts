import type { Command } from "./Command";
import type { Event } from "./Event";

const recorded = new WeakMap<object, Event[]>();

export abstract class AggregateRoot<E extends Event, C extends Command> {
  constructor(readonly id: string) {}

  abstract apply(event: E): void;

  abstract handle(command: C): void;

  protected record(event: E): void {
    this.apply(event);
    const events = recorded.get(this) ?? [];
    events.push(event);
    recorded.set(this, events);
  }
}

export function recordedEvents<E extends Event>(aggregate: AggregateRoot<E, Command>): E[] {
  return (recorded.get(aggregate) ?? []) as E[];
}
