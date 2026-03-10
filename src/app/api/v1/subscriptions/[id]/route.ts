import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError } from "../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../lib/events";
import { prisma } from "../../../../../lib/prisma";
import { serializeSubscription } from "../../../../../lib/serializers";

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const subscription = await prisma.subscription.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
      include: { items: true },
    });
    if (!subscription) {
      throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }
    return NextResponse.json({ subscription: serializeSubscription(subscription) });
  },
});

const updateSubscriptionSchema = z.object({
  default_payment_method: z.string().min(1).optional(),
  cancel_at_period_end: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateSubscriptionSchema,
  handler: async (ctx) => {
    const subscription = await prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
      }

      const data: Prisma.SubscriptionUpdateInput = {};
      if (ctx.body.default_payment_method !== undefined) {
        data.defaultPaymentMethod = ctx.body.default_payment_method;
      }
      if (ctx.body.cancel_at_period_end !== undefined) {
        data.cancelAtPeriodEnd = ctx.body.cancel_at_period_end;
      }
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.subscription.update({
        where: { id: existing.id },
        data,
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.updated",
        entityType: "Subscription",
        entityId: updated.id,
        payload: serializeSubscription(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ subscription: serializeSubscription(subscription) });
  },
});
