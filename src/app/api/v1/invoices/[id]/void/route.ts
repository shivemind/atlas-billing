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
      });
      if (!existing) {
        throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
      }

      invoiceMachine.assertTransition(existing.status, "VOID");

      const now = new Date();
      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data: {
          status: "VOID",
          voidedAt: now,
        },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.voided",
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
