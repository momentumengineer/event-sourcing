import type { Event } from "./Event";
import type { EventStore } from "./EventStore";
import type { Projection } from "./Projection";

export async function rebuildProjections<E extends Event, Tx>(
  store: EventStore<E, Tx>,
  projections: Projection<E, Tx>[],
): Promise<void> {
  const events = await store.loadAllEvents();
  await store.storage.transaction(async (tx) => {
    for (const projection of projections) await projection.reset(tx);
    for (const event of events) {
      for (const projection of projections) await projection.project(tx, event);
    }
  });
}
