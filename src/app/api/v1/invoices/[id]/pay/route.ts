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

      invoiceMachine.assertTransition(existing.status, "PAID");

      const attemptCount = await tx.invoiceAttempt.count({
        where: { invoiceId: existing.id },
      });
      const attemptNumber = attemptCount + 1;
      const amount = existing.amountDue;

      let newStatus: "PAID" | "UNCOLLECTIBLE" | typeof existing.status;
      let errorMessage: string | null = null;
      let attemptStatus: string;

      if (amount % 10 === 0) {
        newStatus = "PAID";
        attemptStatus = "succeeded";
      } else if (amount % 5 === 0) {
        newStatus = "UNCOLLECTIBLE";
        attemptStatus = "failed";
        errorMessage = "Payment declined by processor.";
      } else {
        newStatus = existing.status;
        attemptStatus = "failed";
        errorMessage = "Payment processing pending.";
      }

      await tx.invoiceAttempt.create({
        data: {
          invoiceId: existing.id,
          attemptNumber,
          amount,
          status: attemptStatus,
          errorMessage,
        },
      });

      const now = new Date();
      const data: Record<string, unknown> = {};

      if (newStatus === "PAID") {
        data.status = "PAID";
        data.amountPaid = existing.total;
        data.amountDue = 0;
        data.paidAt = now;
      } else if (newStatus === "UNCOLLECTIBLE") {
        invoiceMachine.assertTransition(existing.status, "UNCOLLECTIBLE");
        data.status = "UNCOLLECTIBLE";
      }

      const updated = await tx.invoice.update({
        where: { id: existing.id },
        data,
        include: { items: true },
      });

      const eventType =
        newStatus === "PAID"
          ? "invoice.paid"
          : newStatus === "UNCOLLECTIBLE"
            ? "invoice.uncollectible"
            : "invoice.payment_failed";

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: eventType,
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
