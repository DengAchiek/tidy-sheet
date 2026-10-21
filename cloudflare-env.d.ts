declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    TIDYSHEET_IDENTITY_MODE?: "disabled";
    ADMIN_INVITE_EMAIL?: string;
    ADMIN_INVITE_HASH?: string;
    BUCKET?: R2Bucket;
    PAYSTACK_SECRET_KEY?:string;
    PAYSTACK_REGULAR_PLAN_CODE?:string;
    PAYSTACK_MONTHLY_PLAN_CODE?:string;
    PAYSTACK_ANNUAL_PLAN_CODE?:string;
    APP_URL?:string;
    TRIAL_DAYS?:string;
    SUPPORT_EMAIL?:string;
    RESEND_API_KEY?:string;
    RECOVERY_EMAIL_FROM?:string;
    CLEANING_API_URL?:string;
    CLEANING_API_TOKEN?:string;
    CLEANING_LOCAL_DEV?:string;
  }
}
