"use client";

import { useEffect, useRef, useState } from "react";
import type { FormRequest } from "@/lib/protocol";

export function VerificationForm({
  request,
  submit,
  dismiss,
}: {
  request: FormRequest;
  submit(
    pesel: string,
  ): Promise<void | { message: string; retryable: boolean }>;

  dismiss(): void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    retryable: boolean;
  } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const lock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const onDismiss = useRef(dismiss);

  useEffect(() => {
    onDismiss.current = dismiss;
  }, [dismiss]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;

    dialog.current?.showModal();

    const tick = () => {
      const left = Math.max(
        0,
        Math.ceil((Date.parse(request.expiresAt) - Date.now()) / 1000),
      );

      setSeconds(left);

      if (!left) {
        onDismiss.current();
      }
    };

    tick();

    const timer = setInterval(tick, 1000);

    return () => {
      clearInterval(timer);

      previous?.focus();
    };
  }, [request.requestId, request.expiresAt]);

  return (
    <dialog
      ref={dialog}
      className="verification"
      aria-labelledby="verification-title"
      onCancel={(event) => {
        event.preventDefault();

        dismiss();
      }}
    >
      <div className="eyebrow">PRIVATE FORM</div>
      <h2 id="verification-title">Enter your demo details</h2>
      <p>
        Enter a fictional PESEL only. Do not read it aloud. Your microphone
        stays muted.
      </p>
      <p className="fine">
        Use any fictional name and 11 digits. For a new PESEL, we save the name
        you gave Klara as a new patient. No PESEL checksum is checked.
        Dismissing restores your previous microphone state.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();

          if (lock.current || feedback?.retryable === false) {
            return;
          }

          if (!/^\d{11}$/.test(value)) {
            setInvalid(true);

            return;
          }

          lock.current = true;

          setBusy(true);

          const input = value;

          setFeedback(null);

          void submit(input)
            .then((result) => {
              if (result) {
                setFeedback(result);
              } else {
                setValue("");
              }
            })
            .catch(() => {
              setFeedback({
                message:
                  "Result unconfirmed. Dismiss the form and ask Klara to check status.",
                retryable: false,
              });
            })
            .finally(() => {
              lock.current = false;

              setBusy(false);
            });
        }}
      >
        <label htmlFor="pesel">Fictional PESEL</label>
        <input
          id="pesel"
          name="demo-identifier"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={11}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);

            setInvalid(false);
          }}
          aria-invalid={invalid || Boolean(feedback?.retryable)}
          aria-describedby={
            feedback ? "pesel-hint pesel-feedback" : "pesel-hint"
          }
          disabled={busy || feedback?.retryable === false}
        />
        <p id="pesel-hint" className={invalid ? "error" : "fine"}>
          {invalid
            ? "Enter exactly 11 digits."
            : `Expires in ${seconds}s. This value is not sent to the conversation.`}
        </p>
        {feedback && (
          <p id="pesel-feedback" className="error" role="alert">
            {feedback.message}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || feedback?.retryable === false}
        >
          {busy ? "Submitting…" : "Save details"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={dismiss}
        >
          Dismiss form
        </button>
      </form>
    </dialog>
  );
}
