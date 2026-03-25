export class NotImplementedError extends Error {
    public readonly command: string;

    constructor(command: string) {
        super(`Command "${command}" is not implemented yet.`);
        this.name = "NotImplementedError";
        this.command = command;

        // Maintain proper prototype chain in transpiled ES5 environments
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
