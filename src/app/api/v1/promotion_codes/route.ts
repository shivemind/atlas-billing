import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../lib/errors";
import { prisma } from "../../../../lib/prisma";
import { emitDomainEvent } from "../../../../lib/events";

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

const createPromotionCodeSchema = z.object({
  coupon_id: z.string().min(1),
  code: z.string().min(1).max(100),
  max_redemptions: z.number().int().min(1).optional(),
  expires_at: z.string().datetime().optional(),
  restrictions: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createPromotionCodeSchema,
  handler: async (ctx) => {
    const promoCode = await prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.findFirst({
        where: { id: ctx.body.coupon_id, merchantId: ctx.merchantId },
      });
      if (!coupon) {
        throw new NotFoundError("COUPON_NOT_FOUND", "Coupon not found.");
      }
      if (!coupon.isActive) {
        throw new ConflictError(
          "COUPON_INACTIVE",
          "Cannot create a promotion code for an inactive coupon.",
        );
      }

      const existing = await tx.promotionCode.findUnique({
        where: { merchantId_code: { merchantId: ctx.merchantId, code: ctx.body.code } },
      });
      if (existing) {
        throw new ConflictError(
          "PROMOTION_CODE_EXISTS",
          "A promotion code with this code already exists.",
        );
      }

      const created = await tx.promotionCode.create({
        data: {
          merchantId: ctx.merchantId,
          couponId: coupon.id,
          code: ctx.body.code,
          maxRedemptions: ctx.body.max_redemptions,
          expiresAt: ctx.body.expires_at ? new Date(ctx.body.expires_at) : undefined,
          restrictions: ctx.body.restrictions as Prisma.InputJsonValue | undefined,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "promotion_code.created",
        entityType: "PromotionCode",
        entityId: created.id,
        payload: serializePromotionCode(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { promotion_code: serializePromotionCode(promoCode) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  coupon_id: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.PromotionCodeWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.coupon_id) where.couponId = ctx.query.coupon_id;
    if (ctx.query.active !== undefined) where.isActive = ctx.query.active === "true";

    const skip = paginationSkip(ctx.query);
    const [total, codes] = await Promise.all([
      prisma.promotionCode.count({ where }),
      prisma.promotionCode.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: codes.map(serializePromotionCode),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
