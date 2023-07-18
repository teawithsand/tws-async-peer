import { StickySubscribable, Subscribable } from "@teawithsand/tws-lts"
import { MediaConnection } from "peerjs"
import { ManagedPeerDataConnection } from "../dataConn"

/**
 * State of peer.
 */
export type ManagedPeerState = {
	/**
	 * If true, this peer can open and receive connections.
	 * One has to wait for this event in order to make/receiver connections.
	 */
	isReady: boolean
	isActive: boolean
	/**
	 * Set to true, when inner peer was closed.
	 * It may be closed externally(although it shouldn't) but here is a way to check that.
	 *
	 * When it's set, isReady is also false.
	 */
	isClosed: boolean
	error: Error | null

	/**
	 * ID of this peer, if any.
	 */
	id: string | null

	config: ManagedPeerConfig
}

export type ManagedPeerConfig = {
	/**
	 * If true, then incoming data connections won't be automatically closed.
	 */
	acceptDataConnections?: boolean

	/**
	 * If true, then incoming media connections won't be automatically closed.
	 */
	acceptMediaConnections?: boolean
}

/**
 * Type of ManagedPeerEvent.
 */
export enum ManagedPeerEventType {
	ERROR = 1,
	MEDIA_CONN = 2,
	DATA_CONN = 3,
	DISCONNECT = 4,
	CLOSE = 5,
	OPEN = 6,
	ACTIVATE = 7,
	DEACTIVATE = 8,
}

/**
 * Any event that peer may send.
 */
export type ManagedPeerEvent = {
	peer: ManagedPeer
} & (
	| {
			type: ManagedPeerEventType.ERROR
			error: Error
	  }
	| {
			type: ManagedPeerEventType.DATA_CONN
			conn: ManagedPeerDataConnection
	  }
	| {
			type: ManagedPeerEventType.DISCONNECT
	  }
	| {
			type: ManagedPeerEventType.MEDIA_CONN
			conn: MediaConnection // FIXME(teawithsand): do not return raw media conn, but wrapper over it.
	  }
	| {
			type: ManagedPeerEventType.CLOSE
	  }
	| {
			type: ManagedPeerEventType.OPEN
			id: string
	  }
	| {
			type: ManagedPeerEventType.ACTIVATE
	  }
	| {
			type: ManagedPeerEventType.DEACTIVATE
	  }
)

/**
 * Abstraction layer over peerjs' peer. It's supposed to be mockable in future.
 * 
 * It's called ManagedPeer rather than Peer in order not to generate name collision with peerjs.
 */
export interface ManagedPeer {
	readonly eventBus: Subscribable<ManagedPeerEvent>
	readonly stateBus: StickySubscribable<ManagedPeerState>

	setConfig: (config: ManagedPeerConfig) => void
	updateConfig: (
		callback: (oldConfig: Readonly<ManagedPeerConfig>) => ManagedPeerConfig
	) => void
	connect: (remoteId: string) => Promise<ManagedPeerDataConnection>
	close: () => void
}