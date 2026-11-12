import { formRequestSchema, type FormRequest } from "./protocol";

/** RPC receipt acknowledges transport, never human input or successful verification. */
export function acceptVerificationRpc(
  data: { callerIdentity: string; payload: string },
  options: {
    isAgent(identity: string): boolean;

    received(request: FormRequest): void;

    mute(): Promise<unknown>;

    open(request: FormRequest): void;

    failed(): void;
  },
): string {
  if (!options.isAgent(data.callerIdentity)) {
    throw new Error("Agent required");
  }

  const request = formRequestSchema.parse(JSON.parse(data.payload));

  if (Date.parse(request.expiresAt) <= Date.now()) {
    throw new Error("Expired request");
  }

  options.received(request);

  void options
    .mute()
    .then(() => options.open(request))
    .catch(options.failed);

  return "accepted";
}
