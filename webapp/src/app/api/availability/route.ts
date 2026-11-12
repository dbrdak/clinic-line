import { z } from "zod";
import { handle } from "@/server/http";
import { availability, id } from "@/server/clinic";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handle(() => {
    const query = z
      .object({ doctorId: id, date: z.iso.date() })
      .parse(Object.fromEntries(new URL(request.url).searchParams));

    return availability(query.doctorId, query.date);
  });
}
