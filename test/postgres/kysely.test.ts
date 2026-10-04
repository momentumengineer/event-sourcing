import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { CommandHandler, ConcurrencyError, Event, EventStore, type Projection, ProjectionRunner } from "../../src";
import { createEventTable, createProjectionStateTable, KyselyEventStorage } from "../../src/kysely";
import { Counter, type CounterCommand, type CounterEvent, Incremented, increment } from "../fixtures";

interface Database {
  counter_total: { id: string; total: number };
}

let container: StartedPostgreSqlContainer;
let db: Kysely<Database>;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  db = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: container.getConnectionUri() }) }),
  });
  await createEventTable(db);
  await createProjectionStateTable(db);
  await db.schema
    .createTable("counter_total")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("total", "integer", (col) => col.notNull())
    .execute();
});

afterAll(async () => {
  await db?.destroy();
  await container?.stop();
});

beforeEach(async () => {
  await sql`truncate event, projection_state, counter_total restart identity`.execute(db);
});

function setup(database: Kysely<Database> = db) {
  const storage = new KyselyEventStorage(database);
  const store = new EventStore<CounterEvent, Transaction<Database>>({ storage, aggregateType: "counter" });
  const handler = new CommandHandler(store, (command: CounterCommand) => new Counter(command.aggregateId));
  return { storage, store, handler };
}

const totals: Projection<CounterEvent, Transaction<Database>> = {
  name: "totals",
  reset: async (trx) => {
    await trx.deleteFrom("counter_total").execute();
  },
  project: async (trx, event) => {
    if (event.type !== "Incremented") return;
    await trx
      .insertInto("counter_total")
      .values({ id: event.aggregateId, total: event.data.by })
      .onConflict((oc) => oc.column("id").doUpdateSet((eb) => ({ total: eb("counter_total.total", "+", event.data.by) })))
      .execute();
  },
};

async function total(id: string) {
  const row = await db.selectFrom("counter_total").select("total").where("id", "=", id).executeTakeFirst();
  return row?.total;
}

describe("KyselyEventStorage", () => {
  it("stores and loads events with versions, metadata and dates", async () => {
    const { store, handler } = setup();
    const at = new Date("2026-05-01T12:00:00Z");
    await handler.handle(increment("c1", 2));
    await store.append([new Event("c1", "Incremented", { by: 3, at }, { metadata: { user: "u1", at } })], {
      expectedVersion: 1,
    });

    const events = await store.loadAggregate("c1");

    expect(events.map((e) => [e.version, e.type])).toEqual([
      [1, "Incremented"],
      [2, "Incremented"],
    ]);
    expect(events[1].data).toEqual({ by: 3, at });
    expect(events[1].metadata).toEqual({ user: "u1", at });
    expect(events[1].createdAt).toBeInstanceOf(Date);
  });

  it("throws a ConcurrencyError when the expected version is stale", async () => {
    const { store, handler } = setup();
    await handler.handle(increment("c1", 1));
    await handler.handle(increment("c1", 1));

    await expect(store.append([new Incremented("c1", 1)], { expectedVersion: 1 })).rejects.toBeInstanceOf(
      ConcurrencyError,
    );
  });

  it("lets only one of two concurrent commands on the same aggregate succeed", async () => {
    const { store, handler } = setup();
    await handler.handle(increment("c1", 1));

    const results = await Promise.allSettled([
      store.append([new Incremented("c1", 1)], { expectedVersion: 1 }),
      store.append([new Incremented("c1", 1)], { expectedVersion: 1 }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ConcurrencyError);
    expect(await store.loadAggregate("c1")).toHaveLength(2);
  });

  it("does not report a duplicate event id as a ConcurrencyError", async () => {
    const { store } = setup();
    await store.append([new Incremented("c1", 1, { id: "00000000-0000-0000-0000-000000000001" })]);

    const duplicate = store.append([new Incremented("c2", 1, { id: "00000000-0000-0000-0000-000000000001" })]);

    await expect(duplicate).rejects.toThrow();
    await expect(duplicate).rejects.not.toBeInstanceOf(ConcurrencyError);
  });

  it("appends inside a given transaction and rolls back with it", async () => {
    const { store } = setup();

    await db.transaction().execute(async (trx) => {
      await setup(trx).store.append([new Incremented("c1", 1)]);
    });
    await expect(
      db.transaction().execute(async (trx) => {
        await setup(trx).store.append([new Incremented("c2", 1)]);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    expect(await store.loadAggregate("c1")).toHaveLength(1);
    expect(await store.loadAggregate("c2")).toHaveLength(0);
  });
});

describe("ProjectionRunner with Kysely", () => {
  let consoleError: MockInstance;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("projects events and stores its position", async () => {
    const { storage, handler } = setup();
    await handler.handle(increment("c1", 2));
    await handler.handle(increment("c1", 3));

    await new ProjectionRunner({ storage, projections: [totals] }).catchUp();

    expect(await total("c1")).toBe(5);
    expect(await storage.getProjectionState("totals")).toMatchObject({ position: 2, lastError: null });
  });

  it("rolls back a failing batch, stores the error and recovers on the next catch up", async () => {
    const { storage, handler } = setup();
    for (const by of [1, 2, 3]) await handler.handle(increment("c1", by));
    let broken = true;
    const flaky: Projection<CounterEvent, Transaction<Database>> = {
      ...totals,
      project: async (trx, event) => {
        await totals.project(trx, event);
        if (broken && event.type === "Incremented" && event.data.by === 2) throw new Error("boom");
      },
    };
    const runner = new ProjectionRunner({ storage, projections: [flaky] });

    await runner.catchUp();

    expect(await total("c1")).toBeUndefined();
    const failed = await storage.getProjectionState("totals");
    expect(failed).toMatchObject({ position: 0, failedPosition: 2 });
    expect(failed.lastError).toContain("boom");
    expect(failed.lastErrorAt).toBeInstanceOf(Date);
    expect(consoleError).toHaveBeenCalled();

    broken = false;
    await runner.catchUp();

    expect(await total("c1")).toBe(6);
    expect(await storage.getProjectionState("totals")).toMatchObject({
      position: 3,
      failedPosition: null,
      lastError: null,
      lastErrorAt: null,
    });
  });

  it("waits for events of transactions that are still open, so none are skipped", async () => {
    const { storage } = setup();
    const runner = new ProjectionRunner({ storage, projections: [totals] });

    await db.transaction().execute(async (trx) => {
      await setup(trx).store.append([new Incremented("slow", 1)]);
      await setup().store.append([new Incremented("fast", 1)]);

      await runner.catchUp();

      expect(await total("fast")).toBeUndefined();
      expect((await storage.getProjectionState("totals")).position).toBe(0);
    });

    await runner.catchUp();

    expect(await total("slow")).toBe(1);
    expect(await total("fast")).toBe(1);
  });

  it("rebuilds a projection", async () => {
    const { storage, handler } = setup();
    await handler.handle(increment("c1", 2));
    await handler.handle(increment("c1", 3));
    const runner = new ProjectionRunner({ storage, projections: [totals] });
    await runner.catchUp();
    await db.updateTable("counter_total").set({ total: 999 }).execute();

    await runner.rebuild("totals");

    expect(await total("c1")).toBe(5);
  });
});
