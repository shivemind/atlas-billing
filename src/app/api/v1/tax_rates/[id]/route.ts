import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";
import { emitDomainEvent } from "../../../../../lib/events";

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

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const taxRate = await prisma.taxRate.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!taxRate) {
      throw new NotFoundError("TAX_RATE_NOT_FOUND", "Tax rate not found.");
    }
    return NextResponse.json({ tax_rate: serializeTaxRate(taxRate) });
  },
});

const updateTaxRateSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  jurisdiction: z.string().max(200).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateTaxRateSchema,
  handler: async (ctx) => {
    const taxRate = await prisma.$transaction(async (tx) => {
      const existing = await tx.taxRate.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("TAX_RATE_NOT_FOUND", "Tax rate not found.");
      }
      if (!existing.isActive) {
        throw new ConflictError(
          "TAX_RATE_INACTIVE",
          "Cannot update an inactive tax rate.",
        );
      }

      const data: Prisma.TaxRateUpdateInput = {};
      if (ctx.body.display_name !== undefined) data.displayName = ctx.body.display_name;
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.jurisdiction !== undefined) data.jurisdiction = ctx.body.jurisdiction;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.taxRate.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "tax_rate.updated",
        entityType: "TaxRate",
        entityId: updated.id,
        payload: serializeTaxRate(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ tax_rate: serializeTaxRate(taxRate) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const taxRate = await prisma.$transaction(async (tx) => {
      const existing = await tx.taxRate.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("TAX_RATE_NOT_FOUND", "Tax rate not found.");
      }
      if (!existing.isActive) {
        throw new ConflictError(
          "TAX_RATE_ALREADY_INACTIVE",
          "Tax rate is already inactive.",
        );
      }

      const updated = await tx.taxRate.update({
        where: { id: existing.id },
        data: { isActive: false },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "tax_rate.deactivated",
        entityType: "TaxRate",
        entityId: updated.id,
        payload: serializeTaxRate(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ tax_rate: serializeTaxRate(taxRate) });
  },
});
