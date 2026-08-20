import { convert } from "html-to-text";
import env from "../config/env.ts";
import sendmail, { type MailSendData } from "../config/sendmail.ts";

export type MailKind = "confirm" | "reset" | "mail-change" | "your-turn" | "game-cancelled";

export interface MailMessage {
	kind: MailKind;
	to: string;
	subject: string;
	html: string;
	/** Where "unsubscribe/manage notifications" points. Adds the List-Unsubscribe header + a body link. */
	unsubscribe?: string;
}

export function buildMailData({ kind, to, subject, html, unsubscribe }: MailMessage): MailSendData {
	const body = unsubscribe
		? `${html}\n<p style="font-size: smaller; color: #666;">Don't want these emails? <a href="${unsubscribe}">Manage your email notifications</a>.</p>`
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
