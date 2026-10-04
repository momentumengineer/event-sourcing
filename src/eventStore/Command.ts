export abstract class Command {
  constructor(readonly aggregateId: string) {}
}
