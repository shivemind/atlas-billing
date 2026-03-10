import { NextResponse } from "next/server";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";

function serializeAdjustment(adj: {
  id: string;
  merchantId: string;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: adj.id,
    merchant_id: adj.merchantId,
    type: adj.type.toLowerCase(),
    amount: adj.amount,
    currency: adj.currency,
    description: adj.description,
    reference: adj.reference,
    metadata: adj.metadata,
    created_at: adj.createdAt.toISOString(),
    updated_at: adj.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const adjustment = await prisma.adjustment.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!adjustment) {
      throw new NotFoundError("ADJUSTMENT_NOT_FOUND", "Adjustment not found.");
    }
    return NextResponse.json({ adjustment: serializeAdjustment(adjustment) });
  },
});
