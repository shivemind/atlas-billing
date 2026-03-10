import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";
import { emitDomainEvent } from "../../../../../lib/events";

function serializePrice(p: {
  id: string;
  merchantId: string;
  productId: string;
  nickname: string | null;
  type: string;
  currency: string;
  unitAmount: number;
  billingInterval: string | null;
  intervalCount: number;
  trialDays: number | null;
  isActive: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    merchant_id: p.merchantId,
    product_id: p.productId,
    nickname: p.nickname,
    type: p.type.toLowerCase(),
    currency: p.currency,
    unit_amount: p.unitAmount,
    billing_interval: p.billingInterval?.toLowerCase() ?? null,
    interval_count: p.intervalCount,
    trial_days: p.trialDays,
    is_active: p.isActive,
    metadata: p.metadata,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const price = await prisma.price.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!price) {
      throw new NotFoundError("PRICE_NOT_FOUND", "Price not found.");
    }
    return NextResponse.json({ price: serializePrice(price) });
  },
});

const updatePriceSchema = z.object({
  nickname: z.string().max(200).nullish(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updatePriceSchema,
  handler: async (ctx) => {
    const price = await prisma.$transaction(async (tx) => {
      const existing = await tx.price.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("PRICE_NOT_FOUND", "Price not found.");
      }

      const data: Record<string, unknown> = {};
      if (ctx.body.nickname !== undefined) data.nickname = ctx.body.nickname;
      if (ctx.body.is_active !== undefined) data.isActive = ctx.body.is_active;
      if (ctx.body.metadata !== undefined) data.metadata = ctx.body.metadata;

      const updated = await tx.price.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "price.updated",
        entityType: "Price",
        entityId: updated.id,
        payload: serializePrice(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ price: serializePrice(price) });
  },
});
