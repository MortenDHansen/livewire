import { sendRequest } from "./request"
import { dataGet, dataSet, each, deeplyEqual, isObjecty, deepClone, diff, isObject, contentIsFromDump, splitDumpFromContent } from '@/utils'
import { on, trigger } from '@/events'

/**
 * A "commit" is anytime a Livewire component makes a server-side update.
 * Typically this is for the purposes of synchronizing state or calling
 * some action...
 */

class CommitBus {
    constructor() {
        this.commits = new Set
        this.pools = new Set
    }

    add(component) {
        let commit = this.findCommitOr(component, () => {
            let newCommit = new Commit(component)

            this.commits.add(newCommit)

            return newCommit
        })

        trigger('commit.pooling', { component: commit.component })

        bufferPoolingForFiveMs(commit, () => {
            this.findPoolOr(commit, () => {
                this.createAndSendNewPool(this.commits)
            })
        })

        return commit
    }

    findCommitOr(component, callback) {
        for (let [idx, commit] of this.commits.entries()) {
            if (commit.component === component) {
                return commit
            }
        }

        return callback()
    }

    findPoolOr(commit, callback) {
        for (let [idx, pool] of this.pools.entries()) {
            if (pool.hasCommitFor(commit.component)) return pool
        }

        return callback()
    }

    createAndSendNewPool(commits) {
        let pools = []

        for (let [idx, commit] of commits.entries()) {
            let hasFoundPool = false

            pools.forEach(pool => {
                if (pool.shouldHoldCommit(commit)) {
                    pool.add(commit)

                    hasFoundPool = true
                }
            })

            if (! hasFoundPool) {
                let newPool = new RequestPool

                newPool.add(commit)

                pools.push(newPool)
            }
        }

        // Clear then from the queue...
        this.commits.clear()

        pools.forEach(pool => {
            this.pools.add(pool)

            pool.send().then(() => {
                this.pools.delete(pool)

                this.sendAnyQueuedCommits()
            })
        })
    }

    sendAnyQueuedCommits() {
        if (this.commits.size > 0) {
            this.createAndSendNewPool(this.commits)
        }
    }
}

class RequestPool {
    constructor() {
        this.commits = new Set
    }

    add(commit) {
        this.commits.add(commit)
    }

    hasCommitFor(component) {
        for (let [idx, commit] of this.commits.entries()) {
            if (commit.component === component) return true
        }

        return false
    }

    shouldHoldCommit(commit) {
        return true
    }

    async send() {
        this.prepare()

        await sendRequest(this)
    }

    prepare() {
        // Give each commit a chance to do any last-minute prep
        // before being sent to the server.
        this.commits.forEach(i => i.prepare())
    }

    payload() {
        let commitPayloads = []

        let successReceivers = []
        let failureReceivers = []

        this.commits.forEach(commit => {
            let [payload, succeed, fail] = commit.toRequestPayload()

            commitPayloads.push(payload)
            successReceivers.push(succeed)
            failureReceivers.push(fail)
        })

        let succeed = components => successReceivers.forEach(receiver => receiver(components.shift()))

        let fail = () => failureReceivers.forEach(receiver => receiver())

        return [ commitPayloads, succeed, fail ]
    }
}

let commitBus = new CommitBus

export async function requestCommit(component) {
    let commit = commitBus.add(component)

    return new Promise((resolve, reject) => {
        commit.addResolver(resolve)
    })
}

export async function requestCall(component, method, params) {
    let commit = commitBus.add(component)

    return new Promise((resolve, reject) => {
        commit.addCall(method, params, value => resolve(value))
    })
}

/**
 * The term "commit" here refers to anytime we're making a network
 * request, updating the server, and generating a new snapshot.
 * We're "requesting" a new commit rather than executing it
 * immediately, because we might want to batch multiple
 * simultaneus commits from other livewire targets.
 */
class Commit {
    constructor(component) {
        this.component = component
        this.calls = []
        this.receivers = []
        this.resolvers = []
    }

    addResolver(resolver) {
        this.resolvers.push(resolver)
    }

    addCall(method, params, receiver) {
        this.calls.push({
            path: '', method, params,
            handleReturn(value) {
                receiver(value)
            },
        })
    }

    prepare() {
        trigger('commit.prepare', { component: this.component })
    }

    toRequestPayload() {
        let propertiesDiff = diff(this.component.canonical, this.component.ephemeral)

        let payload = {
            snapshot: this.component.snapshotEncoded,
            updates: propertiesDiff,
            calls: this.calls.map(i => ({
                path: i.path,
                method: i.method,
                params: i.params,
            }))
        }

        let succeedCallbacks = []
        let failCallbacks = []
        let respondCallbacks = []

        let succeed = (fwd) => succeedCallbacks.forEach(i => i(fwd))
        let fail = () => failCallbacks.forEach(i => i())
        let respond = () => respondCallbacks.forEach(i => i())

        let finishTarget = trigger('commit', {
            component: this.component,
            commit: payload,
            succeed: (callback) => {
                succeedCallbacks.push(callback)
            },
            fail: (callback) => {
                failCallbacks.push(callback)
            },
            respond: (callback) => {
                respondCallbacks.push(callback)
            },
        })

        let handleResponse = (response) => {
            let { snapshot, effects } = response

            respond()

            this.component.mergeNewSnapshot(snapshot, effects, propertiesDiff)

            processEffects(this.component, this.component.effects)

            if (effects['returns']) {
                let returns = effects['returns']

                // Here we'll match up returned values with their method call handlers. We need to build up
                // two "stacks" of the same length and walk through them together to handle them properly...
                let returnHandlerStack = this.calls.map(({ handleReturn }) => (handleReturn))

                returnHandlerStack.forEach((handleReturn, index) => {
                    handleReturn(returns[index])
                })
            }

            let parsedSnapshot = JSON.parse(snapshot)

            finishTarget({ snapshot: parsedSnapshot, effects })

            this.resolvers.forEach(i => i())

            succeed(response)
        }

        let handleFailure = () => {
            respond()

            fail()
        }

        return [payload, handleResponse, handleFailure]
    }
}

/**
 * Here we'll take the new state and side effects from the
 * server and use them to update the existing data that
 * users interact with, triggering reactive effects.
 */
export function processEffects(target, effects) {
    trigger('effects', target, effects)
}

let buffersByCommit = new WeakMap

function bufferPoolingForFiveMs(commit, callback) {
    if (buffersByCommit.has(commit)) return

    buffersByCommit.set(commit, setTimeout(() => {
        callback()

        buffersByCommit.delete(commit)
    }, 5))
}
