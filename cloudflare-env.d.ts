declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    PAYSTACK_SECRET_KEY?:string;
    PAYSTACK_REGULAR_PLAN_CODE?:string;
    PAYSTACK_MONTHLY_PLAN_CODE?:string;
    PAYSTACK_ANNUAL_PLAN_CODE?:string;
    APP_URL?:string;
    TRIAL_DAYS?:string;
    SUPPORT_EMAIL?:string;
  }
}
