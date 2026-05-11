/**
 * Notification fan-out — email + Slack.
 *
 * Each channel has a real adapter selected by env vars and a console-log
 * fallback. Set neither and the app still works in dev — you just see what
 * would have been sent in the server log.
 *
 * Env vars (all optional):
 *   RESEND_API_KEY       — enable Resend (https://resend.com, 100/day free)
 *   RESEND_FROM_EMAIL    — verified sender (e.g. "Faro CMS <noreply@your.domain>")
 *                          Without a verified domain, use `onboarding@resend.dev`
 *                          for testing — only delivers to the address that owns
 *                          the Resend account.
 *   SLACK_WEBHOOK_URL    — incoming webhook (https://api.slack.com/messaging/webhooks)
 *   SLACK_BOT_TOKEN      — (future) enable real `<@USER_ID>` mentions via
 *                          `users.lookupByEmail`. Today we use plain-text
 *                          first-name mentions when the token isn't set.
 */

import { Resend } from "resend";

// ── Senders ──────────────────────────────────────────────────────────────────

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmail(msg: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "Faro CMS <onboarding@resend.dev>";

  if (!apiKey) {
    console.log(
      `[notifications] (log-only — RESEND_API_KEY unset)\n` +
        `  to:      ${msg.to}\n` +
        `  from:    ${from}\n` +
        `  subject: ${msg.subject}\n` +
        `  body:    ${msg.text}`
    );
    return;
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    if (error) {
      console.warn(`[notifications] Resend failed for ${msg.to}:`, error);
    }
  } catch (err) {
    console.warn(`[notifications] Resend threw for ${msg.to}:`, err);
  }
}

interface SlackMessage {
  text: string;
  /** Optional second-tier blocks for richer formatting. */
  blocks?: unknown[];
}

async function postSlack(msg: SlackMessage): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log(`[notifications] (log-only — SLACK_WEBHOOK_URL unset)\n  ${msg.text}`);
    return;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    if (!res.ok) {
      console.warn(`[notifications] Slack webhook returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[notifications] Slack webhook threw:`, err);
  }
}

// Strip the local-part of an email and Title-case the first segment so we have
// a friendlier mention than the raw address.
function displayName(email: string, name?: string): string {
  if (name && name.trim()) return name.trim();
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
}

// ── Public templates ─────────────────────────────────────────────────────────

interface ContributorInvited {
  email: string;
  name?: string;
}

/**
 * Fired when a contributor is added to the platform for the first time.
 * Sends an email; mirrors a brief notice to Slack so the admin team sees
 * onboarding activity.
 */
export async function notifyContributorInvited(c: ContributorInvited): Promise<void> {
  const greeting = c.name ? `Hello ${displayName(c.email, c.name).split(" ")[0]},` : "Hello,";
  const body =
    "you have been invited to contribute on Faro CMS. Please log in to see your pending articles.";

  await Promise.all([
    sendEmail({
      to: c.email,
      subject: "You've been invited to Faro CMS",
      text: `${greeting} ${body}`,
      html: `<p>${greeting}</p><p>${body}</p>`,
    }),
    postSlack({
      text: `:wave: New contributor added to Faro CMS: *${displayName(c.email, c.name)}* (${c.email}).`,
    }),
  ]);
}

interface ArticleSharedForReview {
  /** The contributor being asked to review. */
  reviewerEmail: string;
  reviewerName?: string;
  /** The tech writer who triggered the share — used in the message body. */
  techWriterName: string;
  techWriterEmail?: string;
  articleTitle: string;
  /** Used to construct a deep link in the Slack message. */
  articleFile: string;
  /** Origin like https://your-cms.example.com — falls back to a generic note. */
  baseUrl?: string;
}

/**
 * Fired when a tech writer adds a contributor to an article's reviewer list
 * (i.e. the email appears in `assignedTo` for the first time).
 */
export async function notifyArticleSharedForReview(
  a: ArticleSharedForReview
): Promise<void> {
  const reviewerFirstName = displayName(a.reviewerEmail, a.reviewerName).split(" ")[0];
  const greeting = `Hello ${reviewerFirstName},`;
  const body = `${a.techWriterName} has submitted an article for review in Faro CMS. Please log in to see your pending articles.`;

  const link = a.baseUrl
    ? `${a.baseUrl.replace(/\/$/, "")}/editor/${encodeURIComponent(a.articleFile)}`
    : null;

  await Promise.all([
    sendEmail({
      to: a.reviewerEmail,
      subject: `Review request: ${a.articleTitle}`,
      text: `${greeting}\n\n${body}${link ? `\n\nOpen the article: ${link}` : ""}`,
      html:
        `<p>${greeting}</p><p>${body}</p>` +
        (link
          ? `<p><a href="${link}">Open <em>${a.articleTitle}</em></a></p>`
          : `<p><em>${a.articleTitle}</em></p>`),
    }),
    postSlack({
      text:
        `:memo: *${displayName(a.reviewerEmail, a.reviewerName)}* — ` +
        `${a.techWriterName} submitted *${a.articleTitle}* for your review in Faro CMS.` +
        (link ? ` <${link}|Open article>` : ""),
    }),
  ]);
}
