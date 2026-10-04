# @momentumengineer/event-sourcing

Event sourcing building blocks: events, aggregates, command handlers and projections, with pluggable storage.

```sh
npm install @momentumengineer/event-sourcing
```

## Usage

```ts
import { AggregateRoot, CommandHandler, Event, EventStore, InMemoryEventStorage } from "@momentumengineer/event-sourcing";

type Incremented = Event<"Incremented", { by: number }>;
type Increment = { by: number };

class Counter extends AggregateRoot<Incremented, Increment> {
  count = 0;

  protected on(event: Incremented) {
    this.count += event.data.by;
  }

  handle(command: Increment) {
    if (this.count + command.by > 100) throw new Error("Counter cannot exceed 100");
    this.apply(new Event(this.id, "Incremented", { by: command.by }));
  }
}

const store = new EventStore<Incremented>({ storage: new InMemoryEventStorage(), aggregateType: "counter" });
const handler = new CommandHandler(store, (id) => new Counter(id));

await handler.handle("counter-1", { by: 2 });
```

`on` updates state, `apply` updates state and stages the event. The `CommandHandler` stores staged events once `handle` returns. Concurrent commands on the same aggregate throw a `ConcurrencyError`.

## Projections

Projections never block the event store. A `ProjectionRunner` keeps a position per projection; `catchUp()` processes the remaining events of every projection and returns. Events are processed in batches of `batchSize` (default 100), each in one transaction. If an event fails, its whole batch is rolled back and retried on the next `catchUp()`. When to call it is up to you: after a command, in a worker or from a scheduled job.

```ts
import { ProjectionRunner } from "@momentumengineer/event-sourcing";

const runner = new ProjectionRunner({
  storage,
  projections: [{ name: "counters", aggregateTypes: ["counter"], reset: async (tx) => {}, project: async (tx, event) => {} }],
});

await handler.handle("counter-1", { by: 2 });
await runner.catchUp();

await runner.states();
await runner.rebuild("counters");
```

`states()` returns per projection its position and, after a failure, `failedPosition`, `lastError` and `lastErrorAt`. Failures are also logged with `console.error`.

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
