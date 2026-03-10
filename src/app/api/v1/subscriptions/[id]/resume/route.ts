import { NextResponse } from "next/server";

import { createHandler } from "../../../../../../lib/handler";
import { NotFoundError } from "../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../lib/events";
import { prisma } from "../../../../../../lib/prisma";
import { serializeSubscription } from "../../../../../../lib/serializers";
import { subscriptionMachine } from "../../route";

export const POST = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const subscription = await prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
      }

      subscriptionMachine.assertTransition(existing.status, "ACTIVE");

      const updated = await tx.subscription.update({
        where: { id: existing.id },
        data: { status: "ACTIVE" },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.resumed",
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
