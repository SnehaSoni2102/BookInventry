import { EventEmitter } from 'node:events';
import { Global, Injectable, Module } from '@nestjs/common';

export interface DomainEvent {
  name: string;
  payload: Record<string, unknown>;
  /** Socket.IO rooms to deliver to (see 02 §6.9). */
  rooms?: string[];
}

/** In-process bus. The realtime gateway (M8) subscribes; services publish after commit. */
@Injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();
  readonly published: DomainEvent[] = [];

  publish(event: DomainEvent): void {
    if (this.published.length < 1000) this.published.push(event);
    this.emitter.emit('event', event);
  }

  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }
}

@Global()
@Module({ providers: [EventBus], exports: [EventBus] })
export class EventBusModule {}
