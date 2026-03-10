import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "../../../../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../../lib/events";
import { prisma } from "../../../../../../../lib/prisma";
import {
  serializeSubscription,
  serializeSubscriptionItem,
} from "../../../../../../../lib/serializers";

function findItem(merchantId: string, subscriptionId: string, itemId: string) {
  return prisma.subscriptionItem.findFirst({
    where: {
      id: itemId,
      subscriptionId,
      subscription: { merchantId },
    },
  });
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const item = await findItem(ctx.merchantId, ctx.params.id, ctx.params.itemId);
    if (!item) {
      throw new NotFoundError("SUBSCRIPTION_ITEM_NOT_FOUND", "Subscription item not found.");
    }
    return NextResponse.json({ subscription_item: serializeSubscriptionItem(item) });
  },
});

const updateItemSchema = z.object({
  quantity: z.number().int().min(1),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateItemSchema,
  handler: async (ctx) => {
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionItem.findFirst({
        where: {
          id: ctx.params.itemId,
          subscriptionId: ctx.params.id,
          subscription: { merchantId: ctx.merchantId },
        },
        include: { subscription: true },
      });
      if (!existing) {
        throw new NotFoundError("SUBSCRIPTION_ITEM_NOT_FOUND", "Subscription item not found.");
      }
      if (
        existing.subscription.status === "CANCELED" ||
        existing.subscription.status === "INCOMPLETE_EXPIRED"
      ) {
        throw new BadRequestError(
          "SUBSCRIPTION_NOT_ACTIVE",
          "Cannot update items on a terminated subscription.",
        );
      }

      const updated = await tx.subscriptionItem.update({
        where: { id: existing.id },
        data: { quantity: ctx.body.quantity },
      });

      const sub = await tx.subscription.findUniqueOrThrow({
        where: { id: ctx.params.id },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.updated",
        entityType: "Subscription",
        entityId: sub.id,
        payload: serializeSubscription(sub) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ subscription_item: serializeSubscriptionItem(item) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.subscriptionItem.findFirst({
        where: {
          id: ctx.params.itemId,
          subscriptionId: ctx.params.id,
          subscription: { merchantId: ctx.merchantId },
        },
        include: { subscription: true },
      });
      if (!existing) {
        throw new NotFoundError("SUBSCRIPTION_ITEM_NOT_FOUND", "Subscription item not found.");
      }
      if (
        existing.subscription.status === "CANCELED" ||
        existing.subscription.status === "INCOMPLETE_EXPIRED"
      ) {
        throw new BadRequestError(
          "SUBSCRIPTION_NOT_ACTIVE",
          "Cannot remove items from a terminated subscription.",
        );
      }

      const remainingCount = await tx.subscriptionItem.count({
        where: { subscriptionId: ctx.params.id, id: { not: existing.id } },
      });
      if (remainingCount === 0) {
        throw new BadRequestError(
          "LAST_ITEM",
          "Cannot remove the last item. Cancel the subscription instead.",
        );
      }

      await tx.subscriptionItem.delete({ where: { id: existing.id } });

      const sub = await tx.subscription.findUniqueOrThrow({
        where: { id: ctx.params.id },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.updated",
        entityType: "Subscription",
        entityId: sub.id,
        payload: serializeSubscription(sub) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true });
  },
});
