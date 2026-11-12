import { z } from "zod";
import {
  clinicSchema,
  availabilitySchema,
  appointmentSchema,
  ClinicApiError,
  type Clinic,
  type PatientDetails,
  type ClinicAppointment,
} from "./clinic.ts";

/** Fixed-route backend client. Never includes raw responses or patient details in errors. */
export class ClinicClient implements Clinic {
  private readonly baseUrl: string;
  private readonly transport: typeof fetch;
  private readonly call: { id: string; secret: string } | undefined;

  constructor(
    baseUrl = process.env.CLINIC_API_URL ?? "http://localhost:3000/api/",
    transport: typeof fetch = fetch,
    call?: { id: string; secret: string },
  ) {
    const url = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        "CLINIC_API_URL must be an HTTP(S) API base URL without credentials, query or fragment.",
      );
    }

    this.baseUrl = url.href;

    this.transport = transport;

    this.call = call;
  }

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
      signal?: AbortSignal;
      mutation?: boolean;
    } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    if (!url.href.startsWith(this.baseUrl)) {
      throw new Error("Invalid clinic API route.");
    }

    try {
      const response = await this.transport(url, {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(this.call
            ? {
                Authorization: `Bearer ${this.call.secret}`,
                "x-clinic-call-id": this.call.id,
              }
            : {}),
        },
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
          : AbortSignal.timeout(10_000),
        redirect: "error",
      });

      if (!response.ok) {
        if (response.status >= 500) {
          throw new ClinicApiError(
            options.mutation ? "OUTCOME_UNKNOWN" : "SERVICE_UNAVAILABLE",
            options.mutation
              ? "The change may have been saved. Do not retry or claim success; look up appointments to reconcile."
              : "Clinic service is unavailable. Do not invent results.",
            Boolean(options.mutation),
          );
        }

        const errors: Record<number, string> = {
          400: "INVALID_REQUEST: Check the supplied fields, date and time.",
          401: "PATIENT_VERIFICATION_FAILED: Patient details did not match. Ask for correction without revealing stored values.",
          404: "NOT_FOUND: The requested doctor or authorized appointment was not found.",
          409: "CONFLICT: The slot or appointment state has changed. Refresh availability or appointments before proposing again.",
        };

        throw new ClinicApiError(
          "REQUEST_REJECTED",
          errors[response.status] ?? "The clinic rejected this request.",
        );
      }

      const parsed = schema.safeParse(await response.json());

      if (!parsed.success) {
        throw new ClinicApiError(
          options.mutation ? "OUTCOME_UNKNOWN" : "INVALID_RESPONSE",
          "The clinic returned an invalid response. Do not claim an outcome or blindly retry.",
          Boolean(options.mutation),
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof ClinicApiError) {
        throw error;
      }

      throw new ClinicApiError(
        options.mutation ? "OUTCOME_UNKNOWN" : "SERVICE_UNAVAILABLE",
        options.mutation
          ? "The connection failed and the change may have been saved. Do not retry or claim success; look up appointments to reconcile."
          : "The clinic request could not complete. Do not invent results.",
        Boolean(options.mutation),
      );
    }
  }

  clinic(signal?: AbortSignal) {
    return this.request("clinic", clinicSchema, signal ? { signal } : {});
  }

  availability(doctorId: string, date: string, signal?: AbortSignal) {
    return this.request(
      `availability?${new URLSearchParams({ doctorId, date })}`,
      availabilitySchema,
      signal ? { signal } : {},
    );
  }

  lookup(patient: PatientDetails, signal?: AbortSignal) {
    return this.request(
      "appointments/lookup",
      z.object({ appointments: z.array(appointmentSchema) }),
      {
        method: "POST",
        body: { patient },
        ...(signal ? { signal } : {}),
      },
    );
  }

  change(
    action: "book" | "cancel" | "reschedule",
    patient: PatientDetails,
    doctorId: string | null,
    startsAt: string | null,
    appointmentId: string | null,
    expected?: ClinicAppointment | null,
  ) {
    const path =
      action === "book"
        ? "appointments"
        : `appointments/${encodeURIComponent(appointmentId!)}${action === "cancel" ? "/cancel" : ""}`;

    return this.request(path, z.object({ appointment: appointmentSchema }), {
      method: action === "reschedule" ? "PATCH" : "POST",
      body: {
        patient,
        confirmed: true,
        ...(expected ? { expected } : {}),
        ...(action === "book" ? { doctorId } : {}),
        ...(action !== "cancel" ? { startsAt } : {}),
      },
      mutation: true,
    });
  }
}
