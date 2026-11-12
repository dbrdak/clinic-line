import type { CallSession, Language } from "./protocol";

export type CallPhase = "idle" | "connecting" | "connected" | "error";

export type Connection<T> = {
  value: T;
  connect(): Promise<void>;

  close(): Promise<void>;
};

export type CallSnapshot<T> = {
  phase: CallPhase;
  value: T | null;
  error: boolean;
};

/** Generation checks prevent late token/connection responses from restarting an ended call. */
export function createCallLifecycle<T>(options: {
  issue(language: Language): Promise<CallSession>;

  create(session: CallSession): Connection<T>;

  release(session: CallSession): Promise<void>;

  change(snapshot: CallSnapshot<T>): void;
}) {
  let generation = 0;
  let phase: CallPhase = "idle";
  let active: { session: CallSession; connection: Connection<T> } | undefined;
  const change = (next: CallPhase, value: T | null = null) => {
    phase = next;

    options.change({ phase, value, error: phase === "error" });
  };
  const dispose = async (value: typeof active) => {
    if (!value) {
      return;
    }

    await Promise.allSettled([
      value.connection.close(),
      options.release(value.session),
    ]);
  };

  return {
    current: () => active,
    async start(language: Language) {
      if (phase === "connecting" || phase === "connected") {
        return;
      }

      const turn = ++generation;

      change("connecting");

      let session: CallSession | undefined;
      let owned: typeof active;

      try {
        session = await options.issue(language);

        if (turn !== generation) {
          await options.release(session);

          return;
        }

        owned = { session, connection: options.create(session) };

        active = owned;

        change("connecting", owned.connection.value);

        await owned.connection.connect();

        if (turn !== generation) {
          await dispose(owned);

          return;
        }

        change("connected", owned.connection.value);
      } catch {
        if (turn !== generation) {
          return;
        }

        active = undefined;

        if (owned) {
          await dispose(owned);
        } else if (session) {
          await options.release(session).catch(() => {});
        }

        if (turn === generation) {
          change("error");
        }
      }
    },
    async end(error = false) {
      ++generation;

      const owned = active;

      active = undefined;

      change(error ? "error" : "idle");

      await dispose(owned);
    },
  };
}
