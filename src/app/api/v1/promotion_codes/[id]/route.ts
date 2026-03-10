import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";
import { emitDomainEvent } from "../../../../../lib/events";

function serializePromotionCode(pc: {
  id: string;
  merchantId: string;
  couponId: string;
  code: string;
  isActive: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: Date | null;
  restrictions: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: pc.id,
    merchant_id: pc.merchantId,
    coupon_id: pc.couponId,
    code: pc.code,
    is_active: pc.isActive,
    max_redemptions: pc.maxRedemptions,
    times_redeemed: pc.timesRedeemed,
    expires_at: pc.expiresAt?.toISOString() ?? null,
    restrictions: pc.restrictions,
    metadata: pc.metadata,
    created_at: pc.createdAt.toISOString(),
    updated_at: pc.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const code = await prisma.promotionCode.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!code) {
      throw new NotFoundError(
        "PROMOTION_CODE_NOT_FOUND",
        "Promotion code not found.",
      );
    }
    return NextResponse.json({ promotion_code: serializePromotionCode(code) });
  },
});

const updatePromotionCodeSchema = z.object({
  is_active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updatePromotionCodeSchema,
  handler: async (ctx) => {
    const promoCode = await prisma.$transaction(async (tx) => {
      const existing = await tx.promotionCode.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError(
          "PROMOTION_CODE_NOT_FOUND",
          "Promotion code not found.",
        );
      }

      const data: Record<string, unknown> = {};
      if (ctx.body.is_active !== undefined) data.isActive = ctx.body.is_active;
      if (ctx.body.metadata !== undefined) data.metadata = ctx.body.metadata;

      const updated = await tx.promotionCode.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "promotion_code.updated",
        entityType: "PromotionCode",
        entityId: updated.id,
        payload: serializePromotionCode(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({
      promotion_code: serializePromotionCode(promoCode),
    });
  },
});
