# AtlasPayments Billing Service

Subscription billing microservice extracted from the AtlasPayments monorepo. Handles the full billing lifecycle: product catalog, pricing, coupons, promotion codes, tax rates, subscriptions, invoices, credit notes, and adjustments.

## Domain

| Resource | Description |
|---|---|
| **Products** | Catalog items merchants sell |
| **Prices** | Pricing tiers (one-time or recurring) attached to products |
| **Coupons** | Discount definitions (amount or percent off) |
| **Promotion Codes** | Redeemable codes linked to coupons |
| **Tax Rates** | Tax rate configurations per jurisdiction |
| **Subscriptions** | Recurring billing agreements with customers |
| **Invoices** | Billing documents with line items, payment tracking |
| **Credit Notes** | Credits issued against invoices |
| **Adjustments** | Manual credit/debit adjustments to merchant accounts |

## API Routes

All billing routes live under `/api/v1/` and require `MerchantKeyAuth` (Bearer token).

```
GET/POST   /api/v1/products
GET/PATCH/DELETE  /api/v1/products/:id
GET        /api/v1/products/:id/prices

GET/POST   /api/v1/prices
GET/PATCH  /api/v1/prices/:id

GET/POST   /api/v1/coupons
GET/PATCH/DELETE  /api/v1/coupons/:id

GET/POST   /api/v1/promotion_codes
GET/PATCH  /api/v1/promotion_codes/:id

GET/POST   /api/v1/tax_rates
GET/PATCH/DELETE  /api/v1/tax_rates/:id

GET/POST   /api/v1/subscriptions
GET/PATCH  /api/v1/subscriptions/:id
POST       /api/v1/subscriptions/:id/cancel
POST       /api/v1/subscriptions/:id/pause
POST       /api/v1/subscriptions/:id/resume
GET/POST   /api/v1/subscriptions/:id/items
GET/PATCH/DELETE  /api/v1/subscriptions/:id/items/:itemId

GET/POST   /api/v1/invoices
GET/PATCH  /api/v1/invoices/:id
POST       /api/v1/invoices/:id/finalize
POST       /api/v1/invoices/:id/pay
POST       /api/v1/invoices/:id/void
GET        /api/v1/invoices/:id/attempts
GET/POST   /api/v1/invoices/:id/items
GET/PATCH/DELETE  /api/v1/invoices/:id/items/:itemId

GET/POST   /api/v1/credit_notes
GET/PATCH  /api/v1/credit_notes/:id
POST       /api/v1/credit_notes/:id/void
GET/POST   /api/v1/credit_notes/:id/lines
GET/PATCH/DELETE  /api/v1/credit_notes/:id/lines/:lineId

GET/POST   /api/v1/adjustments
GET        /api/v1/adjustments/:id

GET        /api/health
```

## Setup

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env

# Generate Prisma client
pnpm prisma:generate

# Run migrations
pnpm prisma:migrate:dev

# Start development server (port 3002)
pnpm dev
```

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start dev server on port 3002 |
| `pnpm build` | Production build |
| `pnpm start` | Start production server on port 3002 |
| `pnpm test` | Generate Prisma client and run tests |
| `pnpm lint` | ESLint |
| `pnpm openapi:validate` | Validate OpenAPI spec structure |
| `pnpm openapi:lint` | Spectral lint on OpenAPI spec |
| `pnpm prisma:generate` | Generate Prisma client |
| `pnpm prisma:migrate:dev` | Run development migrations |
| `pnpm format` | Format with Prettier |

## Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **ORM**: Prisma (PostgreSQL)
- **Validation**: Zod
- **Caching/Rate Limiting**: Upstash Redis
- **Testing**: Vitest

## Deterministic Mock Processor

Invoice payment uses a deterministic mock processor:
- Amount divisible by 10 → `paid`
- Amount divisible by 5 (not 10) → `uncollectible`
- All other amounts → payment failed (status unchanged)
