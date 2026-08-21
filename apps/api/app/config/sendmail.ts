import Mailgun from "mailgun-js";
import env from "./env.ts";

// The mailgun-js typings omit the List-Unsubscribe headers, but any `h:*`
// custom header is passed through to the message (#2).
export type MailSendData = Mailgun.messages.SendData & {
	"h:List-Unsubscribe"?: string;
	"h:List-Unsubscribe-Post"?: string;
};

// A message must be POSTed to the Mailgun domain matching its From address —
// DKIM is signed with the sending domain's key, so posting newsletter mail
// (From newsletter.<domain>) through the transactional domain would emit
// misaligned mail. One lazily-built client per sending domain.
const clients = new Map<string, Mailgun.Mailgun>();
function clientFor(domain: string): Mailgun.Mailgun {
	let client = clients.get(domain);
	if (!client) {
		client = Mailgun({ apiKey: env.mailing.api.key, domain, host: env.mailing.api.host });
		clients.set(domain, client);
	}
	return client;
}

type Sendmail = (data: MailSendData, domain?: string) => Promise<unknown>;

const mailgunSend: Sendmail = (data, domain = env.mailing.domain.standard) => clientFor(domain).messages().send(data);
let sendmail = mailgunSend;

// Tests swap in a recorder to assert on outbound mail without touching Mailgun.
export function setSendmailForTests(mock: Sendmail | null) {
	sendmail = mock ?? mailgunSend;
}

export default (data: MailSendData, domain?: string) => sendmail(data, domain);
