/**
 * The minimum shape accepted by the event system. Domain-specific events can
 * add their own fields without weakening the dispatcher API.
 */
export interface DispatchEvent {
    type: string;
    detail?: unknown;
    target?: unknown;
    _stopped?: boolean;
    stopImmediatePropagation?: () => void;
}

export type EventListener<Event extends DispatchEvent = DispatchEvent> = (event: Event) => void;

export interface ListenerEntry {
    listener: EventListener;
    once: boolean;
}

export type ListenerMap = Record<string, ListenerEntry[]>;

function propagationStopped(event: DispatchEvent): boolean {
    return event._stopped === true;
}

/** Event object created when callers dispatch by event name. */
export class HiloEvent<Detail = unknown> implements DispatchEvent {
    readonly type: string;
    readonly target: unknown;
    readonly detail: Detail | undefined;
    _stopped = false;

    constructor(type: string, target: unknown, detail?: Detail) {
        this.type = type;
        this.target = target;
        this.detail = detail;
    }

    stopImmediatePropagation(): void {
        this._stopped = true;
    }
}

/** Native event base class used by engine classes. */
export class EventDispatcher {
    _listeners: ListenerMap | null = null;

    on(type: string, listener: EventListener, once = false): this {
        const listeners = this._listeners ?? (this._listeners = {});
        const eventListeners = listeners[type] ?? (listeners[type] = []);

        if (eventListeners.some(entry => entry.listener === listener)) {
            return this;
        }

        eventListeners.push({ listener, once });
        return this;
    }

    off(type?: string, listener?: EventListener): this {
        if (type === undefined) {
            this._listeners = null;
            return this;
        }

        const eventListeners = this._listeners?.[type];
        if (!eventListeners) return this;

        if (listener === undefined) {
            delete this._listeners?.[type];
            return this;
        }

        const index = eventListeners.findIndex(entry => entry.listener === listener);
        if (index >= 0) eventListeners.splice(index, 1);
        return this;
    }

    fire(typeOrEvent?: string | DispatchEvent, detail?: unknown): boolean {
        if (typeOrEvent === undefined) return false;

        const eventType = typeof typeOrEvent === 'string' ? typeOrEvent : typeOrEvent.type;
        const eventListeners = this._listeners?.[eventType];
        if (!eventListeners || eventListeners.length === 0) return false;

        const event =
            typeof typeOrEvent === 'string' ? new HiloEvent(eventType, this, detail) : typeOrEvent;
        if (propagationStopped(event)) return false;

        for (const entry of [...eventListeners]) {
            entry.listener.call(this, event);
            if (entry.once) {
                const index = eventListeners.indexOf(entry);
                if (index >= 0) eventListeners.splice(index, 1);
            }
            if (propagationStopped(event)) break;
        }

        return true;
    }
}
