import Mailgun from "mailgun-js";
import env from "./env";

const mailgun = Mailgun({
  apiKey: env.mailing.api.key,
  domain: env.mailing.domain.standard,
  host: env.mailing.api.host,
});

// TODO: switch based on env.useMailgun between the two
// import SendMail from 'sendmail';
// const sendmail = new SendMail();

const sendmail = (data) => mailgun.messages().send(data);

export default sendmail;
