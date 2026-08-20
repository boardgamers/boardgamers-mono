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

export interface MailMessage {
	kind: MailKind;
	to: string;
	subject: string;
	html: string;
	/** Signed per-user unsubscribe URL (see unsubscribeUrl in models/user.ts).
	 * Adds the List-Unsubscribe header + a body link. */
	unsubscribe?: string;
}

export function buildMailData({ kind, to, subject, html, unsubscribe }: MailMessage): MailSendData {
	const body = unsubscribe
		? `${html}\n<p style="font-size: smaller; color: #666;">Don't want these emails? <a href="${unsubscribe}">Unsubscribe</a>.</p>`
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
	if (unsubscribe) {
		data["h:List-Unsubscribe"] = `<${unsubscribe}>`;
	}
	return data;
}

export function sendMail(message: MailMessage): Promise<unknown> {
	return sendmail(buildMailData(message));
}
