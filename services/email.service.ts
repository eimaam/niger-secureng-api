import dotenv from "dotenv";
dotenv.config();
import { Resend } from "resend";
import { Config } from "../utils/config";
import { EMAIL_SUBJECTS } from "../utils/constants";
import { emailTemplates } from "../utils/email.templates";

const resend = new Resend(Config.RESEND_API_KEY);

export class EmailService {
  static async sendPasswordResetEmail(email: string, link: string) {
    const { data, error } = await resend.emails.send({
      from: `${Config.PROJECT_NAME} <${Config.RESEND_SENDING_EMAIL}>`,
      to: [email],
      subject: EMAIL_SUBJECTS.PASSWORD_RESET,
      html: emailTemplates.PASSWORD_RESET_LINK(link),
    });

    if (error) {
      console.log("Error sending Password Reset Email", error);
      throw new Error("There was a problem sending Password Reset Email");
    }

    return data;
  }
}
