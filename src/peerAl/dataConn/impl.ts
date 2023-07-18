import { DataConnection } from "peerjs"
import { AsyncQueue, DefaultEventBus, DefaultQueue, DefaultStickyEventBus, StickySubscribable, Subscribable } from "@teawithsand/tws-lts"
import { ClosedManagedPeerDataConnectionTwsPeerError, ManagedPeerDataConnection, ManagedPeerDataConnectionEvent, ManagedPeerDataConnectionEventType, ManagedPeerDataConnectionMessageQueue, ManagedPeerDataConnectionState, UnknownManagedPeerDataConnectionTwsPeerError } from "./abstract"
import { PeerDataConnEventType, makePeerDataConnBus } from "../../peerJsAl"
import { ManagedPeer } from "../peer"
import { TwsPeerError } from "../../error"

/**
 * ManagedPeerDataConnection implementation over peerjs' DataConnection.
 */
export class ManagedPeerJSDataConnection implements ManagedPeerDataConnection {
    private readonly innerEventBus =
        new DefaultEventBus<ManagedPeerDataConnectionEvent>()
    private readonly innerStateBus =
        new DefaultStickyEventBus<ManagedPeerDataConnectionState>({
            error: null,
            isClosed: false,
            isOpen: false,
        })

    private isReceivedMessagesQueueClosed = false
    private readonly onAfterClosedReceivedMessagesQueue = new DefaultQueue<any>()
    private readonly receivedMessagesQueue = new AsyncQueue<any>()
    private readonly preSendQueue = new DefaultQueue<any>()

    private readonly innerHandleEvent = (event: ManagedPeerDataConnectionEvent) => {
        if (event.type === ManagedPeerDataConnectionEventType.ERROR) {
            const error = new UnknownManagedPeerDataConnectionTwsPeerError(
                "Received error from peerjs",
                event.error
            )
            this.innerOnError(error)
        } else if (event.type === ManagedPeerDataConnectionEventType.CLOSE) {
            this.innerStateBus.emitEvent({
                ...this.innerStateBus.lastEvent,
                isClosed: true,
            })

            this.innerDoCleanup()
        } else if (event.type === ManagedPeerDataConnectionEventType.OPEN) {
            const state = this.innerStateBus.lastEvent
            if (!state.isClosed && !state.error) {
                while (!this.preSendQueue.isEmpty) {
                    const v = this.preSendQueue.pop()
                    this.innerSendMessage(v)
                }
            }

            this.innerStateBus.emitEvent({
                ...this.innerStateBus.lastEvent,
                isOpen: true,
            })
        }

        this.innerEventBus.emitEvent(event)
    }

    private innerDoCleanup = (e?: Error) => {
        if (!this.isReceivedMessagesQueueClosed) {
            this.isReceivedMessagesQueueClosed = true

            // This hack is required, since close may have been triggered by remote party BEFORE
            // we were able to receive all incoming messages.
            // So store them in separate instant-access queue, if there are some that is.
            while (this.receivedMessagesQueue.resultQueueLength > 0) {
                const v = this.receivedMessagesQueue.pop()
                this.onAfterClosedReceivedMessagesQueue.append(v)
            }

            this.preSendQueue.clear() // just in case it was not cleared
            this.receivedMessagesQueue.close(
                e ??
                new ClosedManagedPeerDataConnectionTwsPeerError(
                    "PeerJSIDataConnection was closed and can't receive messages"
                )
            )

            try {
                this.innerConn.close()
            } catch (e) { }
        }
    }

    private innerOnError = (error: Error) => {
        const lastEvent = this.innerStateBus.lastEvent
        if (lastEvent.error === null && !lastEvent.isClosed) {
            this.innerStateBus.emitEvent({
                ...this.innerStateBus.lastEvent,
                error,
                isClosed: true,
            })
            this.innerDoCleanup(error)
        }
    }

    private innerSendMessage = (msg: any, doThrow?: boolean) => {
        try {
            this.innerConn.send(msg)
        } catch (e) {
            if (doThrow) {
                throw e
            } else {
                this.innerOnError(
                    new UnknownManagedPeerDataConnectionTwsPeerError(
                        "PeerJS thrown while sending message",
                        e instanceof Error ? e : new TwsPeerError("Unknown error")
                    )
                )
            }
        }
    }

    constructor(
        public readonly peer: ManagedPeer,
        private readonly innerConn: DataConnection
    ) {
        const bus = makePeerDataConnBus(innerConn)
        bus.addSubscriber((event) => {
            if (event.type === PeerDataConnEventType.OPEN) {
                this.innerHandleEvent({
                    type: ManagedPeerDataConnectionEventType.OPEN,
                    conn: this,
                })
            } else if (event.type === PeerDataConnEventType.CLOSE) {
                this.innerHandleEvent({
                    type: ManagedPeerDataConnectionEventType.CLOSE,
                    conn: this,
                })
            } else if (event.type === PeerDataConnEventType.DATA) {
                if (!this.isReceivedMessagesQueueClosed) {
                    // above condition should always be true.
                    this.receivedMessagesQueue.append(event.data)
                }

                this.innerHandleEvent({
                    type: ManagedPeerDataConnectionEventType.DATA,
                    conn: this,
                    data: event.data,
                })
            } else if (event.type === PeerDataConnEventType.ERROR) {
                this.innerHandleEvent({
                    type: ManagedPeerDataConnectionEventType.ERROR,
                    conn: this,
                    error: event.error,
                })
            }
        })
    }

    public readonly messageQueue: ManagedPeerDataConnectionMessageQueue = (() => {
        const self = this
        return {
            get length() {
                if (!self.onAfterClosedReceivedMessagesQueue.isEmpty)
                    return self.onAfterClosedReceivedMessagesQueue.length
                if (self.isReceivedMessagesQueueClosed) return 0
                return self.receivedMessagesQueue.resultQueueLength
            },
            pop: () => {
                if (!this.onAfterClosedReceivedMessagesQueue.isEmpty) {
                    return this.onAfterClosedReceivedMessagesQueue.pop()
                }

                if (self.isReceivedMessagesQueueClosed) return null

                return self.receivedMessagesQueue.pop()
            },
            receive: async () => {
                if (!this.onAfterClosedReceivedMessagesQueue.isEmpty) {
                    return this.onAfterClosedReceivedMessagesQueue.pop()
                }

                if (self.isReceivedMessagesQueueClosed) {
                    throw new ClosedManagedPeerDataConnectionTwsPeerError(
                        "PeerJSIDataConnection was closed and can't send given message"
                    )
                }

                const v = await self.receivedMessagesQueue.popAsync()
                return v
            },
        }
    })()

    get eventBus(): Subscribable<ManagedPeerDataConnectionEvent> {
        return this.innerEventBus
    }
    get stateBus(): StickySubscribable<ManagedPeerDataConnectionState> {
        return this.innerStateBus
    }

    send = (data: any) => {
        const state = this.innerStateBus.lastEvent
        if (state.isClosed) {
            throw new ClosedManagedPeerDataConnectionTwsPeerError(
                "PeerJSIDataConnection was closed and can't send given message"
            )
        }

        if (!state.isOpen) {
            this.preSendQueue.append(data)
        } else {
            this.innerSendMessage(data, true)
        }
    }

    close = () => {
        // this should trigger cascade of events that are required to perform close
        this.innerConn.close() 
    }
}
