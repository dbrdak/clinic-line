"use client";

import { useEffect, useRef, useState } from "react";
import type { FormRequest, Language } from "@/lib/protocol";

export function VerificationForm({
  request,
  language,
  submit,
  dismiss,
}: {
  request: FormRequest;
  language: Language;
  submit(
    pesel: string,
  ): Promise<void | { message: string; retryable: boolean }>;

  dismiss(): void;
}) {
  const pl = language === "pl";
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
      <div className="eyebrow">
        {pl ? "PRYWATNY FORMULARZ" : "PRIVATE FORM"}
      </div>
      <h2 id="verification-title">
        {pl ? "Potwierdź dane demonstracyjne" : "Verify your demo details"}
      </h2>
      <p>
        {pl
          ? "Wpisz wyłącznie fikcyjny PESEL. Nie wypowiadaj go na głos. Mikrofon pozostaje wyciszony."
          : "Enter a fictional PESEL only. Do not read it aloud. Your microphone stays muted."}
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
                message: pl
                  ? "Wynik niepotwierdzony. Zamknij formularz i poproś Klarę o sprawdzenie statusu."
                  : "Result unconfirmed. Dismiss the form and ask Klara to check status.",
                retryable: false,
              });
            })
            .finally(() => {
              lock.current = false;

              setBusy(false);
            });
        }}
      >
        <label htmlFor="pesel">
          {pl ? "Fikcyjny PESEL" : "Fictional PESEL"}
        </label>
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
            ? pl
              ? "Wpisz dokładnie 11 cyfr."
              : "Enter exactly 11 digits."
            : pl
              ? `Ważny jeszcze ${seconds} s. Dane nie trafiają do rozmowy.`
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
          {busy
            ? pl
              ? "Wysyłanie…"
              : "Submitting…"
            : pl
              ? "Potwierdź dane"
              : "Verify details"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={dismiss}
        >
          {pl ? "Zamknij formularz" : "Dismiss form"}
        </button>
      </form>
    </dialog>
  );
}
