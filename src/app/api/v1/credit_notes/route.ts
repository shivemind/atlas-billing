import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../lib/handler";
import { NotFoundError } from "../../../../lib/errors";
import { emitDomainEvent } from "../../../../lib/events";
import { prisma } from "../../../../lib/prisma";

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

const createSchema = z.object({
  invoice_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  validate: createSchema,
  handler: async (ctx) => {
    const creditNote = await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: ctx.body.invoice_id, merchantId: ctx.merchantId },
      });
      if (!invoice) {
        throw new NotFoundError("INVOICE_NOT_FOUND", "Invoice not found.");
      }

      const count = await tx.creditNote.count({
        where: { merchantId: ctx.merchantId },
      });
      const number = `CN-${String(count + 1).padStart(6, "0")}`;

      const created = await tx.creditNote.create({
        data: {
          merchantId: ctx.merchantId,
          invoiceId: ctx.body.invoice_id,
          number,
          amount: ctx.body.amount,
          currency: ctx.body.currency,
          reason: ctx.body.reason,
          metadata: ctx.body.metadata ?? {},
        },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "credit_note.created",
        entityType: "CreditNote",
        entityId: created.id,
        payload: serializeCreditNote(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { credit_note: serializeCreditNote(creditNote) },
      { status: 201 },
    );
  },
});

const listQuery = paginationSchema.extend({
  invoice_id: z.string().optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuery,
  handler: async (ctx) => {
    const where: Record<string, unknown> = { merchantId: ctx.merchantId };
    if (ctx.query.invoice_id) where.invoiceId = ctx.query.invoice_id;

    const skip = paginationSkip(ctx.query);
    const [total, creditNotes] = await Promise.all([
      prisma.creditNote.count({ where }),
      prisma.creditNote.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: creditNotes.map(serializeCreditNote),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
