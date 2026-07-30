import { Global, Module } from "@nestjs/common";
import { EVENT_BUS } from "./event-bus.port";
import { InProcessEventBus } from "./in-process-event-bus";

/**
 * Global event-bus module (EPIC-6, ADR-0004). Binds the {@link EVENT_BUS} port
 * to the {@link InProcessEventBus} and exports it so any feature module can
 * `@Inject(EVENT_BUS)` to publish or subscribe without importing this module.
 * One instance per process, matching the synchronous in-process dispatch model.
 */
@Global()
@Module({
  providers: [InProcessEventBus, { provide: EVENT_BUS, useExisting: InProcessEventBus }],
  exports: [EVENT_BUS],
})
export class EventBusModule {}
