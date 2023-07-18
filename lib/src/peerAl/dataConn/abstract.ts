import { StickySubscribable, Subscribable } from "@teawithsand/tws-lts"
import { ManagedPeer } from "../peer"
import { TwsPeerError } from "../../error"

export class ManagedPeerDataConnectionTwsPeerError extends TwsPeerError {
	constructor(message: string) {
		super(message)
		this.name = "IDataConnTwsPeerError"
	}
}

export class ClosedManagedPeerDataConnectionTwsPeerError extends ManagedPeerDataConnectionTwsPeerError {
	constructor(message: string) {
		super(message)
		this.name = "ClosedManagedPeerDataConnectionTwsPeerError"
	}
}

export class UnknownManagedPeerDataConnectionTwsPeerError extends ManagedPeerDataConnectionTwsPeerError {
	constructor(message: string, public readonly cause: Error) {
		super(message)
		this.name = "UnknownManagedPeerDataConnectionTwsPeerError"
	}
}

export enum ManagedPeerDataConnectionEventType {
	OPEN = 1,
	CLOSE = 2,
	DATA = 3,
	ERROR = 4,
}

export type ManagedPeerDataConnectionState = {
	isOpen: boolean
	isClosed: boolean
	error: Error | null
}

export type ManagedPeerDataConnectionEvent = {
	conn: ManagedPeerDataConnection
} & (
	| {
			type: ManagedPeerDataConnectionEventType.OPEN
	  }
	| {
			type: ManagedPeerDataConnectionEventType.CLOSE
	  }
	| {
			type: ManagedPeerDataConnectionEventType.DATA

			/**
			 * Note: user still has to pop from queue in order to prevent memory leak.
			 * Thus, using this data is allowed, but it's preferred not to do so.
			 */
			data: any
	  }
	| {
			type: ManagedPeerDataConnectionEventType.ERROR
			error: Error
	  }
)

/**
 * Helper associated with data connection, which simplifies receiving messages.
 */
export interface ManagedPeerDataConnectionMessageQueue {
	readonly length: number
	pop: () => any | null

	/**
	 * This promise throws if conn is in closed/error state.
	 *
	 * It does not throw if connection is closed, but there are some messages yet to be received.
	 */
	receive: () => Promise<any>
}

/**
 * Abstraction layer over peerjs' data connection. It's supposed to be mockable in future.
 */
export interface ManagedPeerDataConnection {
	readonly peer: ManagedPeer
	readonly eventBus: Subscribable<ManagedPeerDataConnectionEvent>
	readonly stateBus: StickySubscribable<ManagedPeerDataConnectionState>
	readonly messageQueue: ManagedPeerDataConnectionMessageQueue

	/**
	 * Sends provided JS data to remote target.
	 *
	 * It's also allowed to enqueue messages to send until connection is open.
	 *
	 * Note: this function works on best-effort basis. If close is called too fast, it may not send
	 * message it was requested to send. There is no way to "flush" it in WebRTC standard.
	 *
	 * In order to close connection properly(having all messages sent), make sure that last call is
	 * call to receiving function, so that both parties may exchange end of conn magics and close connection safely.
	 */
	send: (data: any) => void

	close: () => void
}