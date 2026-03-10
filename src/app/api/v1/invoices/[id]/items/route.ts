import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../lib/events";
import { prisma } from "../../../../../../lib/prisma";
import { serializeInvoice, serializeInvoiceItem } from "../../../../../../lib/serializers";

const addItemSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().min(1).default(1),
  unit_amount: z.number().int().min(0),
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toLowerCase()),
  price_id: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: addItemSchema,
  handler: async (ctx) => {
    const item = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!invoice) {
        throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
      }
      if (invoice.status !== "DRAFT") {
        throw new BadRequestError(
          "INVOICE_NOT_DRAFT",
          "Items can only be added to draft invoices.",
        );
      }

      const amount = ctx.body.unit_amount * ctx.body.quantity;

      const created = await tx.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          description: ctx.body.description,
          quantity: ctx.body.quantity,
          unitAmount: ctx.body.unit_amount,
          amount,
          currency: ctx.body.currency,
          priceId: ctx.body.price_id,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      const allItems = await tx.invoiceItem.findMany({
        where: { invoiceId: invoice.id },
      });
      const subtotal = allItems.reduce((sum, i) => sum + i.amount, 0);
      const total = subtotal + invoice.tax;

      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { subtotal, total, amountDue: total - invoice.amountPaid },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.updated",
        entityType: "Invoice",
        entityId: updated.id,
        payload: serializeInvoice(updated) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { invoice_item: serializeInvoiceItem(item) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const invoice = await prisma.invoice.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
      select: { id: true },
    });
    if (!invoice) {
      throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
    }

    const skip = paginationSkip(ctx.query);
    const [total, items] = await Promise.all([
      prisma.invoiceItem.count({ where: { invoiceId: invoice.id } }),
      prisma.invoiceItem.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: items.map(serializeInvoiceItem),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
