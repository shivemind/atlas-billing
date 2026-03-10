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

function serializeProduct(p: {
  id: string;
  merchantId: string;
  name: string;
  description: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    merchant_id: p.merchantId,
    name: p.name,
    description: p.description,
    status: p.status.toLowerCase(),
    metadata: p.metadata,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createProductSchema,
  handler: async (ctx) => {
    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          merchantId: ctx.merchantId,
          name: ctx.body.name,
          description: ctx.body.description,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "product.created",
        entityType: "Product",
        entityId: created.id,
        payload: serializeProduct(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { product: serializeProduct(product) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  status: z.enum(["active", "archived"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.ProductWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.status) {
      where.status = ctx.query.status.toUpperCase() as Prisma.EnumProductStatusFilter["equals"];
    }

    const skip = paginationSkip(ctx.query);
    const [total, products] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: products.map(serializeProduct),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
