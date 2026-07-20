export type ModalCommitPhase =
    | "idle"
    | "preparing"
    | "committing"
    | "finished"
    | "cancelled";

export interface ModalCommitToken {
    readonly generation: number;
}

export class ModalCommitGuard {
    private generation = 0;
    private currentPhase: ModalCommitPhase = "cancelled";

    get phase(): ModalCommitPhase {
        return this.currentPhase;
    }

    get closeLocked(): boolean {
        return this.currentPhase === "committing";
    }

    reset(): void {
        this.generation++;
        this.currentPhase = "idle";
    }

    beginPreparing(): ModalCommitToken | null {
        if (this.currentPhase !== "idle") return null;
        this.currentPhase = "preparing";
        return Object.freeze({ generation: this.generation });
    }

    isCurrent(token: ModalCommitToken): boolean {
        return token.generation === this.generation
            && (this.currentPhase === "preparing"
                || this.currentPhase === "committing");
    }

    beginCommitting(token: ModalCommitToken): boolean {
        if (token.generation !== this.generation
            || this.currentPhase !== "preparing") return false;
        this.currentPhase = "committing";
        return true;
    }

    finish(token: ModalCommitToken): boolean {
        if (token.generation !== this.generation
            || this.currentPhase !== "committing") return false;
        this.currentPhase = "finished";
        return true;
    }

    fail(token: ModalCommitToken): boolean {
        if (token.generation !== this.generation) return false;
        if (this.currentPhase !== "preparing"
            && this.currentPhase !== "committing") return false;
        this.currentPhase = "idle";
        return true;
    }

    cancel(): boolean {
        if (this.currentPhase === "committing") return false;
        this.generation++;
        this.currentPhase = "cancelled";
        return true;
    }
}
