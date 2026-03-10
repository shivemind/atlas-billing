import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";
import { emitDomainEvent } from "../../../../../lib/events";

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

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const coupon = await prisma.coupon.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!coupon) {
      throw new NotFoundError("COUPON_NOT_FOUND", "Coupon not found.");
    }
    return NextResponse.json({ coupon: serializeCoupon(coupon) });
  },
});

const updateCouponSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateCouponSchema,
  handler: async (ctx) => {
    const coupon = await prisma.$transaction(async (tx) => {
      const existing = await tx.coupon.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("COUPON_NOT_FOUND", "Coupon not found.");
      }
      if (!existing.isActive) {
        throw new ConflictError(
          "COUPON_INACTIVE",
          "Cannot update an inactive coupon.",
        );
      }

      const data: Prisma.CouponUpdateInput = {};
      if (ctx.body.name !== undefined) data.name = ctx.body.name;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.coupon.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "coupon.updated",
        entityType: "Coupon",
        entityId: updated.id,
        payload: serializeCoupon(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ coupon: serializeCoupon(coupon) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const coupon = await prisma.$transaction(async (tx) => {
      const existing = await tx.coupon.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("COUPON_NOT_FOUND", "Coupon not found.");
      }
      if (!existing.isActive) {
        throw new ConflictError(
          "COUPON_ALREADY_INACTIVE",
          "Coupon is already inactive.",
        );
      }

      const updated = await tx.coupon.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "coupon.deactivated",
        entityType: "Coupon",
        entityId: updated.id,
        payload: serializeCoupon(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ coupon: serializeCoupon(coupon) });
  },
});
