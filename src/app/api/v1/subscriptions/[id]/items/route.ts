import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../lib/events";
import { prisma } from "../../../../../../lib/prisma";
import {
  serializeSubscription,
  serializeSubscriptionItem,
} from "../../../../../../lib/serializers";

const addItemSchema = z.object({
  price_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
});

export const POST = createHandler({
  auth: "merchant",
  validate: addItemSchema,
  handler: async (ctx) => {
    const item = await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!subscription) {
        throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
      }
      if (subscription.status === "CANCELED" || subscription.status === "INCOMPLETE_EXPIRED") {
        throw new BadRequestError(
          "SUBSCRIPTION_NOT_ACTIVE",
          "Cannot add items to a terminated subscription.",
        );
      }

      const price = await tx.price.findFirst({
        where: { id: ctx.body.price_id, merchantId: ctx.merchantId },
      });
      if (!price) {
        throw new NotFoundError("PRICE_NOT_FOUND", "Price not found.");
      }

      const created = await tx.subscriptionItem.create({
        data: {
          subscriptionId: subscription.id,
          priceId: price.id,
          quantity: ctx.body.quantity,
        },
      });

      const updated = await tx.subscription.findUniqueOrThrow({
        where: { id: subscription.id },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.updated",
        entityType: "Subscription",
        entityId: subscription.id,
        payload: serializeSubscription(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { subscription_item: serializeSubscriptionItem(item) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const subscription = await prisma.subscription.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
      select: { id: true },
    });
    if (!subscription) {
      throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
    }

    const skip = paginationSkip(ctx.query);
    const [total, items] = await Promise.all([
      prisma.subscriptionItem.count({
        where: { subscriptionId: subscription.id },
      }),
      prisma.subscriptionItem.findMany({
        where: { subscriptionId: subscription.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: items.map(serializeSubscriptionItem),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
