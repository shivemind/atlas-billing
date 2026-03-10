import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../lib/errors";
import { emitDomainEvent } from "../../../../lib/events";
import { prisma } from "../../../../lib/prisma";
import { serializeSubscription } from "../../../../lib/serializers";
import { defineTransitions } from "../../../../lib/state-machine";

type SubStatus =
  | "INCOMPLETE"
  | "INCOMPLETE_EXPIRED"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "PAUSED"
  | "CANCELED"
  | "UNPAID";

export const subscriptionMachine = defineTransitions<SubStatus>({
  INCOMPLETE: ["ACTIVE", "INCOMPLETE_EXPIRED", "CANCELED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCELED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELED"],
  PAST_DUE: ["ACTIVE", "UNPAID", "CANCELED"],
  PAUSED: ["ACTIVE", "CANCELED"],
  UNPAID: ["ACTIVE", "CANCELED"],
  INCOMPLETE_EXPIRED: [],
  CANCELED: [],
});

function addPeriod(start: Date, interval: string, count: number): Date {
  const end = new Date(start);
  switch (interval) {
    case "DAY":
      end.setDate(end.getDate() + count);
      break;
    case "WEEK":
      end.setDate(end.getDate() + count * 7);
      break;
    case "MONTH":
      end.setMonth(end.getMonth() + count);
      break;
    case "YEAR":
      end.setFullYear(end.getFullYear() + count);
      break;
  }
  return end;
}

const itemSchema = z.object({
  price_id: z.string().min(1),
  quantity: z.number().int().min(1).default(1),
});

const createSubscriptionSchema = z.object({
  customer_id: z.string().min(1),
  items: z.array(itemSchema).min(1),
  default_payment_method: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  idempotent: true,
  validate: createSubscriptionSchema,
  handler: async (ctx) => {
    const subscription = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: ctx.body.customer_id, merchantId: ctx.merchantId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundError("CUSTOMER_NOT_FOUND", "Customer not found.");
      }

      const priceIds = ctx.body.items.map((i: { price_id: string }) => i.price_id);
      const prices = await tx.price.findMany({
        where: { id: { in: priceIds }, merchantId: ctx.merchantId },
      });
      if (prices.length !== priceIds.length) {
        throw new NotFoundError("PRICE_NOT_FOUND", "One or more prices not found.");
      }

      const recurringPrice = prices.find((p) => p.type === "RECURRING");
      if (!recurringPrice || !recurringPrice.billingInterval) {
        throw new BadRequestError(
          "NO_RECURRING_PRICE",
          "At least one price must be recurring with a billing_interval.",
        );
      }

      const now = new Date();
      const hasTrialDays = recurringPrice.trialDays && recurringPrice.trialDays > 0;
      const periodEnd = addPeriod(
        now,
        recurringPrice.billingInterval,
        recurringPrice.intervalCount,
      );
      const trialEnd = hasTrialDays
        ? new Date(now.getTime() + recurringPrice.trialDays! * 86400000)
        : null;

      const status = hasTrialDays ? "TRIALING" : "ACTIVE";

      const created = await tx.subscription.create({
        data: {
          merchantId: ctx.merchantId,
          customerId: customer.id,
          status,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialStart: hasTrialDays ? now : null,
          trialEnd,
          defaultPaymentMethod: ctx.body.default_payment_method,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
          items: {
            create: ctx.body.items.map((item: { price_id: string; quantity: number }) => ({
              priceId: item.price_id,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });

      const subtotal = ctx.body.items.reduce((sum: number, item: { price_id: string; quantity: number }) => {
        const price = prices.find((p) => p.id === item.price_id)!;
        return sum + price.unitAmount * item.quantity;
      }, 0);

      const invoiceNumber = `INV-${Date.now()}`;
      await tx.invoice.create({
        data: {
          merchantId: ctx.merchantId,
          customerId: customer.id,
          subscriptionId: created.id,
          number: invoiceNumber,
          status: hasTrialDays ? "DRAFT" : "OPEN",
          currency: recurringPrice.currency,
          subtotal,
          tax: 0,
          total: subtotal,
          amountPaid: 0,
          amountDue: subtotal,
          dueDate: periodEnd,
          periodStart: now,
          periodEnd,
          items: {
            create: ctx.body.items.map((item: { price_id: string; quantity: number }) => {
              const price = prices.find((p) => p.id === item.price_id)!;
              return {
                description: `${price.nickname ?? price.id} x ${item.quantity}`,
                quantity: item.quantity,
                unitAmount: price.unitAmount,
                amount: price.unitAmount * item.quantity,
                currency: price.currency,
                priceId: price.id,
              };
            }),
          },
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "subscription.created",
        entityType: "Subscription",
        entityId: created.id,
        payload: serializeSubscription(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { subscription: serializeSubscription(subscription) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  customer_id: z.string().optional(),
  status: z
    .enum([
      "incomplete",
      "incomplete_expired",
      "trialing",
      "active",
      "past_due",
      "paused",
      "canceled",
      "unpaid",
    ])
    .optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.SubscriptionWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.customer_id) where.customerId = ctx.query.customer_id;
    if (ctx.query.status) {
      where.status = ctx.query.status.toUpperCase() as Prisma.EnumSubscriptionStatusFilter["equals"];
    }

    const skip = paginationSkip(ctx.query);
    const [total, subscriptions] = await Promise.all([
      prisma.subscription.count({ where }),
      prisma.subscription.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: subscriptions.map(serializeSubscription),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
