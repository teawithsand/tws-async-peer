import Peer, { PeerJSOption } from "peerjs"
import { ManagedPeer, ManagedPeerConfig, ManagedPeerEvent, ManagedPeerEventType, ManagedPeerState } from "./abstract"
import { DefaultEventBus, DefaultStickyEventBus, StickySubscribable, Subscribable, SubscriptionCanceler, generateUUID, latePromise, throwExpression } from "@teawithsand/tws-lts"
import { PeerEventType, makePeerBus } from "../../peerJsAl"
import { ManagedPeerDataConnection, ManagedPeerJSDataConnection } from "../dataConn"

/**
 * ManagedPeer implementation, which uses PeerJS peer.
 */
export class ManagedPeerJS implements ManagedPeer {
	private innerPeer: Peer | null = null
	private innerPeerBusSubscriptionCanceler: SubscriptionCanceler | null = null

	private readonly innerEventBus = new DefaultEventBus<ManagedPeerEvent>()
	private readonly innerConfigBus = new DefaultStickyEventBus<ManagedPeerConfig>({})
	private readonly innerStateBus = new DefaultStickyEventBus<ManagedPeerState>({
		isReady: false,
		isActive: false,
		isClosed: false,
		error: null,
		config: this.innerConfigBus.lastEvent,
		id: null,
	})

	constructor() {
		this.innerConfigBus.addSubscriber((config) => {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				config,
			})
		})
	}

	get eventBus(): Subscribable<ManagedPeerEvent> {
		return this.innerEventBus
	}
	get stateBus(): StickySubscribable<ManagedPeerState> {
		return this.innerStateBus
	}

	private innerHandleEvent = (event: ManagedPeerEvent) => {
		if (event.type === ManagedPeerEventType.ACTIVATE) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				isActive: true,
			})
		} else if (event.type === ManagedPeerEventType.DEACTIVATE) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				isActive: false,
				isReady: false,
				isClosed: false,
				id: null,
				error: null,
			})
		} else if (event.type === ManagedPeerEventType.OPEN) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				isActive: true,
				isReady: true,
				id: event.id,
			})
		} else if (event.type === ManagedPeerEventType.CLOSE) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				isReady: false,
				isClosed: true,
			})
		} else if (event.type === ManagedPeerEventType.ERROR) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				error: event.error,
				isReady: false,
			})
		}
		/**
		else if (event.type === IPeerEventType.DISCONNECT) {
			this.innerStateBus.emitEvent({
				...this.innerStateBus.lastEvent,
				isReady: false,
			})
		}
		*/

		this.innerEventBus.emitEvent(event)
	}

	/**
	 * Inner PeerJS config to use.
	 * If null, then internally peer is not created and IPeer is not active and can't be used.
	 *
	 * Please note that each call to this function causes peer to restart.
	 */
	setPeerJsConfig = (config: PeerJSOption | null, id?: string) => {
		const tearDown = () => {
			if (!this.innerPeer) return

			this.innerPeer.destroy()
			this.innerHandleEvent({
				type: ManagedPeerEventType.DEACTIVATE,
				peer: this,
			})

			if (this.innerPeerBusSubscriptionCanceler) {
				this.innerPeerBusSubscriptionCanceler()
				this.innerPeerBusSubscriptionCanceler = null
			}

			this.innerPeer = null
		}

		if (config === null) {
			tearDown()
		} else {
			tearDown()
			const idToUse = id || generateUUID()
			const peer = new Peer(idToUse, config)
			this.innerPeer = peer

			this.innerHandleEvent({
				type: ManagedPeerEventType.ACTIVATE,
				peer: this,
			})

			const bus = makePeerBus(peer)

			const handleEvent = this.innerHandleEvent

			const unsubscribe = bus.addSubscriber((event) => {
				const config = this.innerConfigBus.lastEvent

				if (event.type === PeerEventType.OPEN) {
					handleEvent({
						type: ManagedPeerEventType.OPEN,
						peer: this,
						id: event.peer.id,
					})
				} else if (event.type === PeerEventType.CONNECT) {
					if (!config.acceptDataConnections) {
						try {
							event.conn.close()
						} catch (e) {
							console.error(
								"PeerJSIPeer: Filed to close not accepted data connection",
								e
							)
						}
					} else {
						handleEvent({
							type: ManagedPeerEventType.DATA_CONN,
							peer: this,
							conn: new ManagedPeerJSDataConnection(this, event.conn),
						})
					}
				} else if (event.type === PeerEventType.CALL) {
					if (!config.acceptMediaConnections) {
						try {
							event.call.close()
						} catch (e) {
							console.error(
								"PeerJSIPeer: Filed to close not accepted media connection",
								e
							)
						}
					} else {
						handleEvent({
							type: ManagedPeerEventType.MEDIA_CONN,
							peer: this,
							conn: event.call, // FIXME(teawithsand): it wont work like that
						})
					}
				} else if (event.type === PeerEventType.CLOSE) {
					handleEvent({
						type: ManagedPeerEventType.CLOSE,
						peer: this,
					})
				} else if (event.type === PeerEventType.ERROR) {
					handleEvent({
						type: ManagedPeerEventType.ERROR,
						peer: this,
						error: event.error,
					})
				}
				/*
				// For now ignore disconnect event
				if (event.type === PeerEventType.DISCONNECT) {
					handleEvent({
						type: IPeerEventType.DISCONNECT,
						peer: this,
					})
				}
				*/
			})
			this.innerPeerBusSubscriptionCanceler = () => {
				bus.close()
				unsubscribe()
			}
		}
	}

	setConfig = (config: ManagedPeerConfig) => {
		this.innerConfigBus.emitEvent(config)
	}

	updateConfig = (
		callback: (oldConfig: Readonly<ManagedPeerConfig>) => ManagedPeerConfig
	) => {
		this.innerConfigBus.emitEvent(callback(this.innerConfigBus.lastEvent))
	}

	connect = async (remoteId: string): Promise<ManagedPeerDataConnection> => {
		const state = this.innerStateBus.lastEvent

		if (state.error) throw state.error

		if (!state.isActive)
			throw new Error("Can't open new connection, as peer is not active")

		if (!state.isReady) {
			const [promise, resolve, reject] = latePromise<void>()

			this.innerStateBus.addSubscriber((state, unsubscribe) => {
				if (state.error) {
					reject(state.error)
				} else if (!state.isActive) {
					reject(
						new Error(
							"Can't open new connection, as peer is not active"
						)
					)
					unsubscribe()
				} else if (state.isReady) {
					resolve()
					unsubscribe()
				}
			})

			await promise
		}

		const conn = (
			this.innerPeer ?? throwExpression(new Error("Unreachable code"))
		).connect(remoteId)

		return new ManagedPeerJSDataConnection(this, conn)
	}

	/**
	 * Shortcut for setting null config.
	 * Releases all peer's resources.
	 */
	close = () => {
		this.setPeerJsConfig(null)
	}
}
