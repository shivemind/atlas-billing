/**
 * Entity serializers — convert Prisma models to snake_case API responses.
 * Billing-domain serializers only.
 */

// ── Customers ────────────────────────────────────────────────────────

export function serializeCustomer(customer: {
  id: string;
  merchantId: string;
  externalId: string | null;
  email: string | null;
  name: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: customer.id,
    merchant_id: customer.merchantId,
    external_id: customer.externalId,
    email: customer.email,
    name: customer.name,
    metadata: customer.metadata,
    created_at: customer.createdAt.toISOString(),
    updated_at: customer.updatedAt.toISOString(),
  };
}

// ── Subscriptions ───────────────────────────────────────────────────

export function serializeSubscription(sub: {
  id: string;
  merchantId: string;
  customerId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  endedAt: Date | null;
  trialStart: Date | null;
  trialEnd: Date | null;
  defaultPaymentMethod: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    subscriptionId: string;
    priceId: string;
    quantity: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: sub.id,
    merchant_id: sub.merchantId,
    customer_id: sub.customerId,
    status: sub.status.toLowerCase(),
    current_period_start: sub.currentPeriodStart.toISOString(),
    current_period_end: sub.currentPeriodEnd.toISOString(),
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    canceled_at: sub.canceledAt?.toISOString() ?? null,
    ended_at: sub.endedAt?.toISOString() ?? null,
    trial_start: sub.trialStart?.toISOString() ?? null,
    trial_end: sub.trialEnd?.toISOString() ?? null,
    default_payment_method: sub.defaultPaymentMethod,
    metadata: sub.metadata,
    created_at: sub.createdAt.toISOString(),
    updated_at: sub.updatedAt.toISOString(),
    items: sub.items?.map(serializeSubscriptionItem),
  };
}

export function serializeSubscriptionItem(item: {
  id: string;
  subscriptionId: string;
  priceId: string;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    subscription_id: item.subscriptionId,
    price_id: item.priceId,
    quantity: item.quantity,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

// ── Invoices ────────────────────────────────────────────────────────

export function serializeInvoice(inv: {
  id: string;
  merchantId: string;
  customerId: string;
  subscriptionId: string | null;
  number: string | null;
  status: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  dueDate: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    invoiceId: string;
    description: string;
    quantity: number;
    unitAmount: number;
    amount: number;
    currency: string;
    priceId: string | null;
    metadata: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) {
  return {
    id: inv.id,
    merchant_id: inv.merchantId,
    customer_id: inv.customerId,
    subscription_id: inv.subscriptionId,
    number: inv.number,
    status: inv.status.toLowerCase(),
    currency: inv.currency,
    subtotal: inv.subtotal,
    tax: inv.tax,
    total: inv.total,
    amount_paid: inv.amountPaid,
    amount_due: inv.amountDue,
    due_date: inv.dueDate?.toISOString() ?? null,
    paid_at: inv.paidAt?.toISOString() ?? null,
    voided_at: inv.voidedAt?.toISOString() ?? null,
    period_start: inv.periodStart?.toISOString() ?? null,
    period_end: inv.periodEnd?.toISOString() ?? null,
    metadata: inv.metadata,
    created_at: inv.createdAt.toISOString(),
    updated_at: inv.updatedAt.toISOString(),
    items: inv.items?.map(serializeInvoiceItem),
  };
}

export function serializeInvoiceItem(item: {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: string;
  priceId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    invoice_id: item.invoiceId,
    description: item.description,
    quantity: item.quantity,
    unit_amount: item.unitAmount,
    amount: item.amount,
    currency: item.currency,
    price_id: item.priceId,
    metadata: item.metadata,
    created_at: item.createdAt.toISOString(),
    updated_at: item.updatedAt.toISOString(),
  };
}

export function serializeInvoiceAttempt(attempt: {
  id: string;
  invoiceId: string;
  attemptNumber: number;
  amount: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}) {
  return {
    id: attempt.id,
    invoice_id: attempt.invoiceId,
    attempt_number: attempt.attemptNumber,
    amount: attempt.amount,
    status: attempt.status.toLowerCase(),
    error_message: attempt.errorMessage,
    created_at: attempt.createdAt.toISOString(),
  };
}

// ── Webhook Endpoints ────────────────────────────────────────────────

export function serializeWebhookEndpoint(
  endpoint: {
    id: string;
    merchantId: string;
    url: string;
    secret?: string;
    isActive: boolean;
    eventTypes: unknown;
    createdAt: Date;
    updatedAt: Date;
  },
  options?: { includeSecret?: boolean },
) {
  const result: Record<string, unknown> = {
    id: endpoint.id,
    merchant_id: endpoint.merchantId,
    url: endpoint.url,
    is_active: endpoint.isActive,
    enabled_events: endpoint.eventTypes,
    created_at: endpoint.createdAt.toISOString(),
    updated_at: endpoint.updatedAt.toISOString(),
  };
  if (options?.includeSecret && endpoint.secret) {
    result.secret = endpoint.secret;
  }
  return result;
}

// ── Webhook Deliveries ───────────────────────────────────────────────

export function serializeWebhookDelivery(delivery: {
  id: string;
  merchantId: string;
  webhookEndpointId: string;
  eventType: string;
  payload: unknown;
  status: string;
  deliveredAt: Date | null;
  nextAttemptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  attempts?: Array<{
    attemptNumber: number;
    responseStatus: number | null;
    createdAt: Date;
    completedAt: Date | null;
  }>;
}) {
  return {
    id: delivery.id,
    merchant_id: delivery.merchantId,
    webhook_endpoint_id: delivery.webhookEndpointId,
    event_type: delivery.eventType,
    payload: delivery.payload,
    status: delivery.status,
    delivered_at: delivery.deliveredAt?.toISOString() ?? null,
    next_attempt_at: delivery.nextAttemptAt?.toISOString() ?? null,
    created_at: delivery.createdAt.toISOString(),
    updated_at: delivery.updatedAt.toISOString(),
    attempts: delivery.attempts?.map((a) => ({
      attempt_number: a.attemptNumber,
      response_status: a.responseStatus,
      created_at: a.createdAt.toISOString(),
      completed_at: a.completedAt?.toISOString() ?? null,
    })),
  };
}

// ── Events ───────────────────────────────────────────────────────────

export function serializeEvent(event: {
  id: string;
  merchantId: string;
  type: string;
  entityType: string;
  entityId: string;
  payload: unknown;
  actorType: string | null;
  actorId: string | null;
  createdAt: Date;
}) {
  return {
    id: event.id,
    merchant_id: event.merchantId,
    type: event.type,
    entity_type: event.entityType,
    entity_id: event.entityId,
    payload: event.payload,
    actor_type: event.actorType,
    actor_id: event.actorId,
    created_at: event.createdAt.toISOString(),
  };
}

// ── API Key / Identity ───────────────────────────────────────────────

export function serializeIdentity(
  merchant: { id: string; name: string; status: string },
  apiKey: {
    id: string;
    name: string;
    role: string;
    scopes: string[];
    keyPrefix: string;
    createdAt: string;
    lastUsedAt: string | null;
  },
) {
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      status: merchant.status,
    },
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      role: apiKey.role,
      scopes: apiKey.scopes,
      keyPrefix: apiKey.keyPrefix,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
    },
  };
}
