import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../lib/handler";
import { emitDomainEvent } from "../../../../lib/events";
import { prisma } from "../../../../lib/prisma";

function serializeAdjustment(adj: {
  id: string;
  merchantId: string;
  type: string;
  amount: number;
  currency: string;
  description: string | null;
  reference: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: adj.id,
    merchant_id: adj.merchantId,
    type: adj.type.toLowerCase(),
    amount: adj.amount,
    currency: adj.currency,
    description: adj.description,
    reference: adj.reference,
    metadata: adj.metadata,
    created_at: adj.createdAt.toISOString(),
    updated_at: adj.updatedAt.toISOString(),
  };
}

const createSchema = z.object({
  type: z.enum(["credit", "debit"]),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  description: z.string().max(500).optional(),
  reference: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createSchema,
  handler: async (ctx) => {
    const adjustment = await prisma.$transaction(async (tx) => {
      const created = await tx.adjustment.create({
        data: {
          merchantId: ctx.merchantId,
          type: ctx.body.type.toUpperCase() as "CREDIT" | "DEBIT",
          amount: ctx.body.amount,
          currency: ctx.body.currency,
          description: ctx.body.description,
          reference: ctx.body.reference,
          metadata: ctx.body.metadata ?? {},
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "adjustment.created",
        entityType: "Adjustment",
        entityId: created.id,
        payload: serializeAdjustment(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { adjustment: serializeAdjustment(adjustment) },
      { status: 201 },
    );
  },
});

const listQuery = paginationSchema.extend({
  type: z.enum(["credit", "debit"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuery,
  handler: async (ctx) => {
    const where: Record<string, unknown> = { merchantId: ctx.merchantId };
    if (ctx.query.type) where.type = ctx.query.type.toUpperCase();

    const skip = paginationSkip(ctx.query);
    const [total, adjustments] = await Promise.all([
      prisma.adjustment.count({ where }),
      prisma.adjustment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: adjustments.map(serializeAdjustment),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
