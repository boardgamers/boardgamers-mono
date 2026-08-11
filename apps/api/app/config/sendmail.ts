import Mailgun from "mailgun-js";
import env from "./env.ts";

export type MailSendData = Mailgun.messages.SendData;

const mailgun = Mailgun({
	apiKey: env.mailing.api.key,
	domain: env.mailing.domain.standard,
	host: env.mailing.api.host,
});

type Sendmail = (data: MailSendData) => Promise<unknown>;

const mailgunSend: Sendmail = (data) => mailgun.messages().send(data);
let sendmail = mailgunSend;

// Tests swap in a recorder to assert on outbound mail without touching Mailgun.
export function setSendmailForTests(mock: Sendmail | null) {
	sendmail = mock ?? mailgunSend;
}

export default (data: MailSendData) => sendmail(data);
