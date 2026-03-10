import { NextResponse } from "next/server";
import { type Prisma } from "@prisma/client";
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
import { serializeInvoice } from "../../../../lib/serializers";
import { defineTransitions } from "../../../../lib/state-machine";

type InvStatus = "DRAFT" | "OPEN" | "PAID" | "VOID" | "UNCOLLECTIBLE" | "PAST_DUE";

export const invoiceMachine = defineTransitions<InvStatus>({
  DRAFT: ["OPEN", "VOID"],
  OPEN: ["PAID", "VOID", "UNCOLLECTIBLE", "PAST_DUE"],
  PAST_DUE: ["PAID", "VOID", "UNCOLLECTIBLE"],
  PAID: [],
  VOID: [],
  UNCOLLECTIBLE: [],
});

const createInvoiceSchema = z.object({
  customer_id: z.string().min(1),
  subscription_id: z.string().min(1).optional(),
  currency: z
    .string()
    .length(3)
    .transform((v) => v.toLowerCase()),
  due_date: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const POST = createHandler({
  auth: "merchant",
  idempotent: true,
  validate: createInvoiceSchema,
  handler: async (ctx) => {
    const invoice = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: ctx.body.customer_id, merchantId: ctx.merchantId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundError("CUSTOMER_NOT_FOUND", "Customer not found.");
      }

      if (ctx.body.subscription_id) {
        const subscription = await tx.subscription.findFirst({
          where: { id: ctx.body.subscription_id, merchantId: ctx.merchantId },
          select: { id: true },
        });
        if (!subscription) {
          throw new NotFoundError("SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
        }
      }

      const invoiceNumber = `INV-${Date.now()}`;

      const created = await tx.invoice.create({
        data: {
          merchantId: ctx.merchantId,
          customerId: customer.id,
          subscriptionId: ctx.body.subscription_id,
          number: invoiceNumber,
          status: "DRAFT",
          currency: ctx.body.currency,
          subtotal: 0,
          tax: 0,
          total: 0,
          amountPaid: 0,
          amountDue: 0,
          dueDate: ctx.body.due_date,
          metadata: ctx.body.metadata as Prisma.InputJsonValue | undefined,
        },
        include: { items: true },
      });

      await emitDomainEvent(tx, {
        merchantId: ctx.merchantId,
        type: "invoice.created",
        entityType: "Invoice",
        entityId: created.id,
        payload: serializeInvoice(created) as Record<string, unknown>,
        actorType: "api_key",
        actorId: ctx.apiKey.id,
      });

      return created;
    });

    return NextResponse.json(
      { invoice: serializeInvoice(invoice) },
      { status: 201 },
    );
  },
});

const listQuerySchema = paginationSchema.extend({
  customer_id: z.string().optional(),
  subscription_id: z.string().optional(),
  status: z.enum(["draft", "open", "paid", "void", "uncollectible", "past_due"]).optional(),
});

export const GET = createHandler({
  auth: "merchant",
  query: listQuerySchema,
  handler: async (ctx) => {
    const where: Prisma.InvoiceWhereInput = { merchantId: ctx.merchantId };
    if (ctx.query.customer_id) where.customerId = ctx.query.customer_id;
    if (ctx.query.subscription_id) where.subscriptionId = ctx.query.subscription_id;
    if (ctx.query.status) {
      where.status = ctx.query.status.toUpperCase() as Prisma.EnumInvoiceStatusFilter["equals"];
    }

    const skip = paginationSkip(ctx.query);
    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: invoices.map(serializeInvoice),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
