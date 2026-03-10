import { NextResponse } from "next/server";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../../../lib/handler";
import { NotFoundError } from "../../../../../../lib/errors";
import { prisma } from "../../../../../../lib/prisma";

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

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const product = await prisma.product.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!product) {
      throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found.");
    }

    const where = { merchantId: ctx.merchantId, productId: product.id };
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
