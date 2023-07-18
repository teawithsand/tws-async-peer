import { DefaultQueue, Queue, Subscribable, SubscriptionCanceler, latePromise, throwExpression } from "@teawithsand/tws-lts"
import {
	ConnRegistry,
	ConnRegistryAdapter,
	ConnRegistryAdapterHandle,
} from "./connRegistry"

type DummyInitData = {
	n: number
}

type DummyConn = {}

type DummyConfig = {
	done?: boolean
	throw?: any | undefined | null
	n: number
}

type DummyState = {
	n: number
}

type Registry = ConnRegistry<DummyConn, DummyState, DummyConfig, DummyInitData>

const COND_WAIT_TIME = 10
/**
 * Creates promise that awaits single event from bus it's given.
 */
export const busAwaitSingleEvent = async <T>(
	bus: Subscribable<T>
): Promise<T> => {
	const [p, resolve] = latePromise<T>()
	bus.addSubscriber((s, canceller) => {
		resolve(s)
		canceller()
	})

	return p
}

// TODO(teawithsand): rebuild this using AsyncQueue
export class BusAwaiter<T> {
	private readonly canceller: SubscriptionCanceler
	private readonly latePromiseQueue: Queue<
		[(e: T) => void, (e: any) => void]
	> = new DefaultQueue()
	private readonly eventQueue: Queue<T> = new DefaultQueue()
	private innerIsClosed = false

	get isClosed() {
		return this.innerIsClosed
	}

	constructor(bus: Subscribable<T>) {
		this.canceller = bus.addSubscriber((event) => {
			const arr = this.latePromiseQueue.pop()
			if (arr) {
				const [resolve] = arr
				resolve(event)
			} else {
				this.eventQueue.append(event)
			}
		})
	}

	get eventQueueSize(): number {
		return this.eventQueue.length
	}

	get listenerQueueSize(): number {
		return this.latePromiseQueue.length
	}

	/**
	 * Returns event if one was already enqueued and drops it from queue.
	 * Returns null otherwise.
	 *
	 * Always returns as fast as possible.
	 *
	 * Note: running it in infinite loop will cause that loop to never end, as it does not allow
	 * JS fiber switching, so that another fiber may enqueue that event.
	 */
	popEvent = (): T | undefined => {
		return this.eventQueue.pop()
	}

	readEvent = (): Promise<T> => {
		if (this.innerIsClosed)
			return Promise.reject(new Error("Already closed"))

		const event = this.eventQueue.pop()
		if (event) return Promise.resolve(event)

		const [lp, resolve, reject] = latePromise<T>()
		this.latePromiseQueue.append([resolve, reject])

		return lp
	}

	close = () => {
		if (this.innerIsClosed) return
		this.innerIsClosed = true

		while (this.eventQueue.pop()) {}
		for (;;) {
			const v = this.latePromiseQueue.pop()
			if (!v) break
			const [_resolve, reject] = v
			reject(new Error("Already closed"))
		}
		this.canceller()
	}
}


export class DummyAdapter
	implements
		ConnRegistryAdapter<DummyConn, DummyState, DummyConfig, DummyInitData>
{
	modifyConfigOnRemove = (config: DummyConfig) => config
	makeInitialConfig = (
		conn: DummyConn,
		initData: DummyInitData,
		id: string
	) => {
		return {
			n: 1,
		}
	}

	makeInitialState = (
		conn: DummyConn,
		config: DummyConfig,
		initData: DummyInitData,
		id: string
	) => {
		return {
			n: 1,
		}
	}

	handle = async (
		handle: ConnRegistryAdapterHandle<
			DummyConn,
			DummyState,
			DummyConfig,
			DummyInitData
		>
	) => {
		const { initData, connConfigBus, setState } = handle

		const awaiter = new BusAwaiter(connConfigBus)

		for (;;) {
			const config = await awaiter.readEvent()

			if (config.done) {
				if (config.throw) throw config.throw
				else return
			}

			setState({
				n: initData.n * config.n,
			})
		}
	}

	cleanup = async (
		handle: ConnRegistryAdapterHandle<
			DummyConn,
			DummyState,
			DummyConfig,
			DummyInitData
		>,
		exception: any
	) => {
		if (exception) throw exception
	}
}

describe("conn registry", () => {
	const runCondTest = async <T>(
		prepare: (reg: Registry) => Promise<T>,
		assert: (reg: Registry, prepared: T) => Promise<boolean>,
		errorMsg?: string
	) => {
		const registry: Registry = new ConnRegistry(new DummyAdapter())
		const res = await prepare(registry)
		for (let i = 0; i < COND_WAIT_TIME; i++) {
			if (await assert(registry, res)) return
		}

		throw new Error(errorMsg || "Filed to meet condition")
	}

	it("can add conn", async () => {
		await runCondTest(
			async (reg) => {
				return reg.addConn(
					{},
					{
						n: 2,
					}
				)
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				return s[id]?.state?.n == 2
			}
		)
	})

	it("can update conn config", async () => {
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 10,
					done: false,
				})

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				return s[id]?.state?.n == 20
			}
		)
	})

	it("can close conn", async () => {
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 10,
					done: true,
				})

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				return s[id]?.isClosed === true
			}
		)
	})

	it("can throw conn", async () => {
		const ex = new Error("Whoopsie error")
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 10,
					done: true,
					throw: ex,
				})

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				return s[id]?.error === ex
			}
		)
	})

	it("can remove conn", async () => {
		const ex = new Error("Whoopsie error")
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 1,
					done: true,
				})

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				if (s[id]?.isClosed ?? false) reg.removeConn(id)
				return !(id in s)
			}
		)
	})

	it("can remove conn even when not closed", async () => {
		const ex = new Error("Whoopsie error")
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 1,
					done: false,
				})

				reg.removeConn(id)

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				return !(id in s)
			}
		)
	})

	it("can wait until conn done using promise", async () => {
		const ex = new Error("Whoopsie error")
		await runCondTest(
			async (reg) => {
				const id = reg.addConn(
					{},
					{
						n: 2,
					}
				)

				reg.setConfig(id, {
					n: 10,
					done: true,
					throw: ex,
				})

				return id
			},
			async (reg, id) => {
				const s = await busAwaitSingleEvent(reg.stateBus)
				await (s[id]?.promise ??
					throwExpression(new Error("No promise")))

				return true
			}
		)
	})
})
