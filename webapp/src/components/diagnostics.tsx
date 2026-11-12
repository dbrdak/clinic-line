import type { useClinicCall } from "./use-clinic-call";

export function Diagnostics({
  controller,
}: {
  controller: ReturnType<typeof useClinicCall>;
}) {
  const {
    transportState,
    agentState,
    muted,
    quality,
    elapsed,
    reconnects,
    tracks,
    rpcCount,
    t,
  } = controller;

  return (
    <details className="diagnostics">
      <summary>
        {t("Diagnostyka połączenia", "Connection diagnostics")}
        <span>LiveKit</span>
      </summary>
      <dl>
        {[
          [t("Połączenie", "Connection"), transportState],
          [t("Stan agenta", "Agent state"), agentState],
          [
            t("Mikrofon", "Microphone"),
            muted ? t("wyciszony", "muted") : t("włączony", "on"),
          ],
          [
            t("Jakość połączenia", "Connection quality"),
            quality === "unknown"
              ? t("Niedostępna — brak raportu", "Unavailable — not reported")
              : quality,
          ],
          [t("Czas rozmowy", "Call duration"), `${elapsed}s`],
          [t("Ponowne łączenia", "Reconnections"), reconnects],
          [t("Subskrybowane ścieżki audio", "Subscribed audio tracks"), tracks],
          [t("Żądania formularza RPC", "Form RPC requests"), rpcCount],
          [
            t("Opóźnienia STT / LLM / TTS", "STT / LLM / TTS latency"),
            t(
              "Niedostępne — agent ich nie publikuje",
              "Unavailable — not published by the agent",
            ),
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="fine">
        {t(
          "Dane z SDK i zdarzeń tej sesji. Brak estymowanych lub symulowanych pomiarów.",
          "Values from the SDK and this session’s events. No estimated or simulated measurements.",
        )}
      </p>
    </details>
  );
}
