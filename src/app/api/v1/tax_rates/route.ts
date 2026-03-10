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

function serializeTaxRate(t: {
  id: string;
  merchantId: string;
  displayName: string;
  description: string | null;
  jurisdiction: string | null;
  percentage: number;
  inclusive: boolean;
  isActive: boolean;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    merchant_id: t.merchantId,
    display_name: t.displayName,
    description: t.description,
    jurisdiction: t.jurisdiction,
    percentage: t.percentage,
    inclusive: t.inclusive,
    is_active: t.isActive,
    metadata: t.metadata,
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

const createTaxRateSchema = z.object({
  display_name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  jurisdiction: z.string().max(200).optional(),
  percentage: z.number().min(0).max(100),
  inclusive: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createTaxRateSchema,
  handler: async (ctx) => {
    const taxRate = await prisma.$transaction(async (tx) => {
      const created = await tx.taxRate.create({
        data: {
          merchantId: ctx.merchantId,
          displayName: ctx.body.display_name,
          description: ctx.body.description,
          jurisdiction: ctx.body.jurisdiction,
          percentage: ctx.body.percentage,
          inclusive: ctx.body.inclusive,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "tax_rate.created",
        entityType: "TaxRate",
        entityId: created.id,
        payload: serializeTaxRate(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { tax_rate: serializeTaxRate(taxRate) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  active: z.enum(["true", "false"]).optional(),
  inclusive: z.enum(["true", "false"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.TaxRateWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.active !== undefined) where.isActive = ctx.query.active === "true";
    if (ctx.query.inclusive !== undefined) where.inclusive = ctx.query.inclusive === "true";

    const skip = paginationSkip(ctx.query);
    const [total, taxRates] = await Promise.all([
      prisma.taxRate.count({ where }),
      prisma.taxRate.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: taxRates.map(serializeTaxRate),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
