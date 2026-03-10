import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../lib/errors";
import { prisma } from "../../../../../lib/prisma";
import { emitDomainEvent } from "../../../../../lib/events";

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

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const product = await prisma.product.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!product) {
      throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found.");
    }
    return NextResponse.json({ product: serializeProduct(product) });
  },
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateProductSchema,
  handler: async (ctx) => {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found.");
      }
      if (existing.status === "ARCHIVED") {
        throw new ConflictError(
          "PRODUCT_ARCHIVED",
          "Cannot update an archived product.",
        );
      }

      const data: Prisma.ProductUpdateInput = {};
      if (ctx.body.name !== undefined) data.name = ctx.body.name;
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.product.update({
        where: { id: existing.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "product.updated",
        entityType: "Product",
        entityId: updated.id,
        payload: serializeProduct(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ product: serializeProduct(product) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const product = await prisma.$transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("PRODUCT_NOT_FOUND", "Product not found.");
      }
      if (existing.status === "ARCHIVED") {
        throw new ConflictError(
          "PRODUCT_ALREADY_ARCHIVED",
          "Product is already archived.",
        );
      }

      const updated = await tx.product.update({
        where: { id: existing.id },
        data: { status: "ARCHIVED" },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "product.archived",
        entityType: "Product",
        entityId: updated.id,
        payload: serializeProduct(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ product: serializeProduct(product) });
  },
});
