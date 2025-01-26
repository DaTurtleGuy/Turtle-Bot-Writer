export class Lock {
    constructor() {
        this.queue = [];
        this.isLocked = false;
    }

    acquire() {
        return new Promise(resolve => {
            if (!this.isLocked) {
                this.isLocked = true;
                resolve();
            } else {
                this.queue.push(resolve);
            }
        });
    }

    release() {
        if (this.queue.length > 0) {
            const nextResolve = this.queue.shift();
            nextResolve();
        } else {
            this.isLocked = false;
        }
    }

    // Function to check if the lock is occupied
    isOccupied() {
        return this.isLocked;
    }
}
