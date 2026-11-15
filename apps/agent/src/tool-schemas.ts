import { z } from "zod";
import { idSchema, dateTimeSchema } from "./clinic.ts";

export const proposalInput = z.object({
  action: z
    .enum(["book", "cancel", "reschedule"])
    .describe("The single requested appointment action."),
  doctorId: idSchema
    .nullable()
    .describe(
      "For booking only: exact doctor ID returned by getClinicInformation. Otherwise null.",
    ),
  appointmentId: idSchema
    .nullable()
    .describe(
      "For cancellation/rescheduling: exact ID from lookupAppointments for this verified patient. Otherwise null.",
    ),
  startsAt: dateTimeSchema
    .nullable()
    .describe(
      "For booking/rescheduling: exact ISO timestamp of a returned available slot, including offset or Z. Otherwise null.",
    ),
});
