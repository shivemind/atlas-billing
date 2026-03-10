import { NextResponse } from "next/server";

import { createHandler } from "../../../../../../lib/handler";
import { NotFoundError } from "../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../lib/events";
import { prisma } from "../../../../../../lib/prisma";
import { serializeInvoice } from "../../../../../../lib/serializers";
import { invoiceMachine } from "../../route";

export const POST = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const invoice = await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
        include: { items: true },
      });
      if (!existing) {
        throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
      }

      invoiceMachine.assertTransition(existing.status, "OPEN");

      const subtotal = existing.items.reduce((sum, item) => sum + item.amount, 0);
      const total = subtotal + existing.tax;

      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data: {
          status: "OPEN",
          subtotal,
          total,
          amountDue: total - existing.amountPaid,
        },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.finalized",
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
