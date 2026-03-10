import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../lib/handler";
import { prisma } from "../../../../lib/prisma";
import { emitDomainEvent } from "../../../../lib/events";

function serializeCoupon(c: {
  id: string;
  merchantId: string;
  name: string;
  amountOff: number | null;
  percentOff: number | null;
  currency: string | null;
  duration: string;
  durationInMonths: number | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  isActive: boolean;
  redeemBy: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    merchant_id: c.merchantId,
    name: c.name,
    amount_off: c.amountOff,
    percent_off: c.percentOff,
    currency: c.currency,
    duration: c.duration.toLowerCase(),
    duration_in_months: c.durationInMonths,
    max_redemptions: c.maxRedemptions,
    times_redeemed: c.timesRedeemed,
    is_active: c.isActive,
    redeem_by: c.redeemBy?.toISOString() ?? null,
    metadata: c.metadata,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

const createCouponSchema = z
  .object({
    name: z.string().min(1).max(200),
    amount_off: z.number().int().positive().optional(),
    percent_off: z.number().min(0.01).max(100).optional(),
    currency: z.string().length(3).optional(),
    duration: z.enum(["once", "repeating", "forever"]).default("once"),
    duration_in_months: z.number().int().min(1).optional(),
    max_redemptions: z.number().int().min(1).optional(),
    redeem_by: z.string().datetime().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (d) => (d.amount_off !== undefined) !== (d.percent_off !== undefined),
    { message: "Provide exactly one of amount_off or percent_off", path: ["amount_off"] },
  )
  .refine(
    (d) => d.amount_off === undefined || d.currency !== undefined,
    { message: "currency is required when amount_off is set", path: ["currency"] },
  )
  .refine(
    (d) => d.duration !== "repeating" || d.duration_in_months !== undefined,
    { message: "duration_in_months is required for repeating coupons", path: ["duration_in_months"] },
  );

export const POST = createHandler({
  auth: "merchant",
  validate: createCouponSchema,
  handler: async (ctx) => {
    const coupon = await prisma.$transaction(async (tx) => {
      const created = await tx.coupon.create({
        data: {
          merchantId: ctx.merchantId,
          name: ctx.body.name,
          amountOff: ctx.body.amount_off,
          percentOff: ctx.body.percent_off,
          currency: ctx.body.currency?.toLowerCase(),
          duration: ctx.body.duration.toUpperCase() as "ONCE" | "REPEATING" | "FOREVER",
          durationInMonths: ctx.body.duration_in_months,
          maxRedemptions: ctx.body.max_redemptions,
          redeemBy: ctx.body.redeem_by ? new Date(ctx.body.redeem_by) : undefined,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "coupon.created",
        entityType: "Coupon",
        entityId: created.id,
        payload: serializeCoupon(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { coupon: serializeCoupon(coupon) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const where = { merchantId: ctx.merchantId };
    const skip = paginationSkip(ctx.query);
    const [total, coupons] = await Promise.all([
      prisma.coupon.count({ where }),
      prisma.coupon.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: coupons.map(serializeCoupon),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
