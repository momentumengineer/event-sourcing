import { AggregateRoot, CommandHandler, Event, EventStore, InMemoryEventStorage } from "../src";

export type Incremented = Event<"Incremented", { by: number }>;
export type Increment = { by: number };

export class Counter extends AggregateRoot<Incremented, Increment> {
  count = 0;

  apply(event: Incremented) {
    this.count += event.data.by;
  }

  handle(command: Increment) {
    if (this.count + command.by > 10) throw new Error("Counter cannot exceed 10");
    return [new Event(this.id, "Incremented", { by: command.by })];
  }
}

export function setup(storage = new InMemoryEventStorage()) {
  const store = new EventStore<Incremented, undefined>({ storage, aggregateType: "counter" });
  const handler = new CommandHandler(store, (id) => new Counter(id));
  return { storage, store, handler };
}
