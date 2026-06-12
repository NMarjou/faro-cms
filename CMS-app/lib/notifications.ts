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

interface SuggestionResolved {
  /** Contributor who originally submitted the suggestion. */
  contributorEmail: string;
  contributorName?: string;
  /** Tech writer who accepted/rejected. */
  resolverName: string;
  resolverEmail?: string;
  /** "accept" or "reject" */
  action: "accept" | "reject";
  /** A short preview of the suggestion so the contributor remembers it. */
  originalText: string;
  suggestedText: string;
  articleTitle: string;
  articleFile: string;
  baseUrl?: string;
}

/**
 * Fired when a tech writer accepts or rejects a contributor's suggestion.
 * Lets the contributor know their proposed edit landed or was declined
 * without having to refresh the review drawer.
 */
export async function notifySuggestionResolved(s: SuggestionResolved): Promise<void> {
  const firstName = displayName(s.contributorEmail, s.contributorName).split(" ")[0];
  const greeting = `Hello ${firstName},`;
  const verb = s.action === "accept" ? "accepted" : "declined";
  const body =
    s.action === "accept"
      ? `${s.resolverName} ${verb} your suggested edit on “${s.articleTitle}”. It's now part of the article.`
      : `${s.resolverName} ${verb} your suggested edit on “${s.articleTitle}”. Open the article to see other pending suggestions or propose another change.`;

  const link = s.baseUrl
    ? `${s.baseUrl.replace(/\/$/, "")}/editor/${encodeURIComponent(s.articleFile)}`
    : null;

  // Truncated preview, single line, in case the suggestion is long.
  const preview = (txt: string) => (txt.length > 60 ? txt.slice(0, 60) + "…" : txt);

  await Promise.all([
    sendEmail({
      to: s.contributorEmail,
      subject:
        s.action === "accept"
          ? `Your suggestion was accepted: ${s.articleTitle}`
          : `Your suggestion was declined: ${s.articleTitle}`,
      text:
        `${greeting}\n\n${body}\n\n` +
        `Original: ${preview(s.originalText)}\n` +
        `Suggested: ${preview(s.suggestedText)}` +
        (link ? `\n\nOpen the article: ${link}` : ""),
      html:
        `<p>${greeting}</p>` +
        `<p>${body}</p>` +
        `<blockquote style="border-left:3px solid #c8881a;padding-left:10px;color:#5a6a82">` +
        `<div><s>${preview(s.originalText)}</s></div>` +
        `<div><em>${preview(s.suggestedText)}</em></div>` +
        `</blockquote>` +
        (link
          ? `<p><a href="${link}">Open <em>${s.articleTitle}</em></a></p>`
          : ""),
    }),
    postSlack({
      text:
        s.action === "accept"
          ? `:white_check_mark: *${displayName(s.contributorEmail, s.contributorName)}* — ${s.resolverName} accepted your suggestion on *${s.articleTitle}*.` +
            (link ? ` <${link}|Open article>` : "")
          : `:x: *${displayName(s.contributorEmail, s.contributorName)}* — ${s.resolverName} declined your suggestion on *${s.articleTitle}*.` +
            (link ? ` <${link}|Open article>` : ""),
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

interface ReviewMarkedDone {
  /** Tech writer(s) to notify — usually just the original assigner. */
  recipientEmails: string[];
  /** The contributor who finished the review. */
  reviewerEmail: string;
  reviewerName?: string;
  articleTitle: string;
  articleFile: string;
  baseUrl?: string;
  /** Counts so the tech writer knows where the article stands. */
  reviewsDoneCount: number;
  totalReviewers: number;
}

/**
 * Fired when a contributor flips Mark-as-done on an article they were
 * assigned to. Lands one email per recipient + a single Slack post that
 * tags them all.
 */
export async function notifyReviewMarkedDone(n: ReviewMarkedDone): Promise<void> {
  if (n.recipientEmails.length === 0) return;
  const reviewerLabel = displayName(n.reviewerEmail, n.reviewerName);
  const allDone = n.reviewsDoneCount === n.totalReviewers;
  const progress = `${n.reviewsDoneCount}/${n.totalReviewers}`;
  const link = n.baseUrl
    ? `${n.baseUrl.replace(/\/$/, "")}/editor/${encodeURIComponent(n.articleFile)}`
    : null;

  const subject = allDone
    ? `Review complete: ${n.articleTitle}`
    : `Review progress (${progress}): ${n.articleTitle}`;

  const body = allDone
    ? `${reviewerLabel} marked the review of "${n.articleTitle}" as done. All assigned reviewers have signed off (${progress}).`
    : `${reviewerLabel} marked the review of "${n.articleTitle}" as done. Reviewer progress: ${progress}.`;

  await Promise.all([
    ...n.recipientEmails.map((to) =>
      sendEmail({
        to,
        subject,
        text:
          `${body}` +
          (link ? `\n\nOpen the article: ${link}` : ""),
        html:
          `<p>${body}</p>` +
          (link
            ? `<p><a href="${link}">Open <em>${n.articleTitle}</em></a></p>`
            : ""),
      })
    ),
    postSlack({
      text:
        (allDone ? ":white_check_mark:" : ":eyes:") +
        ` *${reviewerLabel}* marked the review of *${n.articleTitle}* done (${progress}).` +
        (link ? ` <${link}|Open article>` : ""),
    }),
  ]);
}

interface ReviewSignedOff {
  /** Contributors to ping — typically the article's `assignedTo` list. */
  recipientEmails: string[];
  /** Map of email → display name so the email greeting can be personal. */
  recipientNames?: Record<string, string | undefined>;
  /** The tech writer who signed off. */
  techWriterName: string;
  techWriterEmail?: string;
  articleTitle: string;
  articleFile: string;
  baseUrl?: string;
}

/**
 * Fired when a tech writer flips the article-level `reviewComplete` flag.
 * Pings each contributor who was assigned to the review so they know the
 * round closed and their suggestions won't be actioned further.
 */
export async function notifyReviewSignedOff(
  n: ReviewSignedOff
): Promise<void> {
  if (n.recipientEmails.length === 0) return;
  const link = n.baseUrl
    ? `${n.baseUrl.replace(/\/$/, "")}/editor/${encodeURIComponent(n.articleFile)}`
    : null;
  const subject = `Review signed off: ${n.articleTitle}`;

  await Promise.all([
    ...n.recipientEmails.map((to) => {
      const firstName = displayName(to, n.recipientNames?.[to.toLowerCase()]).split(" ")[0];
      const body =
        `${n.techWriterName} has marked the review of "${n.articleTitle}" as done. ` +
        `The review round is now closed — thanks for your input.`;
      return sendEmail({
        to,
        subject,
        text:
          `Hello ${firstName},\n\n${body}` +
          (link ? `\n\nOpen the article: ${link}` : ""),
        html:
          `<p>Hello ${firstName},</p><p>${body}</p>` +
          (link
            ? `<p><a href="${link}">Open <em>${n.articleTitle}</em></a></p>`
            : ""),
      });
    }),
    postSlack({
      text:
        `:lock: *${n.techWriterName}* signed off the review of *${n.articleTitle}*.` +
        (link ? ` <${link}|Open article>` : ""),
    }),
  ]);
}

interface ArticleSubmittedForApproval {
  /** Tech writer(s) to notify — they sign off by publishing. */
  recipientEmails: string[];
  /** The author who submitted the article. */
  submitterEmail: string;
  submitterName?: string;
  articleTitle: string;
  articleFile: string;
  baseUrl?: string;
}

/**
 * Fired when an author submits one of their own articles for tech-writer
 * sign-off. Lands one email per tech writer + a single Slack post. Publishing
 * the article is the sign-off — there's no separate approve action.
 */
export async function notifyArticleSubmittedForApproval(
  a: ArticleSubmittedForApproval
): Promise<void> {
  if (a.recipientEmails.length === 0) return;
  const submitterLabel = displayName(a.submitterEmail, a.submitterName);
  const link = a.baseUrl
    ? `${a.baseUrl.replace(/\/$/, "")}/editor/${encodeURIComponent(a.articleFile)}`
    : null;

  const subject = `Approval requested: ${a.articleTitle}`;
  const body = `${submitterLabel} submitted "${a.articleTitle}" for your sign-off in Faro CMS. Review it and publish to approve.`;

  await Promise.all([
    ...a.recipientEmails.map((to) =>
      sendEmail({
        to,
        subject,
        text: `${body}${link ? `\n\nOpen the article: ${link}` : ""}`,
        html:
          `<p>${body}</p>` +
          (link
            ? `<p><a href="${link}">Open <em>${a.articleTitle}</em></a></p>`
            : `<p><em>${a.articleTitle}</em></p>`),
      })
    ),
    postSlack({
      text:
        `:lock: *${submitterLabel}* submitted *${a.articleTitle}* for sign-off in Faro CMS.` +
        (link ? ` <${link}|Review &amp; publish>` : ""),
    }),
  ]);
}
