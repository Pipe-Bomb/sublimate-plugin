import EventEmitter from "events";

type EventId = "destroy";

export class SearchClientPayload {
	private readonly eventEmitter = new EventEmitter();
	private isDestroyed = false;

	destroy() {
		this.emit("destroy");
		this.isDestroyed = true;
		this.eventEmitter.removeAllListeners();
	}

	private emit(eventId: EventId) {
		this.eventEmitter.emit(eventId);
	}

	on(eventId: EventId, callback: () => void) {
		if (this.isDestroyed) {
			throw new Error("Payload is destroyed");
		}
		this.eventEmitter.on(eventId, callback);
	}

	off(eventId: EventId, callback: () => void) {
		this.eventEmitter.off(eventId, callback);
	}
}
