import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError, BadRequestError } from "../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../lib/events";
import { prisma } from "../../../../../lib/prisma";
import { serializeInvoice } from "../../../../../lib/serializers";

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const invoice = await prisma.invoice.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
    }
    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  },
});

const updateInvoiceSchema = z.object({
  due_date: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateInvoiceSchema,
  handler: async (ctx) => {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!existing) {
        throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new BadRequestError(
          "INVOICE_NOT_DRAFT",
          "Only draft invoices can be updated.",
        );
      }

      const data: Prisma.InvoiceUpdateInput = {};
      if (ctx.body.due_date !== undefined) data.dueDate = ctx.body.due_date;
      if (ctx.body.metadata !== undefined) {
        data.metadata = ctx.body.metadata as Prisma.InputJsonValue;
      }

      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data,
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

      return updated;
    });

    return NextResponse.json({ invoice: serializeInvoice(invoice) });
  },
});
