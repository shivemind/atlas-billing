import { NextResponse } from "next/server";
import { z } from "zod";

import { createHandler } from "../../../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../../lib/events";
import { prisma } from "../../../../../../../lib/prisma";

function serializeLineItem(line: {
  id: string;
  creditNoteId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  createdAt: Date;
}) {
  return {
    id: line.id,
    credit_note_id: line.creditNoteId,
    description: line.description,
    quantity: line.quantity,
    unit_amount: line.unitAmount,
    amount: line.amount,
    created_at: line.createdAt.toISOString(),
  };
}

async function findLineItem(merchantId: string, creditNoteId: string, lineId: string) {
  const cn = await prisma.creditNote.findFirst({
    where: { id: creditNoteId, merchantId },
  });
  if (!cn) {
    throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
  }

  const line = await prisma.creditNoteLineItem.findFirst({
    where: { id: lineId, creditNoteId: cn.id },
  });
  if (!line) {
    throw new NotFoundError("LINE_ITEM_NOT_FOUND", "Line item not found.");
  }

  return { cn, line };
}

export const GET = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    const { line } = await findLineItem(ctx.merchantId, ctx.params.id, ctx.params.lineId);
    return NextResponse.json({ line_item: serializeLineItem(line) });
  },
});

const updateLineSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  quantity: z.number().int().positive().optional(),
  unit_amount: z.number().int().positive().optional(),
});

export const PATCH = createHandler({
  auth: "merchant",
  validate: updateLineSchema,
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
          "Cannot update lines on a voided credit note.",
        );
      }

      const line = await tx.creditNoteLineItem.findFirst({
        where: { id: ctx.params.lineId, creditNoteId: cn.id },
      });
      if (!line) {
        throw new NotFoundError("LINE_ITEM_NOT_FOUND", "Line item not found.");
      }

      const quantity = ctx.body.quantity ?? line.quantity;
      const unitAmount = ctx.body.unit_amount ?? line.unitAmount;
      const amount = quantity * unitAmount;

      const result = await tx.creditNoteLineItem.update({
        where: { id: line.id },
        data: {
          description: ctx.body.description ?? line.description,
          quantity,
          unitAmount,
          amount,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "credit_note.line_item.updated",
        entityType: "CreditNoteLineItem",
        entityId: result.id,
        payload: serializeLineItem(result) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return result;
    });

    return NextResponse.json({ line_item: serializeLineItem(updated) });
  },
});

export const DELETE = createHandler({
  auth: "merchant",
  handler: async (ctx) => {
    await prisma.$transaction(async (tx) => {
      const cn = await tx.creditNote.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!cn) {
        throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
      }
      if (cn.status === "VOID") {
        throw new ConflictError(
          "CREDIT_NOTE_VOID",
          "Cannot delete lines on a voided credit note.",
        );
      }

      const line = await tx.creditNoteLineItem.findFirst({
        where: { id: ctx.params.lineId, creditNoteId: cn.id },
      });
      if (!line) {
        throw new NotFoundError("LINE_ITEM_NOT_FOUND", "Line item not found.");
      }

      await tx.creditNoteLineItem.delete({ where: { id: line.id } });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "credit_note.line_item.deleted",
        entityType: "CreditNoteLineItem",
        entityId: line.id,
        payload: serializeLineItem(line) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });
    });

    return NextResponse.json({ deleted: true, id: ctx.params.lineId });
  },
});
