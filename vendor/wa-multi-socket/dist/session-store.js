export class SessionAuthStore {
    inner;
    revoked = false;
    chain = Promise.resolve();
    constructor(inner) {
        this.inner = inner;
    }
    revoke() {
        this.revoked = true;
    }
    async drain() {
        await this.chain.then(() => undefined, () => undefined);
    }
    get(userId, key) {
        return this.inner.get(userId, key);
    }
    async getMany(userId, keys) {
        if (this.inner.getMany)
            return this.inner.getMany(userId, keys);
        const entries = await Promise.all(keys.map(async (key) => [key, await this.inner.get(userId, key)]));
        return new Map(entries.filter((e) => e[1] !== undefined));
    }
    setMany(userId, records) {
        return this.enqueue(() => this.inner.setMany(userId, records));
    }
    deleteKeys(userId, prefix) {
        return this.enqueue(() => this.inner.deleteKeys(userId, prefix));
    }
    deleteUser(userId) {
        return this.inner.deleteUser(userId);
    }
    listUsers() {
        return this.inner.listUsers();
    }
    close() {
        return Promise.resolve();
    }
    enqueue(work) {
        if (this.revoked)
            return Promise.resolve();
        const run = this.chain.then(() => (this.revoked ? undefined : work()));
        this.chain = run.catch(() => undefined);
        return run.then(() => undefined);
    }
}
