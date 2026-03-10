import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../lib/events";
import { prisma } from "../../../../../lib/prisma";

function serializeCreditNote(cn: {
  id: string;
  merchantId: string;
  invoiceId: string;
  number: string | null;
  status: string;
  reason: string | null;
  amount: number;
  currency: string;
  voidedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: cn.id,
    merchant_id: cn.merchantId,
    invoice_id: cn.invoiceId,
    number: cn.number,
    status: cn.status.toLowerCase(),
    reason: cn.reason,
    amount: cn.amount,
    currency: cn.currency,
    voided_at: cn.voidedAt?.toISOString() ?? null,
    metadata: cn.metadata,
    created_at: cn.createdAt.toISOString(),
    updated_at: cn.updatedAt.toISOString(),
  };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const cn = await prisma.creditNote.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!cn) {
      throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
    }
    return NextResponse.json({ credit_note: serializeCreditNote(cn) });
  },
});

const updateSchema = z.object({
  reason: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateSchema,
  handler: async (ctx) => {
    const updated = await prisma.$transaction(async (tx) => {
      const cn = await tx.creditNote.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!cn) {
        throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
      }
      if (cn.status === "VOID") {
        throw new ConflictError(
          "CREDIT_NOTE_VOID",
          "Cannot update a voided credit note.",
        );
      }

      const data: Record<string, unknown> = {};
      if (ctx.body.reason !== undefined) data.reason = ctx.body.reason;
      if (ctx.body.metadata !== undefined) data.metadata = ctx.body.metadata;

      const result = await tx.creditNote.update({
        where: { id: cn.id },
        data,
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "credit_note.updated",
        entityType: "CreditNote",
        entityId: result.id,
        payload: serializeCreditNote(result) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return result;
    });

    return NextResponse.json({ credit_note: serializeCreditNote(updated) });
  },
});
