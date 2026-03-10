import { NextResponse } from "next/server";

import { createHandler } from "../../../lib/handler";

export const GET = createHandler({
  auth: "none",
  handler: async () => {
    return NextResponse.json({
      status: "ok",
      service: "atlas-billing",
      timestamp: new Date().toISOString(),
    });
  },
});
