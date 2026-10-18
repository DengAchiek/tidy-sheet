import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', {
  id:text('id').primaryKey(), email:text('email').notNull(), name:text('name').notNull(),
  createdAt:integer('created_at').notNull(), trialEnds:integer('trial_ends').notNull().default(0),
});
export const subscriptions = sqliteTable('subscriptions', {
  userId:text('user_id').primaryKey().references(()=>accounts.id),
  customerCode:text('customer_code'), subscriptionCode:text('subscription_code'), planCode:text('plan_code'),
  tier:text('tier').notNull().default('premium'),status:text('status').notNull().default('none'),billingMode:text('billing_mode').notNull().default('live'), periodEnd:integer('period_end').notNull().default(0),
  lastPaidAt:integer('last_paid_at').notNull().default(0), revokedAt:integer('revoked_at').notNull().default(0),
  amount:integer('amount').notNull().default(0),currency:text('currency').notNull().default('KES'),
  verifiedAt:integer('verified_at').notNull().default(0), updatedAt:integer('updated_at').notNull(),
},t=>[uniqueIndex('subscriptions_code_unique').on(t.subscriptionCode),uniqueIndex('subscriptions_customer_unique').on(t.customerCode)]);
export const checkoutSessions=sqliteTable('checkout_sessions',{
  reference:text('reference').primaryKey(),userId:text('user_id').notNull().references(()=>accounts.id),
  email:text('email').notNull(),planCode:text('plan_code').notNull(),amount:integer('amount').notNull(),currency:text('currency').notNull(),
  billingMode:text('billing_mode').notNull().default('live'),checkoutUrl:text('checkout_url'),status:text('status').notNull().default('pending'),createdAt:integer('created_at').notNull(),
},t=>[index('checkout_user_status').on(t.userId,t.status),uniqueIndex('checkout_one_pending_user').on(t.userId).where(sql`${t.status} = 'pending'`)]);
export const paymentReceipts=sqliteTable('payment_receipts',{
  reference:text('reference').primaryKey(),userId:text('user_id').notNull().references(()=>accounts.id),
  transactionId:text('transaction_id').notNull(),billingMode:text('billing_mode').notNull().default('live'),subscriptionCode:text('subscription_code').notNull(),
  amount:integer('amount').notNull(),currency:text('currency').notNull(),paidAt:integer('paid_at').notNull(),
});
export const webhookEvents=sqliteTable('webhook_events',{id:text('id').primaryKey(),processedAt:integer('processed_at').notNull()});
export const usageEvents=sqliteTable('usage_events',{
  id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>accounts.id),
  mode:text('mode').notNull().default('business'),rowCount:integer('row_count').notNull(),columnCount:integer('column_count').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('usage_user_created').on(t.userId,t.createdAt)]);
