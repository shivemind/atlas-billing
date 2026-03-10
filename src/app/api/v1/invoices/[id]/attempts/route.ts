import { NextResponse } from "next/server";

import {
  createHandler,
  paginationSchema,
  paginationMeta,
  paginationSkip,
} from "../../../../../../lib/handler";
import { NotFoundError } from "../../../../../../lib/errors";
import { prisma } from "../../../../../../lib/prisma";
import { serializeInvoiceAttempt } from "../../../../../../lib/serializers";

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
    const [total, attempts] = await Promise.all([
      prisma.invoiceAttempt.count({ where: { invoiceId: invoice.id } }),
      prisma.invoiceAttempt.findMany({
        where: { invoiceId: invoice.id },
        orderBy: { attemptNumber: "asc" },
        skip,
        take: ctx.query.pageSize,
      }),
    ]);

    return NextResponse.json({
      data: attempts.map(serializeInvoiceAttempt),
      pagination: paginationMeta(ctx.query, total),
    });
  },
});
