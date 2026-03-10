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
import { prisma } from "../../../../lib/prisma";
import { emitDomainEvent } from "../../../../lib/events";

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

const createPriceSchema = z
  .object({
    product_id: z.string().min(1),
    nickname: z.string().max(200).optional(),
    type: z.enum(["one_time", "recurring"]).default("one_time"),
    currency: z.string().length(3),
    unit_amount: z.number().int().min(1),
    billing_interval: z.enum(["day", "week", "month", "year"]).optional(),
    interval_count: z.number().int().min(1).default(1),
    trial_days: z.number().int().min(0).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (d) => d.type !== "recurring" || d.billing_interval !== undefined,
    { message: "billing_interval is required for recurring prices", path: ["billing_interval"] },
  );

export const POST = createHandler({
  auth: "merchant",
  validate: createPriceSchema,
  handler: async (ctx) => {
    const price = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: ctx.body.product_id, merchantId: ctx.merchantId },
      });
      if (!product) {
        throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found.");
      }
      if (product.status === "ARCHIVED") {
        throw new BadRequestError(
          "PRODUCT_ARCHIVED",
          "Cannot create a price for an archived product.",
        );
      }

      const created = await tx.price.create({
        data: {
          merchantId: ctx.merchantId,
          productId: product.id,
          nickname: ctx.body.nickname,
          type: ctx.body.type.toUpperCase() as "ONE_TIME" | "RECURRING",
          currency: ctx.body.currency.toLowerCase(),
          unitAmount: ctx.body.unit_amount,
          billingInterval: ctx.body.billing_interval
            ? (ctx.body.billing_interval.toUpperCase() as "DAY" | "WEEK" | "MONTH" | "YEAR")
            : null,
          intervalCount: ctx.body.interval_count,
          trialDays: ctx.body.trial_days,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "price.created",
        entityType: "Price",
        entityId: created.id,
        payload: serializePrice(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { price: serializePrice(price) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  product_id: z.string().optional(),
  active: z.enum(["true", "false"]).optional(),
  type: z.enum(["one_time", "recurring"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.PriceWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.product_id) where.productId = ctx.query.product_id;
    if (ctx.query.active !== undefined) where.isActive = ctx.query.active === "true";
    if (ctx.query.type) where.type = ctx.query.type.toUpperCase() as "ONE_TIME" | "RECURRING";

    const skip = paginationSkip(ctx.query);
    const [total, prices] = await Promise.all([
      prisma.price.count({ where }),
      prisma.price.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: prices.map(serializePrice),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
