import { convert } from "html-to-text";
import env from "../config/env.ts";
import sendmail, { type MailSendData } from "../config/sendmail.ts";

export type MailKind = "confirm" | "reset" | "mail-change" | "your-turn" | "game-cancelled" | "newsletter";

// Unsubscribable kinds map to the mailing setting they flip (see
// applyUnsubscribe in models/user.ts); transactional kinds are absent.
export const unsubscribeScopes = {
	"your-turn": "game",
	"game-cancelled": "game",
	newsletter: "newsletter",
} as const satisfies Partial<Record<MailKind, string>>;

export type UnsubscribeScope = (typeof unsubscribeScopes)[keyof typeof unsubscribeScopes];

/** The human unsubscribe landing page (GET-describe, button POSTs). */
export function unsubscribePageUrl(token: string): string {
	return `https://${env.site}/unsubscribe?token=${token}`;
}

/**
 * RFC 8058 one-click endpoint — the List-Unsubscribe header target. Mail
 * providers POST this exact URI with a `List-Unsubscribe=One-Click` form body;
 * a browser opening it (GET) is redirected to the landing page instead.
 */
export function unsubscribeOneClickUrl(token: string): string {
	return `https://${env.site}/api/account/unsubscribe/one-click?token=${token}`;
}

export interface MailMessage {
	kind: MailKind;
	to: string;
	subject: string;
	html: string;
	/** Signed unsubscribe token (see signUnsubscribeToken in models/user.ts).
	 * Adds the RFC 8058 List-Unsubscribe(-Post) headers + a body footer link
	 * to the landing page. */
	unsubscribeToken?: string;
}

export function buildMailData({ kind, to, subject, html, unsubscribeToken }: MailMessage): MailSendData {
	const body = unsubscribeToken
		? `${html}\n<p style="font-size: smaller; color: #666;">Don't want these emails? <a href="${unsubscribePageUrl(unsubscribeToken)}">Unsubscribe</a>.</p>`
		: html;

	const data: MailSendData = {
		from: env.noreply,
		to,
		subject,
		html: body,
		text: convert(body, { wordwrap: false }),
		"o:tag": [kind],
		"h:Reply-To": env.contact,
	};
	if (unsubscribeToken) {
		// One-click (RFC 8058): the header URI is what providers POST to; the
		// body link stays on the human landing page. Gmail/Yahoo require this
		// pair for bulk senders — and it's what makes their native
		// "Unsubscribe" button work.
		data["h:List-Unsubscribe"] = `<${unsubscribeOneClickUrl(unsubscribeToken)}>`;
		data["h:List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
	}
	return data;
}

export function sendMail(message: MailMessage): Promise<unknown> {
	return sendmail(buildMailData(message));
}
