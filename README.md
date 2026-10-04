# @momentumengineer/event-sourcing

Event sourcing building blocks: events, aggregates, command handlers and projections, with pluggable storage.

```sh
npm install @momentumengineer/event-sourcing
```

## Usage

```ts
import { AggregateRoot, Command, CommandHandler, Event, EventStore, InMemoryEventStorage } from "@momentumengineer/event-sourcing";

class Incremented extends Event<"Incremented", { by: number }> {
  constructor(aggregateId: string, by: number) {
    super(aggregateId, "Incremented", { by });
  }
}

class Increment extends Command {
  constructor(aggregateId: string, readonly by: number) {
    super(aggregateId);
  }
}

class Counter extends AggregateRoot<Incremented, Increment> {
  count = 0;

  apply(event: Incremented) {
    this.count += event.data.by;
  }

  handle(command: Increment) {
    if (this.count + command.by > 100) throw new Error("Counter cannot exceed 100");
    return [new Incremented(this.id, command.by)];
  }
}

const store = new EventStore<Incremented>({ storage: new InMemoryEventStorage(), aggregateType: "counter" });
const handler = new CommandHandler(store, (command: Increment) => new Counter(command.aggregateId));

await handler.handle(new Increment("counter-1", 2));
```

Commands extend `Command`; an aggregate with several commands tells them apart with `instanceof`. Events extend `Event` with only a constructor: loaded events are plain `Event` objects, so `apply` and projections switch on `event.type`. Concurrent commands on the same aggregate throw a `ConcurrencyError`.

## Projections

Projections never block the event store. A `ProjectionRunner` keeps a position per projection; `catchUp()` processes the remaining events of every projection and returns. Events are processed in batches of `batchSize` (default 100), each in one transaction. If an event fails, its whole batch is rolled back and retried on the next `catchUp()`. When to call it is up to you: after a command, in a worker or from a scheduled job.

```ts
import { ProjectionRunner } from "@momentumengineer/event-sourcing";

const runner = new ProjectionRunner({
  storage,
  projections: [{ name: "counters", aggregateTypes: ["counter"], reset: async (tx) => {}, project: async (tx, event) => {} }],
});

await handler.handle(new Increment("counter-1", 2));
await runner.catchUp();

await runner.rebuild("counters");
```

Failures are logged with `console.error` and stored with the projection's position as `failedPosition`, `lastError` and `lastErrorAt`.

## Kysely (PostgreSQL)

```ts
import { createEventTable, createProjectionStateTable, KyselyEventStorage } from "@momentumengineer/event-sourcing/kysely";

await createEventTable(db);
await createProjectionStateTable(db);
const storage = new KyselyEventStorage(db);
```

Projections receive the Kysely transaction in which their position is saved. Pass a transaction to `new KyselyEventStorage(trx)` to append events as part of it. Requires PostgreSQL 13 or newer.

## License

MIT
