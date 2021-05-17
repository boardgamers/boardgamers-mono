import Mailgun from "mailgun-js";
import env from "./env";

const mailgun = Mailgun({
  apiKey: env.mailing.api.key,
  domain: env.mailing.domain.standard,
  host: env.mailing.api.host,
});

const sendmail = (data: Mailgun.messages.SendData) => mailgun.messages().send(data);

export default sendmail;
