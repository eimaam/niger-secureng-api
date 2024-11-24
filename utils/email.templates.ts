export const emailTemplates = {
    PASSWORD_RESET_CODE: (code: string) => `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                .container { max-width: 600px; margin: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; padding: 20px; }
                .header { text-align: center; padding: 20px 0; }
                .content { background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .code { background: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0; border-radius: 4px; }
                .btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body style="background-color: #f8fafc; margin: 0; padding: 20px;">
            <div class="container">
                <div class="header">
                    <h2 style="color: #1e293b;">SecureNG</h2>
                    <p style="color: #64748b;">Bexil Group</p>
                </div>
                <div class="content">
                    <h1 style="color: #1e293b; font-size: 20px;">Password Reset Request</h1>
                    <p style="color: #475569;">You recently requested to reset your password for your SecureNG account. Use the code below to complete the process:</p>
                    
                    <div class="code">
                        <strong>${code}</strong>
                    </div>
                    
                    <p style="color: #475569;">This token will expire in <strong>30 mins</strong>. If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
                    
                    <p style="color: #475569;">For security reasons, this link can only be used once. If you need to reset your password again, please request another reset.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} Bexil Group. All rights reserved.</p>
                    <p>This is an automated message, please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
    `,
    PASSWORD_RESET_LINK: (resetLink: string) => `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                .container { max-width: 600px; margin: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; padding: 20px; }
                .header { text-align: center; padding: 20px 0; }
                .content { background: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .code { background: #f5f5f5; padding: 15px; text-align: center; font-size: 24px; letter-spacing: 5px; margin: 20px 0; border-radius: 4px; }
                .btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: black; text-decoration: none; border-radius: 6px; margin: 20px 0; }
                .footer { text-align: center; color: #666; font-size: 12px; margin-top: 20px; }
            </style>
        </head>
        <body style="background-color: #f8fafc; margin: 0; padding: 20px;">
            <div class="container">
                <div class="header">
                    <h2 style="color: #1e293b;">SecureNG</h2>
                    <p style="color: #64748b;">Bexil Group</p>
                </div>
                <div class="content">
                    <h1 style="color: #1e293b; font-size: 20px;">Password Reset Request</h1>
                    <p style="color: #475569;">You recently requested to reset your password for your SecureNG account. Click the button below to reset your password:</p>
                    
                    <div style="text-align: center; margin: 30px 0;">
                        <a href="${resetLink}" class="btn">Reset Password</a>
                    </div>
                    
                    <p style="color: #475569;">This link will expire in <strong>30 mins</strong>. If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
                    
                    <p style="color: #475569;">For security reasons, this link can only be used once. If you need to reset your password again, please request another reset.</p>
                </div>
                <div class="footer">
                    <p>© ${new Date().getFullYear()} Bexil Group. All rights reserved.</p>
                    <p>This is an automated message, please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
    `
}