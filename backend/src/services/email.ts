import * as brevo from "@getbrevo/brevo";

const brevoApiInstance = new brevo.TransactionalEmailsApi();
brevoApiInstance.setApiKey(
  brevo.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY || ""
);

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@example.com";
const FROM_NAME = process.env.FROM_NAME || "Construction Tracker";

export async function sendTestEmail(to: string) {
  const email = new brevo.SendSmtpEmail();
  email.subject = "Test Email";
  email.htmlContent = "<p>This is a test email from Construction Tracker.</p>";
  email.sender = { name: FROM_NAME, email: FROM_EMAIL };
  email.to = [{ email: to }];
  const result = await brevoApiInstance.sendTransacEmail(email);
  return result.body.messageId;
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  const email = new brevo.SendSmtpEmail();
  email.subject = "Password Reset";
  email.htmlContent = `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password.</p><p>This link expires in 1 hour.</p>`;
  email.sender = { name: FROM_NAME, email: FROM_EMAIL };
  email.to = [{ email: to }];
  const result = await brevoApiInstance.sendTransacEmail(email);
  return result.body.messageId;
}

export { FROM_EMAIL, FROM_NAME };
