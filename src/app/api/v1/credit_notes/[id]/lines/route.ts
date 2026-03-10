import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../../../lib/handler";
import { NotFoundError, ConflictError } from "../../../../../../lib/errors";
import { emitDomainEvent } from "../../../../../../lib/events";
import { prisma } from "../../../../../../lib/prisma";

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

const createLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive().default(1),
  unit_amount: z.number().int().positive(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createLineSchema,
  handler: async (ctx) => {
    const line = await prisma.$transaction(async (tx) => {
      const cn = await tx.creditNote.findFirst({
        where: { id: ctx.params.id, merchantId: ctx.merchantId },
      });
      if (!cn) {
        throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
      }
      if (cn.status === "VOID") {
        throw new ConflictError(
          "CREDIT_NOTE_VOID",
          "Cannot add lines to a voided credit note.",
        );
      }

      const amount = ctx.body.quantity * ctx.body.unit_amount;

      const created = await tx.creditNoteLineItem.create({
        data: {
          creditNoteId: cn.id,
          description: ctx.body.description,
          quantity: ctx.body.quantity,
          unitAmount: ctx.body.unit_amount,
          amount,
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "credit_note.line_item.created",
        entityType: "CreditNoteLineItem",
        entityId: created.id,
        payload: serializeLineItem(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { line_item: serializeLineItem(line) },
      { status: 201 },
    );
  },
});

export const GET = createHandler({
  auth: "merchant",
  query: paginationSchema,
  handler: async (ctx) => {
    const cn = await prisma.creditNote.findFirst({
      where: { id: ctx.params.id, merchantId: ctx.merchantId },
    });
    if (!cn) {
      throw new NotFoundError("CREDIT_NOTE_NOT_FOUND", "Credit note not found.");
    }

    const skip = paginationSkip(ctx.query);
    const where = { creditNoteId: cn.id };
    const [total, lines] = await Promise.all([
      prisma.creditNoteLineItem.count({ where }),
      prisma.creditNoteLineItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: lines.map(serializeLineItem),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
