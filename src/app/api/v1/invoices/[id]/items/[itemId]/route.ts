import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../../lib/events";
import { prisma } from "../../../../../../../lib/prisma";
import { serializeInvoice, serializeInvoiceItem } from "../../../../../../../lib/serializers";

function findItem(merchantId: string, invoiceId: string, itemId: string) {
  return prisma.invoiceItem.findFirst({
    where: {
      id: itemId,
      invoiceId,
      invoice: { merchantId },
    },
    include: { invoice: true },
  });
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const row = await findItem(ctx.merchantId, ctx.params.id, ctx.params.itemId);
    if (!row) {
      throw new NotFoundError("INVOICE_ITEM_NOT_FOUND", "Invoice item not found.");
    }
    return NextResponse.json({ invoice_item: serializeInvoiceItem(row) });
  },
});

const updateItemSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  quantity: z.number().int().min(1).optional(),
  unit_amount: z.number().int().min(0).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateItemSchema,
  handler: async (ctx) => {
    const item = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoiceItem.findFirst({
        where: {
          id: ctx.params.itemId,
          invoiceId: ctx.params.id,
          invoice: { merchantId: ctx.merchantId },
        },
        include: { invoice: true },
      });
      if (!existing) {
        throw new NotFoundError("INVOICE_ITEM_NOT_FOUND", "Invoice item not found.");
      }
      if (existing.invoice.status !== "DRAFT") {
        throw new BadRequestError(
          "INVOICE_NOT_DRAFT",
          "Items can only be updated on draft invoices.",
        );
      }

      const quantity = ctx.body.quantity ?? existing.quantity;
      const unitAmount = ctx.body.unit_amount ?? existing.unitAmount;
      const amount = unitAmount * quantity;

      const data: Prisma.InvoiceItemUpdateInput = {
        quantity,
        unitAmount,
        amount,
      };
      if (ctx.body.description !== undefined) data.description = ctx.body.description;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.invoiceItem.update({
        where: { id: existing.id },
        data,
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoiceId: ctx.params.id },
      });
      const subtotal = allItems.reduce((sum, i) => sum + i.amount, 0);
      const total = subtotal + existing.invoice.tax;

      const inv = await tx.invoice.update({
        where: { id: ctx.params.id },
        data: { subtotal, total, amountDue: total - existing.invoice.amountPaid },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.updated",
        entityType: "Invoice",
        entityId: inv.id,
        payload: serializeInvoice(inv) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return updated;
    });

    return NextResponse.json({ invoice_item: serializeInvoiceItem(item) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.invoiceItem.findFirst({
        where: {
          id: ctx.params.itemId,
          invoiceId: ctx.params.id,
          invoice: { merchantId: ctx.merchantId },
        },
        include: { invoice: true },
      });
      if (!existing) {
        throw new NotFoundError("INVOICE_ITEM_NOT_FOUND", "Invoice item not found.");
      }
      if (existing.invoice.status !== "DRAFT") {
        throw new BadRequestError(
          "INVOICE_NOT_DRAFT",
          "Items can only be removed from draft invoices.",
        );
      }

      await tx.invoiceItem.delete({ where: { id: existing.id } });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoiceId: ctx.params.id },
      });
      const subtotal = allItems.reduce((sum, i) => sum + i.amount, 0);
      const total = subtotal + existing.invoice.tax;

      const inv = await tx.invoice.update({
        where: { id: ctx.params.id },
        data: { subtotal, total, amountDue: total - existing.invoice.amountPaid },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.updated",
        entityType: "Invoice",
        entityId: inv.id,
        payload: serializeInvoice(inv) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true });
  },
});
