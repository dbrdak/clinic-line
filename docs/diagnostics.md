# LiveKit diagnostics lab

Start the same two applications; no extra service or credentials are needed:

```sh
cd /Users/dominikbrdak/clinic-line
pnpm --dir webapp dev
# In another terminal:
pnpm --dir agent dev
```

Open http://localhost:3000, start a call, and expand **Diagnostics lab / Laboratorium diagnostyczne**. The four buttons select latency, interruptions, browser audio transport, and tool/HTTP execution. PL/EN call selection and the appointment/form flow are unchanged. Technical SDK field names and definitions are in English in both modes. Local application requests use HTTP. LiveKit Cloud retains its normal secure transport.

## Telemetry flow and privacy

`agent/src/diagnostics.ts` subscribes to public TypeScript session events and projects **only numeric measurements, fixed enums, booleans and call-local ID aliases**. `ChatMessage.content`, transcripts, `extra`, provider request IDs, audio, probabilities, patient names, identifiers, tokens, verification references, tool arguments/results and raw exceptions are never serialized. Tool IDs and speech IDs are consistently aliased inside a call; they are not provider log lookup keys.

The worker publishes small version-1 reliable **LiveKit data packets**, topic `clinic.diagnostics.v1`, with `destination_identities` set to the browser participant from the call binding. Each envelope contains `v`, opaque `callId`, random per-worker-call `streamId`, monotonically increasing `seq`, and agent-relative `atMs`. There is no broadcast or privileged Cloud API polling.

Publication runs independently of session callbacks and tool/HTTP execution. The queue holds at most 64 waiting events plus one in flight; old queued events are dropped if publication stalls. Send failures are swallowed without changing business values, cancellation, exceptions or appointment writes. Closing a call detaches session listeners and clears pending events. The publisher retains at most 512 ID aliases, 100 user-stop timestamps, and 64 unfinished speech callbacks. Completed callbacks remove themselves; closing detaches unfinished callbacks too.

The browser listens before a call finishes connecting. It checks the topic, agent participant kind, exact call ID, strict allowlisted schema and 4096-byte limit, then pins the sender and stream. Packets from another call/participant/stream are ignored. It deduplicates by sequence, reorders within the retained window, and bounds history to the latest 400 sequence positions. Sequence gaps are reported **within that retained window**, not as a lifetime delivery guarantee. A full worker replacement requires a fresh call; old and replacement streams are not silently merged.

Reconnecting keeps the same stream/history and resets browser stats baselines. There is no replay service; packets lost during disconnection may remain missing. An end event without a retained start is shown as such. Missing ends never imply success. Closing freezes the last local snapshot for inspection; starting another call or refreshing clears it. Histories and transport reports are not persisted to SQLite or another platform.

## 1. Per-turn voice latency

Source: `ChatMessage.metrics`, read for user `conversation_item_added` events and finalized assistant messages in the public `SpeechHandle.chatItems` on speech completion. No deprecated session-level `metrics_collected` listener is used. Usage/cost telemetry is not included.

| Field                      | Role      | Definition                                                                               | Display unit            |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| `transcriptionDelay`       | User      | End of user speech to final transcript                                                   | ms (SDK seconds × 1000) |
| `endOfTurnDelay`           | User      | End of user speech to turn-completion decision, including overlapping transcription work | ms                      |
| `onUserTurnCompletedDelay` | User      | Agent callback execution duration                                                        | ms                      |
| `llmNodeTtft`              | Assistant | LLM pipeline node to first token                                                         | ms                      |
| `ttsNodeTtfb`              | Assistant | First text token to first TTS audio chunk                                                | ms                      |
| `e2eLatency`               | Assistant | User stopped speaking to agent began responding, as reported by the SDK                  | ms                      |

These are **durations**, not independent sequential spans. The panel never adds them or manufactures waterfall positions. E2E is not a measurement of browser audibility: browser delivery, device buffering and speakers are outside this timing. A realtime model or unsupported provider may leave node timings empty; missing, negative or nonfinite latency values remain unavailable, not zero.

Timeline rows show observed agent-relative event time separately from actual SDK speech start/end timestamps. SDK speech timestamps are seconds since epoch; they are converted to ms relative to the worker's wall-clock origin. Event observation uses a monotonic clock. These are distinct clock surfaces, not a synchronized browser/agent waterfall.

A user message is its own turn ID. An assistant-to-user relationship is reported only when `startedSpeakingAt - e2eLatency` matches a recorded SDK user-stop timestamp (within 1 ms); the UI marks this **sdk-timing**, a timing-derived association, rather than guessing from delivery order. Tools correlate exactly to SDK speech handles; the corresponding speech-completion event maps handles to assistant message aliases. Public overlap/recovery events lack exact speech IDs, so that relationship is explicitly unavailable.

Application greeting/status calls are explicitly marked as proactive at creation; the SDK `userInitiated` flag also covers normal replies and is deliberately not used for this classification. Latest values include excluded samples and display their exclusion reason. Median/p95/counts use only eligible measurements in retained history; each metric has its own sample count. Median is the middle value (average of the middle two for even counts), p95 uses nearest rank. Proactive greetings/status-event replies, interrupted responses, form/confirmation waiting and assistant messages without matching user timing are conservatively excluded. No latency is synthesized for missing turns.

Form waits begin after form-opening RPC acknowledgement and end on an authoritative non-pending status. Confirmation waits begin after successful prepare-tool completion and end at the next committed user turn or confirm/discard tool. These are **application wait markers**, not measurements of how long a person thinks. A pending wait at disconnect has no fabricated end. Preparation's spoken review and RPC acknowledgement remain part of tool execution time; human form entry and later approval are outside it.

## 2. Interruption intelligence

Source: TypeScript `AgentSessionEventTypes.OverlappingSpeech`, `AgentFalseInterruption`, and public speech-handle completion.

| SDK value                             | Meaning                                                          | Conversion                                |
| ------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `isInterruption`                      | Adaptive decision: interruption vs backchannel                   | Boolean → fixed label                     |
| `agentEnded`                          | Agent speech ended the overlap; negative verdict is inconclusive | Display **inconclusive**, not backchannel |
| `detectionDelayInS`                   | Reported overlap-detection delay                                 | × 1000 ms                                 |
| `predictionDurationInS`               | Model inference duration                                         | × 1000 ms                                 |
| `totalDurationInS`                    | Model request round-trip duration                                | × 1000 ms                                 |
| `numRequests`                         | Requests used for the decision                                   | count                                     |
| `SpeechHandle.interrupted`            | This speech completed interrupted                                | boolean; text omitted                     |
| `AgentFalseInterruptionEvent.resumed` | False interruption automatically resumed speech                  | boolean                                   |

The three durations overlap and are not summed. Recovery support does not guarantee a recovery event in every call. Missing events remain unavailable/no event reported. “Mhm” can legitimately be classified differently by the model; the panel reports the actual decision, not the intended demonstration label. No Python-only events or fields are assumed.

## 3. Browser audio transport

Sources: public `LocalAudioTrack.getSenderStats()`, `RemoteAudioTrack.getReceiverStats()`, and each track's public `getRTCStatsReport()`. Sample interval is approximately 2 seconds. Only local microphone and remote agent audio are sampled. Raw reports stay in the browser and are not uploaded. Candidate IP addresses, SDP, fingerprints and device labels are not displayed or transmitted.

| Measurement              | Definition / scope                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RTT                      | Uplink RTT estimated from remote RTCP receiver-report timestamps where available; otherwise direction-local selected ICE candidate-pair RTT. Downlink uses local ICE RTT. Both seconds × 1000; source labeled. Neither includes the agent/provider network leg. |
| Jitter                   | RTP interarrival jitter: uplink as reported by SFU receiver; downlink as reported by browser receiver. Seconds × 1000.                                                                                                                                          |
| Interval loss            | `100 × Δlost / (Δreceived + Δlost)`. Uplink uses remote receive counters when present. Otherwise an explicitly labeled estimate uses `100 × Δlost / Δsent`, only when a new RTCP report arrives; its reports are asynchronous.                                  |
| Bitrate                  | `8 × Δbytes / Δtimestamp_ms`, displayed in decimal kbit/s. Derived, not provider billing throughput.                                                                                                                                                            |
| Mean jitter-buffer delay | `1000 × ΔjitterBufferDelay_seconds / ΔjitterBufferEmittedCount`, per interval. Not cumulative delay and not an added pipeline stage.                                                                                                                            |
| Concealed samples/events | Receiver counter deltas per interval; samples/second is derived from the same interval. These counters are unavailable for the uplink receiver in the public browser report.                                                                                    |
| ICE types / protocol     | Types from the transport's explicitly selected candidate pair: local/remote host, srflx, prflx or relay; udp/tcp. No guessing from arbitrary candidate pairs.                                                                                                   |

First samples, reset/decreased counters, zero/negative elapsed time, gaps over 15 seconds and zero denominators produce unavailable rates. Missing fields never become zero. A real zero delta is shown as zero. The loss report interval is shown separately: uplink RTCP reporting windows can differ from the 2-second polling/bitrate interval. RTCP reports that have not advanced produce unavailable interval uplink loss rather than a misleading zero. Track changes and reconnects reset baselines. Multiple tracks are shown separately, never averaged without weights.

## 4. Tool and clinic HTTP timeline

The thin tool definitions wrap existing conversation functions. Wrappers emit start/end timestamps, monotonic total duration and **execution** success/error/cancelled, while preserving returned values and the exact exception object. Execution success is not a statement that an appointment was booked. Appointment outcomes/confirmation guards remain in the existing conversation and backend code.

The clinic client measures fetch plus parsing/validation using the same monotonic clock. `AsyncLocalStorage` associates each request with its executing tool/speech, including overlapping tool calls. Background status-RPC/cleanup requests are shown without a tool context. Endpoint names are mapped to a fixed operation allowlist; URLs, path IDs, request bodies and responses never enter telemetry. Individual HTTP durations are shown, not summed: requests may overlap.

Total tool time can include serialization behind other tool calls, validation, HTTP, form RPC acknowledgement, and proposal review playback. Human form input and the later confirmation gap have separate wait markers. No waiting time is subtracted to create an invented “pure” tool duration.

## Demonstration sequence

Use fictional data and no real identifiers:

1. Select English or Polish, start the call, inspect the visible lab. Ask “Which doctors can I book, and what are your opening hours?” Wait for the answer to finish. **Latency** should show user STT/EOT and assistant node/E2E measurements; the proactive greeting remains excluded. **Tools** should show `getClinicInformation` and its HTTP request.
2. Ask Klara to explain booking, then say a brief “mhm” while she is speaking. Inspect **Interruptions** for the actual decision and durations. A backchannel is not guaranteed; do not relabel a model's interruption verdict.
3. During another answer, say “Wait, stop — I want a different doctor.” Check interruption decisions and an interrupted speech. False-interruption recovery appears only if the SDK reports one.
4. Ask to book a real offered slot using any fictional name. Submit an eleven-digit fictional PESEL **only in the private form**. Inspect the short verification HTTP/RPC execution separately from human form waiting. Approve only after the exact appointment review; then inspect the confirmation tool and HTTP execution. Diagnostics do not grant approval or change appointment behavior.
5. In **Audio transport**, inspect uplink/downlink sources and interval rates. End and restart: history must clear for the new call. Refresh/reconnect may leave sequence gaps; the panel does not invent missing measurements.

## Checks and observed limitations

```sh
pnpm --dir agent test
pnpm --dir agent typecheck
pnpm --dir agent lint
pnpm --dir agent build
pnpm --dir webapp typecheck
pnpm --dir webapp lint
pnpm --dir webapp build
```

Agent-only telemetry tests cover mapping and units, safe projections, exact timing/async correlation, proactive/human exclusions, interruption-vs-inconclusive semantics, publish failure, cancellation/exception preservation, bounded queues, stream/call isolation and listener cleanup. There are no dedicated browser/backend test suites.

The browser smoke check received actual greeting node metrics and real receiver transport stats. The in-app browser could receive audio but stayed awaiting microphone access, so this was not a physical-microphone conversation. A separate synthetic PCM caller exercised the real Cloud audio pipeline and emitted user metrics, tool/HTTP spans, SDK-derived response E2E and overlap decisions. The final synthetic run delivered 11 turn/message records, six speech completions, two tool events, two HTTP events and two overlap decisions, with zero schema rejections. Another participant in that room received zero diagnostic packets. Three completed responses had eligible SDK E2E values; greetings and interrupted replies were excluded. The intended “mhm” backchannel was classified as an interruption, and the panel preserved that verdict. Controlled counter snapshots separately checked rate/unit calculations, reset/zero intervals and stale RTCP handling; no browser/backend test suite was introduced. This checks delivery and mapping, not human speech quality or speaker audibility. Browser-specific field support, actual human backchannel classification, microphone permissions, a real reconnect and false-interruption recovery still need hands-on checks. Model decisions and provider timings vary between runs.

Official references checked against installed SDK types:

- [Per-turn metrics and data hooks](https://docs.livekit.io/testing/observability/data/)
- [Agent events](https://docs.livekit.io/reference/agents/events/)
- [Adaptive interruptions](https://docs.livekit.io/agents/logic/turns/adaptive-interruption-handling/)
- [Targeted data packets](https://docs.livekit.io/transport/data/packets/)
- [WebRTC statistics definitions](https://www.w3.org/TR/webrtc-stats/)

## Downloading call data

The top-right download controls export JSON. Metrics use the browser's retained 400-event window and latest audio stats; they do not fetch Cloud data or include call proofs, room tokens, transcripts, or tool payloads.

Transcript and agent-log downloads use the existing Next.js server as a proxy to the [LiveKit Cloud observability API](https://docs.livekit.io/reference/api/projects/sessions/observability/). They are requested only on click. Configure `LIVEKIT_CLOUD_PROJECT_ID` and `LIVEKIT_CLOUD_SESSION_TOKEN` in `webapp/.env.local`; these are server-only values. The token must belong to an Admin user on that project. Room API keys/secrets cannot authenticate these endpoints.

Obtain the user session via `lk cloud auth --user-auth` in an interactive terminal, as described in [Cloud authentication](https://docs.livekit.io/reference/api/#authentication). Transfer the intended account's session token from the CLI configuration to the local environment without printing it or committing it. User sessions expire (approximately 30 days); sign in and replace the value when needed. Restart Next.js after configuring it. No credentials are returned to the browser.

Enable observability and PII redaction in Cloud before starting the demo call; the export proxy refuses downloads if redaction is currently off. It does not change project settings or retrospectively redact historical sessions. Use fictional data only. Automated redaction is not a privacy or compliance guarantee.

Each request requires the current browser's call proof. The server derives the exact random room name from SQLite and checks exact equality against the Cloud session (Cloud's room-name filter is a prefix). It accepts no client-supplied room/session IDs. Closed calls remain exportable only until their original 30-minute call authorization expires; exports never reactivate patient verification. Refreshing loses browser access; starting another call selects the new call.

Transcripts include user/agent messages only, excluding tool calls/results and prompt/configuration items. They become available after the session closes and Cloud finishes processing/redaction. Agent logs export Cloud timestamps and severity only: free-form messages, attributes and structured bodies can contain sensitive tool payloads and are deliberately omitted. These exports are separate from metrics and never enter its telemetry stream. Additional masking removes eleven-digit identifiers, familiar bearer/JWT formats, and configured server credentials from transcript text; it is defence in depth, not a guarantee for arbitrary speech.

Cloud error messages and payloads are never forwarded verbatim. Missing configuration, expired user authentication, missing Admin role, rate limits and data not yet ready produce explicit UI feedback. Pagination is bounded to 20 pages, individual responses and downloads to about 8 MB, and requests to 25 seconds. `dataStatus` identifies an active/settling snapshot; repeat the download later if needed. No persistent export files or new services are created.
